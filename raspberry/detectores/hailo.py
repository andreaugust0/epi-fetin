"""Adaptador do seu `epi_hailo.py` (Hailo-8) para o protocolo `Detector`.

Não substitui nem duplica o seu código: importa o `DetectorEPI` que já
existe, com o mesmo decode DFL e o mesmo NMS, e só traduz a saída para o
formato que o agente entende.

    python3 -m detectores.hailo ~/epi-testes/modelo_epi.hef
    python3 -m detectores.hailo ~/epi-testes/modelo_epi.hef --camera 2
    python3 -m detectores.hailo ~/epi-testes/modelo_epi.hef --mostrar

Duas coisas que este arquivo faz e que valem ser ditas em voz alta:

1. Confere que `epi_hailo.CLASSES` foi preenchido. Enquanto estiver com
   `classe_0`…`classe_6`, o mapa de tradução não reconhece nada e todo
   EPI vira ausente — a catraca ficaria fechada para todo mundo, com o
   modelo funcionando perfeitamente.

2. Converte a caixa de `(x1, y1, x2, y2)`, que é o que o seu
   `pos_processar` devolve, para `(x, y, largura, altura)`, que é o que o
   servidor grava. As duas formas têm quatro números e são fáceis de
   confundir; o erro só aparece no desenho da evidência, semanas depois.
"""
from __future__ import annotations

import argparse
import importlib.util
import logging
import os
import signal
import sys
import threading
import time
from pathlib import Path

from epi_borda import Agente, Deteccao, carregar

log = logging.getLogger("detectores.hailo")

RAIZ = Path(__file__).resolve().parent.parent

#: Onde procurar o `epi_hailo.py`. Ele vive fora do repositório hoje; a
#: variável de ambiente cobre quem o guarda noutro lugar.
CANDIDATOS = [
    Path(os.getenv("EPI_HAILO", "")) if os.getenv("EPI_HAILO") else None,
    RAIZ / "epi_hailo.py",
    Path.home() / "epi-testes" / "epi_hailo.py",
]


def carregar_epi_hailo():
    """Importa o `epi_hailo.py` de onde ele estiver."""
    for caminho in CANDIDATOS:
        if caminho and caminho.is_file():
            spec = importlib.util.spec_from_file_location("epi_hailo", caminho)
            modulo = importlib.util.module_from_spec(spec)
            sys.modules["epi_hailo"] = modulo
            spec.loader.exec_module(modulo)
            log.info("epi_hailo carregado de %s", caminho)
            return modulo

    procurados = "\n  ".join(str(c) for c in CANDIDATOS if c)
    raise SystemExit(
        f"não achei o epi_hailo.py. Procurei em:\n  {procurados}\n\n"
        f"Aponte com EPI_HAILO=/caminho/para/epi_hailo.py, ou copie o "
        f"arquivo para {RAIZ}."
    )


