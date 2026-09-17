"""Relatórios e Analytics: a versão "Power BI" dos dados de verificação.

Diferente do painel executivo em `relatorios.py` — que tem um período único
(N dias) e nenhum filtro além disso — aqui todo endpoint aceita o mesmo
conjunto de filtros globais (`app.services.filtros_analytics`) e as
agregações continuam inteiramente no Postgres: nenhum endpoint carrega
verificações em memória Python para somar ou agrupar.

Os dicts de saída (sem `response_model`) seguem o mesmo padrão do resto de
`relatorios.py` — o painel executivo já tipa essas respostas à mão no
`cliente.ts`, e não há por que este módulo inventar uma segunda convenção.
"""
from __future__ import annotations

import csv
import io
from collections.abc import AsyncIterator

from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import ColumnElement, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload

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
from app.services.filtros_analytics import (
    FiltrosAnalytics,
    condicoes,
    filtros_analytics,
    periodo_anterior,
)

router = APIRouter(tags=["analytics"])


def _contagem(status: StatusVerificacao) -> ColumnElement[int]:
    """`COUNT` condicional por status — repetido em quase todo endpoint
    deste módulo; existe aqui para não divergir um do outro com o tempo."""
    return func.count(case((Verificacao.status == status, 1)))


@router.get("/relatorios/analytics/opcoes")
async def opcoes(
    _: UsuarioAdmin = Depends(admin_atual), db: AsyncSession = DB
) -> dict:
    """Metadados dos filtros: o que existe para escolher, não os dados em si.

    Uma chamada só, feita ao abrir a página — evita que a tela dispare uma
    consulta por combo (pontos, tipos de EPI, setores, versões de modelo).
    """
    pontos = (
        await db.execute(
            select(PontoAcesso.id, PontoAcesso.nome)
            .where(PontoAcesso.ativo.is_(True))
            .order_by(PontoAcesso.nome)
        )
    ).all()
    tipos = (
        await db.execute(
            select(TipoEpi.codigo, TipoEpi.rotulo).order_by(TipoEpi.rotulo)
        )
    ).all()
    setores = (
        await db.execute(
            select(Pessoa.setor)
            .where(Pessoa.setor.is_not(None), Pessoa.setor != "")
            .distinct()
            .order_by(Pessoa.setor)
        )
    ).scalars().all()
    versoes = (
        await db.execute(
            select(Verificacao.versao_modelo)
            .where(Verificacao.versao_modelo.is_not(None))
            .distinct()
            .order_by(Verificacao.versao_modelo)
        )
    ).scalars().all()

    return {
        "pontos": [{"id": pid, "nome": nome} for pid, nome in pontos],
        "tipos_epi": [{"codigo": c, "rotulo": r} for c, r in tipos],
        "setores": list(setores),
        "versoes_modelo": list(versoes),
        "situacoes": [s.value for s in StatusVerificacao],
    }


