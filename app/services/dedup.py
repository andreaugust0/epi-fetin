"""Deduplicação de mensagens MQTT.

QoS 1 entrega *pelo menos uma vez*. Duplicata não é caso raro nem bug: é o
comportamento contratado do protocolo. Sem esta trava, uma reentrega grava a
verificação em dobro e libera a catraca duas vezes.

A tabela cresce; limpe periodicamente com `limpar_antigas`.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import MensagemProcessada


async def registrar(db: AsyncSession, msg_id: uuid.UUID, topico: str) -> bool:
    """Marca a mensagem como processada.

    Devolve True se é a primeira vez (siga em frente) e False se já tinha
    sido vista (descarte). O INSERT ... ON CONFLICT DO NOTHING resolve isso
    atomicamente no banco — uma checagem SELECT-depois-INSERT teria corrida
    entre dois workers.
    """
    stmt = (
        insert(MensagemProcessada)
        .values(msg_id=msg_id, topico=topico)
        .on_conflict_do_nothing(index_elements=["msg_id"])
        .returning(MensagemProcessada.msg_id)
    )
    return (await db.execute(stmt)).scalar_one_or_none() is not None


async def limpar_antigas(db: AsyncSession, dias: int = 7) -> int:
    corte = datetime.now(timezone.utc) - timedelta(days=dias)
    res = await db.execute(
        delete(MensagemProcessada).where(MensagemProcessada.processada_em < corte)
    )
    return res.rowcount or 0
