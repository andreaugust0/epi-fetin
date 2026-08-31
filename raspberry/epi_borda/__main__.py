"""Execução completa: câmera + modelo ONNX + agente.

Use isto se quiser um serviço pronto para o systemd. Se o seu laço de
visão já existe, prefira importar o `Agente` dentro dele — veja o README.

    python -m epi_borda
    python -m epi_borda --mostrar          # janela com as caixas (só no desktop)
    python -m epi_borda --fonte 0          # /dev/video0 em vez da picamera2
"""
from __future__ import annotations

import argparse
import logging
import signal
import sys
import threading
import time

from epi_borda import Agente, carregar

log = logging.getLogger("epi_borda")


def abrir_camera(fonte: str, largura: int, altura: int):
    """picamera2 quando houver; cai para OpenCV em qualquer outro caso.

    Devolve uma função que entrega um frame BGR — o formato que o
    OpenCV usa e que o adaptador ONNX espera.
    """
    if fonte == "picamera2":
        try:
            from picamera2 import Picamera2  # type: ignore

            cam = Picamera2()
            cam.configure(
                cam.create_preview_configuration(
                    main={"size": (largura, altura), "format": "RGB888"}
                )
            )
            cam.start()
            time.sleep(1.0)  # deixa o auto-exposure estabilizar
            log.info("picamera2 aberta em %dx%d", largura, altura)
            # A picamera2 entrega RGB; invertemos para BGR e o resto do
            # código não precisa saber de onde veio o frame.
            return lambda: cam.capture_array()[:, :, ::-1], cam.stop
        except ImportError:
            log.warning("picamera2 indisponível; tentando OpenCV")
            fonte = "0"

    import cv2

    indice = int(fonte) if fonte.isdigit() else fonte
    cap = cv2.VideoCapture(indice)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, largura)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, altura)
    # Buffer de 1: sem isso o OpenCV entrega frames de segundos atrás, e
    # a verificação decide sobre quem já passou pela catraca.
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    if not cap.isOpened():
        raise SystemExit(f"não consegui abrir a câmera {fonte!r}")
    log.info("câmera %r aberta em %dx%d", fonte, largura, altura)

    def ler():
        ok, frame = cap.read()
        return frame if ok else None

    return ler, cap.release


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--fonte", default="picamera2",
                   help="'picamera2', índice de /dev/video, ou caminho de vídeo")
    p.add_argument("--largura", type=int, default=640)
    p.add_argument("--altura", type=int, default=480)
    p.add_argument("--mostrar", action="store_true",
                   help="abre janela com as caixas (precisa de display)")
    p.add_argument("--fps-max", type=float, default=10.0)
    args = p.parse_args()

    cfg = carregar()
    logging.basicConfig(
        level=getattr(logging, cfg.log_nivel, logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)-22s %(message)s",
        datefmt="%H:%M:%S",
    )

    from detectores.onnx_yolo import DetectorOnnx

    detector = DetectorOnnx(
        cfg.modelo, confianca_min=cfg.confianca_min, iou_nms=cfg.iou_nms
    )
    ler_frame, fechar_camera = abrir_camera(args.fonte, args.largura, args.altura)

    codificar = None
    if cfg.evidencia_ativa:
        import cv2

        def codificar(frame):
            ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            if not ok:
                raise RuntimeError("imencode falhou")
            return buf.tobytes()

    parar = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: parar.set())
    signal.signal(signal.SIGTERM, lambda *_: parar.set())

    intervalo = 1.0 / args.fps_max
    try:
        with Agente(cfg, detector=detector, codificar_jpeg=codificar) as agente:
            log.info("pronto. escutando epi/v1/%s/%s/cmd/capturar",
                     cfg.site, cfg.ponto)
            while not parar.is_set():
                t0 = time.monotonic()
                frame = ler_frame()
                if frame is None:
                    log.warning("frame vazio; tentando de novo")
                    time.sleep(0.2)
                    continue

                deteccoes = detector.detectar(frame)
                agente.registrar_frame(deteccoes, frame)

                if args.mostrar:
                    _desenhar(frame, deteccoes)

                # Teto de fps: sem isso a inferência come 100% de CPU e a
                # Pi passa a jogar throttling térmico em cima do laço.
                sobra = intervalo - (time.monotonic() - t0)
                if sobra > 0:
                    time.sleep(sobra)
    finally:
        fechar_camera()

    log.info("encerrado")
    return 0


def _desenhar(frame, deteccoes) -> None:
    import cv2

    for d in deteccoes:
        if not d.bbox:
            continue
        x, y, w, h = d.bbox
        cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 200, 0), 2)
        cv2.putText(frame, f"{d.classe} {d.confianca:.2f}", (x, max(14, y - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 200, 0), 1)
    cv2.imshow("epi-borda", frame)
    cv2.waitKey(1)


if __name__ == "__main__":
    sys.exit(main())
