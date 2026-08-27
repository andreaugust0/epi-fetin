"""Autenticação de administradores e emissão de token de tablet."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DB, exige_papel
from app.core.config import settings
from app.core.security import conferir_senha, criar_token
from app.db.models import Dispositivo, TipoDispositivo, UsuarioAdmin
from app.schemas.api import LoginIn, TokenOut

router = APIRouter(tags=["auth"])


@router.post("/auth/login", response_model=TokenOut)
async def login(dados: LoginIn, db: AsyncSession = DB) -> TokenOut:
    stmt = select(UsuarioAdmin).where(UsuarioAdmin.email == dados.email)
    usuario = (await db.execute(stmt)).scalar_one_or_none()

    # Mesma mensagem para e-mail inexistente e senha errada: não entregamos
    # ao atacante a informação de quais e-mails existem na base.
    if usuario is None or not conferir_senha(dados.senha, usuario.senha_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "credenciais inválidas")
    if not usuario.ativo:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "usuário inativo")

    return TokenOut(
        access_token=criar_token(str(usuario.id), "admin", papel=usuario.papel),
        expira_em=datetime.now(timezone.utc)
        + timedelta(minutes=settings.JWT_EXPIRA_MIN),
    )


@router.post("/auth/tablets/{dispositivo_id}/token", response_model=TokenOut)
async def emitir_token_tablet(
    dispositivo_id: int,
    _: UsuarioAdmin = Depends(exige_papel("admin")),
    db: AsyncSession = DB,
) -> TokenOut:
    """Provisionamento do totem: um admin emite o token uma vez, na bancada.

    O token carrega o `ponto_id` — é isso que impede um tablet de operar em
    um ponto de acesso que não é o dele.
    """
    disp = await db.get(Dispositivo, dispositivo_id)
    if disp is None or disp.tipo is not TipoDispositivo.TABLET:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tablet não encontrado")

    return TokenOut(
        access_token=criar_token(
            disp.client_id_mqtt, "dispositivo", ponto_id=disp.ponto_id
        ),
        expira_em=datetime.now(timezone.utc)
        + timedelta(days=settings.JWT_DISPOSITIVO_EXPIRA_DIAS),
    )
