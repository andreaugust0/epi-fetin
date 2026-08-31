"""Cliente MQTT da borda: paho síncrono, LWT, status retido, reconexão.

Síncrono de propósito. O servidor usa aiomqtt porque atende centenas de
conexões HTTP no mesmo laço; uma Raspberry atende uma câmera. `paho` com
`loop_start()` roda a rede numa thread e deixa o laço de visão em paz —
que é exatamente a divisão que se quer aqui.
"""
from __future__ import annotations

import json
import logging
import threading
from collections import deque
from typing import Callable

import paho.mqtt.client as mqtt

from epi_borda import contrato
from epi_borda.config import Config

log = logging.getLogger(__name__)


class ClienteBorda:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.online_broker = False
        self._handlers: dict[str, Callable[[dict, str], None]] = {}
        self._extras_status: dict = {}

        # ------------------------------------------------------------
        # client_id = device_id. Não é cosmético: o servidor casa a
        # presença por `client_id_mqtt`, e um broker com ACL amarra a
        # permissão de publicar a este identificador.
        #
        # clean_session=False: o broker guarda as mensagens QoS 1
        # destinadas a nós enquanto estivermos fora do ar. Sem isso, um
        # `cmd/capturar` publicado durante um reboot de 4 s some — e o
        # servidor expira a verificação sem nunca ter sido ouvido.
        self.cli = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=cfg.device_id,
            clean_session=False,
        )
        if cfg.mqtt_usuario:
            self.cli.username_pw_set(cfg.mqtt_usuario, cfg.mqtt_senha)

        # ------------------------------------------------------------
        # O testamento. Se este processo morrer sem se despedir — queda de
        # energia, kernel panic, cabo de rede arrancado — o BROKER publica
        # isto no nosso lugar. É assim que o servidor descobre que a
        # câmera caiu, sem polling nenhum, e passa a recusar verificações
        # com 503 em vez de deixar a pessoa esperando dez segundos por um
        # timeout previsível.
        self._topico_status = contrato.t_status(cfg.site, cfg.ponto, cfg.device_id)
        self.cli.will_set(
            self._topico_status,
            json.dumps({"online": False, "motivo": "lwt"}),
            qos=1,
            retain=True,
        )

        self.cli.on_connect = self._ao_conectar
        self.cli.on_disconnect = self._ao_desconectar
        self.cli.on_message = self._ao_receber
        self.cli.on_subscribe = self._ao_assinar

        # Assinaturas ainda sem SUBACK. Enquanto houver alguma, não nos
        # anunciamos online — veja `_ao_assinar`.
        self._pendentes: set[int] = set()

        # Duplicata de QoS 1 é normal, não é defeito: "pelo menos uma vez"
        # significa que redundância acontece. Sem isto, uma reentrega
        # dispara a inferência duas vezes para a mesma verificação.
        self._vistos: deque[str] = deque(maxlen=64)
        self._trava_vistos = threading.Lock()

    # ------------------------------------------------------------ setup
    def assinar(self, topico: str, handler: Callable[[dict, str], None]) -> None:
        self._handlers[topico] = handler

    def definir_extras_status(self, **extras) -> None:
        """Campos que acompanham o status online (fw, modelo)."""
        self._extras_status = extras

    # ------------------------------------------------------- callbacks
    def _ao_conectar(self, cli, userdata, flags, reason_code, properties=None):
        if reason_code != 0:
            log.error("broker recusou a conexão: %s", reason_code)
            return
        self.online_broker = True
        log.info("conectado ao broker como %s", self.cfg.device_id)

        # Reassinar a cada conexão: com clean_session=False o broker
        # deveria lembrar, mas um broker reiniciado esquece, e reassinar
        # é idempotente. Custo zero, evita um silêncio difícil de achar.
        for topico in self._handlers:
            _, mid = cli.subscribe(topico, qos=1)
            if mid is not None:
                self._pendentes.add(mid)
            log.debug("assinando %s (mid=%s)", topico, mid)

        # O status online NÃO sai aqui. Veja `_ao_assinar`.
        if not self._pendentes:
            self.publicar_status(True)

    def _ao_assinar(self, cli, userdata, mid, reason_codes=None, properties=None):
        """Só nos declaramos online depois do SUBACK.

        Isto custou uma verificação perdida para aparecer. Anunciando
        `online` logo após o SUBSCRIBE, existe uma janela de alguns
        milissegundos em que o servidor já nos considera de pé e o broker
        ainda não registrou a assinatura. O primeiro `cmd/capturar` cai
        nesse buraco: publicado, entregue a ninguém, e a verificação
        expira dez segundos depois sem nenhum erro em lugar nenhum.

        Na bancada é invisível — só a PRIMEIRA verificação depois de
        ligar a Raspberry é afetada, e a segunda funciona. Em campo é a
        pessoa que chega primeiro no turno.
        """
        self._pendentes.discard(mid)
        if not self._pendentes:
            log.debug("assinaturas confirmadas pelo broker")
            self.publicar_status(True)

    def _ao_desconectar(self, cli, userdata, flags, reason_code, properties=None):
        self.online_broker = False
        if reason_code != 0:
            log.warning("conexão com o broker caiu (%s); paho vai reconectar",
                        reason_code)

    def _ao_receber(self, cli, userdata, msg):
        topico = msg.topic
        handler = self._handlers.get(topico)
        if handler is None:
            return
        try:
            payload = json.loads(msg.payload)
        except json.JSONDecodeError:
            log.warning("payload não é JSON em %s", topico)
            return

        msg_id = payload.get("msg_id")
        if msg_id:
            with self._trava_vistos:
                if msg_id in self._vistos:
                    log.info("duplicata descartada: %s", msg_id)
                    return
                self._vistos.append(msg_id)

        # O handler roda na thread de rede do paho. Ele precisa devolver
        # rápido — se travar aqui, paramos de responder PINGREQ e o broker
        # nos derruba por keepalive. Quem faz trabalho longo despacha
        # para outra thread (veja `agente.py`).
        try:
            handler(payload, topico)
        except Exception:
            log.exception("handler de %s falhou", topico)

    # ------------------------------------------------------------- uso
    def publicar_status(self, online: bool) -> None:
        """retain=True: quem conectar depois recebe o estado atual na hora.

        É o que faz o servidor saber que a câmera está de pé mesmo tendo
        subido *depois* dela — sem retain, ele só descobriria no próximo
        status, e recusaria toda verificação até lá.
        """
        corpo = contrato.payload_status(online, **self._extras_status)
        self.cli.publish(self._topico_status, json.dumps(corpo), qos=1, retain=True)
        log.info("status -> %s", "online" if online else "offline")

    def publicar(self, topico: str, corpo: dict, qos: int = 1) -> None:
        """Publica um fato.

        retain SEMPRE False para evento. Um `evt/resultado` retido seria
        reentregue ao worker a cada reconexão dele, e ele tentaria decidir
        de novo uma verificação antiga.
        """
        info = self.cli.publish(topico, json.dumps(corpo), qos=qos, retain=False)
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            log.error("publish em %s falhou: rc=%s", topico, info.rc)

    def iniciar(self) -> None:
        log.info("conectando em %s:%s…", self.cfg.mqtt_host, self.cfg.mqtt_porta)
        # connect_async + loop_start: não trava a subida se o broker ainda
        # não estiver de pé. Numa Raspberry que liga junto com o resto da
        # bancada, isso acontece toda vez.
        self.cli.connect_async(
            self.cfg.mqtt_host, self.cfg.mqtt_porta, keepalive=self.cfg.mqtt_keepalive
        )
        self.cli.loop_start()

    def parar(self) -> None:
        """Despedida limpa: offline ANTES de desconectar.

        Assim o servidor distingue manutenção planejada de queda — o
        motivo do LWT é "lwt", este aqui não tem motivo nenhum.
        """
        if self.online_broker:
            self.publicar_status(False)
            self.cli.loop_write()  # garante que o pacote saia antes do fim
        self.cli.loop_stop()
        self.cli.disconnect()
        log.info("desconectado")
