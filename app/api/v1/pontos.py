"""Pontos de acesso, dispositivos e liberação manual."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DB, admin_atual, exige_papel
from app.core.config import settings
from app.db.models import (
    Dispositivo,
    EventoAcesso,
    LogAuditoria,
    PontoAcesso,
    Site,
    TipoEventoAcesso,
    UsuarioAdmin,
    Verificacao,
)
from app.mqtt import topics
from app.mqtt.publisher import MqttIndisponivel, publisher
from app.mqtt.schemas import LiberarCmd
from app.schemas.api import DispositivoOut, LiberacaoManualIn, PontoOut

router = APIRouter(tags=["pontos"])


@router.get("/pontos", response_model=list[PontoOut])
async def listar_pontos(db: AsyncSession = DB) -> list[PontoOut]:
    stmt = select(PontoAcesso).options(
        selectinload(PontoAcesso.epis_exigidos)
    ).order_by(PontoAcesso.id)
    pontos = list((await db.execute(stmt)).scalars().unique().all())
    return [
        PontoOut(
            id=p.id,
            codigo=p.codigo,
            nome=p.nome,
            ativo=p.ativo,
            epis_exigidos=[e.tipo_epi.codigo for e in p.epis_exigidos],
        )
        for p in pontos
    ]


@router.get("/dispositivos", response_model=list[DispositivoOut])
async def listar_dispositivos(
    _: UsuarioAdmin = Depends(admin_atual), db: AsyncSession = DB
) -> list[DispositivoOut]:
    """Presença ao vivo, sem polling.

    A coluna `online` é mantida pelo worker a partir do status retido e do
    Last Will de cada dispositivo. O broker é quem avisa que alguém morreu.
    """
    stmt = select(Dispositivo).order_by(Dispositivo.ponto_id, Dispositivo.tipo)
    itens = list((await db.execute(stmt)).scalars().all())
    return [
        DispositivoOut(
            id=d.id,
            ponto_id=d.ponto_id,
            tipo=d.tipo.value,
            client_id_mqtt=d.client_id_mqtt,
            online=d.online,
            visto_em=d.visto_em,
            firmware=d.firmware,
            versao_modelo=d.versao_modelo,
        )
        for d in itens
    ]


@router.post("/pontos/{ponto_id}/liberacao-manual")
async def liberacao_manual(
    ponto_id: int,
    dados: LiberacaoManualIn,
    usuario: UsuarioAdmin = Depends(exige_papel("admin", "supervisor")),
    db: AsyncSession = DB,
) -> dict:
    """Override do supervisor — SEMPRE auditado.

    Um sistema de controle de acesso sem escape manual trava a operação no
    primeiro defeito de câmera. Um escape manual sem trilha de auditoria
    vira o caminho preferido para burlar o controle. Por isso os dois
    andam juntos: a justificativa é obrigatória e fica gravada.
    """
    ponto = await db.get(PontoAcesso, ponto_id)
    if ponto is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ponto não encontrado")

    verif = await db.get(Verificacao, dados.verificacao_id)
    if verif is None or verif.ponto_id != ponto_id:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "verificação não encontrada neste ponto"
        )

    site = await db.get(Site, ponto.site_id)
    agora = datetime.now(timezone.utc)
    cmd = LiberarCmd(
        verificacao_id=verif.id,
        duracao_ms=settings.CATRACA_DURACAO_MS,
        expira_em=agora + timedelta(seconds=settings.LIBERACAO_TTL_S),
    )
    try:
        await publisher.publicar(
            topics.cmd_liberar(site.codigo, ponto.codigo), cmd, qos=1, retain=False
        )
    except MqttIndisponivel as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "broker indisponível"
        ) from exc

    db.add(
        EventoAcesso(
            verificacao_id=verif.id,
            evento=TipoEventoAcesso.LIBERACAO_MANUAL,
            ocorrido_em=agora,
            autor_admin_id=usuario.id,
            justificativa=dados.justificativa,
        )
    )
    db.add(
        LogAuditoria(
            ator_id=usuario.id,
            acao="LIBERACAO_MANUAL",
            entidade="verificacao",
            entidade_id=str(verif.id),
            detalhe={"ponto_id": ponto_id, "justificativa": dados.justificativa},
        )
    )
    await db.commit()
    return {"ok": True}
