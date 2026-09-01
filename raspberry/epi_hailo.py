#!/usr/bin/env python3
"""
Inferência YOLOv8 (7 classes de EPI) em Hailo-8 / Raspberry Pi 5.

O HEF devolve 6 tensores brutos (3 escalas x {caixas DFL, logits de classe}).
Este módulo faz o decode no host: sigmoid, DFL, conversão para xyxy e NMS.

Uso:
    python3 epi_hailo.py modelo_epi.hef foto.jpg      # imagem parada
    python3 epi_hailo.py modelo_epi.hef --camera      # câmera USB (índice 0)
    python3 epi_hailo.py modelo_epi.hef --camera 2    # outro índice

Antes de rodar, ajuste a lista CLASSES abaixo na mesma ordem do seu data.yaml.
"""

import sys
import time

import cv2
import numpy as np

from hailo_platform import (
    HEF, VDevice, HailoStreamInterface, InferVStreams,
    ConfigureParams, InputVStreamParams, OutputVStreamParams, FormatType,
)

# ---------------------------------------------------------------------------
# CONFIGURAÇÃO — ajuste os nomes na MESMA ORDEM do seu data.yaml
# ---------------------------------------------------------------------------
# Lidos do metadata do best.onnx, que foi exportado do mesmo treino:
#   python3 -m epi_borda.classes --do-modelo best.onnx
#
# CONFIRA contra o data.yaml antes de confiar. Se a ordem estiver trocada,
# o classe_id vira índice numa lista errada e o sistema passa a chamar
# bota de capacete — sem nada na tela denunciar.
CLASSES = [
    "Botas", "Capacete", "Colete", "Luvas",
    "Mascara", "Oculos", "Protetor auricular",
]

CONF_THRES = 0.30
IOU_THRES = 0.70
IMGSZ = 640
REG_MAX = 16                      # bins do DFL

# Câmera USB. Resolução alta não melhora a detecção — tudo vira 640x640
# no letterbox de qualquer jeito — e só custa tempo de captura e resize.
CAM_INDICE = 0
CAM_LARGURA = 1280
CAM_ALTURA = 720
CAM_FPS = 30
MOSTRAR_JANELA = True             # False quando rodar via SSH sem display

# tensor de caixas, tensor de classes, stride
ESCALAS = [
    ("epi/conv41", "epi/conv42", 8),
    ("epi/conv52", "epi/conv53", 16),
    ("epi/conv62", "epi/conv63", 32),
]


# ---------------------------------------------------------------------------
# Pré-processamento
# ---------------------------------------------------------------------------
def letterbox(img, size=IMGSZ):
    """Redimensiona mantendo proporção e preenche com cinza.

    Retorna a imagem, a escala e os offsets, necessários para mapear as
    caixas de volta às coordenadas da imagem original.
    """
    h, w = img.shape[:2]
    escala = min(size / h, size / w)
    nh, nw = int(round(h * escala)), int(round(w * escala))

    redim = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
    canvas = np.full((size, size, 3), 114, dtype=np.uint8)

    dy, dx = (size - nh) // 2, (size - nw) // 2
    canvas[dy:dy + nh, dx:dx + nw] = redim

    return canvas, escala, dx, dy


def abrir_camera(indice=CAM_INDICE):
    """Abre uma câmera USB com as opções que importam na Pi.

    MJPG: muitas câmeras USB entregam YUYV por padrão e ficam presas em
    poucos FPS a 720p, porque YUYV não é comprimido e satura a banda.

    BUFFERSIZE=1: sem isso o OpenCV enfileira frames antigos e a imagem vai
    atrasando em relação à realidade conforme o processamento não acompanha
    a captura — inaceitável para monitoramento de EPI em tempo real.
    """
    cap = cv2.VideoCapture(indice, cv2.CAP_V4L2)
    if not cap.isOpened():
        print(f"Não consegui abrir a câmera {indice}.")
        print("Verifique com: v4l2-ctl --list-devices")
        return None

    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAM_LARGURA)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAM_ALTURA)
    cap.set(cv2.CAP_PROP_FPS, CAM_FPS)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    # o que a câmera de fato aceitou pode diferir do que foi pedido
    fourcc = int(cap.get(cv2.CAP_PROP_FOURCC))
    print(
        f"Câmera {indice}: "
        f"{int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))}x{int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))} "
        f"@ {cap.get(cv2.CAP_PROP_FPS):.0f} FPS "
        f"[{''.join(chr((fourcc >> 8 * i) & 0xFF) for i in range(4))}]"
    )

    for _ in range(5):            # descarta frames de aquecimento
        cap.read()

    return cap


