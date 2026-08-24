"""Armazenamento de evidências (S3/MinIO), com fallback local em dev."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import Evidencia

log = logging.getLogger(__name__)

_DIR_LOCAL = Path("./_evidencias")


def _cliente():
    """Cliente S3 preguiçoso — só importa boto3 se for realmente usar."""
    import boto3  # noqa: PLC0415

    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
    )


async def salvar(chave: str, conteudo: bytes, content_type: str) -> None:
    if settings.ENV == "dev" and not settings.S3_ENDPOINT.startswith("http"):
        destino = _DIR_LOCAL / chave
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(conteudo)
        return

    def _put() -> None:
        _cliente().put_object(
            Bucket=settings.S3_BUCKET,
            Key=chave,
            Body=conteudo,
            ContentType=content_type,
        )

    # boto3 é síncrono; joga para a thread pool para não travar o event loop
    await asyncio.to_thread(_put)


async def url_temporaria(chave: str, segundos: int = 300) -> str:
    def _sign() -> str:
        return _cliente().generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.S3_BUCKET, "Key": chave},
            ExpiresIn=segundos,
        )

    return await asyncio.to_thread(_sign)


async def expurgar_vencidas(db: AsyncSession) -> int:
    """Apaga evidências cuja retenção venceu.

    A coluna `expira_em` existe exatamente para isto. Rode diariamente —
    retenção que depende de alguém lembrar de apagar não é retenção.
    """
    agora = datetime.now(timezone.utc)
    vencidas = list(
        (
            await db.execute(select(Evidencia).where(Evidencia.expira_em < agora))
        ).scalars().all()
    )
    for ev in vencidas:
        try:
            await asyncio.to_thread(
                lambda k=ev.storage_key: _cliente().delete_object(
                    Bucket=settings.S3_BUCKET, Key=k
                )
            )
        except Exception:
            log.exception("falha ao apagar %s do storage", ev.storage_key)
            continue
        await db.delete(ev)
    if vencidas:
        log.info("%d evidências expurgadas por retenção", len(vencidas))
    return len(vencidas)
