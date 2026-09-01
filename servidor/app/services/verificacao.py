"""Regra de conformidade — o cérebro do sistema.

A decisão de liberar mora AQUI, nunca na Raspberry. A borda relata o que
viu; o servidor confronta com a política do ponto de acesso. Trocar a
exigência de um ponto é um UPDATE no banco, não uma reprogramação de campo.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import (
    Deteccao,
    Dispositivo,
    EpiExigido,
    EventoAcesso,
    Identificacao,
    Pessoa,
    PontoAcesso,
    Site,
    StatusVerificacao,
    TipoDispositivo,
    TipoEpi,
    TipoEventoAcesso,
    Verificacao,
)
from app.mqtt import topics
from app.mqtt.publisher import MqttIndisponivel, publisher
from app.mqtt.schemas import (
    AvisoTabletEvt,
    CapturarCmd,
    LiberarCmd,
    PassagemEvt,
    ResultadoEvt,
)

log = logging.getLogger(__name__)


class ErroVerificacao(Exception):
    pass


class PontoIndisponivel(ErroVerificacao):
    pass


# ------------------------------------------------------------------ helpers
async def epis_exigidos(db: AsyncSession, ponto_id: int) -> list[TipoEpi]:
    stmt = (
        select(TipoEpi)
        .join(EpiExigido, EpiExigido.tipo_epi_id == TipoEpi.id)
        .where(EpiExigido.ponto_id == ponto_id)
    )
    return list((await db.execute(stmt)).scalars().all())


async def _codigos_topico(db: AsyncSession, ponto: PontoAcesso) -> tuple[str, str]:
    """(codigo_site, codigo_ponto) — os dois níveis do tópico MQTT.

    Carregamos o site explicitamente: em SQLAlchemy assíncrono, tocar em
    `ponto.site` sem eager loading levanta MissingGreenlet.
    """
    site = await db.get(Site, ponto.site_id)
    if site is None:
        raise ErroVerificacao(f"site {ponto.site_id} não encontrado")
    return site.codigo, ponto.codigo


async def _camera_online(db: AsyncSession, ponto_id: int) -> bool:
    """Presença da Raspberry, alimentada pelo status retido / LWT.

    Checar isto ANTES de abrir a verificação é o que evita deixar a pessoa
    parada dez segundos esperando um timeout que já era previsível.
    """
    stmt = select(Dispositivo).where(
        Dispositivo.ponto_id == ponto_id,
        Dispositivo.tipo == TipoDispositivo.RASPBERRY,
    )
    dispositivos = list((await db.execute(stmt)).scalars().all())
    return any(d.online for d in dispositivos)


# ------------------------------------------------------------------ abertura
async def abrir(
    db: AsyncSession, *, ponto_id: int, identificacao: Identificacao | None
) -> Verificacao:
    """Cria a verificação e dispara cmd/capturar."""
    ponto = await db.get(PontoAcesso, ponto_id)
    if ponto is None or not ponto.ativo:
        raise PontoIndisponivel("ponto de acesso inexistente ou inativo")

    if not await _camera_online(db, ponto_id):
        raise PontoIndisponivel("câmera do ponto está offline")

    exigidos = await epis_exigidos(db, ponto_id)
    if not exigidos:
        raise ErroVerificacao("ponto sem EPIs configurados")

    agora = datetime.now(timezone.utc)
    verif = Verificacao(
        id=uuid.uuid4(),
        ponto_id=ponto_id,
        pessoa_id=identificacao.pessoa_id if identificacao else None,
        identificacao_id=identificacao.id if identificacao else None,
        status=StatusVerificacao.AGUARDANDO_ANALISE,
        expira_em=agora + timedelta(seconds=settings.VERIFICACAO_TIMEOUT_S),
    )
    db.add(verif)
    await db.flush()

    site_codigo, ponto_codigo = await _codigos_topico(db, ponto)

    cmd = CapturarCmd(
        verificacao_id=verif.id,
        epis_exigidos=[e.codigo for e in exigidos],
        frames=settings.VERIFICACAO_FRAMES,
        expira_em=verif.expira_em,
    )
    try:
        await publisher.publicar(
            topics.cmd_capturar(site_codigo, ponto_codigo), cmd, qos=1
        )
    except MqttIndisponivel as exc:
        verif.status = StatusVerificacao.ERRO
        verif.motivo_falha = "broker indisponível"
        verif.concluida_em = agora
        await db.flush()
        raise PontoIndisponivel("broker MQTT indisponível") from exc

    return verif


# ------------------------------------------------------------------ decisão
def _avaliar(
    exigidos: list[TipoEpi], evt: ResultadoEvt
) -> tuple[bool, list[str]]:
    """Confronta o que a borda viu com o que o ponto exige.

    Ausência de informação conta como reprovação: se a Raspberry não relatou
    nada sobre o capacete e o capacete é exigido, a pessoa não passa. Falhar
    para o lado seguro é o comportamento correto em segurança do trabalho.
    """
    vistos = {d.epi: d for d in evt.deteccoes}
    faltantes: list[str] = []
    for epi in exigidos:
        item = vistos.get(epi.codigo)
        if item is None or not item.presente:
            faltantes.append(epi.rotulo)
    return (not faltantes), faltantes


async def registrar_resultado(db: AsyncSession, evt: ResultadoEvt) -> None:
    """Persiste o resultado da inferência, decide e libera a catraca."""
    verif = await db.get(Verificacao, evt.verificacao_id)
    if verif is None:
        log.warning("resultado para verificação desconhecida %s", evt.verificacao_id)
        return
    if verif.status is not StatusVerificacao.AGUARDANDO_ANALISE:
        log.info("resultado tardio para %s (%s)", verif.id, verif.status)
        return

    agora = datetime.now(timezone.utc)
    if verif.expira_em < agora:
        verif.status = StatusVerificacao.EXPIRADA
        verif.concluida_em = agora
        verif.motivo_falha = "resultado chegou após o prazo"
        await _notificar(db, verif, [])
        return

    exigidos = await epis_exigidos(db, verif.ponto_id)
    por_codigo = {e.codigo: e for e in exigidos}

    for item in evt.deteccoes:
        tipo = por_codigo.get(item.epi)
        if tipo is None:
            continue  # a borda relatou um EPI que este ponto não exige
        db.add(
            Deteccao(
                verificacao_id=verif.id,
                tipo_epi_id=tipo.id,
                presente=item.presente,
                confianca=item.confianca,
                frames_confirmados=item.frames_confirmados,
                bbox={"xywh": item.bbox} if item.bbox else None,
            )
        )

    aprovado, faltantes = _avaliar(exigidos, evt)
    verif.status = (
        StatusVerificacao.APROVADA if aprovado else StatusVerificacao.REPROVADA
    )
    verif.versao_modelo = evt.versao_modelo
    verif.concluida_em = agora
    verif.latencia_ms = int((agora - verif.iniciada_em).total_seconds() * 1000)
    if not aprovado:
        verif.motivo_falha = "EPI ausente: " + ", ".join(faltantes)
    await db.flush()

    if aprovado:
        await _liberar(db, verif)
    else:
        db.add(
            EventoAcesso(
                verificacao_id=verif.id,
                evento=TipoEventoAcesso.NEGADO,
                ocorrido_em=agora,
            )
        )

    await _notificar(db, verif, faltantes)


async def _liberar(db: AsyncSession, verif: Verificacao) -> None:
    ponto = await db.get(PontoAcesso, verif.ponto_id)
    site_codigo, ponto_codigo = await _codigos_topico(db, ponto)
    agora = datetime.now(timezone.utc)

    cmd = LiberarCmd(
        verificacao_id=verif.id,
        duracao_ms=settings.CATRACA_DURACAO_MS,
        expira_em=agora + timedelta(seconds=settings.LIBERACAO_TTL_S),
    )
    # retain=False é OBRIGATÓRIO aqui. Um "liberar" retido seria reentregue
    # ao ESP32 a cada reboot dele — a catraca abriria sozinha após queda de
    # energia.
    await publisher.publicar(
        topics.cmd_liberar(site_codigo, ponto_codigo), cmd, qos=1, retain=False
    )
    db.add(
        EventoAcesso(
            verificacao_id=verif.id,
            evento=TipoEventoAcesso.LIBERADO,
            ocorrido_em=agora,
        )
    )


async def registrar_passagem(db: AsyncSession, evt: PassagemEvt) -> None:
    """Fecha o ciclo: liberar não é o mesmo que passar.

    Só o evento de passagem prova que a pessoa entrou. A auditoria de
    segurança do trabalho vive dessa distinção.
    """
    verif = await db.get(Verificacao, evt.verificacao_id)
    if verif is None:
        log.warning("passagem para verificação desconhecida %s", evt.verificacao_id)
        return
    db.add(
        EventoAcesso(
            verificacao_id=verif.id,
            evento=TipoEventoAcesso(evt.evento),
            ocorrido_em=evt.ts,
        )
    )
    await db.flush()
    await _avisar_tablet(
        verif.ponto_id,
        {"tipo": "passagem", "verificacao_id": str(verif.id),
         "evento": evt.evento},
    )


async def _notificar(
    db: AsyncSession, verif: Verificacao, faltantes: list[str]
) -> None:
    """Anuncia o desfecho no canal interno, para chegar ao tablet.

    Publica no broker em vez de escrever direto no `hub`. Parece um desvio
    e é o contrário: quem decide o desfecho é o WORKER, que roda em outro
    processo, e o `hub` é um objeto em memória com os WebSockets do
    processo da API. Escrevendo direto, a mensagem se perdia — o tablet
    ficava esperando um resultado que já estava gravado no banco.

    Cada processo da API assina este tópico e reemite para os seus
    próprios WebSockets (`app/realtime/ponte.py`). Com a API e o worker no
    mesmo processo, o caminho é o mesmo e entrega uma vez só.
    """
    # `verif.pessoa` dispararia lazy-load síncrono fora do bridge greenlet.
    # Mesma armadilha que Caio corrigiu em /identificacao (5f6cfe3): o get
    # consulta o identity map antes, então no caminho comum não custa
    # consulta nenhuma.
    nome = None
    if verif.pessoa_id is not None:
        pessoa = await db.get(Pessoa, verif.pessoa_id)
        nome = pessoa.nome if pessoa else None

    await _avisar_tablet(
        verif.ponto_id,
        {
            "tipo": "resultado",
            "verificacao_id": str(verif.id),
            "status": verif.status.value,
            "pessoa": nome,
            "faltantes": faltantes,
            "motivo": verif.motivo_falha,
        },
    )


async def _avisar_tablet(ponto_id: int, mensagem: dict) -> None:
    """Publica no canal interno; a ponte de cada API reemite no WebSocket."""
    try:
        await publisher.publicar(
            topics.AVISOS_TABLET,
            AvisoTabletEvt(ponto_id=ponto_id, mensagem=mensagem),
            qos=1,
        )
    except MqttIndisponivel as exc:
        # Aviso ao tablet é acessório: a decisão já está no banco e a
        # catraca já foi comandada. Perder o aviso degrada a experiência,
        # não a segurança — então não derrubamos o processamento.
        log.warning("não consegui avisar o ponto %s: %s", ponto_id, exc)


# ------------------------------------------------------------------ timeout
async def expirar_pendentes(db: AsyncSession) -> int:
    """Fecha verificações que passaram do prazo sem resposta da borda.

    Roda periodicamente. Sem isso, uma Raspberry que travou deixa
    verificações penduradas para sempre e o ponto trava para a fila.
    """
    agora = datetime.now(timezone.utc)
    stmt = select(Verificacao).where(
        Verificacao.status == StatusVerificacao.AGUARDANDO_ANALISE,
        Verificacao.expira_em < agora,
    )
    pendentes = list((await db.execute(stmt)).scalars().all())
    for verif in pendentes:
        verif.status = StatusVerificacao.EXPIRADA
        verif.concluida_em = agora
        verif.motivo_falha = "sem resposta da borda dentro do prazo"
        await _notificar(db, verif, [])
    if pendentes:
        log.info("%d verificações expiradas", len(pendentes))
    return len(pendentes)
