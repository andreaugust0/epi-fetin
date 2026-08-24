"""Worker MQTT — PROCESSO SEPARADO do servidor web.

Por que separado: se o cliente MQTT abrisse no `lifespan` do FastAPI, subir
`uvicorn --workers 4` faria cada processo abrir a própria conexão. Todos
receberiam a mesma mensagem, a mesma verificação seria gravada quatro vezes
e a catraca liberada quatro vezes. É um bug que não aparece em
desenvolvimento e aparece em produção.

Alternativa mais sofisticada, se quiser manter tudo num processo só:
shared subscriptions do MQTT 5 — `$share/backend/epi/v1/+/+/evt/#` — onde o
próprio broker entrega cada mensagem a apenas um assinante do grupo.

Executar com:  python -m app.mqtt.worker
"""
from __future__ import annotations

import asyncio
import json
import logging
import signal

import aiomqtt
from pydantic import ValidationError

from app.core.config import settings
from app.core.logging import configurar_logging
from app.db.session import session_scope
from app.mqtt import topics
from app.mqtt.publisher import publisher
from app.mqtt.schemas import PassagemEvt, ResultadoEvt, StatusEvt
from app.services import dedup, presenca
from app.services import verificacao as svc_verif

log = logging.getLogger(__name__)

INTERVALO_MANUTENCAO_S = 30


async def despachar(topico: str, bruto: bytes) -> None:
    """Roteia uma mensagem para o serviço certo."""
    lido = topics.parse(topico)
    if lido is None:
        log.debug("tópico ignorado: %s", topico)
        return

    payload = json.loads(bruto)

    if lido.classe == "evt" and lido.acao == "resultado":
        evt = ResultadoEvt.model_validate(payload)
        async with session_scope() as db:
            if not await dedup.registrar(db, evt.msg_id, topico):
                log.info("duplicata descartada: %s", evt.msg_id)
                return
            await svc_verif.registrar_resultado(db, evt)

    elif lido.classe == "evt" and lido.acao == "passagem":
        evt_p = PassagemEvt.model_validate(payload)
        async with session_scope() as db:
            if not await dedup.registrar(db, evt_p.msg_id, topico):
                return
            await svc_verif.registrar_passagem(db, evt_p)

    elif lido.classe == "dev" and lido.acao == "status":
        assert lido.device_id
        async with session_scope() as db:
            await presenca.atualizar(
                db, lido.device_id, StatusEvt.model_validate(payload)
            )

    elif lido.classe == "dev" and lido.acao == "telemetria":
        log.debug("telemetria de %s: %s", lido.device_id, payload)


async def manutencao() -> None:
    """Tarefas periódicas: expirar verificações penduradas, limpar dedup."""
    while True:
        try:
            async with session_scope() as db:
                await svc_verif.expirar_pendentes(db)
        except Exception:
            log.exception("falha na rotina de manutenção")
        await asyncio.sleep(INTERVALO_MANUTENCAO_S)


async def consumir() -> None:
    """Laço principal, com reconexão em backoff exponencial."""
    atraso = 1
    while True:
        try:
            async with aiomqtt.Client(
                hostname=settings.MQTT_HOST,
                port=settings.MQTT_PORT,
                username=settings.MQTT_USER,
                password=settings.MQTT_PASS,
                tls_context=settings.tls_context(),
                identifier=settings.MQTT_CLIENT_ID_WORKER,
                # clean_session=False: o broker guarda a fila de QoS 1
                # enquanto estivermos fora do ar. Sem isso, tudo que chegar
                # durante uma reinicialização do worker é perdido.
                clean_session=False,
            ) as client:
                atraso = 1
                for topico, qos in topics.ASSINATURAS:
                    await client.subscribe(topico, qos=qos)
                log.info("worker conectado; %d assinaturas", len(topics.ASSINATURAS))

                async for msg in client.messages:
                    # try/except DENTRO do laço: um payload malformado não
                    # pode derrubar o consumo de todos os outros.
                    try:
                        await despachar(str(msg.topic), msg.payload)
                    except ValidationError as exc:
                        log.warning("payload inválido em %s: %s", msg.topic, exc)
                    except Exception:
                        log.exception("falha ao tratar %s", msg.topic)

        except asyncio.CancelledError:
            raise
        except aiomqtt.MqttError as exc:
            log.warning("broker indisponível (%s); retry em %ss", exc, atraso)
            await asyncio.sleep(atraso)
            atraso = min(atraso * 2, 30)


async def main() -> None:
    configurar_logging()
    # O worker também publica (cmd/liberar sai daqui, ao decidir o resultado).
    await publisher.start()

    parar = asyncio.Event()
    laco = asyncio.get_running_loop()
    for sinal in (signal.SIGINT, signal.SIGTERM):
        laco.add_signal_handler(sinal, parar.set)

    tarefas = [
        asyncio.create_task(consumir(), name="mqtt-consumer"),
        asyncio.create_task(manutencao(), name="manutencao"),
    ]
    await parar.wait()
    log.info("encerrando worker")
    for t in tarefas:
        t.cancel()
    await asyncio.gather(*tarefas, return_exceptions=True)
    await publisher.stop()


if __name__ == "__main__":
    asyncio.run(main())
