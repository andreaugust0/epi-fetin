"""Upload da evidência — chamado pela Raspberry.

Por HTTP, não por MQTT. Um JPEG de 300 KB em base64 vira ~400 KB de payload
que o broker precisa bufferizar na RAM para cada assinante, e uma
retransmissão de QoS 1 duplica o tráfego. O MQTT carrega fatos; mídia vai
por HTTP.
"""
from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DB, Tablet, tablet_atual
from app.core.config import settings
from app.db.models import Evidencia, Verificacao
from app.schemas.api import EvidenciaOut
from app.services import storage

log = logging.getLogger(__name__)
router = APIRouter(tags=["evidências"])

TAMANHO_MAX = 5 * 1024 * 1024
TIPOS_ACEITOS = {"image/jpeg", "image/png", "image/webp"}


@router.post(
    "/evidencias", response_model=EvidenciaOut, status_code=status.HTTP_201_CREATED
)
async def enviar(
    verificacao_id: uuid.UUID = Form(...),
    rosto_borrado: bool = Form(True),
    arquivo: UploadFile = File(...),
    _: Tablet = Depends(tablet_atual),
    db: AsyncSession = DB,
) -> EvidenciaOut:
    if arquivo.content_type not in TIPOS_ACEITOS:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            f"tipo não aceito: {arquivo.content_type}",
        )

    conteudo = await arquivo.read(TAMANHO_MAX + 1)
    if len(conteudo) > TAMANHO_MAX:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "arquivo acima de 5 MB"
        )

    verif = await db.get(Verificacao, verificacao_id)
    if verif is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "verificação não encontrada")

    if not rosto_borrado:
        # A borda deveria borrar antes de enviar. Registramos para que a
        # não conformidade apareça no log, em vez de passar despercebida.
        log.warning("evidência de %s enviada SEM borrar o rosto", verificacao_id)

    evidencia_id = f"ev_{uuid.uuid4().hex[:22]}"
    sha = hashlib.sha256(conteudo).hexdigest()
    chave = f"{verif.iniciada_em:%Y/%m/%d}/{evidencia_id}.jpg"
    await storage.salvar(chave, conteudo, arquivo.content_type)

    agora = datetime.now(timezone.utc)
    registro = Evidencia(
        id=evidencia_id,
        verificacao_id=verificacao_id,
        storage_key=chave,
        sha256=sha,
        bytes=len(conteudo),
        rosto_borrado=rosto_borrado,
        # Retenção curta e automática: uma rotina diária apaga o que venceu.
        expira_em=agora + timedelta(days=settings.EVIDENCIA_RETENCAO_DIAS),
    )
    db.add(registro)
    await db.commit()
    return EvidenciaOut(evidencia_id=evidencia_id, expira_em=registro.expira_em)
