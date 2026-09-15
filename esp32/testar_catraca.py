"""Exercita o firmware da catraca sem o sistema inteiro no ar.

Publica um `cmd/liberar` à mão e mostra o que a placa responde. Serve para
gravar o firmware e testá-lo numa mesa, sem tablet, sem Raspberry e sem banco
de dados — e para demonstrar as duas travas na apresentação.

    pip install paho-mqtt
    python testar_catraca.py --host 192.168.0.103

    python testar_catraca.py --host ... --repetir   # a MESMA mensagem 2x
    python testar_catraca.py --host ... --vencido   # comando fora do prazo

As duas últimas são o ponto: `--repetir` manda o mesmo `msg_id` duas vezes, e
a catraca só pode abrir UMA. `--vencido` manda um comando que já expirou, e a
catraca não pode abrir NENHUMA. Sem essas travas, as duas abririam — e é isso
que separa um controle de acesso de um botão de abrir porta pela rede.
"""
from __future__ import annotations

import argparse
import json
import time
import uuid
from datetime import datetime, timedelta, timezone

import paho.mqtt.client as mqtt


def agora_iso(delta_s: float = 0) -> str:
    momento = datetime.now(timezone.utc) + timedelta(seconds=delta_s)
    return momento.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--host", required=True, help="IP do broker MQTT")
    p.add_argument("--porta", type=int, default=1883)
    p.add_argument("--site", default="planta01")
    p.add_argument("--ponto", default="portaria")
    p.add_argument("--duracao", type=int, default=5000, help="janela do relé, ms")
    p.add_argument("--repetir", action="store_true",
                   help="publica a MESMA mensagem duas vezes (testa idempotência)")
    p.add_argument("--vencido", action="store_true",
                   help="publica um comando já expirado (testa a checagem de prazo)")
    args = p.parse_args()

    t_liberar = f"epi/v1/{args.site}/{args.ponto}/cmd/liberar"
    t_passagem = f"epi/v1/{args.site}/{args.ponto}/evt/passagem"
    t_status = f"epi/v1/{args.site}/{args.ponto}/dev/+/status"

    cli = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="teste-catraca")

    def ao_conectar(c, _dados, _flags, codigo, _props=None):
        if codigo != 0:
            print(f"conexão recusada: {codigo}")
            return
        print(f"conectado em {args.host}:{args.porta}")
        c.subscribe([(t_passagem, 1), (t_status, 1)])

    def ao_receber(_c, _dados, msg):
        corpo = json.loads(msg.payload)
        if msg.topic.endswith("/status"):
            estado = "online" if corpo.get("online") else "OFFLINE"
            print(f"  [status] {msg.topic.split('/')[-2]} está {estado} "
                  f"· fw {corpo.get('fw', '?')}")
            return
        print(f"  [passagem] {corpo.get('evento')} "
              f"· verificação {str(corpo.get('verificacao_id'))[:8]}…")

    cli.on_connect = ao_conectar
    cli.on_message = ao_receber
    cli.connect(args.host, args.porta, keepalive=30)
    cli.loop_start()

    # Dá tempo de o `status` retido chegar antes de publicarmos qualquer coisa:
    # se a catraca não estiver no ar, é melhor descobrir agora.
    time.sleep(1.5)

    verificacao_id = str(uuid.uuid4())
    cmd = {
        "v": 1,
        "msg_id": str(uuid.uuid4()),
        "ts": agora_iso(),
        "verificacao_id": verificacao_id,
        "acao": "LIBERAR",
        "duracao_ms": args.duracao,
        # Trinta segundos é o prazo normal. Menos sessenta é um comando que
        # venceu há um minuto — exatamente o que chegaria a um ESP32 que ficou
        # sem rede e reconectou.
        "expira_em": agora_iso(-60 if args.vencido else 30),
    }

    if args.vencido:
        print("\npublicando um comando VENCIDO — a catraca NÃO deve abrir")
    elif args.repetir:
        print("\npublicando a MESMA mensagem duas vezes — deve abrir UMA vez só")
    else:
        print("\npublicando um comando normal — a catraca deve abrir")

    cli.publish(t_liberar, json.dumps(cmd), qos=1)
    if args.repetir:
        time.sleep(0.3)
        cli.publish(t_liberar, json.dumps(cmd), qos=1)  # msg_id idêntico

    # Espera a janela inteira mais uma folga, para ver o evento de fechamento.
    time.sleep(args.duracao / 1000 + 2)

    cli.loop_stop()
    cli.disconnect()
    print("\nfim. Confira também o monitor serial da placa.")


if __name__ == "__main__":
    main()
