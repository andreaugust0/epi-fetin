"""Foto de rosto para embedding — o mesmo caminho que o tablet percorre.

Existe para o cadastro biométrico poder acontecer pelo painel, sem depender
de alguém segurar um tablet na frente de cada funcionário.

    from app.services import rosto
    resultado = rosto.extrair(bytes_da_foto)
    resultado.embedding   # 512 floats, L2-normalizados

O QUE ESTE ARQUIVO PRECISA ACERTAR, e por que é delicado
--------------------------------------------------------

O tablet gera embeddings assim, e este módulo tem que produzir vetores
comparáveis com aqueles — porque é o MESMO índice pgvector, e a mesma
distância de corte (`FACE_DISTANCIA_MAX`) julga os dois:

    ML Kit detecta  →  caixa vira quadrado do lado maior, SEM margem
                    →  recorta  →  160x160  →  (p - 127.5) / 128
                    →  FaceNet  →  512-d L2

Os passos do quadrado em diante são aritmética determinística, e estão
portados aqui linha a linha de `faceGeometry.ts` e `facenetPreprocess.ts`.
Esses eu garanto.

O passo que NÃO dá para garantir por construção é a detecção. O tablet usa
ML Kit; aqui usamos YuNet, porque ML Kit não roda fora do Android.
Detectores diferentes devolvem caixas diferentes para o mesmo rosto — um
mais apertado na testa, outro pegando mais queixo. Como o recorte é feito
sem margem, uma caixa diferente vira um recorte diferente, e um recorte
diferente vira um embedding legítimo mas de outro espaço.

O sintoma seria cruel: o cadastro dá certo, a tela diz "cadastrado", e a
pessoa nunca é reconhecida na catraca. Por isso o endpoint que usa este
módulo MEDE a distância entre o vetor novo e os que o tablet já gravou
para a mesma pessoa, e devolve o número. É a diferença entre saber e
torcer.
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

from app.core.config import settings

log = logging.getLogger(__name__)

#: Lado que o FaceNet espera. Espelha `FACENET_IMAGE_SIZE` no tablet.
LADO_FACENET = 160


class ErroRosto(Exception):
    """Falha ao extrair um rosto utilizável da foto."""


class NenhumRosto(ErroRosto):
    pass


class MuitosRostos(ErroRosto):
    pass


@dataclass(frozen=True, slots=True)
class Caixa:
    x: int
    y: int
    largura: int
    altura: int

    def como_dict(self) -> dict[str, int]:
        return {"x": self.x, "y": self.y, "largura": self.largura, "altura": self.altura}


@dataclass(frozen=True, slots=True)
class Extracao:
    embedding: list[float]
    caixa_bruta: Caixa
    caixa_recorte: Caixa
    confianca_deteccao: float
    largura_imagem: int
    altura_imagem: int
    #: O recorte 160x160 em PNG. Serve para a tela mostrar O QUE foi medido —
    #: é a única forma de alguém perceber que o detector pegou o cotovelo.
    recorte_png: bytes


def _quadrar(caixa: Caixa, largura: int, altura: int) -> Caixa:
    """Porta de `toSquareBox` (faceGeometry.ts). Sem margem, de propósito.

    Qualquer folga acrescentada aqui e não lá tornaria os embeddings deste
    caminho incomparáveis com os do tablet — que é exatamente o defeito
    silencioso que este módulo inteiro tenta evitar.
    """
    limite = min(largura, altura)
    lado = min(max(caixa.largura, caixa.altura), limite)

    centro_x = caixa.x + caixa.largura / 2
    centro_y = caixa.y + caixa.altura / 2

    # `clamp` mantém o quadrado inteiro dentro da imagem, deslocando-o em
    # vez de cortá-lo — igual ao tablet.
    x = min(max(centro_x - lado / 2, 0), max(0, largura - lado))
    y = min(max(centro_y - lado / 2, 0), max(0, altura - lado))

    return Caixa(round(x), round(y), round(lado), round(lado))


def _padronizar(recorte_rgb: np.ndarray) -> np.ndarray:
    """(p - 127.5) / 128 e layout CHW. Porta de `facenetPreprocess.ts`.

    Não é `p / 255` e não é média/desvio do ImageNet: é a
    `fixed_image_standardization` do facenet-pytorch, que foi o que o
    enrollment usou. O grafo ONNX não normaliza nada antes da primeira
    convolução, então isto precisa acontecer aqui.
    """
    tensor = (recorte_rgb.astype(np.float32) - 127.5) / 128.0
    # HWC -> CHW, e um lote de um.
    return np.ascontiguousarray(tensor.transpose(2, 0, 1)[None, ...])


class _Modelos:
    """Carrega detector e FaceNet uma vez, sob demanda.

    Carregar na importação faria qualquer `python -m scripts.…` pagar 94 MB
    de FaceNet para tarefas que nem tocam em rosto. Carregar a cada chamada
    faria cada cadastro pagar de novo.
    """

    def __init__(self) -> None:
        self._trava = threading.Lock()
        self._facenet: ort.InferenceSession | None = None
        self._detector: cv2.FaceDetectorYN | None = None

    def facenet(self) -> ort.InferenceSession:
        with self._trava:
            if self._facenet is None:
                caminho = Path(settings.FACE_ONNX)
                if not caminho.is_file():
                    raise ErroRosto(
                        f"modelo FaceNet não encontrado em {caminho}. Ele vive no "
                        f"repositório do tablet e chega aqui por volume "
                        f"(ver docker-compose.yml); confira FACE_ONNX."
                    )
                self._facenet = ort.InferenceSession(
                    str(caminho), providers=["CPUExecutionProvider"]
                )
                log.info("FaceNet carregado de %s", caminho)
            return self._facenet

    def detector(self) -> cv2.FaceDetectorYN:
        with self._trava:
            if self._detector is None:
                caminho = Path(settings.FACE_DETECTOR_ONNX)
                if not caminho.is_file():
                    raise ErroRosto(f"detector de rosto não encontrado em {caminho}")
                self._detector = cv2.FaceDetectorYN.create(
                    str(caminho),
                    "",
                    (320, 320),
                    settings.FACE_DETECCAO_MIN,
                    0.3,
                    5000,
                )
                log.info("detector de rosto carregado de %s", caminho)
            return self._detector


_modelos = _Modelos()


def _decodificar(dados: bytes) -> np.ndarray:
    imagem = cv2.imdecode(np.frombuffer(dados, np.uint8), cv2.IMREAD_COLOR)
    if imagem is None:
        raise ErroRosto(
            "não consegui ler a imagem. Envie JPEG ou PNG — HEIC do iPhone "
            "não é lido aqui."
        )
    return imagem


#: Lado maior da imagem entregue ao YuNet. Só a DETECÇÃO usa esta redução;
#: o recorte continua saindo da foto original, em resolução plena.
LADO_DETECCAO_MAX = 1024


def _detectar(imagem_bgr: np.ndarray) -> list[tuple[Caixa, float]]:
    """Onde estão os rostos, e com que confiança.

    A foto é REDUZIDA antes de ir ao detector, e isso não é economia de CPU:
    é o que faz o YuNet funcionar. Ele foi treinado com entradas pequenas, e
    suas âncoras cobrem rostos de algumas dezenas a algumas centenas de
    pixels. Numa foto de celular — 3024x4032 — um rosto de perto ocupa dois
    mil pixels de lado, muito acima do que ele sabe procurar, e a confiança
    despenca conforme o rosto CRESCE no quadro:

        rosto ocupando 25% da altura   nativo 0.90    reduzido 0.95
        rosto ocupando 40% da altura   nativo 0.71    reduzido 0.95
        rosto ocupando 55% da altura   nativo 0.70    reduzido 0.95
        rosto ocupando 70% da altura   nativo 0.61    reduzido 0.94

    Com `FACE_DETECCAO_MIN` em 0.7, isso produzia o pior tipo de erro: a
    foto boa, de frente e bem iluminada, era recusada com "nenhum rosto
    encontrado" — e a mensagem mandava a pessoa aproximar o rosto, que é
    exatamente o que piorava. Enquanto isso um recorte distante passava. O
    conselho na tela estava invertido porque o diagnóstico estava.

    A caixa volta convertida para as coordenadas da imagem original, então
    nada muda do quadrado em diante: o recorte tem a resolução que sempre
    teve, e a geometria continua idêntica à do tablet.
    """
    altura, largura = imagem_bgr.shape[:2]
    maior = max(altura, largura)

    if maior > LADO_DETECCAO_MAX:
        fator = LADO_DETECCAO_MAX / maior
        # INTER_AREA é o que não cria serrilhado ao reduzir. Aqui pode ser
        # diferente do tablet sem prejuízo: isto alimenta o detector, não o
        # FaceNet — o vetor sai do recorte original.
        entrada = cv2.resize(
            imagem_bgr,
            (round(largura * fator), round(altura * fator)),
            interpolation=cv2.INTER_AREA,
        )
    else:
        fator = 1.0
        entrada = imagem_bgr

    alt_ent, larg_ent = entrada.shape[:2]
    detector = _modelos.detector()
    detector.setInputSize((larg_ent, alt_ent))
    _, cruas = detector.detect(entrada)
    if cruas is None:
        return []

    achados = []
    for linha in cruas:
        x, y, w, h = (float(v) / fator for v in linha[:4])
        achados.append((Caixa(round(x), round(y), round(w), round(h)), float(linha[-1])))
    return achados


def extrair(dados: bytes) -> Extracao:
    """Foto → embedding, pelo mesmo caminho do tablet.

    A imagem existe só em memória: nada é gravado em disco em nenhum ponto
    desta função, e quem chama não recebe os bytes originais de volta.
    """
    imagem = _decodificar(dados)
    altura, largura = imagem.shape[:2]

    rostos = _detectar(imagem)
    if not rostos:
        raise NenhumRosto(
            "nenhum rosto encontrado nesta foto. Use uma foto de frente, com "
            "o rosto bem iluminado e ocupando boa parte do quadro."
        )
    if len(rostos) > 1:
        # O tablet escolhe o maior rosto e segue, porque lá a alternativa é
        # travar a catraca com uma fila atrás. No cadastro não há pressa, e
        # escolher sozinho é como se cadastra o rosto errado: a foto do
        # crachá com o colega ao fundo vira a biometria do colega.
        raise MuitosRostos(
            f"{len(rostos)} rostos nesta foto. Para cadastro, envie uma foto "
            f"com uma pessoa só — aqui não dá para adivinhar qual é."
        )

    caixa_bruta, confianca = rostos[0]
    recorte_caixa = _quadrar(caixa_bruta, largura, altura)

    recorte = imagem[
        recorte_caixa.y : recorte_caixa.y + recorte_caixa.altura,
        recorte_caixa.x : recorte_caixa.x + recorte_caixa.largura,
    ]
    if recorte.size == 0:
        raise ErroRosto("o recorte do rosto saiu vazio")

    # INTER_LINEAR (bilinear) para casar com o `resize` do
    # expo-image-manipulator no tablet. Trocar por INTER_AREA daria uma
    # imagem "melhor" e um embedding diferente do dele — que é pior.
    redimensionado = cv2.resize(
        recorte, (LADO_FACENET, LADO_FACENET), interpolation=cv2.INTER_LINEAR
    )

    # BGR -> RGB. O OpenCV lê em BGR; o tablet decodifica PNG em RGBA e usa
    # R, G, B nessa ordem. Esquecer esta linha produz um embedding
    # perfeitamente formado e completamente sem sentido.
    rgb = cv2.cvtColor(redimensionado, cv2.COLOR_BGR2RGB)

    sessao = _modelos.facenet()
    entrada = sessao.get_inputs()[0].name
    saida = sessao.run(None, {entrada: _padronizar(rgb)})[0][0]

    vetor = np.asarray(saida, dtype=np.float32)
    norma = float(np.linalg.norm(vetor))
    if norma == 0.0 or not np.isfinite(norma):
        raise ErroRosto("o modelo devolveu um vetor degenerado")
    # O grafo já entrega normalizado; renormalizar é barato e protege de uma
    # troca futura de modelo que não normalize.
    vetor = vetor / norma

    ok, png = cv2.imencode(".png", redimensionado)
    if not ok:
        raise ErroRosto("falha ao codificar a prévia do recorte")

    return Extracao(
        embedding=[float(v) for v in vetor],
        caixa_bruta=caixa_bruta,
        caixa_recorte=recorte_caixa,
        confianca_deteccao=confianca,
        largura_imagem=largura,
        altura_imagem=altura,
        recorte_png=png.tobytes(),
    )


def distancia_cosseno(a: list[float] | np.ndarray, b: list[float] | np.ndarray) -> float:
    """1 - cos(a, b), a mesma medida que o pgvector usa na identificação.

    O resultado é preso em [0, 2] porque, sem isso, dois vetores idênticos
    devolvem algo como -1e-8: o produto interno passa de 1 por ruído de
    ponto flutuante. Matematicamente é zero, mas a tela mostrava
    "distância -0.000", que parece defeito e faz duvidar do número certo.
    """
    va = np.asarray(a, dtype=np.float32)
    vb = np.asarray(b, dtype=np.float32)
    na, nb = float(np.linalg.norm(va)), float(np.linalg.norm(vb))
    if na == 0.0 or nb == 0.0:
        return 1.0
    return float(min(2.0, max(0.0, 1.0 - np.dot(va, vb) / (na * nb))))
