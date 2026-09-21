"""Enquadramento com o serviço PARADO — a versão avulsa da prévia.

Se o `epi-borda` está rodando, não use este arquivo: passe `--previa` para o
próprio serviço e abra a mesma tela sem parar nada. Veja o README.

Este aqui serve para o caso oposto — mexer na câmera antes de o serviço
existir, ou com ele desligado de propósito:

    sudo systemctl stop epi-borda
    python3 enquadrar.py
    # no notebook: http://raspberrypi.local:8080

    python3 enquadrar.py --girar 90      # compara com o quadro em pé

`/dev/video0` só abre uma vez. Com o serviço de pé, este script falha ao
abrir a câmera — e é para isso que a mensagem de erro aponta o caminho.

As guias, a conta do letterbox e a calculadora de EPI moram em
`epi_borda/previa.py`, compartilhadas com o serviço. Duplicar o desenho aqui
faria as duas telas divergirem com o tempo, e a que mente é sempre a que
você não está olhando.
"""
from __future__ import annotations

import argparse
import logging
import sys
import time

import cv2

from epi_borda.previa import MIN_MODELO_PX, ServidorPrevia, ip_local, medidas

log = logging.getLogger("enquadrar")

GIROS = {
    0: None,
    90: cv2.ROTATE_90_CLOCKWISE,
    180: cv2.ROTATE_180,
    270: cv2.ROTATE_90_COUNTERCLOCKWISE,
}


def abrir(indice: int, largura: int, altura: int):
    cap = cv2.VideoCapture(indice, cv2.CAP_V4L2)
    if not cap.isOpened():
        raise SystemExit(
            f"nao consegui abrir /dev/video{indice}.\n\n"
            "Quase sempre e o servico segurando a camera. Duas saidas:\n\n"
            "  1) deixe o servico rodando e use a previa dele:\n"
            "       edite o ExecStart com --previa 8080 e reinicie\n\n"
            "  2) ou pare o servico e rode este script:\n"
            "       sudo systemctl stop epi-borda\n\n"
            "Se nao for isso, veja o que existe:  v4l2-ctl --list-devices"
        )
    # Mesmas opções do epi_hailo.abrir_camera: MJPG porque em YUYV a webcam
    # cai para 5 fps em 720p, e buffer 1 para não acumular atraso.
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, largura)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, altura)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    return cap


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--camera", type=int, default=0)
    p.add_argument("--porta", type=int, default=8080)
    p.add_argument("--largura", type=int, default=1280)
    p.add_argument("--altura", type=int, default=720)
    p.add_argument("--girar", type=int, choices=sorted(GIROS), default=0,
                   help="gira o frame; 90 deixa o quadro em pe")
    p.add_argument("--fps-max", type=float, default=15.0)
    args = p.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    cap = abrir(args.camera, args.largura, args.altura)
    giro = GIROS[args.girar]

    ok, frame = cap.read()
    if not ok:
        cap.release()
        raise SystemExit("a camera abriu mas nao entregou frame nenhum.")
    if giro is not None:
        frame = cv2.rotate(frame, giro)

    h, w = frame.shape[:2]
    m = medidas(w, h)
    log.info("")
    log.info("  captura ............ %dx%d", w, h)
    log.info("  entrada do modelo .. %dx%d (escala %.3f)",
             m["util_l"], m["util_a"], m["escala"])
    log.info("  altura util ........ %d px no modelo (pessoa em pe)", m["util_a"])
    log.info("  piso de %d px no modelo = %d px na tela",
             MIN_MODELO_PX, m["min_tela"])
    log.info("")
    log.info("  abra no notebook:  http://%s:%d", ip_local(), args.porta)
    log.info("  (Ctrl+C para sair)")
    log.info("")

    intervalo = 1.0 / args.fps_max
    n, t0, fps = 0, time.time(), 0.0

    try:
        with ServidorPrevia(args.porta) as previa:
            while True:
                inicio = time.monotonic()
                ok, frame = cap.read()
                if not ok:
                    log.warning("falha ao ler frame — camera desconectada?")
                    time.sleep(0.2)
                    continue
                if giro is not None:
                    frame = cv2.rotate(frame, giro)

                previa.publicar(frame, fps)

                n += 1
                if n % 30 == 0:
                    fps = 30 / (time.time() - t0)
                    t0 = time.time()

                sobra = intervalo - (time.monotonic() - inicio)
                if sobra > 0:
                    time.sleep(sobra)
    except KeyboardInterrupt:
        log.info("encerrando")
    finally:
        cap.release()
    return 0


if __name__ == "__main__":
    sys.exit(main())
