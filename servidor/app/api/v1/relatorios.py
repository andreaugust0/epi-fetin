"""Relatórios de conformidade.

Divididos em dois públicos, de propósito.

Os três primeiros (`conformidade`, `epis-faltantes`, `biometria`) respondem
perguntas de quem opera e de quem calibra o sistema. Os quatro últimos
(`panorama`, `tendencia`, `horarios`, `reincidencia`) respondem a pergunta
de quem paga: o que este equipamento mudou na minha operação?

A diferença não é cosmética. Um gerente de segurança quer saber qual EPI
falta mais; um dono de empresa quer saber se o número de gente entrando sem
capacete caiu desde que instalou isso — e, se caiu, quer poder mostrar a
curva. Todos saem dos mesmos registros; nenhum campo novo foi criado para
eles.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DB, admin_atual
from app.core.config import settings
from app.db.models import (
    Deteccao,
    EventoAcesso,
    Pessoa,
    PontoAcesso,
    StatusVerificacao,
    TipoEpi,
    TipoEventoAcesso,
    UsuarioAdmin,
    Verificacao,
)

router = APIRouter(tags=["relatórios"])


@router.get("/relatorios/conformidade")
async def conformidade(
    dias: int = Query(30, ge=1, le=365),
    _: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> dict:
    """Taxa de aprovação por ponto no período."""
    desde = datetime.now(timezone.utc) - timedelta(days=dias)
    aprovadas = func.count(
        case((Verificacao.status == StatusVerificacao.APROVADA, 1))
    )
    stmt = (
        select(
            PontoAcesso.id,
            PontoAcesso.nome,
            func.count(Verificacao.id).label("total"),
            aprovadas.label("aprovadas"),
        )
        .join(Verificacao, Verificacao.ponto_id == PontoAcesso.id)
        .where(Verificacao.iniciada_em >= desde)
        .group_by(PontoAcesso.id, PontoAcesso.nome)
        .order_by(PontoAcesso.nome)
    )
    linhas = (await db.execute(stmt)).all()
    return {
        "periodo_dias": dias,
        "pontos": [
            {
                "ponto_id": pid,
                "nome": nome,
                "total": total,
                "aprovadas": aprov,
                "taxa_conformidade": round(100 * aprov / total, 1) if total else None,
            }
            for pid, nome, total, aprov in linhas
        ],
    }


@router.get("/relatorios/epis-faltantes")
async def epis_faltantes(
    dias: int = Query(30, ge=1, le=365),
    _: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> dict:
    """EPI mais esquecido por ponto — o relatório que vira ação de treinamento."""
    desde = datetime.now(timezone.utc) - timedelta(days=dias)
    faltas = func.count(case((Deteccao.presente.is_(False), 1)))
    stmt = (
        select(
            PontoAcesso.nome,
            TipoEpi.rotulo,
            func.count(Deteccao.id).label("total"),
            faltas.label("faltas"),
        )
        .join(Verificacao, Verificacao.id == Deteccao.verificacao_id)
        .join(PontoAcesso, PontoAcesso.id == Verificacao.ponto_id)
        .join(TipoEpi, TipoEpi.id == Deteccao.tipo_epi_id)
        .where(Verificacao.iniciada_em >= desde)
        .group_by(PontoAcesso.nome, TipoEpi.rotulo)
        .order_by(faltas.desc())
    )
    linhas = (await db.execute(stmt)).all()
    return {
        "periodo_dias": dias,
        "itens": [
            {
                "ponto": ponto,
                "epi": epi,
                "total": total,
                "faltas": f,
                "pct_falta": round(100 * f / total, 1) if total else None,
            }
            for ponto, epi, total, f in linhas
        ],
    }


@router.get("/relatorios/biometria")
async def desempenho_biometria(
    dias: int = Query(30, ge=1, le=365),
    _: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> dict:
    """Desempenho da identificação facial em campo.

    É o dado que permite calibrar FACE_DISTANCIA_MAX com evidência em vez de
    com chute — e rende um capítulo inteiro de resultados no TCC.
    """
    from app.db.models import Identificacao

    desde = datetime.now(timezone.utc) - timedelta(days=dias)
    stmt = (
        select(
            Identificacao.resultado,
            func.count(Identificacao.id),
            func.avg(Identificacao.distancia),
        )
        .where(Identificacao.criada_em >= desde)
        .group_by(Identificacao.resultado)
    )
    linhas = (await db.execute(stmt)).all()
    return {
        "periodo_dias": dias,
        "por_resultado": [
            {
                "resultado": r.value,
                "quantidade": qtd,
                "distancia_media": round(float(dist), 4) if dist else None,
            }
            for r, qtd, dist in linhas
        ],
    }


# ======================================================== painel executivo
def _desde(dias: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=dias)


@router.get("/relatorios/panorama")
async def panorama(
    dias: int = Query(30, ge=1, le=365),
    _: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> dict:
    """Os números que abrem o painel, e a comparação com o período anterior.

    A variação existe porque um número solto não diz nada. "142 verificações"
    não é bom nem ruim; "142, contra 96 no mês passado" é uma frase. E a
    conformidade subindo é o único argumento que interessa a quem decidiu
    gastar dinheiro nisto: o sistema não está só barrando gente, está
    mudando o que as pessoas fazem antes de chegar na catraca.
    """
    agora = datetime.now(timezone.utc)
    inicio = agora - timedelta(days=dias)
    inicio_anterior = inicio - timedelta(days=dias)

    async def metricas(de: datetime, ate: datetime) -> dict:
        total, aprovadas, reprovadas = (
            await db.execute(
                select(
                    func.count(Verificacao.id),
                    func.count(case((Verificacao.status == StatusVerificacao.APROVADA, 1))),
                    func.count(case((Verificacao.status == StatusVerificacao.REPROVADA, 1))),
                ).where(Verificacao.iniciada_em >= de, Verificacao.iniciada_em < ate)
            )
        ).one()

        manuais = (
            await db.execute(
                select(func.count(EventoAcesso.id)).where(
                    EventoAcesso.evento == TipoEventoAcesso.LIBERACAO_MANUAL,
                    EventoAcesso.ocorrido_em >= de,
                    EventoAcesso.ocorrido_em < ate,
                )
            )
        ).scalar_one()

        # Pessoas distintas barradas: "23 reprovações" pode ser uma pessoa
        # teimosa vinte e três vezes ou vinte e três pessoas diferentes, e
        # as duas situações pedem respostas opostas.
        pessoas_barradas = (
            await db.execute(
                select(func.count(func.distinct(Verificacao.pessoa_id))).where(
                    Verificacao.status == StatusVerificacao.REPROVADA,
                    Verificacao.pessoa_id.is_not(None),
                    Verificacao.iniciada_em >= de,
                    Verificacao.iniciada_em < ate,
                )
            )
        ).scalar_one()

        decididas = aprovadas + reprovadas
        return {
            "verificacoes": total,
            "aprovadas": aprovadas,
            "bloqueios": reprovadas,
            "pessoas_barradas": pessoas_barradas,
            "liberacoes_manuais": manuais,
            # Só entram no denominador as que o sistema conseguiu decidir.
            # Verificações expiradas ou com erro são falha de infraestrutura,
            # não comportamento de ninguém — contá-las como reprovação faria
            # uma câmera offline parecer gente sem capacete.
            "taxa_conformidade": (
                round(100 * aprovadas / decididas, 1) if decididas else None
            ),
        }

    atual = await metricas(inicio, agora)
    anterior = await metricas(inicio_anterior, inicio)

    return {
        "periodo_dias": dias,
        "atual": atual,
        "anterior": anterior,
    }


@router.get("/relatorios/tendencia")
async def tendencia(
    dias: int = Query(30, ge=1, le=365),
    _: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> dict:
    """Conformidade dia a dia — a curva que mostra se algo mudou.

    Devolve os dias COM verificação, não uma série contínua. Preencher
    domingos e feriados com zero desenharia quedas a pique que não
    aconteceram; quem lê o gráfico entenderia "naquele dia ninguém usou
    EPI" quando o que houve foi "naquele dia ninguém trabalhou".
    """
    dia = func.date_trunc("day", Verificacao.iniciada_em).label("dia")
    aprovadas = func.count(case((Verificacao.status == StatusVerificacao.APROVADA, 1)))
    reprovadas = func.count(case((Verificacao.status == StatusVerificacao.REPROVADA, 1)))

    stmt = (
        select(dia, aprovadas.label("aprovadas"), reprovadas.label("reprovadas"))
        .where(Verificacao.iniciada_em >= _desde(dias))
        .group_by(dia)
        .order_by(dia)
    )
    linhas = (await db.execute(stmt)).all()

    return {
        "periodo_dias": dias,
        "dias": [
            {
                "dia": d.date().isoformat(),
                "aprovadas": ap,
                "bloqueios": rep,
                "total": ap + rep,
                "taxa_conformidade": round(100 * ap / (ap + rep), 1) if (ap + rep) else None,
            }
            for d, ap, rep in linhas
        ],
    }


@router.get("/relatorios/horarios")
async def horarios(
    dias: int = Query(30, ge=1, le=365),
    _: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> dict:
    """Quando as reprovações acontecem, por hora e dia da semana.

    É o relatório que vira ação em vez de advertência. Se as reprovações se
    concentram na primeira meia hora do turno, o problema é a rotina do
    vestiário — e a resposta é um briefing às sete, não uma conversa com
    cada pessoa.

    O corte usa o fuso de exibição, não UTC: uma tabela de horários em UTC
    aponta o turno errado por três horas e leva a conclusão errada.
    """
    tz = settings.TZ_EXIBICAO
    local = func.timezone(tz, Verificacao.iniciada_em)
    hora = func.extract("hour", local).label("hora")
    # 0 = domingo, no padrão do PostgreSQL.
    dia_semana = func.extract("dow", local).label("dia_semana")

    reprovadas = func.count(case((Verificacao.status == StatusVerificacao.REPROVADA, 1)))
    stmt = (
        select(dia_semana, hora, func.count(Verificacao.id), reprovadas)
        .where(Verificacao.iniciada_em >= _desde(dias))
        .group_by(dia_semana, hora)
        .order_by(dia_semana, hora)
    )
    linhas = (await db.execute(stmt)).all()

    return {
        "periodo_dias": dias,
        "fuso": tz,
        "celulas": [
            {
                "dia_semana": int(dow),
                "hora": int(h),
                "total": total,
                "bloqueios": rep,
                "taxa_bloqueio": round(100 * rep / total, 1) if total else None,
            }
            for dow, h, total, rep in linhas
        ],
    }


@router.get("/relatorios/reincidencia")
async def reincidencia(
    dias: int = Query(30, ge=1, le=365),
    limite: int = Query(10, ge=1, le=100),
    _: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> dict:
    """Quem foi barrado mais vezes, e por qual equipamento.

    Este é o relatório mais acionável e o mais fácil de usar mal. Ele existe
    para dizer QUEM PRECISA DE TREINAMENTO, e é assim que a tela o
    apresenta — não como um ranking de infratores. Alguém barrado seis vezes
    pelo mesmo EPI quase nunca é alguém que despreza a norma; é alguém cujo
    equipamento não está onde deveria, ou não serve, ou ninguém explicou.

    Por isso vem acompanhado do EPI mais frequente de cada pessoa: sem ele,
    a lista culpa; com ele, a lista indica o que fazer.
    """
    desde = _desde(dias)

    bloqueios = (
        await db.execute(
            select(
                Verificacao.pessoa_id,
                Pessoa.nome,
                func.count(Verificacao.id).label("bloqueios"),
                func.max(Verificacao.iniciada_em).label("ultimo"),
            )
            .join(Pessoa, Pessoa.id == Verificacao.pessoa_id)
            .where(
                Verificacao.status == StatusVerificacao.REPROVADA,
                Verificacao.iniciada_em >= desde,
            )
            .group_by(Verificacao.pessoa_id, Pessoa.nome)
            .order_by(func.count(Verificacao.id).desc())
            .limit(limite)
        )
    ).all()

    if not bloqueios:
        return {"periodo_dias": dias, "pessoas": []}

    ids = [pid for pid, _n, _b, _u in bloqueios]

    # Qual EPI cada uma dessas pessoas mais deixou de usar. Uma consulta só
    # para todas elas; o agrupamento em Python é sobre dezenas de linhas.
    faltas = (
        await db.execute(
            select(Verificacao.pessoa_id, TipoEpi.rotulo, func.count(Deteccao.id))
            .join(Deteccao, Deteccao.verificacao_id == Verificacao.id)
            .join(TipoEpi, TipoEpi.id == Deteccao.tipo_epi_id)
            .where(
                Verificacao.pessoa_id.in_(ids),
                Verificacao.status == StatusVerificacao.REPROVADA,
                Verificacao.iniciada_em >= desde,
                Deteccao.presente.is_(False),
            )
            .group_by(Verificacao.pessoa_id, TipoEpi.rotulo)
        )
    ).all()

    principal: dict[int, tuple[str, int]] = {}
    for pid, rotulo, qtd in faltas:
        atual = principal.get(pid)
        if atual is None or qtd > atual[1]:
            principal[pid] = (rotulo, qtd)

    # Total de verificações de cada pessoa, para a taxa. Sem ela, quem passa
    # na catraca dez vezes por dia sempre lidera o ranking.
    totais = dict(
        (
            await db.execute(
                select(Verificacao.pessoa_id, func.count(Verificacao.id))
                .where(Verificacao.pessoa_id.in_(ids), Verificacao.iniciada_em >= desde)
                .group_by(Verificacao.pessoa_id)
            )
        ).all()
    )

    return {
        "periodo_dias": dias,
        "pessoas": [
            {
                "pessoa_id": pid,
                "nome": nome,
                "bloqueios": b,
                "verificacoes": totais.get(pid, b),
                "taxa_bloqueio": (
                    round(100 * b / totais[pid], 1) if totais.get(pid) else None
                ),
                "epi_mais_ausente": principal.get(pid, (None, 0))[0],
                "ultimo_em": u.isoformat(),
            }
            for pid, nome, b, u in bloqueios
        ],
    }


@router.get("/relatorios/liberacoes-manuais")
async def liberacoes_manuais(
    dias: int = Query(30, ge=1, le=365),
    _: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> dict:
    """Quando a catraca foi aberta por fora do sistema, e por quem.

    Todo controle precisa de uma válvula de escape — sem ela, alguém acaba
    escorando a catraca com um extintor e aí não há registro de nada. O que
    interessa é a frequência: uma liberação manual por mês é operação
    normal, trinta por semana significam que o sistema está atrapalhando o
    trabalho e vai ser contornado de qualquer jeito.
    """
    stmt = (
        select(
            EventoAcesso.ocorrido_em,
            EventoAcesso.justificativa,
            PontoAcesso.nome,
            Pessoa.nome,
        )
        .join(Verificacao, Verificacao.id == EventoAcesso.verificacao_id)
        .join(PontoAcesso, PontoAcesso.id == Verificacao.ponto_id)
        .outerjoin(Pessoa, Pessoa.id == Verificacao.pessoa_id)
        .where(
            EventoAcesso.evento == TipoEventoAcesso.LIBERACAO_MANUAL,
            EventoAcesso.ocorrido_em >= _desde(dias),
        )
        .order_by(EventoAcesso.ocorrido_em.desc())
        .limit(50)
    )
    linhas = (await db.execute(stmt)).all()
    return {
        "periodo_dias": dias,
        "itens": [
            {
                "ocorrido_em": quando.isoformat(),
                "justificativa": just,
                "ponto": ponto,
                "pessoa": pessoa,
            }
            for quando, just, ponto, pessoa in linhas
        ],
    }
