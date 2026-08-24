"""Dependências de autenticação e autorização."""
from __future__ import annotations

from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import ler_token
from app.db.models import UsuarioAdmin
from app.db.session import get_session

bearer = HTTPBearer(auto_error=True)

DB = Depends(get_session)


@dataclass(frozen=True, slots=True)
class Tablet:
    client_id: str
    ponto_id: int


def _nao_autorizado(detalhe: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detalhe,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def admin_atual(
    cred: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = DB,
) -> UsuarioAdmin:
    try:
        payload = ler_token(cred.credentials, "admin")
    except jwt.PyJWTError as exc:
        raise _nao_autorizado("token inválido") from exc

    usuario = await db.get(UsuarioAdmin, int(payload["sub"]))
    if usuario is None or not usuario.ativo:
        raise _nao_autorizado("usuário inativo")
    return usuario


def exige_papel(*papeis: str):
    """Autorização por papel. Uso: `Depends(exige_papel("admin"))`."""

    async def _checar(usuario: UsuarioAdmin = Depends(admin_atual)) -> UsuarioAdmin:
        if usuario.papel not in papeis:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"requer papel: {', '.join(papeis)}",
            )
        return usuario

    return _checar


async def tablet_atual(
    cred: HTTPAuthorizationCredentials = Depends(bearer),
) -> Tablet:
    """Token de dispositivo.

    Carrega o `ponto_id` dentro do próprio token: assim o tablet não pode
    operar em um ponto de acesso que não é o dele, mesmo que mande outro
    ponto_id no corpo do request. Os endpoints comparam os dois.
    """
    try:
        payload = ler_token(cred.credentials, "dispositivo")
    except jwt.PyJWTError as exc:
        raise _nao_autorizado("token de dispositivo inválido") from exc

    ponto_id = payload.get("ponto_id")
    if ponto_id is None:
        raise _nao_autorizado("token sem ponto_id")
    return Tablet(client_id=payload["sub"], ponto_id=int(ponto_id))


def confere_ponto(tablet: Tablet, ponto_id: int) -> None:
    if tablet.ponto_id != ponto_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="este dispositivo não opera neste ponto de acesso",
        )
