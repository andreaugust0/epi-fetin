"""Presença de dispositivos, alimentada pelo status retido / LWT do MQTT.

Não há polling em lugar nenhum: quem avisa que um dispositivo morreu é o
próprio broker, publicando o testamento (Last Will) que o dispositivo
registrou ao conectar.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Dispositivo
from app.mqtt.schemas import StatusEvt

log = logging.getLogger(__name__)


async def atualizar(db: AsyncSession, client_id: str, evt: StatusEvt) -> None:
    stmt = select(Dispositivo).where(Dispositivo.client_id_mqtt == client_id)
    disp = (await db.execute(stmt)).scalar_one_or_none()
    if disp is None:
        # Dispositivo publicando status sem estar cadastrado. Não criamos
        # automaticamente: cadastro é ato administrativo, e criar sozinho
        # abriria caminho para um cliente qualquer se registrar.
        log.warning("status de dispositivo não cadastrado: %s", client_id)
        return

    disp.online = evt.online
    disp.visto_em = datetime.now(timezone.utc)
    if evt.fw:
        disp.firmware = evt.fw
    if evt.modelo:
        disp.versao_modelo = evt.modelo
    await db.flush()
    log.info("dispositivo %s -> %s", client_id, "online" if evt.online else "offline")
