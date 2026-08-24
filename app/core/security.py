"""JWT e hash de senha.

Usamos `bcrypt` diretamente em vez de passlib: passlib 1.7.4 é o último
lançamento (2020) e já não conversa com bcrypt 4.x — a combinação emite
"error reading bcrypt version" a cada hash. bcrypt puro é uma dependência a
menos e uma API de três funções.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import bcrypt
import jwt

from app.core.config import settings

Publico = Literal["admin", "dispositivo"]

# Custo do bcrypt. 12 leva ~250 ms num servidor modesto — lento de
# propósito, é isso que torna força bruta cara.
_ROUNDS = 12


def hash_senha(senha: str) -> str:
    return bcrypt.hashpw(senha.encode(), bcrypt.gensalt(rounds=_ROUNDS)).decode()


def conferir_senha(senha: str, hash_: str) -> bool:
    try:
        return bcrypt.checkpw(senha.encode(), hash_.encode())
    except ValueError:
        # hash malformado no banco — trata como senha errada, não como 500
        return False


def criar_token(
    subject: str,
    publico: Publico,
    *,
    papel: str | None = None,
    ponto_id: int | None = None,
    expira: timedelta | None = None,
) -> str:
    """Emite um JWT.

    Tokens de tablet (`publico="dispositivo"`) carregam `ponto_id` e valem um
    ano — o dispositivo fica em campo e não tem quem digite senha. Em troca,
    eles só abrem os endpoints do totem, nunca os de administração: é o
    `aud` que separa os dois mundos.
    """
    if expira is None:
        expira = (
            timedelta(days=settings.JWT_DISPOSITIVO_EXPIRA_DIAS)
            if publico == "dispositivo"
            else timedelta(minutes=settings.JWT_EXPIRA_MIN)
        )
    agora = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "aud": publico,
        "iat": agora,
        "exp": agora + expira,
    }
    if papel:
        payload["papel"] = papel
    if ponto_id is not None:
        payload["ponto_id"] = ponto_id
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALG)


def ler_token(token: str, publico: Publico) -> dict[str, Any]:
    """Decodifica e valida. Lança jwt.PyJWTError se algo estiver errado."""
    return jwt.decode(
        token,
        settings.JWT_SECRET,
        algorithms=[settings.JWT_ALG],
        audience=publico,
    )
