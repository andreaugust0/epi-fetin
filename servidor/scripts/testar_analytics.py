"""Testa a área de Relatórios e Analytics de ponta a ponta contra o banco
de verdade — precisa de Postgres (e do broker MQTT, que a API tenta
conectar no lifespan) no ar.

    python -m scripts.testar_analytics

Diferente de `semear_demo.py` (dados aleatórios, para gente olhar), este
script cria um cenário determinístico: cada verificação nasce de um laço que
já sabe, na hora de criar a linha, para qual contador ela conta. Os números
"esperados" abaixo não são recalculados por inspeção depois — são somados no
mesmo laço que cria os dados, então um erro de aritmética manual não pode se
esconder atrás de um teste que concorda consigo mesmo por coincidência.

Cenário (tudo marcado com o sufixo `[analytics-teste]`, seguro rodar de
novo — o script apaga o que criou antes de começar e no final):

* HOJE: 100 verificações decididas (70 APROVADA + 20 REPROVADA) + 5 EXPIRADA
  + 5 ERRO, distribuídas por 6 pessoas em 4 setores e 3 pontos de acesso.
  Conformidade esperada: 70 / (70 + 20) = 77,78% — EXPIRADA e ERRO de fora
  do denominador, a mesma regra de `panorama()`/`tendencia()`.
* ONTEM: 30 decididas (24 aprovada + 6 reprovada) = 80,0% — só para testar
  o período anterior com um número diferente do de hoje.
* 5 dias anteriores a ontem: contagens pequenas e crescentes, só para dar
  massa a `tendencia()` (7 dias distintos com dado).
* Um dia isolado 10 dias atrás, com 4 verificações cravadas em 23h30, 23h59,
  00h00 e 00h30 (horário de `TZ_EXIBICAO`) — o teste de fronteira de
  timezone pedido explicitamente.
* Um dia isolado 11 dias atrás, com 2 verificações sem pessoa identificada
  (`pessoa_id is None`) — testa o `NULL` em `setor`/`pessoa` sendo tratado
  como "Não informado", não como erro.

Precisa que `python -m scripts.init_db` já tenha rodado (usa o ponto de
acesso e o catálogo de EPIs que ele cria).
"""
from __future__ import annotations

import asyncio
import csv
import io
import os
import uuid
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

# Client_id próprio ANTES de importar app.main — ver o mesmo comentário em
# testar_api_admin.py: sem isto, este teste disputa o broker com uma API
# que já esteja no ar e os dois se derrubam em revezamento.
os.environ.setdefault("MQTT_CLIENT_ID_API", "teste-analytics")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import delete, select  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.db.models import (  # noqa: E402
    Deteccao,
    EventoAcesso,
    Pessoa,
    PontoAcesso,
    Site,
    StatusVerificacao,
    TipoEpi,
    Verificacao,
)
from app.db.session import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402

MARCA = "[analytics-teste]"
FUSO = ZoneInfo(settings.TZ_EXIBICAO)

ok, falhas = 0, []


def checar(nome: str, cond: bool, extra: str = "") -> None:
    global ok
    if cond:
        ok += 1
        print(f"  ok    {nome} {extra}")
    else:
        falhas.append(nome)
        print(f"  FALHA {nome} {extra}")


# --------------------------------------------------------------- cenário
SETORES_POR_PESSOA = [
    ("Ana Analytics", "Producao"),
    ("Bruno Analytics", "Producao"),
    ("Carla Analytics", "Manutencao"),
    ("Diego Analytics", "Manutencao"),
    ("Elisa Analytics", "Logistica"),
    ("Fabio Analytics", "Qualidade"),
]
VERSOES = ["modelo-v1", "modelo-v2"]


@dataclass
class Registro:
    dia: date
    hora_local: datetime  # já com tzinfo=FUSO
    pessoa_idx: int | None
    ponto_idx: int
    status: StatusVerificacao
    versao: str | None
    latencia: int | None
    # (codigo_epi, presente) — vazio para EXPIRADA/ERRO
    deteccoes: list[tuple[str, bool]] = field(default_factory=list)


def _hora(dia_base: datetime, minuto_offset: int) -> datetime:
    """`dia_base` é meio-dia local; desloca por minutos, sem cruzar meia-noite
    (offsets ficam sempre < 300, bem dentro do mesmo dia civil)."""
    return dia_base + timedelta(minutes=minuto_offset)