# ---------------------------------------------------------------------------
# Decode
# ---------------------------------------------------------------------------
def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def softmax(x, eixo=-1):
    x = x - x.max(axis=eixo, keepdims=True)
    e = np.exp(x)
    return e / e.sum(axis=eixo, keepdims=True)


def decodificar_escala(caixas_raw, cls_raw, stride, conf_thres):
    """Decodifica uma escala. Retorna (caixas_xyxy, scores, ids_classe).

    Só aplica o DFL nas células que passam do threshold — na prática são
    dezenas entre 6400, o que torna o decode barato.
    """
    h, w, _ = cls_raw.shape

    scores_todos = sigmoid(cls_raw)                  # (h, w, 7)
    score_max = scores_todos.max(axis=-1)
    classe_id = scores_todos.argmax(axis=-1)

    ys, xs = np.nonzero(score_max > conf_thres)
    if len(ys) == 0:
        return np.empty((0, 4)), np.empty(0), np.empty(0, dtype=int)

    scores = score_max[ys, xs]
    ids = classe_id[ys, xs]

    # DFL: 64 canais = 4 lados x 16 bins
    dfl = caixas_raw[ys, xs].reshape(-1, 4, REG_MAX)
    prob = softmax(dfl, eixo=-1)
    dist = (prob * np.arange(REG_MAX, dtype=np.float32)).sum(axis=-1)  # (n, 4)

    # centro de cada célula, em pixels da imagem 640x640
    ancora_x = (xs.astype(np.float32) + 0.5) * stride
    ancora_y = (ys.astype(np.float32) + 0.5) * stride

    dist = dist * stride
    x1 = ancora_x - dist[:, 0]
    y1 = ancora_y - dist[:, 1]
    x2 = ancora_x + dist[:, 2]
    y2 = ancora_y + dist[:, 3]

    return np.stack([x1, y1, x2, y2], axis=1), scores, ids


def nms(caixas, scores, iou_thres):
    """NMS puro em numpy. Retorna os índices mantidos."""
    if len(caixas) == 0:
        return []

    x1, y1, x2, y2 = caixas[:, 0], caixas[:, 1], caixas[:, 2], caixas[:, 3]
    areas = (x2 - x1) * (y2 - y1)
    ordem = scores.argsort()[::-1]

    mantidos = []
    while ordem.size > 0:
        i = ordem[0]
        mantidos.append(i)
        if ordem.size == 1:
            break

        xx1 = np.maximum(x1[i], x1[ordem[1:]])
        yy1 = np.maximum(y1[i], y1[ordem[1:]])
        xx2 = np.minimum(x2[i], x2[ordem[1:]])
        yy2 = np.minimum(y2[i], y2[ordem[1:]])

        inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
        iou = inter / (areas[i] + areas[ordem[1:]] - inter + 1e-9)

        ordem = ordem[1:][iou <= iou_thres]

    return mantidos


def pos_processar(saidas, escala, dx, dy, forma_orig,
                  conf_thres=CONF_THRES, iou_thres=IOU_THRES):
    """Junta as 3 escalas, aplica NMS por classe e volta às coordenadas originais."""
    todas_caixas, todos_scores, todos_ids = [], [], []

    for nome_caixa, nome_cls, stride in ESCALAS:
        b, s, i = decodificar_escala(
            saidas[nome_caixa][0], saidas[nome_cls][0], stride, conf_thres
        )
        if len(b):
            todas_caixas.append(b)
            todos_scores.append(s)
            todos_ids.append(i)

    if not todas_caixas:
        return []

    caixas = np.concatenate(todas_caixas)
    scores = np.concatenate(todos_scores)
    ids = np.concatenate(todos_ids)

    # NMS por classe: objetos de classes diferentes podem se sobrepor
    finais = []
    for c in np.unique(ids):
        m = ids == c
        for k in nms(caixas[m], scores[m], iou_thres):
            finais.append((caixas[m][k], scores[m][k], int(c)))

    # desfaz o letterbox
    h0, w0 = forma_orig[:2]
    resultado = []
    for caixa, score, c in finais:
        x1 = (caixa[0] - dx) / escala
        y1 = (caixa[1] - dy) / escala
        x2 = (caixa[2] - dx) / escala
        y2 = (caixa[3] - dy) / escala

        resultado.append({
            "caixa": (
                max(0, int(x1)), max(0, int(y1)),
                min(w0, int(x2)), min(h0, int(y2)),
            ),
            "score": float(score),
            "classe_id": c,
            "classe": CLASSES[c] if c < len(CLASSES) else str(c),
        })

    return sorted(resultado, key=lambda d: -d["score"])


