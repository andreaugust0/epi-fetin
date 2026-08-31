"""A fronteira entre o código de visão de vocês e o resto deste pacote.

O único acoplamento é o protocolo `Detector` abaixo: dois atributos e um
método. Nada aqui sabe o que é ONNX, YOLO, OpenCV ou picamera2 — trocar o
runtime do modelo não deve tocar em uma linha de MQTT.

Também mora aqui a peça que resolve o descompasso central desta
integração: o seu laço é **contínuo** e o servidor é **sob demanda**.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Any, Protocol, Sequence


@dataclass(frozen=True, slots=True)
class Deteccao:
    """Uma caixa que o modelo desenhou num frame."""

    classe: str          # o nome COMO SAI DO MODELO; a tradução é depois
    confianca: float
    bbox: tuple[int, int, int, int] | None = None  # x, y, largura, altura


class Detector(Protocol):
    """Implemente isto em cima do seu código atual.

    `nomes_classes` é lido uma vez na subida para validar a tabela de
    tradução — é o que faz um mapa incompleto falhar na bancada e não na
    catraca.
    """

    nomes_classes: Sequence[str]

    def detectar(self, frame: Any) -> list[Deteccao]:
        """Roda a inferência num frame e devolve o que viu.

        Sem filtro por EPI exigido: filtrar é decisão de política, e ela
        é do servidor. Devolva tudo que passou do limiar de confiança.
        """
        ...


# --------------------------------------------------------------- buffer
class BufferFrames:
    """Anel dos últimos N frames já inferidos.

    É AQUI que o seu laço contínuo e o pedido do servidor se encontram.

    A alternativa óbvia — ao receber `cmd/capturar`, ligar a câmera e
    tirar cinco fotos — não fecha a conta. O servidor expira em 10 s, e
    entre acordar o sensor, esperar o auto-exposure estabilizar e rodar
    cinco inferências numa CPU ARM, o orçamento evapora. Pior: as fotos
    seriam todas do mesmo instante, então "confirmado em 3 de 5 frames"
    não valeria nada.

    Mantendo o laço rodando e gravando cada resultado aqui, responder um
    comando vira leitura de memória: microssegundos, e com um histórico
    real de instantes diferentes para votar em cima.

    O custo é que a resposta olha para o passado recente, não para o
    agora. Com `janela_s` em 3 segundos e a pessoa parada na frente da
    catraca, é a mesma coisa — e é por isso que existe o descarte por
    idade: um frame de 30 s atrás pode ser de outra pessoa.
    """

    def __init__(self, capacidade: int = 15, janela_s: float = 3.0) -> None:
        self.janela_s = janela_s
        self._itens: deque[tuple[float, list[Deteccao]]] = deque(maxlen=capacidade)
        self._trava = threading.Lock()
        self._frames_vistos = 0

    def registrar(self, deteccoes: list[Deteccao]) -> None:
        """Chame a cada frame que o seu laço inferir."""
        with self._trava:
            self._itens.append((time.monotonic(), deteccoes))
            self._frames_vistos += 1

    def recentes(self, quantos: int) -> list[list[Deteccao]]:
        """Os últimos `quantos` frames dentro da janela de tempo."""
        limite = time.monotonic() - self.janela_s
        with self._trava:
            frescos = [d for t, d in self._itens if t >= limite]
        return frescos[-quantos:]

    @property
    def frames_vistos(self) -> int:
        return self._frames_vistos

    def __len__(self) -> int:
        with self._trava:
            return len(self._itens)


# --------------------------------------------------------------- votação
@dataclass(frozen=True, slots=True)
class Voto:
    presente: bool
    confianca: float
    confirmacoes: int
    bbox: tuple[int, int, int, int] | None


def votar(
    amostras: list[list[Deteccao]],
    codigos_exigidos: Sequence[str],
    traduzir,
    min_confirmacoes: int,
) -> dict[str, Voto]:
    """Consolida N frames num veredito por EPI.

    Um EPI conta como presente quando aparece em pelo menos
    `min_confirmacoes` frames distintos. A confiança relatada é a
    **mediana** dos frames em que apareceu, não a máxima: com a máxima,
    um único frame sortudo com um reflexo faz o número parecer ótimo, e
    o relatório do TCC passa a mentir sobre a qualidade do modelo.

    Cada EPI é contado no máximo uma vez por frame. Sem isso, uma pessoa
    com as duas luvas visíveis produziria duas confirmações no mesmo
    instante e o mínimo de três seria atingido com um frame e meio.
    """
    por_epi: dict[str, list[Deteccao]] = {c: [] for c in codigos_exigidos}

    for frame in amostras:
        melhor_no_frame: dict[str, Deteccao] = {}
        for det in frame:
            codigo = traduzir(det.classe)
            if codigo is None or codigo not in por_epi:
                continue
            atual = melhor_no_frame.get(codigo)
            if atual is None or det.confianca > atual.confianca:
                melhor_no_frame[codigo] = det
        for codigo, det in melhor_no_frame.items():
            por_epi[codigo].append(det)

    resultado: dict[str, Voto] = {}
    for codigo in codigos_exigidos:
        vistos = por_epi[codigo]
        n = len(vistos)
        if n == 0:
            # Ausência total: confiança 0 e nenhuma caixa. O servidor lê
            # `presente: false` e reprova — que é o comportamento certo.
            resultado[codigo] = Voto(False, 0.0, 0, None)
            continue

        confs = sorted(d.confianca for d in vistos)
        mediana = confs[n // 2] if n % 2 else (confs[n // 2 - 1] + confs[n // 2]) / 2
        mais_confiante = max(vistos, key=lambda d: d.confianca)
        resultado[codigo] = Voto(
            presente=n >= min_confirmacoes,
            confianca=mediana,
            confirmacoes=n,
            bbox=mais_confiante.bbox,
        )
    return resultado