class DetectorHailo:
    """Envelope fino em volta do `DetectorEPI` do seu script."""

    def __init__(self, hef: str, conf_thres: float | None = None,
                 iou_thres: float | None = None) -> None:
        self.eh = carregar_epi_hailo()
        self.nomes_classes = list(self.eh.CLASSES)
        self._conferir_classes()

        self.conf_thres = (
            conf_thres if conf_thres is not None else self.eh.CONF_THRES
        )
        self.iou_thres = iou_thres if iou_thres is not None else self.eh.IOU_THRES
        self.det = self.eh.DetectorEPI(hef)
        log.info("Hailo pronto · %d classes · conf>=%.2f iou<=%.2f",
                 len(self.nomes_classes), self.conf_thres, self.iou_thres)

    def _conferir_classes(self) -> None:
        """Recusa subir com a lista de exemplo ainda no lugar.

        Esta checagem existe porque a falha que ela evita é silenciosa do
        pior jeito: o modelo detecta certo, o Hailo funciona, o desenho na
        tela aparece — e o servidor reprova todo mundo, porque nenhum dos
        nomes casa com um código de EPI. Sem isto, o suspeito seria a rede,
        o broker ou o modelo, nunca uma lista de strings.
        """
        genericas = [n for n in self.nomes_classes if n.startswith("classe_")]
        if genericas:
            raise SystemExit(
                "epi_hailo.CLASSES ainda está com os nomes de exemplo "
                f"({', '.join(genericas)}).\n\n"
                "Preencha com os nomes reais, NA MESMA ORDEM do data.yaml do "
                "treino. Pelo metadata do best.onnx, a ordem é:\n\n"
                '    CLASSES = ["Botas", "Capacete", "Colete", "Luvas",\n'
                '               "Mascara", "Oculos", "Protetor auricular"]\n\n'
                "Confira contra o seu data.yaml antes de aceitar: se a ordem "
                "estiver trocada, o sistema passa a chamar bota de capacete e "
                "ninguém percebe olhando a tela."
            )

    def detectar(self, frame) -> list[Deteccao]:
        saida = []
        for d in self.det.detectar(frame, self.conf_thres, self.iou_thres):
            x1, y1, x2, y2 = d["caixa"]
            saida.append(
                Deteccao(
                    classe=d["classe"],
                    confianca=d["score"],
                    # xyxy -> xywh: o servidor grava largura e altura, não
                    # o canto oposto.
                    bbox=(x1, y1, x2 - x1, y2 - y1),
                )
            )
        return saida

    def fechar(self) -> None:
        self.det.fechar()


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("hef", help="caminho do modelo .hef")
    p.add_argument("--camera", type=int, default=None,
                   help="índice de /dev/video (padrão: o do epi_hailo.py)")
    p.add_argument("--mostrar", action="store_true",
                   help="abre janela com as caixas (precisa de display)")
    p.add_argument("--conf", type=float, default=None)
    p.add_argument("--iou", type=float, default=None)
    p.add_argument("--fps-max", type=float, default=15.0)
    args = p.parse_args()

    cfg = carregar()
    logging.basicConfig(
        level=getattr(logging, cfg.log_nivel, logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)-22s %(message)s",
        datefmt="%H:%M:%S",
    )

    detector = DetectorHailo(args.hef, args.conf, args.iou)
    eh = detector.eh

    cap = eh.abrir_camera(
        args.camera if args.camera is not None else eh.CAM_INDICE
    )
    if cap is None:
        return 1

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
    t0, n = time.time(), 0

    try:
        with Agente(cfg, detector=detector, codificar_jpeg=codificar) as agente:
            log.info("escutando epi/v1/%s/%s/cmd/capturar", cfg.site, cfg.ponto)
            while not parar.is_set():
                inicio = time.monotonic()
                ok, frame = cap.read()
                if not ok:
                    log.warning("falha ao ler frame — câmera desconectada?")
                    time.sleep(0.2)
                    continue

                deteccoes = detector.detectar(frame)

                # A ÚNICA linha nova em relação ao seu laço original.
                agente.registrar_frame(deteccoes, frame)

                n += 1
                if n % 30 == 0:
                    log.info("%.1f fps · %d detecções no último frame",
                             n / (time.time() - t0), len(deteccoes))

                if args.mostrar:
                    import cv2

                    eh.desenhar(frame, [
                        {"caixa": (d.bbox[0], d.bbox[1],
                                   d.bbox[0] + d.bbox[2], d.bbox[1] + d.bbox[3]),
                         "classe": d.classe, "score": d.confianca}
                        for d in deteccoes
                    ])
                    cv2.imshow("EPI", frame)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        break

                # Teto de fps: o Hailo é rápido, mas a captura, o letterbox
                # e o decode ainda rodam na CPU da Pi. Sem teto, o laço come
                # um núcleo inteiro e o throttling térmico derruba
                # justamente o fps que se queria alto.
                sobra = intervalo - (time.monotonic() - inicio)
                if sobra > 0:
                    time.sleep(sobra)
    finally:
        cap.release()
        detector.fechar()
        if args.mostrar:
            import cv2
            cv2.destroyAllWindows()

    log.info("encerrado")
    return 0


if __name__ == "__main__":
    sys.exit(main())
