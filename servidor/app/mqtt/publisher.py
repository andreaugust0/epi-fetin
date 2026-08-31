"""Publicador MQTT usado pelos processos que emitem comandos.

Mantém uma conexão aberta durante o ciclo de vida da aplicação. Se a conexão
cair, `publicar` levanta MqttIndisponivel — quem chama decide o que fazer.
Para um comando de catraca, a resposta certa é falhar alto, não enfileirar
em silêncio: liberar a catraca tarde é pior do que não liberar.

CADA PROCESSO PRECISA DO PRÓPRIO `identificador`. O MQTT trata client_id
como identidade exclusiva: quando um segundo cliente conecta com um id já
em uso, o broker **derruba o primeiro** — está no §3.1.4 do protocolo, e
Mosquitto cumpre à risca. Com a API e o worker publicando sob o mesmo id,
os dois se expulsam em revezamento, e `cmd/liberar` falha de forma
intermitente: catraca que abre às vezes é pior do que catraca que nunca
abre, porque ninguém acredita no relato.
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
        self._identificador: str = settings.MQTT_CLIENT_ID_API
        #: Sinaliza que a conexão atual não presta e deve ser refeita.
        self._cair = asyncio.Event()

    # ------------------------------------------------------------- ciclo
    async def start(self, identificador: str | None = None) -> None:
        """`identificador` é o client_id MQTT — único por processo."""
        if identificador:
            self._identificador = identificador
        self._task = asyncio.create_task(
            self._manter_conexao(), name=f"mqtt-pub:{self._identificador}"
        )

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
                    identifier=self._identificador,
                ) as client:
                    self._client = client
                    self._cair.clear()
                    self._pronto.set()
                    atraso = 1
                    log.info("publicador MQTT '%s' conectado em %s",
                             self._identificador, settings.MQTT_HOST)
                    await self._vigiar()
                    log.warning("publicador MQTT '%s' perdeu a conexão; "
                                "reconectando", self._identificador)
            except asyncio.CancelledError:
                raise
            except aiomqtt.MqttError as exc:
                log.warning("publicador MQTT caiu (%s); retry em %ss", exc, atraso)
                await asyncio.sleep(atraso)
                atraso = min(atraso * 2, 30)
            finally:
                self._client = None
                self._pronto.clear()

    async def _vigiar(self) -> None:
        """Fica aqui enquanto a conexão presta.

        A versão anterior era `await asyncio.Future()` — o contexto ficava
        aberto para sempre. O problema é que o aiomqtt só percebe a queda
        quando alguém faz uma operação: se o broker nos derruba (outro
        cliente com o mesmo id, restart do Mosquitto), ninguém acorda,
        `conectado` continua dizendo True, `/health` mente, e a próxima
        publicação estoura sem que a reconexão jamais tenha começado.

        Então perguntamos ao paho de tempos em tempos. É atributo privado
        do aiomqtt, e por isso o acesso é defensivo: se sumir numa versão
        futura, voltamos ao comportamento antigo em vez de quebrar.
        """
        while not self._cair.is_set():
            try:
                await asyncio.wait_for(self._cair.wait(), timeout=5)
                return
            except asyncio.TimeoutError:
                pass
            paho = getattr(self._client, "_client", None)
            if paho is not None and hasattr(paho, "is_connected"):
                if not paho.is_connected():
                    return

    # ------------------------------------------------------------- uso
    @property
    def conectado(self) -> bool:
        return self._client is not None

    async def publicar(
        self, topico: str, payload: BaseModel, *, qos: int = 1, retain: bool = False
    ) -> None:
        if self._client is None:
            raise MqttIndisponivel("sem conexão com o broker")
        try:
            async with self._lock:
                await self._client.publish(
                    topico,
                    payload.model_dump_json(by_alias=True).encode(),
                    qos=qos,
                    retain=retain,
                )
        except aiomqtt.MqttError as exc:
            # A conexão pode ter caído entre o teste acima e o publish.
            # Duas coisas acontecem aqui: traduzimos para a exceção
            # documentada (sem isso o erro sobe como MqttCodeError e
            # derruba o tratamento da mensagem, em vez de virar 503 ou
            # verificação com status ERRO), e acordamos a reconexão em
            # vez de esperar o vigia notar daqui a cinco segundos.
            self._cair.set()
            raise MqttIndisponivel(f"publish falhou: {exc}") from exc
        log.debug("publicado em %s", topico)


publisher = Publisher()
