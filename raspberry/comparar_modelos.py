#!/usr/bin/env python3
"""Compara o modelo FP32 (best.onnx) com o quantizado INT8 (modelo_epi.hef).

Os dois usam o mesmo letterbox, os mesmos thresholds e o mesmo NMS, então
qualquer diferença observada vem da quantização — não do pré-processamento.

Uso:
    python3 comparar_modelos.py imagens/ --onnx best.onnx --hef modelo_epi.hef
    python3 comparar_modelos.py fundo/   --onnx best.onnx --hef modelo_epi.hef --fundo

A flag --fundo trata as imagens como cenas SEM nenhum EPI: toda detecção ali
é falso positivo, e o script reporta a contagem em vez de comparar caixas.
"""

import argparse
import glob
import os
import time

import cv2
import numpy as np

from epi_hailo import (
    DetectorEPI, letterbox, nms, CLASSES, CONF_THRES, IOU_THRES, IMGSZ,
)

IOU_PAREAMENTO = 0.50      # IoU mínimo para considerar que é a mesma detecção


# ---------------------------------------------------------------------------
# Baseline FP32 via onnxruntime
# ---------------------------------------------------------------------------
class DetectorONNX:
    """Roda best.onnx. A saída é (1, 4+nc, 8400) com xywh e scores já sigmoidados."""

    def __init__(self, onnx_path):
        import onnxruntime as ort

        self.sess = ort.InferenceSession(
            onnx_path, providers=["CPUExecutionProvider"]
        )
        self.nome_entrada = self.sess.get_inputs()[0].name

    def detectar(self, img_bgr, conf_thres=CONF_THRES, iou_thres=IOU_THRES):
        rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        entrada, escala, dx, dy = letterbox(rgb)

        # o ONNX espera float 0-1 em NCHW (a normalização dele não está no grafo)
        x = entrada.astype(np.float32) / 255.0
        x = np.transpose(x, (2, 0, 1))[None]

        saida = self.sess.run(None, {self.nome_entrada: x})[0]      # (1, 4+nc, 8400)
        pred = saida[0].T                                            # (8400, 4+nc)

        caixas_xywh = pred[:, :4]
        scores_cls = pred[:, 4:]

        score_max = scores_cls.max(axis=1)
        classe_id = scores_cls.argmax(axis=1)

        m = score_max > conf_thres
        if not m.any():
            return []

        caixas_xywh = caixas_xywh[m]
        scores = score_max[m]
        ids = classe_id[m]

        cx, cy, w, h = caixas_xywh.T
        caixas = np.stack([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], axis=1)

        resultado = []
        for c in np.unique(ids):
            sel = ids == c
            for k in nms(caixas[sel], scores[sel], iou_thres):
                caixa = caixas[sel][k]
                x1 = (caixa[0] - dx) / escala
                y1 = (caixa[1] - dy) / escala
                x2 = (caixa[2] - dx) / escala
                y2 = (caixa[3] - dy) / escala

                h0, w0 = img_bgr.shape[:2]
                resultado.append({
                    "caixa": (max(0, int(x1)), max(0, int(y1)),
                              min(w0, int(x2)), min(h0, int(y2))),
                    "score": float(scores[sel][k]),
                    "classe_id": int(c),
                    "classe": CLASSES[c] if c < len(CLASSES) else str(c),
                })

        return sorted(resultado, key=lambda d: -d["score"])


# ---------------------------------------------------------------------------
# Pareamento
# ---------------------------------------------------------------------------
def iou(a, b):
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b

    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)

    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    if inter == 0:
        return 0.0

    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    return inter / (area_a + area_b - inter)


