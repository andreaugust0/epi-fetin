"""Adaptador do seu ONNX para o protocolo `Detector`.

Isto é um **exemplo funcional**, não um substituto do que vocês já
escreveram. Se o seu código de inferência já está pronto e rodando, o
caminho mais curto é o outro: mantenha-o, e implemente só os dois membros
que o `Detector` pede em cima dele.

    class MeuDetector:
        nomes_classes = ["helmet", "vest", ...]

        def detectar(self, frame):
            for cx, cy, w, h, conf, cls in o_que_voce_ja_tem(frame):
                yield Deteccao(self.nomes_classes[cls], conf,
                               (int(cx - w/2), int(cy - h/2), int(w), int(h)))

Este arquivo existe para (a) rodar de ponta a ponta caso vocês queiram, e
(b) mostrar exatamente o formato de caixa que o servidor espera: **x, y,
largura, altura** com origem no canto superior esquerdo, em pixels do
frame original — não o cxcywh normalizado que sai da rede.

    pip install onnxruntime numpy opencv-python-headless
"""
from __future__ import annotations

import ast
import json
import logging
from pathlib import Path

import numpy as np
import onnxruntime as ort

from epi_borda.detector import Deteccao

log = logging.getLogger(__name__)


class DetectorOnnx:
    def __init__(
        self,
        caminho: str | Path,
        *,
        confianca_min: float = 0.45,
        iou_nms: float = 0.45,
        threads: int = 2,
    ) -> None:
        opcoes = ort.SessionOptions()
        # Numa Pi 4 são quatro núcleos e o laço de câmera precisa de um.
        # Deixar o ORT tomar todos faz o fps despencar por disputa.
        opcoes.intra_op_num_threads = threads
        opcoes.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        self.sessao = ort.InferenceSession(
            str(caminho), opcoes, providers=["CPUExecutionProvider"]
        )
        entrada = self.sessao.get_inputs()[0]
        self.nome_entrada = entrada.name
        # Formato NCHW: [lote, canais, altura, largura]. Um eixo dinâmico
        # vem como string; caímos no 640 padrão do YOLO.
        _, _, alt, larg = entrada.shape
        self.tamanho = (
            int(larg) if isinstance(larg, int) else 640,
            int(alt) if isinstance(alt, int) else 640,
        )
        self.nomes_classes = self._ler_nomes()
        self.confianca_min = confianca_min
        self.iou_nms = iou_nms
        log.info("modelo carregado: %s · entrada %s · %d classes",
                 Path(caminho).name, self.tamanho, len(self.nomes_classes))

    def _ler_nomes(self) -> list[str]:
        meta = self.sessao.get_modelmeta().custom_metadata_map
        bruto = meta.get("names")
        if not bruto:
            raise RuntimeError(
                "o ONNX não traz 'names' no metadata. Passe a lista de "
                "classes à mão: DetectorOnnx.nomes_classes = [...] na "
                "mesma ordem do data.yaml do treino."
            )
        try:
            d = json.loads(bruto.replace("'", '"'))
        except json.JSONDecodeError:
            d = ast.literal_eval(bruto)
        return [d[k] for k in sorted(d, key=lambda x: int(x))]

    # ------------------------------------------------------ pré-processo
    def _letterbox(self, frame: np.ndarray):
        """Redimensiona mantendo proporção e preenche com cinza.

        Esticar a imagem para o quadrado distorce as caixas e piora a
        detecção de objeto estreito — o que é justamente o caso de luva e
        óculos. Devolvemos escala e deslocamento para desfazer depois.
        """
        import cv2

        alt0, larg0 = frame.shape[:2]
        larg1, alt1 = self.tamanho
        escala = min(larg1 / larg0, alt1 / alt0)
        nova = (int(round(larg0 * escala)), int(round(alt0 * escala)))
        dx, dy = (larg1 - nova[0]) // 2, (alt1 - nova[1]) // 2

        tela = np.full((alt1, larg1, 3), 114, dtype=np.uint8)
        tela[dy:dy + nova[1], dx:dx + nova[0]] = cv2.resize(
            frame, nova, interpolation=cv2.INTER_LINEAR
        )
        # BGR do OpenCV -> RGB, HWC -> CHW, 0..255 -> 0..1
        tensor = tela[:, :, ::-1].transpose(2, 0, 1).astype(np.float32) / 255.0
        return np.ascontiguousarray(tensor)[None], escala, dx, dy

    # ------------------------------------------------------- inferência
    def detectar(self, frame) -> list[Deteccao]:
        tensor, escala, dx, dy = self._letterbox(frame)
        saida = self.sessao.run(None, {self.nome_entrada: tensor})[0]
        caixas, confs, ids = self._decodificar(saida)
        if len(caixas) == 0:
            return []

        mantidas = _nms(caixas, confs, self.iou_nms)
        resultado: list[Deteccao] = []
        for i in mantidas:
            x1, y1, x2, y2 = caixas[i]
            # Desfaz o letterbox para voltar aos pixels do frame original
            x1 = max(0, int((x1 - dx) / escala))
            y1 = max(0, int((y1 - dy) / escala))
            x2 = int((x2 - dx) / escala)
            y2 = int((y2 - dy) / escala)
            resultado.append(
                Deteccao(
                    classe=self.nomes_classes[int(ids[i])],
                    confianca=float(confs[i]),
                    bbox=(x1, y1, x2 - x1, y2 - y1),  # xywh, como o servidor quer
                )
            )
        return resultado

    def _decodificar(self, saida: np.ndarray):
        """Cobre os dois formatos de saída que aparecem na prática.

        v8/v11: (1, 4+nc, N) — sem objectness, a confiança É o score da
                classe.
        v5:     (1, N, 5+nc) — com objectness, que multiplica o score.

        A desambiguação usa o número de classes, não "qual eixo é maior".
        O palpite pelo tamanho do eixo funciona com as 8400 âncoras reais
        e quebra em qualquer teste pequeno — e um decodificador que só
        funciona com entrada grande não é testável.
        """
        nc = len(self.nomes_classes)
        s = saida[0]

        if s.shape[0] == 4 + nc:          # (4+nc, N) -> v8, precisa transpor
            s = s.T
        if s.shape[1] == 4 + nc:          # (N, 4+nc) -> v8
            caixas_cxcywh = s[:, :4]
            scores = s[:, 4:]
        elif s.shape[1] == 5 + nc:        # (N, 5+nc) -> v5
            caixas_cxcywh = s[:, :4]
            scores = s[:, 5:] * s[:, 4:5]
        else:
            raise RuntimeError(
                f"saída {saida.shape} não bate com {nc} classes: eu esperava "
                f"o último eixo em {4 + nc} (v8) ou {5 + nc} (v5). Confira se "
                f"a lista de classes é a mesma do treino."
            )

        ids = scores.argmax(axis=1)
        confs = scores[np.arange(len(ids)), ids]
        manter = confs >= self.confianca_min
        caixas_cxcywh, confs, ids = (
            caixas_cxcywh[manter], confs[manter], ids[manter]
        )

        cx, cy, w, h = caixas_cxcywh.T
        caixas = np.stack([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], axis=1)
        return caixas, confs, ids