def gerar_cenario() -> tuple[list[Registro], dict]:
    """Gera os registros e os totais esperados, no mesmo laço — ver
    docstring do módulo sobre por que isso importa.
    """
    hoje_meio_dia = datetime.now(FUSO).replace(hour=12, minute=0, second=0, microsecond=0)
    registros: list[Registro] = []
    esperado: dict = {"por_dia": {}, "contadores": Counter()}

    def dia_de(offset: int) -> date:
        return (hoje_meio_dia - timedelta(days=offset)).date()

    # ---------------------------------------------------------- HOJE (100)
    # 70 APROVADA, round-robin por pessoa/ponto/versão — cada combinação
    # aparece um número prático de vezes, mas o que importa é a CONTAGEM
    # total, tabulada em `esperado` linha a linha.
    dia_hoje = dia_de(0)
    contagem_hoje = {"total": 0, "aprovadas": 0, "reprovadas": 0, "expiradas": 0, "erros": 0}
    por_ponto_hoje: Counter = Counter()
    por_setor_hoje: Counter = Counter()
    por_pessoa_hoje: Counter = Counter()
    por_versao_hoje: Counter = Counter()
    latencias_hoje: list[int] = []

    def registrar_hoje(reg: Registro) -> None:
        registros.append(reg)
        contagem_hoje["total"] += 1
        chave = {
            StatusVerificacao.APROVADA: "aprovadas",
            StatusVerificacao.REPROVADA: "reprovadas",
            StatusVerificacao.EXPIRADA: "expiradas",
            StatusVerificacao.ERRO: "erros",
        }[reg.status]
        contagem_hoje[chave] += 1
        por_ponto_hoje[reg.ponto_idx] += 1
        if reg.pessoa_idx is not None:
            por_setor_hoje[SETORES_POR_PESSOA[reg.pessoa_idx][1]] += 1
            por_pessoa_hoje[reg.pessoa_idx] += 1
        if reg.versao:
            por_versao_hoje[reg.versao] += 1
        if reg.latencia is not None:
            latencias_hoje.append(reg.latencia)

    i = 0
    for _ in range(70):  # APROVADA
        pessoa_idx = i % len(SETORES_POR_PESSOA)
        ponto_idx = i % 3
        versao = VERSOES[i % 2]
        registrar_hoje(Registro(
            dia=dia_hoje, hora_local=_hora(hoje_meio_dia, i),
            pessoa_idx=pessoa_idx, ponto_idx=ponto_idx,
            status=StatusVerificacao.APROVADA, versao=versao,
            latencia=100 + (i % 40) * 5,
            deteccoes=[("capacete", True)],
        ))
        i += 1
    n_reprovada_capacete = 10
    for _ in range(n_reprovada_capacete):  # REPROVADA por falta de capacete
        pessoa_idx = i % len(SETORES_POR_PESSOA)
        ponto_idx = i % 3
        versao = VERSOES[i % 2]
        registrar_hoje(Registro(
            dia=dia_hoje, hora_local=_hora(hoje_meio_dia, i),
            pessoa_idx=pessoa_idx, ponto_idx=ponto_idx,
            status=StatusVerificacao.REPROVADA, versao=versao,
            latencia=200 + (i % 20) * 5,
            deteccoes=[("capacete", False)],
        ))
        i += 1
    n_reprovada_colete = 10
    for _ in range(n_reprovada_colete):  # REPROVADA por falta de colete
        pessoa_idx = i % len(SETORES_POR_PESSOA)
        ponto_idx = i % 3
        versao = VERSOES[i % 2]
        registrar_hoje(Registro(
            dia=dia_hoje, hora_local=_hora(hoje_meio_dia, i),
            pessoa_idx=pessoa_idx, ponto_idx=ponto_idx,
            status=StatusVerificacao.REPROVADA, versao=versao,
            latencia=210 + (i % 20) * 5,
            # capacete OK, colete ausente — garante que filtrar por
            # tipo_epi=capacete NÃO pega estas (só as 10 acima + as 70
            # aprovadas), e que tipo_epi=colete pega SÓ estas 10.
            deteccoes=[("capacete", True), ("colete", False)],
        ))
        i += 1
    for _ in range(5):  # EXPIRADA — sem detecção, sem latência, sem versão
        pessoa_idx = i % len(SETORES_POR_PESSOA)
        ponto_idx = i % 3
        registrar_hoje(Registro(
            dia=dia_hoje, hora_local=_hora(hoje_meio_dia, i),
            pessoa_idx=pessoa_idx, ponto_idx=ponto_idx,
            status=StatusVerificacao.EXPIRADA, versao=None, latencia=None,
        ))
        i += 1
    for _ in range(5):  # ERRO — idem
        pessoa_idx = i % len(SETORES_POR_PESSOA)
        ponto_idx = i % 3
        registrar_hoje(Registro(
            dia=dia_hoje, hora_local=_hora(hoje_meio_dia, i),
            pessoa_idx=pessoa_idx, ponto_idx=ponto_idx,
            status=StatusVerificacao.ERRO, versao=None, latencia=None,
        ))
        i += 1

    assert contagem_hoje == {
        "total": 100, "aprovadas": 70, "reprovadas": 20, "expiradas": 5, "erros": 5,
    }, f"cenário de hoje saiu errado: {contagem_hoje}"

    esperado["hoje"] = {
        "data": dia_hoje,
        **contagem_hoje,
        "decididas": contagem_hoje["aprovadas"] + contagem_hoje["reprovadas"],
        "taxa_conformidade": round(100 * 70 / 90, 1),  # 77.8
        "latencia_media_ms": round(sum(latencias_hoje) / len(latencias_hoje), 0),
        "por_ponto": dict(por_ponto_hoje),
        "por_setor": dict(por_setor_hoje),
        "por_pessoa": dict(por_pessoa_hoje),
        "por_versao": dict(por_versao_hoje),
        "reprovadas_capacete": n_reprovada_capacete,
        "reprovadas_colete": n_reprovada_colete,
        "inspecionaram_capacete": 70 + n_reprovada_capacete + n_reprovada_colete,  # 90
        "inspecionaram_colete": n_reprovada_colete,  # 10
    }

    # --------------------------------------------------------- ONTEM (30)
    dia_ontem = dia_de(1)
    ontem_meio_dia = hoje_meio_dia - timedelta(days=1)
    j = 0
    for _ in range(24):  # APROVADA
        registros.append(Registro(
            dia=dia_ontem, hora_local=_hora(ontem_meio_dia, j),
            pessoa_idx=j % len(SETORES_POR_PESSOA), ponto_idx=j % 3,
            status=StatusVerificacao.APROVADA, versao=VERSOES[j % 2],
            latencia=120 + j, deteccoes=[("capacete", True)],
        ))
        j += 1
    for _ in range(6):  # REPROVADA
        registros.append(Registro(
            dia=dia_ontem, hora_local=_hora(ontem_meio_dia, j),
            pessoa_idx=j % len(SETORES_POR_PESSOA), ponto_idx=j % 3,
            status=StatusVerificacao.REPROVADA, versao=VERSOES[j % 2],
            latencia=220 + j, deteccoes=[("capacete", False)],
        ))
        j += 1
    esperado["ontem"] = {
        "data": dia_ontem, "total": 30, "aprovadas": 24, "reprovadas": 6,
        "taxa_conformidade": 80.0,
    }

    # ------------------------------------------- 5 DIAS ANTERIORES (filler)
    # Só para `tendencia()` ter vários dias distintos — números redondos,
    # crescendo a cada dia mais antigo.
    total_filler = 0
    aprovadas_filler = 0
    reprovadas_filler = 0
    dias_filler = []
    for offset in range(2, 7):  # dias -2 .. -6
        n_total = offset * 3
        n_aprov = int(n_total * 2 / 3)
        n_rep = n_total - n_aprov
        dia_data = dia_de(offset)
        dia_meio_dia = hoje_meio_dia - timedelta(days=offset)
        k = 0
        for _ in range(n_aprov):
            registros.append(Registro(
                dia=dia_data, hora_local=_hora(dia_meio_dia, k),
                pessoa_idx=k % len(SETORES_POR_PESSOA), ponto_idx=k % 3,
                status=StatusVerificacao.APROVADA, versao=VERSOES[k % 2],
                latencia=130 + k, deteccoes=[("capacete", True)],
            ))
            k += 1
        for _ in range(n_rep):
            registros.append(Registro(
                dia=dia_data, hora_local=_hora(dia_meio_dia, k),
                pessoa_idx=k % len(SETORES_POR_PESSOA), ponto_idx=k % 3,
                status=StatusVerificacao.REPROVADA, versao=VERSOES[k % 2],
                latencia=230 + k, deteccoes=[("capacete", False)],
            ))
            k += 1
        total_filler += n_total
        aprovadas_filler += n_aprov
        reprovadas_filler += n_rep
        dias_filler.append(dia_data)

    esperado["janela_7_dias"] = {
        "desde": dia_de(6),
        "ate": dia_hoje,
        "dias_distintos": 7,  # hoje + ontem + 5 de preenchimento
        "total": contagem_hoje["total"] + 30 + total_filler,
        "aprovadas": contagem_hoje["aprovadas"] + 24 + aprovadas_filler,
        "reprovadas": contagem_hoje["reprovadas"] + 6 + reprovadas_filler,
    }
    dec = esperado["janela_7_dias"]["aprovadas"] + esperado["janela_7_dias"]["reprovadas"]
    esperado["janela_7_dias"]["taxa_conformidade"] = round(
        100 * esperado["janela_7_dias"]["aprovadas"] / dec, 1
    )

    # ------------------------------------------ FRONTEIRA DE TIMEZONE (4)
    # 10 dias atrás, cravado nos quatro instantes pedidos: 23h30, 23h59,
    # 00h00 e 00h30 — hora LOCAL (`TZ_EXIBICAO`), não UTC.
    dia_borda = dia_de(10)
    inicio_dia_borda = datetime(
        dia_borda.year, dia_borda.month, dia_borda.day, 0, 0, 0, tzinfo=FUSO,
    )
    horarios_borda = {
        "00:00": inicio_dia_borda,
        "00:30": inicio_dia_borda + timedelta(minutes=30),
        "23:30": inicio_dia_borda + timedelta(hours=23, minutes=30),
        "23:59": inicio_dia_borda + timedelta(hours=23, minutes=59),
    }
    for idx, (_rotulo, hora_local) in enumerate(horarios_borda.items()):
        registros.append(Registro(
            dia=dia_borda, hora_local=hora_local,
            pessoa_idx=idx % len(SETORES_POR_PESSOA), ponto_idx=idx % 3,
            status=StatusVerificacao.APROVADA, versao="modelo-v1",
            latencia=140, deteccoes=[("capacete", True)],
        ))
    esperado["dia_borda"] = {
        "data": dia_borda, "total": 4,
        "dia_anterior": dia_borda - timedelta(days=1),
        "dia_seguinte": dia_borda + timedelta(days=1),
    }

    # --------------------------------------------- SEM PESSOA IDENTIFICADA
    #
    # offset=15: bem longe de qualquer outra data em uso. A borda de
    # timezone (offset=10) também é testada num dia ANTERIOR e num dia
    # SEGUINTE a ela mesma (offsets 9 e 11, respectivamente — ver
    # `dia_anterior`/`dia_seguinte` abaixo) — colocar este bloco em
    # qualquer offset entre 7 e 11 arriscaria cair bem em cima de uma
    # dessas datas "vizinhas" e misturar os dois cenários na mesma consulta.
    #
    # `ponto_idx=1` (um dos pontos MARCADOS, não o `ponto_padrao` do
    # `init_db`) de propósito: é o nome do ponto — não da pessoa — que
    # `limpar()` usa para achar estas linhas quando `pessoa_id` é nulo. Em
    # `ponto_idx=0` (`ponto_padrao`, sem marcador) elas ficavam com pessoa
    # nula E ponto sem marcador — invisíveis para `limpar()`, acumulando a
    # cada execução do script.
    dia_sem_pessoa = dia_de(15)
    meio_dia_sem_pessoa = hoje_meio_dia - timedelta(days=15)
    for idx in range(2):
        registros.append(Registro(
            dia=dia_sem_pessoa, hora_local=_hora(meio_dia_sem_pessoa, idx),
            pessoa_idx=None, ponto_idx=1,
            status=StatusVerificacao.APROVADA, versao="modelo-v1",
            latencia=150, deteccoes=[("capacete", True)],
        ))
    esperado["sem_pessoa"] = {"data": dia_sem_pessoa, "total": 2}

    esperado["total_geral"] = len(registros)
    return registros, esperado


