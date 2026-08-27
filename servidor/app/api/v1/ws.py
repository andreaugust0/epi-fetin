"""WebSocket do tablet: recebe o desfecho da verificação em tempo real."""
from __future__ import annotations

import logging

import jwt
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from app.core.security import ler_token
from app.realtime.hub import hub

log = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/ws/pontos/{ponto_id}")
async def canal_do_ponto(
    websocket: WebSocket, ponto_id: int, token: str = Query(...)
) -> None:
    """O token vem na query string porque a API de WebSocket do navegador
    não permite cabeçalhos personalizados no handshake. Por isso ele é um
    token de dispositivo de escopo estreito, e a conexão só é aceita para o
    ponto que o próprio token declara.
    """
    try:
        payload = ler_token(token, "dispositivo")
    except jwt.PyJWTError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    if int(payload.get("ponto_id", -1)) != ponto_id:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await hub.conectar(ponto_id, websocket)
    try:
        while True:
            # Só mantemos a conexão viva; todo o tráfego útil é do servidor
            # para o tablet. Ler serve para detectar a queda da conexão.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await hub.desconectar(ponto_id, websocket)