def parear(det_fp32, det_int8):
    """Pareamento guloso por score. Retorna (pares, só_fp32, só_int8)."""
    pares = []
    usados_int8 = set()

    for i, a in enumerate(sorted(det_fp32, key=lambda d: -d["score"])):
        melhor_j, melhor_iou = None, IOU_PAREAMENTO

        for j, b in enumerate(det_int8):
            if j in usados_int8 or b["classe_id"] != a["classe_id"]:
                continue
            v = iou(a["caixa"], b["caixa"])
            if v >= melhor_iou:
                melhor_j, melhor_iou = j, v

        if melhor_j is not None:
            usados_int8.add(melhor_j)
            pares.append((a, det_int8[melhor_j], melhor_iou))

    so_fp32 = [a for a in det_fp32
               if not any(a is p[0] for p in pares)]
    so_int8 = [b for j, b in enumerate(det_int8) if j not in usados_int8]

    return pares, so_fp32, so_int8


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pasta")
    ap.add_argument("--onnx", default="best.onnx")
    ap.add_argument("--hef", default="modelo_epi.hef")
    ap.add_argument("--conf", type=float, default=CONF_THRES)
    ap.add_argument("--iou", type=float, default=IOU_THRES)
    ap.add_argument("--fundo", action="store_true",
                    help="imagens sem EPI: toda detecção é falso positivo")
    ap.add_argument("--limite", type=int, default=0, help="máximo de imagens")
    args = ap.parse_args()

    imagens = sorted(
        p for ext in ("jpg", "jpeg", "png", "JPG", "PNG")
        for p in glob.glob(os.path.join(args.pasta, f"**/*.{ext}"), recursive=True)
    )
    if args.limite:
        imagens = imagens[:args.limite]
    if not imagens:
        print(f"Nenhuma imagem em {args.pasta}")
        return

    print(f"{len(imagens)} imagens | conf={args.conf} iou={args.iou}\n")

    onnx = DetectorONNX(args.onnx)
    hef = DetectorEPI(args.hef)

    n_fp32 = n_int8 = 0
    n_pares = n_so_fp32 = n_so_int8 = 0
    ious, deltas = [], []
    por_classe = {i: {"fp32": 0, "int8": 0} for i in range(len(CLASSES))}
    imgs_com_fp = 0
    t_onnx = t_hef = 0.0

    for k, caminho in enumerate(imagens, 1):
        img = cv2.imread(caminho)
        if img is None:
            continue

        t = time.perf_counter()
        d_fp32 = onnx.detectar(img, args.conf, args.iou)
        t_onnx += time.perf_counter() - t

        t = time.perf_counter()
        d_int8 = hef.detectar(img, args.conf, args.iou)
        t_hef += time.perf_counter() - t

        n_fp32 += len(d_fp32)
        n_int8 += len(d_int8)

        # setdefault: um classe_id fora da lista CLASSES nao pode derrubar
        # uma comparacao que leva minutos rodando.
        for d in d_fp32:
            por_classe.setdefault(d["classe_id"], {"fp32": 0, "int8": 0})["fp32"] += 1
        for d in d_int8:
            por_classe.setdefault(d["classe_id"], {"fp32": 0, "int8": 0})["int8"] += 1

        if args.fundo:
            if d_int8:
                imgs_com_fp += 1
                if len(d_int8) or len(d_fp32):
                    print(f"  {os.path.basename(caminho):<40} "
                          f"FP32:{len(d_fp32)} INT8:{len(d_int8)}")
        else:
            pares, so_a, so_b = parear(d_fp32, d_int8)
            n_pares += len(pares)
            n_so_fp32 += len(so_a)
            n_so_int8 += len(so_b)
            for a, b, v in pares:
                ious.append(v)
                deltas.append(b["score"] - a["score"])

        if k % 25 == 0:
            print(f"  ... {k}/{len(imagens)}")

    hef.fechar()

    # -----------------------------------------------------------------------
    print("\n" + "=" * 64)
    if args.fundo:
        print("CENAS DE FUNDO — toda detecção aqui é falso positivo")
        print("=" * 64)
        print(f"  Imagens                : {len(imagens)}")
        print(f"  Falsos positivos FP32  : {n_fp32}")
        print(f"  Falsos positivos INT8  : {n_int8}")
        print(f"  Imagens afetadas (INT8): {imgs_com_fp} "
              f"({100 * imgs_com_fp / len(imagens):.1f}%)")
        if n_fp32:
            print(f"  Variação               : {100 * (n_int8 - n_fp32) / n_fp32:+.1f}%")
    else:
        print("COMPARAÇÃO FP32 vs INT8")
        print("=" * 64)
        print(f"  Detecções FP32         : {n_fp32}")
        print(f"  Detecções INT8         : {n_int8}")
        print(f"  Pareadas               : {n_pares}")
        print(f"  Só no FP32 (perdidas)  : {n_so_fp32}")
        print(f"  Só no INT8 (extras)    : {n_so_int8}")

        if n_fp32:
            print(f"\n  Retenção               : {100 * n_pares / n_fp32:.1f}%")
        if ious:
            print(f"  IoU médio dos pares    : {np.mean(ious):.3f}")
            print(f"  Δ confiança médio      : {np.mean(deltas):+.4f}")
            print(f"  Δ confiança p05/p95    : {np.percentile(deltas, 5):+.4f} / "
                  f"{np.percentile(deltas, 95):+.4f}")

        print("\n  Por classe:")
        print(f"    {'classe':<24} {'FP32':>6} {'INT8':>6} {'delta':>8}")
        for i, nome in enumerate(CLASSES):
            a, b = por_classe[i]["fp32"], por_classe[i]["int8"]
            if a or b:
                d = f"{100 * (b - a) / a:+.0f}%" if a else "—"
                print(f"    {nome:<24} {a:>6} {b:>6} {d:>8}")

    print(f"\n  Tempo médio FP32 (CPU) : {1000 * t_onnx / len(imagens):.1f} ms")
    print(f"  Tempo médio INT8 (NPU) : {1000 * t_hef / len(imagens):.1f} ms")
    print("=" * 64)


if __name__ == "__main__":
    main()