async def limpar() -> None:
    async with SessionLocal() as db:
        pessoas = (
            await db.execute(select(Pessoa.id).where(Pessoa.nome.like(f"%{MARCA}")))
        ).scalars().all()
        pontos = (
            await db.execute(select(PontoAcesso.id).where(PontoAcesso.nome.like(f"%{MARCA}")))
        ).scalars().all()
        verifs: list = []
        if pessoas or pontos:
            condicoes = []
            if pessoas:
                condicoes.append(Verificacao.pessoa_id.in_(pessoas))
            if pontos:
                condicoes.append(Verificacao.ponto_id.in_(pontos))
            from sqlalchemy import or_

            verifs = (
                await db.execute(select(Verificacao.id).where(or_(*condicoes)))
            ).scalars().all()
        if verifs:
            await db.execute(delete(EventoAcesso).where(EventoAcesso.verificacao_id.in_(verifs)))
            await db.execute(delete(Deteccao).where(Deteccao.verificacao_id.in_(verifs)))
            await db.execute(delete(Verificacao).where(Verificacao.id.in_(verifs)))
        if pessoas:
            await db.execute(delete(Pessoa).where(Pessoa.id.in_(pessoas)))
        if pontos:
            await db.execute(delete(PontoAcesso).where(PontoAcesso.id.in_(pontos)))
        await db.commit()

    # `limpar()` é chamado de dois lugares que rodam em event loops
    # DIFERENTES: uma vez dentro de `preparar()` (que já descarta o pool no
    # fim) e de novo, sozinho, em `asyncio.run(limpar())` ao final de
    # `main()` — este último cria um loop novo só para esta chamada e o
    # fecha assim que ela termina. A conexão que esta função abre é
    # devolvida ao pool do `engine` (que é um singleton do módulo,
    # compartilhado entre todas as chamadas), não fechada de verdade — e o
    # pool a mantém viva, presa ao transport asyncio daquele loop, para
    # reaproveitar depois. Quando não há "depois" (o loop já fechou), essa
    # conexão só é encerrada quando o coletor de lixo a alcança, e aí o
    # SQLAlchemy tenta um `terminate()` assíncrono contra um loop que não
    # existe mais — daí o `RuntimeError: Event loop is closed` e o
    # `SAWarning` de conexão não devolvida, os dois aparecendo bem no fim do
    # script. Descartar aqui garante que todo `limpar()`, não importa qual
    # loop o chamou, sai sem deixar conexão pendurada.
    await engine.dispose()


