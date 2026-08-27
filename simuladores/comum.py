"""Base compartilhada pelos simuladores de dispositivo.

DECISÃO IMPORTANTE: estes simuladores NÃO importam nada de `app/`.

A tentação é reaproveitar `app.mqtt.topics` e `app.mqtt.schemas`. Seria
menos código — e destruiria o valor do teste. Um simulador que usa os
schemas do servidor está testando o servidor contra ele mesmo: qualquer
erro de contrato passa despercebido porque os dois lados leem o mesmo
arquivo.

Escrevendo o contrato de novo aqui, do jeito que um dispositivo real
escreveria, o acordo entre as duas pontas passa a ser verificado de
verdade. E o código fica próximo do que vai virar firmware: usamos
`paho-mqtt` síncrono, que é o que roda numa Raspberry, não o cliente
assíncrono do servidor.

Dependência única:  pip install paho-mqtt
"""
from __future__ import annotations

import json
import sys
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

import paho.mqtt.client as mqtt

NS = "epi"
V = "v1"

# --------------------------------------------------------------- cores
_CORES = {
    "cinza": "\033[90m", "verde": "\033[32m", "amarelo": "\033[33m",
    "vermelho": "\033[31m", "azul": "\033[36m", "off": "\033[0m",
}


def log(cor: str, tag: str, msg: str) -> None:
    hora = datetime.now().strftime("%H:%M:%S")
    c, off = _CORES.get(cor, ""), _CORES["off"]
    print(f"{_CORES['cinza']}{hora}{off} {c}{tag:<9}{off} {msg}", flush=True)


# --------------------------------------------------------------- tópicos
def t_cmd(site: str, ponto: str, acao: str) -> str:
    return f"{NS}/{V}/{site}/{ponto}/cmd/{acao}"


def t_evt(site: str, ponto: str, acao: str) -> str:
    return f"{NS}/{V}/{site}/{ponto}/evt/{acao}"


def t_status(site: str, ponto: str, device_id: str) -> str:
    return f"{NS}/{V}/{site}/{ponto}/dev/{device_id}/status"


# --------------------------------------------------------------- payload
def envelope(**campos: Any) -> dict:
    """Os quatro campos de infraestrutura que todo payload carrega."""
    return {
        "v": 1,
        "msg_id": str(uuid.uuid4()),
        "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        **campos,
    }


def agora() -> datetime:
    return datetime.now(timezone.utc)


def ler_ts(valor: str) -> datetime:
    """Lê um ISO-8601 vindo do servidor, tolerando o sufixo Z."""
    return datetime.fromisoformat(valor.replace("Z", "+00:00"))