# ---------------------------------------------------------------------------
# Wrapper do dispositivo
# ---------------------------------------------------------------------------
class DetectorEPI:
    """Mantém a rede ativada entre inferências. Reabrir o HEF a cada frame custa caro."""

    def __init__(self, hef_path):
        self.hef = HEF(hef_path)
        self.target = VDevice()

        params = ConfigureParams.create_from_hef(
            self.hef, interface=HailoStreamInterface.PCIe
        )
        self.grupo = self.target.configure(self.hef, params)[0]
        self.grupo_params = self.grupo.create_params()

        # FLOAT32 na saída faz o HailoRT desquantizar e converter FCR->NHWC
        self.in_params = InputVStreamParams.make(self.grupo, format_type=FormatType.UINT8)
        self.out_params = OutputVStreamParams.make(self.grupo, format_type=FormatType.FLOAT32)

        self.nome_entrada = self.hef.get_input_vstream_infos()[0].name

        self._ativacao = self.grupo.activate(self.grupo_params)
        self._ativacao.__enter__()
        self._pipeline = InferVStreams(self.grupo, self.in_params, self.out_params)
        self._infer = self._pipeline.__enter__()

    def detectar(self, img_bgr, conf_thres=CONF_THRES, iou_thres=IOU_THRES):
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        entrada, escala, dx, dy = letterbox(img_rgb)

        lote = np.expand_dims(entrada, axis=0)          # (1, 640, 640, 3) uint8
        saidas = self._infer.infer({self.nome_entrada: lote})

        return pos_processar(saidas, escala, dx, dy, img_bgr.shape,
                             conf_thres, iou_thres)

    def fechar(self):
        self._pipeline.__exit__(None, None, None)
        self._ativacao.__exit__(None, None, None)
        self.target.release()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.fechar()


# ---------------------------------------------------------------------------
# Desenho
# ---------------------------------------------------------------------------
def desenhar(img, deteccoes):
    for d in deteccoes:
        x1, y1, x2, y2 = d["caixa"]
        rotulo = f"{d['classe']} {d['score']:.2f}"

        cv2.rectangle(img, (x1, y1), (x2, y2), (0, 255, 0), 2)
        (tw, th), _ = cv2.getTextSize(rotulo, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.rectangle(img, (x1, y1 - th - 6), (x1 + tw + 2, y1), (0, 255, 0), -1)
        cv2.putText(img, rotulo, (x1 + 1, y1 - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)
    return img


# ---------------------------------------------------------------------------
def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    hef_path, alvo = sys.argv[1], sys.argv[2]

    with DetectorEPI(hef_path) as det:
        if alvo == "--camera":
            indice = int(sys.argv[3]) if len(sys.argv) > 3 else CAM_INDICE
            cap = abrir_camera(indice)
            if cap is None:
                sys.exit(1)

            t0, n = time.time(), 0
            try:
                while True:
                    ok, frame = cap.read()
                    if not ok:
                        print("Falha ao ler frame — câmera desconectada?")
                        break

                    deteccoes = det.detectar(frame)
                    desenhar(frame, deteccoes)

                    n += 1
                    if n % 30 == 0:
                        fps = n / (time.time() - t0)
                        cv2.putText(frame, f"{fps:.1f} FPS", (10, 30),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
                        print(f"{fps:.1f} FPS | {len(deteccoes)} detecções")

                    if MOSTRAR_JANELA:
                        cv2.imshow("EPI", frame)
                        if cv2.waitKey(1) & 0xFF == ord("q"):
                            break
            except KeyboardInterrupt:
                print("\nInterrompido.")
            finally:
                cap.release()
                cv2.destroyAllWindows()

        else:
            img = cv2.imread(alvo)
            if img is None:
                print(f"Não consegui ler {alvo}")
                sys.exit(1)

            t0 = time.time()
            deteccoes = det.detectar(img)
            print(f"{(time.time() - t0) * 1000:.1f} ms")

            for d in deteccoes:
                print(f"  {d['classe']:<20} {d['score']:.3f}  {d['caixa']}")

            cv2.imwrite("saida.jpg", desenhar(img, deteccoes))
            print("Anotado em saida.jpg")


if __name__ == "__main__":
    main()
