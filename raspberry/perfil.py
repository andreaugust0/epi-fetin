#!/usr/bin/env python3
"""Mede onde o tempo está indo no pipeline.

    python3 perfil.py modelo_epi.hef
    python3 perfil.py modelo_epi.hef --sem-janela    # por SSH, sem display
    python3 perfil.py modelo_epi.hef --n 300

O `--sem-janela` importa mais do que parece: por SSH sem display, o
`imshow` ou falha ou passa a dominar a medição via X11 encaminhado — e aí
o perfil mede a sua rede, não a Raspberry.
"""

import argparse
import sys
import time
import statistics as st

import cv2
import numpy as np

from epi_hailo import (
    DetectorEPI, abrir_camera, letterbox, pos_processar, desenhar,
    CONF_THRES, IOU_THRES,
)

ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
ap.add_argument("hef", nargs="?", default="modelo_epi.hef")
ap.add_argument("--n", type=int, default=100, help="frames por medição")
ap.add_argument("--sem-janela", action="store_true",
                help="não chama imshow (obrigatório por SSH sem display)")
args = ap.parse_args()

N = args.n
MOSTRAR = not args.sem_janela


def resumo(nome, tempos):
    ms = [t * 1000 for t in tempos]
    print(f"  {nome:<22} mediana {st.median(ms):6.1f} ms   "
          f"p95 {sorted(ms)[int(len(ms) * 0.95)]:6.1f} ms   "
          f"(teto {1000 / st.median(ms):5.1f} FPS)")


hef_path = args.hef

# ---------------------------------------------------------------------------
print("=" * 70)
print("1. CAPTURA PURA (loop vazio, só cap.read)")
cap = abrir_camera()
if cap is None:
    sys.exit(1)

tempos = []
for _ in range(N):
    t = time.perf_counter()
    ok, frame = cap.read()
    tempos.append(time.perf_counter() - t)
    if not ok:
        print("  falha na leitura")
        break
resumo("cap.read()", tempos)

# ---------------------------------------------------------------------------
print("\n2. ETAPAS DO PIPELINE")
det = DetectorEPI(hef_path)

t_cvt, t_letter, t_infer, t_decode, t_draw, t_show = [], [], [], [], [], []

for _ in range(N):
    ok, frame = cap.read()
    if not ok:
        break

    t = time.perf_counter()
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    t_cvt.append(time.perf_counter() - t)

    t = time.perf_counter()
    entrada, escala, dx, dy = letterbox(rgb)
    lote = np.expand_dims(entrada, axis=0)
    t_letter.append(time.perf_counter() - t)

    t = time.perf_counter()
    saidas = det._infer.infer({det.nome_entrada: lote})
    t_infer.append(time.perf_counter() - t)

    t = time.perf_counter()
    deteccoes = pos_processar(saidas, escala, dx, dy, frame.shape,
                              CONF_THRES, IOU_THRES)
    t_decode.append(time.perf_counter() - t)

    t = time.perf_counter()
    desenhar(frame, deteccoes)
    t_draw.append(time.perf_counter() - t)

    t = time.perf_counter()
    if MOSTRAR:
        cv2.imshow("perfil", frame)
        cv2.waitKey(1)
    t_show.append(time.perf_counter() - t)

resumo("cvtColor", t_cvt)
resumo("letterbox", t_letter)
resumo("infer (NPU)", t_infer)
resumo("decode", t_decode)
resumo("desenhar", t_draw)
resumo("imshow" if MOSTRAR else "imshow (desligado)", t_show)

total = st.median([a + b + c + d + e + f for a, b, c, d, e, f
                   in zip(t_cvt, t_letter, t_infer, t_decode, t_draw, t_show)])
print(f"\n  {'TOTAL (sem captura)':<22} mediana {total * 1000:6.1f} ms   "
      f"(teto {1 / total:5.1f} FPS)")

# ---------------------------------------------------------------------------
print("\n3. NPU ISOLADA (mesmo frame, sem captura)")
frame_fixo = np.zeros((1, 640, 640, 3), dtype=np.uint8)
tempos = []
for _ in range(N):
    t = time.perf_counter()
    det._infer.infer({det.nome_entrada: frame_fixo})
    tempos.append(time.perf_counter() - t)
resumo("infer puro", tempos)

cap_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
cap_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
cap_fps = cap.get(cv2.CAP_PROP_FPS)
cap_fourcc = cap.get(cv2.CAP_PROP_FOURCC)

det.fechar()
cap.release()
if MOSTRAR:
    cv2.destroyAllWindows()

print("\n" + "=" * 70)
# Antes havia aqui uma frase fixa dizendo YUYV 640x480. Ela contradiz o que
# `abrir_camera` pede (MJPG 1280x720) e, num relatório, viraria um numero
# errado citado com confiança. Melhor perguntar à câmera.
fourcc = int(cap_fourcc)
print(
    f"Câmera: {cap_w}x{cap_h} @ {cap_fps:.0f} FPS "
    f"[{''.join(chr((fourcc >> 8 * i) & 0xFF) for i in range(4))}] — "
    f"esse é o teto de captura."
)
print("Compare a captura pura com o TOTAL: o menor dos dois manda no FPS final.")