async def preparar() -> dict:
    """Cria o cenário no banco e devolve os IDs/valores que os testes
    precisam, junto com os totais esperados calculados por `gerar_cenario`.
    """
    await limpar()
    registros, esperado = gerar_cenario()

    async with SessionLocal() as db:
        ponto_base = (
            await db.execute(select(PontoAcesso).limit(1))
        ).scalar_one_or_none()
        if ponto_base is None:
            raise RuntimeError(
                "nenhum ponto de acesso — rode antes: python -m scripts.init_db"
            )

        tipos = {
            t.codigo: t
            for t in (
                await db.execute(
                    select(TipoEpi).where(TipoEpi.codigo.in_(["capacete", "colete"]))
                )
            ).scalars().all()
        }
        if "capacete" not in tipos or "colete" not in tipos:
            raise RuntimeError(
                "tipos de EPI 'capacete'/'colete' não encontrados — rode antes: "
                "python -m scripts.init_db"
            )

        site = (await db.execute(select(Site).limit(1))).scalar_one()
        pontos = [ponto_base]
        for letra in ("B", "C"):
            p = PontoAcesso(
                site_id=site.id,
                codigo=f"teste-analytics-{letra.lower()}-{uuid.uuid4().hex[:6]}",
                nome=f"Portaria Analytics {letra} {MARCA}",
            )
            db.add(p)
            pontos.append(p)
        await db.flush()

        pessoas = []
        for nome, setor in SETORES_POR_PESSOA:
            p = Pessoa(nome=f"{nome} {MARCA}", setor=setor, ativo=True)
            db.add(p)
            pessoas.append(p)
        await db.flush()

        for reg in registros:
            quando_utc = reg.hora_local.astimezone(timezone.utc)
            v = Verificacao(
                id=uuid.uuid4(),
                ponto_id=pontos[reg.ponto_idx].id,
                pessoa_id=pessoas[reg.pessoa_idx].id if reg.pessoa_idx is not None else None,
                status=reg.status,
                iniciada_em=quando_utc,
                concluida_em=quando_utc,
                expira_em=quando_utc + timedelta(seconds=10),
                latencia_ms=reg.latencia,
                versao_modelo=reg.versao,
                motivo_falha=(
                    "EPI ausente: verificação não confirmada pela inspeção"
                    if reg.status == StatusVerificacao.REPROVADA
                    else None
                ),
            )
            db.add(v)
            for codigo, presente in reg.deteccoes:
                db.add(Deteccao(
                    verificacao_id=v.id,
                    tipo_epi_id=tipos[codigo].id,
                    presente=presente,
                    confianca=0.95 if presente else 0.15,
                    frames_confirmados=5 if presente else 0,
                ))

        await db.commit()

    # Descarta o pool de conexões AINDA dentro deste event loop. O
    # `TestClient` mais abaixo roda a aplicação (e portanto `get_session()`)
    # num loop novo; sem isto, o pool tenta reaproveitar uma conexão
    # asyncpg presa ao loop que está prestes a fechar, e todo request que
    # precisar do banco quebra com "Event loop is closed".
    await engine.dispose()

    return {
        "esperado": esperado,
        "ponto_ids": [p.id for p in pontos],
        "pessoa_ids": [p.id for p in pessoas],
    }