def _nms(caixas: np.ndarray, confs: np.ndarray, limiar: float) -> list[int]:
    """Supressão de não-máximos em numpy puro.

    Escrito à mão para não arrastar torch ou torchvision para dentro de
    uma Raspberry só por causa de vinte linhas.

    Nota: é NMS global, não por classe. Para EPI isso é o que se quer —
    capacete e máscara ocupam regiões vizinhas na cabeça, e suprimir
    entre classes derrubaria uma detecção boa. Se o seu modelo emitir
    classes que se sobrepõem de propósito, agrupe por `ids` antes.
    """
    ordem = confs.argsort()[::-1]
    area = (caixas[:, 2] - caixas[:, 0]) * (caixas[:, 3] - caixas[:, 1])
    mantidas: list[int] = []

    while ordem.size:
        i = ordem[0]
        mantidas.append(int(i))
        if ordem.size == 1:
            break
        resto = ordem[1:]
        x1 = np.maximum(caixas[i, 0], caixas[resto, 0])
        y1 = np.maximum(caixas[i, 1], caixas[resto, 1])
        x2 = np.minimum(caixas[i, 2], caixas[resto, 2])
        y2 = np.minimum(caixas[i, 3], caixas[resto, 3])
        inter = np.maximum(0, x2 - x1) * np.maximum(0, y2 - y1)
        iou = inter / (area[i] + area[resto] - inter + 1e-9)
        ordem = resto[iou <= limiar]

    return mantidas
