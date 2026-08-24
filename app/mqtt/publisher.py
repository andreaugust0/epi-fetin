"""Publicador MQTT usado pela API (processo web) para emitir comandos.

Mantém uma conexão aberta durante o ciclo de vida da aplicação. Se a conexão
cair, `publicar` levanta MqttIndisponivel — quem chama decide o que fazer.
Para um comando de catraca, a resposta certa é falhar alto, não enfileirar
em silêncio: liberar a catraca tarde é pior do que não liberar.
"""
from __future__ import annotations

import asyncio
import logging

import aiomqtt
from pydantic import BaseModel

from app.core.config import settings

log = logging.getLogger(__name__)


class MqttIndisponivel(RuntimeError):
    pass


class Publisher:
    def __init__(self) -> None:
        self._client: aiomqtt.Client | None = None
        self._lock = asyncio.Lock()
        self._task: asyncio.Task | None = None
        self._pronto = asyncio.Event()

    # ------------------------------------------------------------- ciclo
    async def start(self) -> None:
        self._task = asyncio.create_task(self._manter_conexao(), name="mqtt-pub")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _manter_conexao(self) -> None:
        atraso = 1
        while True:
            try:
                async with aiomqtt.Client(
                    hostname=settings.MQTT_HOST,
                    port=settings.MQTT_PORT,
                    username=settings.MQTT_USER,
                    password=settings.MQTT_PASS,
                    tls_context=settings.tls_context(),
                    identifier=settings.MQTT_CLIENT_ID_API,
                ) as client:
                    self._client = client
                    self._pronto.set()
                    atraso = 1
                    log.info("publicador MQTT conectado em %s", settings.MQTT_HOST)
                    await asyncio.Future()  # mantém o contexto aberto
            except asyncio.CancelledError:
                raise
            except aiomqtt.MqttError as exc:
                self._client = None
                self._pronto.clear()
                log.warning("publicador MQTT caiu (%s); retry em %ss", exc, atraso)
                await asyncio.sleep(atraso)
                atraso = min(atraso * 2, 30)

    # ------------------------------------------------------------- uso
    @property
    def conectado(self) -> bool:
        return self._client is not None

    async def publicar(
        self, topico: str, payload: BaseModel, *, qos: int = 1, retain: bool = False
    ) -> None:
        if self._client is None:
            raise MqttIndisponivel("sem conexão com o broker")
        async with self._lock:
            await self._client.publish(
                topico,
                payload.model_dump_json(by_alias=True).encode(),
                qos=qos,
                retain=retain,
            )
        log.debug("publicado em %s", topico)


publisher = Publisher()