@router.get("/relatorios/analytics/indicadores")
async def indicadores(
    f: FiltrosAnalytics = Depends(filtros_analytics),
    _: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> dict:
    """Os cards do topo, com a comparação ao período anterior equivalente.

    A comparação só existe quando o período tem início e fim definidos — sem
    isso não há como saber a duração para recortar o "antes", e mostrar um
    número inventado seria pior que não mostrar nada.
    """

    async def metricas(cond: list) -> dict:
        total, aprovadas, reprovadas, latencia_media = (
            await db.execute(
                select(
                    func.count(Verificacao.id),
                    _contagem(StatusVerificacao.APROVADA),
                    _contagem(StatusVerificacao.REPROVADA),
                    func.avg(Verificacao.latencia_ms),
                ).where(*cond)
            )
        ).one()

        pessoas_barradas = (
            await db.execute(
                select(func.count(func.distinct(Verificacao.pessoa_id))).where(
                    *cond,
                    Verificacao.status == StatusVerificacao.REPROVADA,
                    Verificacao.pessoa_id.is_not(None),
                )
            )
        ).scalar_one()

        manuais = (
            await db.execute(
                select(func.count(EventoAcesso.id))
                .join(Verificacao, Verificacao.id == EventoAcesso.verificacao_id)
                .where(*cond, EventoAcesso.evento == TipoEventoAcesso.LIBERACAO_MANUAL)
            )
        ).scalar_one()

        decididas = aprovadas + reprovadas
        return {
            "verificacoes": total,
            "aprovadas": aprovadas,
            "bloqueios": reprovadas,
            "pessoas_barradas": pessoas_barradas,
            "liberacoes_manuais": manuais,
            "taxa_conformidade": (
                round(100 * aprovadas / decididas, 1) if decididas else None
            ),
            "latencia_media_ms": (
                round(float(latencia_media), 0) if latencia_media is not None else None
            ),
        }

    atual = await metricas(condicoes(f))

    desde_ant, ate_ant = periodo_anterior(f)
    anterior = None
    if desde_ant is not None:
        f_anterior = FiltrosAnalytics(
            desde=desde_ant,
            ate_exclusivo=ate_ant,
            ponto_id=f.ponto_id,
            situacao=f.situacao,
            setor=f.setor,
            tipo_epi=f.tipo_epi,
            pessoa_id=f.pessoa_id,
            versao_modelo=f.versao_modelo,
        )
        anterior = await metricas(condicoes(f_anterior))

    return {"atual": atual, "anterior": anterior}


@router.get("/relatorios/analytics/tendencia")
async def tendencia(
    f: FiltrosAnalytics = Depends(filtros_analytics),
    _: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> dict:
    """Uma consulta só para dois gráficos: conformidade no tempo e volume por
    status. Separar em duas consultas duplicaria o `GROUP BY` inteiro só
    para trocar quais colunas voltam.
    """
    dia = func.date_trunc("day", Verificacao.iniciada_em).label("dia")
    aprovadas = _contagem(StatusVerificacao.APROVADA)
    reprovadas = _contagem(StatusVerificacao.REPROVADA)
    expiradas = _contagem(StatusVerificacao.EXPIRADA)
    erros = _contagem(StatusVerificacao.ERRO)

    stmt = (
        select(
            dia,
            aprovadas.label("aprovadas"),
            reprovadas.label("reprovadas"),
            expiradas.label("expiradas"),
            erros.label("erros"),
        )
        .where(*condicoes(f))
        .group_by(dia)
        .order_by(dia)
    )
    linhas = (await db.execute(stmt)).all()

    return {
        "dias": [
            {
                "dia": d.date().isoformat(),
                "aprovadas": ap,
                "bloqueios": rep,
                "expiradas": exp,
                "erros": err,
                "total": ap + rep + exp + err,
                "taxa_conformidade": (
                    round(100 * ap / (ap + rep), 1) if (ap + rep) else None
                ),
            }
            for d, ap, rep, exp, err in linhas
        ],
    }


@router.get("/relatorios/analytics/epis-ausentes")
async def epis_ausentes(
    limite: int = Query(12, ge=1, le=50),
    f: FiltrosAnalytics = Depends(filtros_analytics),
    _: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> dict:
    """Ranking por EPI, somado entre pontos — o que `epis-faltantes` não faz
    porque agrupa por (ponto, epi) para o outro público deste arquivo.
    """
    faltas = func.count(case((Deteccao.presente.is_(False), 1)))
    stmt = (
        select(
            TipoEpi.codigo,
            TipoEpi.rotulo,
            func.count(Deteccao.id).label("total"),
            faltas.label("faltas"),
        )
        .join(Verificacao, Verificacao.id == Deteccao.verificacao_id)
        .join(TipoEpi, TipoEpi.id == Deteccao.tipo_epi_id)
        .where(*condicoes(f))
        .group_by(TipoEpi.codigo, TipoEpi.rotulo)
        .order_by(faltas.desc())
        .limit(limite)
    )
    linhas = (await db.execute(stmt)).all()
    return {
        "itens": [
            {
                "epi": codigo,
                "rotulo": rotulo,
                "total": total,
                "faltas": faltas_epi,
                "pct_falta": round(100 * faltas_epi / total, 1) if total else None,
            }
            for codigo, rotulo, total, faltas_epi in linhas
        ],
    }


@router.get("/relatorios/analytics/conformidade-por-ponto")
async def conformidade_por_ponto(
    f: FiltrosAnalytics = Depends(filtros_analytics),
    _: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> dict:
    """Igual a `/relatorios/conformidade`, mas com o conjunto completo de
    filtros — o endpoint antigo continua existindo com sua assinatura
    (`dias`) porque o painel executivo já depende dela.

    A taxa usa `aprovadas / (aprovadas + reprovadas)` — as mesmas
    "decididas" de `indicadores()` e `tendencia()`, não `aprovadas / total`.
    `/relatorios/conformidade` (o endpoint antigo) usa `total` no
    denominador, o que deixaria EXPIRADA e ERRO baixarem a conformidade de
    um ponto por falha de infraestrutura, não por comportamento de
    ninguém — exatamente o que o comentário de `panorama()` em
    `relatorios.py` explica que este sistema evita de propósito. Como este
    é um endpoint novo, sem consumidor que dependa do comportamento antigo,
    ele usa a regra correta desde o início em vez de repetir a divergência.
    """
    aprovadas = _contagem(StatusVerificacao.APROVADA)
    reprovadas = _contagem(StatusVerificacao.REPROVADA)
    stmt = (
        select(
            PontoAcesso.id,
            PontoAcesso.nome,
            func.count(Verificacao.id).label("total"),
            aprovadas.label("aprovadas"),
            reprovadas.label("reprovadas"),
        )
        .join(Verificacao, Verificacao.ponto_id == PontoAcesso.id)
        .where(*condicoes(f))
        .group_by(PontoAcesso.id, PontoAcesso.nome)
        .order_by(PontoAcesso.nome)
    )
    linhas = (await db.execute(stmt)).all()
    return {
        "pontos": [
            {
                "ponto_id": pid,
                "nome": nome,
                "total": total,
                "aprovadas": aprov,
                "taxa_conformidade": (
                    round(100 * aprov / (aprov + rep), 1) if (aprov + rep) else None
                ),
            }
            for pid, nome, total, aprov, rep in linhas
        ],
    }


@router.get("/relatorios/analytics/horarios")
async def horarios(
    f: FiltrosAnalytics = Depends(filtros_analytics),
    _: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> dict:
    """Igual a `/relatorios/horarios`, com filtros — mesmo corte de fuso
    (`TZ_EXIBICAO`), pela mesma razão: hora em UTC aponta o turno errado.
    """
    tz = settings.TZ_EXIBICAO
    local = func.timezone(tz, Verificacao.iniciada_em)
    hora = func.extract("hour", local).label("hora")
    dia_semana = func.extract("dow", local).label("dia_semana")

    reprovadas = _contagem(StatusVerificacao.REPROVADA)
    stmt = (
        select(dia_semana, hora, func.count(Verificacao.id), reprovadas)
        .where(*condicoes(f))
        .group_by(dia_semana, hora)
        .order_by(dia_semana, hora)
    )
    linhas = (await db.execute(stmt)).all()

    return {
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


@router.get("/relatorios/analytics/setores")
async def setores(
    f: FiltrosAnalytics = Depends(filtros_analytics),
    _: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> dict:
    """Concentração de verificações e bloqueios por setor.

    Existe para apontar treinamento, não para apontar culpados — por isso
    devolve volume e conformidade, não um ranking de "piores setores". Quem
    não tem setor cadastrado entra em "Não informado" em vez de sumir: uma
    fatia grande aí é, em si, um problema de cadastro a resolver.
    """
    setor_rotulo = func.coalesce(Pessoa.setor, "Não informado").label("setor")
    aprovadas = _contagem(StatusVerificacao.APROVADA)
    reprovadas = _contagem(StatusVerificacao.REPROVADA)
    stmt = (
        select(
            setor_rotulo,
            func.count(Verificacao.id).label("total"),
            aprovadas.label("aprovadas"),
            reprovadas.label("bloqueios"),
        )
        .outerjoin(Pessoa, Pessoa.id == Verificacao.pessoa_id)
        .where(*condicoes(f))
        .group_by(setor_rotulo)
        .order_by(setor_rotulo)
    )
    linhas = (await db.execute(stmt)).all()
    return {
        "itens": [
            {
                "setor": setor,
                "total": total,
                "bloqueios": bloqueios,
                "taxa_conformidade": (
                    round(100 * ap / (ap + bloqueios), 1) if (ap + bloqueios) else None
                ),
            }
            for setor, total, ap, bloqueios in linhas
        ],
    }


@router.get("/relatorios/analytics/desempenho")
async def desempenho(
    f: FiltrosAnalytics = Depends(filtros_analytics),
    _: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> dict:
    """Latência média, sua evolução e o resultado por versão do modelo.

    O front decide se há dado suficiente para exibir esta seção (por
    exemplo, menos de duas versões distintas não rende comparação nenhuma);
    aqui só devolvemos o que existir, mesmo que seja pouco.
    """
    cond = condicoes(f)

    latencia_media = (
        await db.execute(
            select(func.avg(Verificacao.latencia_ms)).where(
                *cond, Verificacao.latencia_ms.is_not(None)
            )
        )
    ).scalar_one()

    dia = func.date_trunc("day", Verificacao.iniciada_em).label("dia")
    linhas_dia = (
        await db.execute(
            select(dia, func.avg(Verificacao.latencia_ms))
            .where(*cond, Verificacao.latencia_ms.is_not(None))
            .group_by(dia)
            .order_by(dia)
        )
    ).all()

    aprovadas = _contagem(StatusVerificacao.APROVADA)
    reprovadas = _contagem(StatusVerificacao.REPROVADA)
    linhas_versao = (
        await db.execute(
            select(
                Verificacao.versao_modelo,
                func.count(Verificacao.id).label("total"),
                aprovadas.label("aprovadas"),
                reprovadas.label("bloqueios"),
                func.avg(Verificacao.latencia_ms),
            )
            .where(*cond, Verificacao.versao_modelo.is_not(None))
            .group_by(Verificacao.versao_modelo)
            .order_by(Verificacao.versao_modelo)
        )
    ).all()

    return {
        "latencia_media_ms": (
            round(float(latencia_media), 0) if latencia_media is not None else None
        ),
        "latencia_dias": [
            {
                "dia": d.date().isoformat(),
                "latencia_media_ms": round(float(lat), 0) if lat is not None else None,
            }
            for d, lat in linhas_dia
        ],
        "por_versao": [
            {
                "versao_modelo": versao,
                "total": total,
                "taxa_conformidade": (
                    round(100 * ap / (ap + rep), 1) if (ap + rep) else None
                ),
                "latencia_media_ms": round(float(lat), 0) if lat is not None else None,
            }
            for versao, total, ap, rep, lat in linhas_versao
        ],
    }


def _aceito(d: Deteccao) -> bool:
    return d.presente and float(d.confianca) >= settings.EPI_CONFIANCA_MIN


def _linha_analytics(v: Verificacao) -> dict:
    """Uma verificação, no formato da tabela detalhada e do CSV.

    Deliberadamente NÃO inclui `identificacao_id`, embeddings, imagens ou
    qualquer campo de `Evidencia` — a tabela é para auditoria operacional,
    não um segundo caminho para extrair dado biométrico.
    """
    detectados = [t.tipo_epi.rotulo for t in v.deteccoes if _aceito(t)]
    ausentes = [t.tipo_epi.rotulo for t in v.deteccoes if not t.presente]
    return {
        "id": str(v.id),
        "iniciada_em": v.iniciada_em.isoformat(),
        "pessoa_nome": v.pessoa.nome if v.pessoa else None,
        "pessoa_matricula": v.pessoa.matricula if v.pessoa else None,
        "setor": v.pessoa.setor if v.pessoa else None,
        "ponto": v.ponto.nome,
        "status": v.status.value,
        "motivo_falha": v.motivo_falha,
        "epis_detectados": detectados,
        "epis_ausentes": ausentes,
        "latencia_ms": v.latencia_ms,
        "versao_modelo": v.versao_modelo,
    }


@router.get("/relatorios/analytics/tabela")
async def tabela(
    limite: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    f: FiltrosAnalytics = Depends(filtros_analytics),
    _: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> dict:
    cond = condicoes(f)
    total = (
        await db.execute(select(func.count(Verificacao.id)).where(*cond))
    ).scalar_one()

    stmt = (
        select(Verificacao)
        .where(*cond)
        .order_by(Verificacao.iniciada_em.desc())
        .limit(limite)
        .offset(offset)
        # `evidencias` e `eventos` são selectin por padrão no modelo, mas
        # `_linha_analytics` nunca os lê — sem isto, toda página desta
        # tabela dispara duas consultas extras (uma por relação) para
        # dados que são descartados na sequência.
        .options(noload(Verificacao.evidencias), noload(Verificacao.eventos))
    )
    # `deteccoes`, `pessoa` e `ponto` já vêm carregados pela estratégia do
    # próprio modelo (selectin / joined) — nenhuma consulta extra por linha.
    itens = list((await db.execute(stmt)).scalars().unique().all())
    return {"total": total, "itens": [_linha_analytics(v) for v in itens]}


CABECALHO_CSV = [
    "data_hora",
    "pessoa",
    "registro",
    "setor",
    "ponto",
    "status",
    "motivo_falha",
    "epis_detectados",
    "epis_ausentes",
    "latencia_ms",
    "versao_modelo",
]


def _linha_csv(v: Verificacao) -> list[str]:
    linha = _linha_analytics(v)
    return [
        v.iniciada_em.astimezone(_fuso_exibicao()).strftime("%d/%m/%Y %H:%M:%S"),
        linha["pessoa_nome"] or "",
        linha["pessoa_matricula"] or "",
        linha["setor"] or "",
        linha["ponto"],
        linha["status"],
        linha["motivo_falha"] or "",
        "; ".join(linha["epis_detectados"]),
        "; ".join(linha["epis_ausentes"]),
        "" if linha["latencia_ms"] is None else str(linha["latencia_ms"]),
        linha["versao_modelo"] or "",
    ]


def _fuso_exibicao() -> ZoneInfo:
    return ZoneInfo(settings.TZ_EXIBICAO)


#: Quantas verificações a ORM materializa por vez durante a exportação.
#: Ver o comentário em `_gerar_csv` sobre por que este número existe.
LOTE_EXPORTACAO = 200


async def _gerar_csv(db: AsyncSession, cond: list) -> AsyncIterator[bytes]:
    """Gera o CSV linha a linha com um cursor de servidor (`stream_scalars`).

    Nada de `SELECT` completo em memória: o objetivo explícito é permitir
    exportar meses de verificações sem que o processo da API precise
    materializar todas elas em uma lista Python antes de começar a escrever.

    Isso só é verdade com `yield_per` definido. Sem ele, `stream_scalars`
    ainda usa um cursor de servidor no Postgres, mas o carregador `selectin`
    de `deteccoes` (ver `Verificacao.deteccoes` no modelo) puxa TODAS as
    chaves primárias do resultado antes de liberar a primeira linha para
    quem consome — na prática, materializa o `SELECT` inteiro em objetos
    Python antes de escrever um byte, exatamente o que este código existe
    para evitar. Confirmado lendo o comportamento real do SQLAlchemy: sem
    `yield_per`, uma exportação de 3000 linhas disparava as 6 consultas do
    `selectin` (lotes de 500) por inteiro antes da primeira linha sair;
    com `yield_per(200)`, cada lote de 200 é carregado e escrito antes do
    próximo ser buscado.

    `.unique()` não é usado aqui de propósito: o SQLAlchemy recusa combinar
    `yield_per` com `unique()` (`InvalidRequestError`), e não faz falta —
    nada neste `SELECT` faz `JOIN` com uma coleção (o que duplicaria
    linhas). `Verificacao.pessoa`/`.ponto` são muitos-para-um, e
    `deteccoes` é uma consulta `selectin` separada, não um `JOIN` na
    consulta principal.
    """
    # BOM: sem ele, o Excel abre um CSV UTF-8 com acento como texto corrompido.
    yield b"\xef\xbb\xbf"

    buffer = io.StringIO()
    escritor = csv.writer(buffer, delimiter=";", lineterminator="\r\n")
    escritor.writerow(CABECALHO_CSV)
    yield buffer.getvalue().encode("utf-8")
    buffer.seek(0)
    buffer.truncate(0)

    stmt = (
        select(Verificacao)
        .where(*cond)
        .order_by(Verificacao.iniciada_em.desc())
        .execution_options(yield_per=LOTE_EXPORTACAO)
        .options(noload(Verificacao.evidencias), noload(Verificacao.eventos))
    )
    resultado = await db.stream_scalars(stmt)
    async for v in resultado:
        escritor.writerow(_linha_csv(v))
        yield buffer.getvalue().encode("utf-8")
        buffer.seek(0)
        buffer.truncate(0)


@router.get("/relatorios/analytics/exportar")
async def exportar_csv(
    f: FiltrosAnalytics = Depends(filtros_analytics),
    _: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> StreamingResponse:
    """CSV com TODOS os registros do filtro ativo — não só a página carregada.

    Não exporta embeddings, imagens nem qualquer campo de `Evidencia`: o
    arquivo é para auditoria operacional (quem, quando, onde, por quê), não
    um segundo caminho para tirar dado biométrico do sistema.
    """
    # Data do fuso de exibição, não UTC puro: perto da meia-noite em UTC-3 as
    # duas divergem, e o nome do arquivo deveria contar a mesma história que
    # o resto do relatório.
    nome_arquivo = f"relatorio-epi-{datetime.now(_fuso_exibicao()):%Y-%m-%d}.csv"
    return StreamingResponse(
        _gerar_csv(db, condicoes(f)),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{nome_arquivo}"'},
    )
