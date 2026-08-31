"""Detector falso — roda o pacote inteiro sem câmera e sem modelo.

Serve para três coisas: provar a integração com o servidor antes de a
Raspberry existir, demonstrar o fluxo na apresentação sem depender de
hardware, e testar o caminho de erro ("agora ele tira o capacete") sem
pedir para alguém tirar o capacete de verdade.

    python -m detectores.falso                 # aprova tudo
    python -m detectores.falso --faltando helmet
    python -m detectores.falso --mudo          # testa o timeout do servidor
"""
from __future__ import annotations

import argparse
import logging
import random
import signal
import sys
import threading
import time

from epi_borda import Agente, Deteccao, carregar
from epi_borda.classes import DE_MODELO_PARA_SERVIDOR


class DetectorFalso:
    """Emite as classes do mapa, menos as que mandarem faltar."""

    def __init__(self, faltando: set[str], confianca: float = 0.88) -> None:
        # Um nome de modelo por código de servidor — sem os sinônimos,
        # que só existem para tradução e poluiriam a validação.
        vistos: dict[str, str] = {}
        for nome_modelo, codigo in DE_MODELO_PARA_SERVIDOR.items():
            vistos.setdefault(codigo, nome_modelo)
        self.nomes_classes = sorted(vistos.values())
        self.faltando = faltando
        self.confianca = confianca

    def detectar(self, frame) -> list[Deteccao]:
        saida = []
        for nome in self.nomes_classes:
            if nome in self.faltando:
                continue
            # Ruído leve: um resultado sintético demais esconde os
            # problemas de arredondamento e de limiar.
            conf = min(0.999, max(0.01, self.confianca + random.uniform(-0.05, 0.05)))
            saida.append(Deteccao(nome, round(conf, 3), (312, 88, 196, 154)))
        return saida


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--faltando", default="",
                   help="classes (do modelo) a omitir, separadas por vírgula")
    p.add_argument("--fps", type=float, default=6.0)
    p.add_argument("--mudo", action="store_true",
                   help="para de alimentar o buffer: o servidor vai expirar")
    p.add_argument("--confianca", type=float, default=0.88)
    args = p.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)-22s %(message)s",
        datefmt="%H:%M:%S",
    )

    faltando = {x.strip() for x in args.faltando.split(",") if x.strip()}
    detector = DetectorFalso(faltando, args.confianca)
    cfg = carregar()

    print(f"\ndispositivo : {cfg.device_id}")
    print(f"broker      : {cfg.mqtt_host}:{cfg.mqtt_porta}")
    print(f"tópico      : epi/v1/{cfg.site}/{cfg.ponto}/cmd/capturar")
    print(f"faltando    : {sorted(faltando) or 'nada — aprova tudo'}\n")

    parar = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: parar.set())
    signal.signal(signal.SIGTERM, lambda *_: parar.set())

    with Agente(cfg, detector=detector) as agente:
        intervalo = 1.0 / args.fps
        while not parar.is_set():
            if not args.mudo:
                agente.registrar_frame(detector.detectar(None))
            time.sleep(intervalo)

    print("\nencerrado.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
