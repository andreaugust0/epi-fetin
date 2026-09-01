"""Hub de WebSocket: os tablets conectados A ESTE processo.

O hub é deliberadamente local: ele conhece só os WebSockets abertos no
processo em que vive, e ninguém o chama de fora.

Quem descobre o desfecho é o worker MQTT, em OUTRO PROCESSO — então
escrever aqui a partir dele não alcançava ninguém, e o tablet ficava
esperando um aviso que já tinha acontecido. Quem atravessa essa fronteira
é `app/realtime/ponte.py`, que assina o canal interno no broker e chama
`publicar` deste lado. Ver o docstring dela para o porquê da escolha.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import WebSocket

log = logging.getLogger(__name__)


class Hub:
    def __init__(self) -> None:
        self._conexoes: dict[int, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def conectar(self, ponto_id: int, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._conexoes.setdefault(ponto_id, set()).add(ws)
        log.info("tablet conectado ao ponto %s", ponto_id)

    async def desconectar(self, ponto_id: int, ws: WebSocket) -> None:
        async with self._lock:
            conjunto = self._conexoes.get(ponto_id)
            if conjunto:
                conjunto.discard(ws)
                if not conjunto:
                    self._conexoes.pop(ponto_id, None)

    async def publicar(self, ponto_id: int, mensagem: dict[str, Any]) -> None:
        async with self._lock:
            alvos = list(self._conexoes.get(ponto_id, ()))
        mortos: list[WebSocket] = []
        for ws in alvos:
            try:
                await ws.send_json(mensagem)
            except Exception:
                mortos.append(ws)
        for ws in mortos:
            await self.desconectar(ponto_id, ws)


hub = Hub()
