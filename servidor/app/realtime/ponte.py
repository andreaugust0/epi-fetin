"""Ponte entre o worker e os WebSockets do processo da API.

O problema que ela resolve, e que só apareceu num teste de ponta a ponta:

    quem decide o desfecho é o WORKER, num processo separado.
    quem segura os WebSockets do tablet é a API, noutro processo.
    o `hub` é um objeto em memória.

Escrevendo direto no hub a partir do worker, a mensagem nunca atravessava.
A verificação era decidida, gravada e a catraca liberada — e o tablet
ficava esperando para sempre um aviso que já tinha acontecido. Nada no log
denunciava, porque, do ponto de vista de cada processo, tudo deu certo.

A alternativa clássica é Redis pub/sub. Não vale acrescentar um serviço
para carregar uma mensagem por verificação, quando já existe um broker que
é dependência dura do sistema. O MQTT faz esse trabalho.

Cada processo da API assina o mesmo tópico e reemite só para os seus
próprios WebSockets, então subir `uvicorn --workers 4` continua correto:
o processo que não tem o tablet conectado simplesmente não entrega a
ninguém.
"""
from __future__ import annotations

import asyncio
import json
import logging

import aiomqtt
from pydantic import ValidationError

from app.core.config import settings
from app.mqtt import topics
from app.mqtt.schemas import AvisoTabletEvt
from app.realtime.hub import hub

log = logging.getLogger(__name__)


class Ponte:
    def __init__(self) -> None:
        self._tarefa: asyncio.Task | None = None

    async def start(self, identificador: str) -> None:
        self._tarefa = asyncio.create_task(
            self._consumir(identificador), name="ws-ponte"
        )

    async def stop(self) -> None:
        if self._tarefa:
            self._tarefa.cancel()
            try:
                await self._tarefa
            except asyncio.CancelledError:
                pass

    async def _consumir(self, identificador: str) -> None:
        atraso = 1
        while True:
            try:
                async with aiomqtt.Client(
                    hostname=settings.MQTT_HOST,
                    port=settings.MQTT_PORT,
                    username=settings.MQTT_USER,
                    password=settings.MQTT_PASS,
                    tls_context=settings.tls_context(),
                    identifier=identificador,
                    # clean_session=True, ao contrário do worker: um aviso
                    # que ficou na fila enquanto este processo estava fora
                    # do ar não interessa mais. O tablet que estava
                    # conectado já caiu junto, e entregar um desfecho de
                    # dez minutos atrás para quem reconectou seria pior do
                    # que não entregar nada.
                    clean_session=True,
                ) as cliente:
                    await cliente.subscribe(topics.AVISOS_TABLET, qos=1)
                    atraso = 1
                    log.info("ponte de WebSocket assinando %s", topics.AVISOS_TABLET)

                    async for msg in cliente.messages:
                        try:
                            await self._entregar(msg.payload)
                        except ValidationError as exc:
                            log.warning("desfecho malformado: %s", exc)
                        except Exception:
                            log.exception("falha ao entregar desfecho")

            except asyncio.CancelledError:
                raise
            except aiomqtt.MqttError as exc:
                log.warning("ponte de WebSocket caiu (%s); retry em %ss",
                            exc, atraso)
                await asyncio.sleep(atraso)
                atraso = min(atraso * 2, 30)

    async def _entregar(self, bruto: bytes) -> None:
        # A ponte é burra de propósito: valida o envelope e repassa
        # `mensagem` sem tocar. O formato que o tablet recebe fica definido
        # onde é produzido, em `services/verificacao.py`, e acrescentar um
        # tipo de aviso novo não exige mexer aqui.
        evt = AvisoTabletEvt.model_validate(json.loads(bruto))
        await hub.publicar(evt.ponto_id, evt.mensagem)


ponte = Ponte()