# --------------------------------------------------------------- cliente
class Dispositivo:
    """Envelope em volta do paho com LWT, status retido e reconexão."""

    def __init__(
        self,
        device_id: str,
        site: str,
        ponto: str,
        host: str,
        porta: int,
        usuario: str | None = None,
        senha: str | None = None,
        anunciar: bool = True,
        extras_status: dict | None = None,
    ) -> None:
        self.device_id = device_id
        self.site, self.ponto = site, ponto
        self.host, self.porta = host, porta
        self.anunciar = anunciar
        self.extras_status = extras_status or {}
        self.online = anunciar

        self.cli = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=device_id,
            # False: o broker guarda as mensagens QoS 1 publicadas enquanto
            # estivermos fora do ar e entrega quando voltarmos.
            clean_session=False,
        )
        if usuario:
            self.cli.username_pw_set(usuario, senha)

        # O testamento. Se este processo morrer sem se despedir, o BROKER
        # publica isto por ele — é assim que o servidor descobre a queda,
        # sem nenhum polling.
        self.cli.will_set(
            t_status(site, ponto, device_id),
            json.dumps({"online": False, "motivo": "lwt"}),
            qos=1,
            retain=True,
        )
        self.cli.on_connect = self._on_connect
        self.cli.on_disconnect = self._on_disconnect
        self._assinaturas: list[tuple[str, Callable[[dict, str], None]]] = []

    # ------------------------------------------------------------ setup
    def ao_receber(self, topico: str, handler: Callable[[dict, str], None]) -> None:
        self._assinaturas.append((topico, handler))

    def _on_connect(self, cli, userdata, flags, reason_code, properties=None):
        if reason_code != 0:
            log("vermelho", "MQTT", f"conexão recusada: {reason_code}")
            return
        log("verde", "MQTT", f"conectado como {self.device_id}")
        for topico, _ in self._assinaturas:
            cli.subscribe(topico, qos=1)
            log("cinza", "MQTT", f"assinado {topico}")
        self.publicar_status(self.online)

    def _on_disconnect(self, cli, userdata, flags, reason_code, properties=None):
        if reason_code != 0:
            log("amarelo", "MQTT", "conexão perdida; paho vai reconectar")

    def _despachar(self, cli, userdata, msg):
        topico = msg.topic
        try:
            payload = json.loads(msg.payload)
        except json.JSONDecodeError:
            log("vermelho", "ERRO", f"payload inválido em {topico}")
            return
        for padrao, handler in self._assinaturas:
            if padrao == topico:
                try:
                    handler(payload, topico)
                except Exception as exc:  # noqa: BLE001
                    log("vermelho", "ERRO", f"{type(exc).__name__}: {exc}")
                return

    # ------------------------------------------------------------ uso
    def publicar_status(self, online: bool) -> None:
        """retain=True: quem conectar depois recebe o estado atual na hora."""
        self.online = online
        corpo = {"online": online, **({} if not online else self.extras_status)}
        self.cli.publish(
            t_status(self.site, self.ponto, self.device_id),
            json.dumps(corpo),
            qos=1,
            retain=True,
        )
        log("verde" if online else "amarelo", "STATUS",
            f"{self.device_id} → {'online' if online else 'offline'}")

    def publicar(self, topico: str, corpo: dict) -> None:
        self.cli.publish(topico, json.dumps(corpo), qos=1, retain=False)

    def iniciar(self) -> None:
        self.cli.on_message = self._despachar
        log("azul", "INFO", f"conectando em {self.host}:{self.porta}…")
        self.cli.connect(self.host, self.porta, keepalive=30)
        self.cli.loop_start()

    def parar(self) -> None:
        # Despedida limpa: publica offline ANTES de desconectar, para o
        # servidor saber que foi saída planejada e não queda.
        self.publicar_status(False)
        self.cli.loop_stop()
        self.cli.disconnect()
        log("cinza", "INFO", "encerrado")


# --------------------------------------------------------------- teclado
def escutar_teclado(mapa: dict[str, Callable[[], None]], ajuda: str) -> None:
    """Lê comandos de uma letra no terminal, em uma thread separada.

    Serve para demonstração ao vivo: dá para mudar o comportamento do
    dispositivo no meio da apresentação sem reiniciar nada. Se a entrada
    não for um terminal (rodando em pipe ou docker sem -it), desiste em
    silêncio e o simulador segue no modo padrão.
    """
    if not sys.stdin.isatty():
        log("cinza", "INFO", "sem terminal interativo; teclado desativado")
        return

    print(f"\n{_CORES['azul']}{ajuda}{_CORES['off']}\n", flush=True)

    def laco() -> None:
        for linha in sys.stdin:
            tecla = linha.strip().lower()[:1]
            acao = mapa.get(tecla)
            if acao:
                acao()
            elif tecla:
                log("cinza", "INFO", f"tecla '{tecla}' não faz nada")

    threading.Thread(target=laco, daemon=True).start()


def argumentos_comuns(parser) -> None:
    """Flags que os dois simuladores compartilham."""
    parser.add_argument("--host", default="localhost", help="host do broker")
    parser.add_argument("--porta", type=int, default=1883)
    parser.add_argument("--usuario", default=None)
    parser.add_argument("--senha", default=None)
    parser.add_argument("--site", default="planta01")
    parser.add_argument("--ponto", default="portaria")
    parser.add_argument(
        "--offline", action="store_true",
        help="sobe sem anunciar presença — o servidor recusa verificações "
             "com 503, que é o comportamento correto",
    )