def main() -> None:
    ctx = asyncio.run(preparar())
    esperado = ctx["esperado"]
    ponto_ids = ctx["ponto_ids"]
    pessoa_ids = ctx["pessoa_ids"]

    print(f"cenário: {esperado['total_geral']} verificações criadas")

    with TestClient(app) as c:
        r = c.post(
            "/api/v1/auth/login",
            json={"email": "admin@epiguard.com.br", "senha": "admin123"},
        )
        checar("login admin", r.status_code == 200, f"({r.status_code})")
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}

        hoje = esperado["hoje"]
        ontem = esperado["ontem"]
        base = {"desde": hoje["data"].isoformat(), "ate": hoje["data"].isoformat()}

        # ---------------------------------------------------- /opcoes
        print("\n0. /analytics/opcoes")
        r = c.get("/api/v1/relatorios/analytics/opcoes", headers=h)
        checar("200 OK", r.status_code == 200, f"({r.status_code})")
        d = r.json()
        for setor in sorted({s for _, s in SETORES_POR_PESSOA}):
            checar(f"setor '{setor}' listado em /opcoes", setor in d["setores"])
        for versao in VERSOES:
            checar(f"versão '{versao}' listada em /opcoes", versao in d["versoes_modelo"])
        checar(
            "pelo menos 3 pontos ativos listados",
            len(d["pontos"]) >= 3, f"(vieram {len(d['pontos'])})",
        )

        # ------------------------------------------------ /indicadores
        print("\n1. /analytics/indicadores — cenário de HOJE (70/20/5/5)")
        r = c.get("/api/v1/relatorios/analytics/indicadores", headers=h, params=base)
        checar("200 OK", r.status_code == 200, f"({r.status_code})")
        a = r.json()["atual"]
        checar("verificacoes == 100", a["verificacoes"] == 100, f"(veio {a['verificacoes']})")
        checar("aprovadas == 70", a["aprovadas"] == 70, f"(veio {a['aprovadas']})")
        checar("bloqueios == 20", a["bloqueios"] == 20, f"(veio {a['bloqueios']})")
        checar(
            f"taxa_conformidade == {hoje['taxa_conformidade']} "
            f"(70/(70+20) = 77,78% — EXPIRADA/ERRO fora do denominador)",
            a["taxa_conformidade"] == hoje["taxa_conformidade"],
            f"(veio {a['taxa_conformidade']})",
        )
        checar(
            f"latencia_media_ms == {hoje['latencia_media_ms']}",
            a["latencia_media_ms"] == hoje["latencia_media_ms"],
            f"(veio {a['latencia_media_ms']})",
        )
        checar(
            "pessoas_barradas == 6 (as 6 pessoas do cenário passam por pelo "
            "menos uma reprovação, dado o round-robin de 20 reprovações "
            "sobre 6 pessoas)",
            a["pessoas_barradas"] == min(20, len(SETORES_POR_PESSOA)),
            f"(veio {a['pessoas_barradas']})",
        )

        print("\n2. período anterior (ontem: 24/6 == 80%)")
        anterior = r.json()["anterior"]
        checar("período anterior existe", anterior is not None)
        if anterior:
            checar(
                "anterior.verificacoes == 30", anterior["verificacoes"] == ontem["total"],
                f"(veio {anterior['verificacoes']})",
            )
            checar(
                f"anterior.taxa_conformidade == {ontem['taxa_conformidade']}",
                anterior["taxa_conformidade"] == ontem["taxa_conformidade"],
                f"(veio {anterior['taxa_conformidade']})",
            )

        # -------------------------------------------------- /tendencia
        print("\n3. /analytics/tendencia — janela de 7 dias (hoje..-6)")
        janela = esperado["janela_7_dias"]
        r = c.get(
            "/api/v1/relatorios/analytics/tendencia", headers=h,
            params={"desde": janela["desde"].isoformat(), "ate": janela["ate"].isoformat()},
        )
        checar("200 OK", r.status_code == 200, f"({r.status_code})")
        dias = r.json()["dias"]
        checar(
            f"{janela['dias_distintos']} dias distintos com dado",
            len(dias) == janela["dias_distintos"], f"(vieram {len(dias)})",
        )
        soma_total = sum(d["total"] for d in dias)
        soma_aprovadas = sum(d["aprovadas"] for d in dias)
        soma_reprovadas = sum(d["bloqueios"] for d in dias)
        checar(
            f"soma de verificações na janela == {janela['total']}",
            soma_total == janela["total"], f"(veio {soma_total})",
        )
        checar(
            f"soma de aprovadas na janela == {janela['aprovadas']}",
            soma_aprovadas == janela["aprovadas"], f"(veio {soma_aprovadas})",
        )
        checar(
            f"soma de reprovadas na janela == {janela['reprovadas']}",
            soma_reprovadas == janela["reprovadas"], f"(veio {soma_reprovadas})",
        )
        dia_hoje_na_lista = next((d for d in dias if d["dia"] == hoje["data"].isoformat()), None)
        checar(
            "o dia de hoje aparece em tendencia com os mesmos 70/20/5/5",
            dia_hoje_na_lista is not None
            and dia_hoje_na_lista["aprovadas"] == 70
            and dia_hoje_na_lista["bloqueios"] == 20
            and dia_hoje_na_lista["expiradas"] == 5
            and dia_hoje_na_lista["erros"] == 5,
            f"(veio {dia_hoje_na_lista})",
        )

        # ---------------------------------------------- /epis-ausentes
        print("\n4. /analytics/epis-ausentes")
        r = c.get("/api/v1/relatorios/analytics/epis-ausentes", headers=h, params=base)
        checar("200 OK", r.status_code == 200, f"({r.status_code})")
        itens = {i["epi"]: i for i in r.json()["itens"]}
        checar(
            f"capacete: 10 faltas em {hoje['inspecionaram_capacete']} inspeções",
            "capacete" in itens
            and itens["capacete"]["faltas"] == 10
            and itens["capacete"]["total"] == hoje["inspecionaram_capacete"],
            f"(veio {itens.get('capacete')})",
        )
        checar(
            f"colete: 10 faltas em {hoje['inspecionaram_colete']} inspeções (100%)",
            "colete" in itens
            and itens["colete"]["faltas"] == 10
            and itens["colete"]["total"] == hoje["inspecionaram_colete"]
            and itens["colete"]["pct_falta"] == 100.0,
            f"(veio {itens.get('colete')})",
        )

        # ---------------------------------------- /conformidade-por-ponto
        print("\n5. /analytics/conformidade-por-ponto")
        r = c.get(
            "/api/v1/relatorios/analytics/conformidade-por-ponto", headers=h, params=base,
        )
        checar("200 OK", r.status_code == 200, f"({r.status_code})")
        pontos_resp = {p["ponto_id"]: p for p in r.json()["pontos"]}
        checar(
            "3 pontos do cenário aparecem",
            all(pid in pontos_resp for pid in ponto_ids),
            f"(vieram ids {list(pontos_resp.keys())})",
        )
        soma_total_pontos = sum(
            p["total"] for pid, p in pontos_resp.items() if pid in ponto_ids
        )
        checar(
            "soma de verificações entre os 3 pontos == 100",
            soma_total_pontos == 100, f"(veio {soma_total_pontos})",
        )

        # -------------------------------------------------- /horarios
        print("\n6. /analytics/horarios (heatmap)")
        r = c.get("/api/v1/relatorios/analytics/horarios", headers=h, params=base)
        checar("200 OK", r.status_code == 200, f"({r.status_code})")
        checar("fuso retornado é o TZ_EXIBICAO", r.json()["fuso"] == settings.TZ_EXIBICAO)
        soma_celulas = sum(c_["total"] for c_ in r.json()["celulas"])
        checar(
            "soma das células do heatmap == 100 (nenhuma verificação sumiu)",
            soma_celulas == 100, f"(veio {soma_celulas})",
        )

        # --------------------------------------------------- /setores
        print("\n7. /analytics/setores")
        r = c.get("/api/v1/relatorios/analytics/setores", headers=h, params=base)
        checar("200 OK", r.status_code == 200, f"({r.status_code})")
        setores_resp = {s["setor"]: s for s in r.json()["itens"]}
        for setor, total_esperado in hoje["por_setor"].items():
            checar(
                f"setor {setor}: total == {total_esperado}",
                setor in setores_resp and setores_resp[setor]["total"] == total_esperado,
                f"(veio {setores_resp.get(setor)})",
            )

        # ------------------------------------------------ /desempenho
        print("\n8. /analytics/desempenho")
        r = c.get("/api/v1/relatorios/analytics/desempenho", headers=h, params=base)
        checar("200 OK", r.status_code == 200, f"({r.status_code})")
        d = r.json()
        checar(
            f"latencia_media_ms == {hoje['latencia_media_ms']}",
            d["latencia_media_ms"] == hoje["latencia_media_ms"],
            f"(veio {d['latencia_media_ms']})",
        )
        por_versao_resp = {v["versao_modelo"]: v for v in d["por_versao"]}
        for versao, total_esperado in hoje["por_versao"].items():
            checar(
                f"versão {versao}: total == {total_esperado}",
                versao in por_versao_resp
                and por_versao_resp[versao]["total"] == total_esperado,
                f"(veio {por_versao_resp.get(versao)})",
            )

        # --------------------------------------------------- /tabela
        print("\n9. /analytics/tabela — filtros simples")
        r = c.get(
            "/api/v1/relatorios/analytics/tabela", headers=h,
            params={**base, "situacao": "REPROVADA", "limite": 50},
        )
        checar("20 reprovadas no dia", r.json()["total"] == 20, f"(veio {r.json()['total']})")

        r = c.get(
            "/api/v1/relatorios/analytics/tabela", headers=h,
            params={**base, "setor": "Producao", "limite": 50},
        )
        checar(
            f"setor Producao: {hoje['por_setor']['Producao']} verificações",
            r.json()["total"] == hoje["por_setor"]["Producao"],
            f"(veio {r.json()['total']})",
        )

        r = c.get(
            "/api/v1/relatorios/analytics/tabela", headers=h,
            params={**base, "pessoa_id": pessoa_ids[0], "limite": 50},
        )
        checar(
            f"pessoa 0: {hoje['por_pessoa'][0]} verificações",
            r.json()["total"] == hoje["por_pessoa"][0], f"(veio {r.json()['total']})",
        )

        r = c.get(
            "/api/v1/relatorios/analytics/tabela", headers=h,
            params={**base, "tipo_epi": "capacete", "limite": 50},
        )
        checar(
            f"tipo_epi=capacete: {hoje['inspecionaram_capacete']} verificações",
            r.json()["total"] == hoje["inspecionaram_capacete"], f"(veio {r.json()['total']})",
        )

        r = c.get(
            "/api/v1/relatorios/analytics/tabela", headers=h,
            params={**base, "tipo_epi": "colete", "limite": 50},
        )
        checar(
            f"tipo_epi=colete: {hoje['inspecionaram_colete']} verificações",
            r.json()["total"] == hoje["inspecionaram_colete"], f"(veio {r.json()['total']})",
        )

        r = c.get(
            "/api/v1/relatorios/analytics/tabela", headers=h,
            params={**base, "versao_modelo": "modelo-v1", "limite": 50},
        )
        checar(
            f"versao_modelo=modelo-v1: {hoje['por_versao']['modelo-v1']} verificações",
            r.json()["total"] == hoje["por_versao"]["modelo-v1"], f"(veio {r.json()['total']})",
        )

        print("\n10. combinação: REPROVADA + tipo_epi=colete")
        r = c.get(
            "/api/v1/relatorios/analytics/tabela", headers=h,
            params={**base, "situacao": "REPROVADA", "tipo_epi": "colete", "limite": 50},
        )
        checar(
            "10 (todas as reprovadas por colete, e só elas)",
            r.json()["total"] == 10, f"(veio {r.json()['total']})",
        )

        print("\n11. combinação: setor + ponto + situação")
        r = c.get(
            "/api/v1/relatorios/analytics/tabela", headers=h,
            params={
                **base, "setor": "Producao", "ponto_id": ponto_ids[0],
                "situacao": "REPROVADA", "limite": 100,
            },
        )
        checar(
            "200 OK (combinação de 3 filtros não quebra)",
            r.status_code == 200, f"({r.status_code})",
        )
        checar(
            "resultado da combinação é um subconjunto coerente (<= 20 reprovadas, <= "
            f"{hoje['por_setor']['Producao']} da Produção)",
            0 <= r.json()["total"] <= min(20, hoje["por_setor"]["Producao"]),
            f"(veio {r.json()['total']})",
        )

        print("\n12. intervalo sem dados")
        sem_dados = (hoje["data"] - timedelta(days=365)).isoformat()
        r = c.get(
            "/api/v1/relatorios/analytics/indicadores", headers=h,
            params={"desde": sem_dados, "ate": sem_dados},
        )
        d = r.json()["atual"]
        checar(
            "intervalo sem dados: verificacoes == 0, sem erro 500",
            r.status_code == 200 and d["verificacoes"] == 0, f"(veio {d})",
        )
        checar(
            "intervalo sem dados: taxa_conformidade é None (não divide por zero)",
            d["taxa_conformidade"] is None, f"(veio {d['taxa_conformidade']})",
        )

        # ---------------------------------------------------- timezone
        print("\n13. fronteira de timezone (23h30/23h59/00h00/00h30 local)")
        borda = esperado["dia_borda"]
        r = c.get(
            "/api/v1/relatorios/analytics/indicadores", headers=h,
            params={"desde": borda["data"].isoformat(), "ate": borda["data"].isoformat()},
        )
        checar(
            "as 4 verificações da borda caem no dia certo",
            r.json()["atual"]["verificacoes"] == 4, f"(veio {r.json()['atual']['verificacoes']})",
        )
        r_antes = c.get(
            "/api/v1/relatorios/analytics/indicadores", headers=h,
            params={
                "desde": borda["dia_anterior"].isoformat(),
                "ate": borda["dia_anterior"].isoformat(),
            },
        )
        checar(
            "nenhuma delas vaza para o dia ANTERIOR (23h30/23h59 não somem pro dia de trás)",
            r_antes.json()["atual"]["verificacoes"] == 0,
            f"(veio {r_antes.json()['atual']['verificacoes']})",
        )
        r_depois = c.get(
            "/api/v1/relatorios/analytics/indicadores", headers=h,
            params={
                "desde": borda["dia_seguinte"].isoformat(),
                "ate": borda["dia_seguinte"].isoformat(),
            },
        )
        checar(
            "nenhuma delas vaza para o dia SEGUINTE (00h00/00h30 não pulam pro dia da frente)",
            r_depois.json()["atual"]["verificacoes"] == 0,
            f"(veio {r_depois.json()['atual']['verificacoes']})",
        )

        # --------------------------------------------- pessoa não identificada
        print("\n14. verificação sem pessoa identificada (NULL tratado como 'Não informado')")
        sem_pessoa = esperado["sem_pessoa"]
        r = c.get(
            "/api/v1/relatorios/analytics/setores", headers=h,
            params={"desde": sem_pessoa["data"].isoformat(), "ate": sem_pessoa["data"].isoformat()},
        )
        setores_resp = {s["setor"]: s for s in r.json()["itens"]}
        checar(
            "as 2 verificações sem pessoa aparecem como 'Não informado'",
            "Não informado" in setores_resp and setores_resp["Não informado"]["total"] == 2,
            f"(veio {setores_resp})",
        )
        r = c.get(
            "/api/v1/relatorios/analytics/tabela", headers=h,
            params={"desde": sem_pessoa["data"].isoformat(), "ate": sem_pessoa["data"].isoformat(), "limite": 10},
        )
        checar(
            "pessoa_nome vem null na tabela, sem quebrar",
            r.status_code == 200
            and len(r.json()["itens"]) == 2
            and all(it["pessoa_nome"] is None for it in r.json()["itens"]),
            f"(veio {[it.get('pessoa_nome') for it in r.json().get('itens', [])]})",
        )

        # ---------------------------------------------------- paginação
        print("\n15. paginação sobre as 100 verificações de hoje")
        r = c.get(
            "/api/v1/relatorios/analytics/tabela", headers=h,
            params={**base, "limite": 25, "offset": 0},
        )
        checar(
            "primeira página: total=100, 25 itens",
            r.json()["total"] == 100 and len(r.json()["itens"]) == 25,
            f"(total={r.json()['total']}, itens={len(r.json()['itens'])})",
        )
        ids_pagina1 = {it["id"] for it in r.json()["itens"]}

        r = c.get(
            "/api/v1/relatorios/analytics/tabela", headers=h,
            params={**base, "limite": 25, "offset": 50},
        )
        checar(
            "página intermediária (offset=50): 25 itens",
            len(r.json()["itens"]) == 25, f"(vieram {len(r.json()['itens'])})",
        )
        ids_pagina3 = {it["id"] for it in r.json()["itens"]}
        checar("página intermediária não repete a primeira", ids_pagina1.isdisjoint(ids_pagina3))

        r = c.get(
            "/api/v1/relatorios/analytics/tabela", headers=h,
            params={**base, "limite": 25, "offset": 75},
        )
        checar(
            "última página (offset=75): 25 itens",
            len(r.json()["itens"]) == 25, f"(vieram {len(r.json()['itens'])})",
        )

        r = c.get(
            "/api/v1/relatorios/analytics/tabela", headers=h,
            params={**base, "limite": 25, "offset": 100},
        )
        checar(
            "além do limite (offset=100): 0 itens, sem erro",
            r.status_code == 200 and len(r.json()["itens"]) == 0,
            f"({r.status_code}, {len(r.json().get('itens', []))} itens)",
        )

        print("\n16. filtro trocado no meio da paginação não mistura resultados")
        r_pag0_situacao_todas = c.get(
            "/api/v1/relatorios/analytics/tabela", headers=h,
            params={**base, "limite": 25, "offset": 0},
        )
        r_pag0_so_reprovada = c.get(
            "/api/v1/relatorios/analytics/tabela", headers=h,
            params={**base, "situacao": "REPROVADA", "limite": 25, "offset": 0},
        )
        checar(
            "trocar o filtro muda o total relatado (100 -> 20), não só a página",
            r_pag0_situacao_todas.json()["total"] == 100
            and r_pag0_so_reprovada.json()["total"] == 20,
            f"(veio {r_pag0_situacao_todas.json()['total']} e "
            f"{r_pag0_so_reprovada.json()['total']})",
        )

        # ---------------------------------------------------- CSV real
        print("\n17. exportação CSV — chamada HTTP real")
        r = c.get(
            "/api/v1/relatorios/analytics/exportar", headers=h,
            params={**base, "situacao": "REPROVADA"},
        )
        checar("200 OK", r.status_code == 200, f"({r.status_code})")
        checar(
            "Content-Type é text/csv",
            "text/csv" in r.headers.get("content-type", ""),
            f"({r.headers.get('content-type')})",
        )
        disposicao = r.headers.get("content-disposition", "")
        checar(
            "Content-Disposition é anexo com nome .csv",
            "attachment" in disposicao and ".csv" in disposicao, f"({disposicao})",
        )
        corpo = r.content
        checar("BOM UTF-8 no início do arquivo", corpo[:3] == b"\xef\xbb\xbf")
        texto = corpo.decode("utf-8-sig")
        checar(
            "usa ';' como delimitador (cabeçalho tem 'data_hora;pessoa')",
            "data_hora;pessoa" in texto.splitlines()[0],
        )
        linhas = list(csv.reader(io.StringIO(texto), delimiter=";"))
        checar(
            "cabeçalho com as 11 colunas esperadas, sem campo sensível",
            linhas[0] == [
                "data_hora", "pessoa", "registro", "setor", "ponto", "status",
                "motivo_falha", "epis_detectados", "epis_ausentes", "latencia_ms",
                "versao_modelo",
            ],
            f"(veio {linhas[0]})",
        )
        checar(
            "nenhuma coluna de embedding/identificação/evidência/biometria",
            not any(
                termo in " ".join(linhas[0]).lower()
                for termo in ("embedding", "identificacao", "evidencia", "biometr")
            ),
        )
        linhas_dado = linhas[1:]
        checar(
            "20 linhas de dado (as 20 reprovadas do dia, não a tabela inteira)",
            len(linhas_dado) == 20, f"(vieram {len(linhas_dado)})",
        )
        checar(
            "todas as linhas exportadas são de fato REPROVADA",
            all(linha[5] == "REPROVADA" for linha in linhas_dado),
        )
        checar(
            "caracteres acentuados decodificam corretamente (sem mojibake) "
            "no motivo_falha ('verificação', 'não')",
            all("verificação não confirmada" in linha[6] for linha in linhas_dado),
            f"(veio {linhas_dado[0][6] if linhas_dado else '(vazio)'})",
        )

        print("\n18. autenticação")
        r = c.get("/api/v1/relatorios/analytics/indicadores")
        checar("sem token -> 403", r.status_code == 403, f"({r.status_code})")

    asyncio.run(limpar())

    print(f"\n{'=' * 56}")
    print(f"{ok} verificações passaram, {len(falhas)} falharam")
    if falhas:
        for nome in falhas:
            print(f"  - {nome}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
