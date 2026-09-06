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
    """Anel dos últimos N frames CRUS da câmera — sem inferência nenhuma.

    É AQUI que o laço contínuo da câmera e o pedido do servidor se
    encontram, e a divisão de trabalho é deliberada: **guardar é
    contínuo, inferir é sob demanda.**

    A alternativa que parece mais simples — ao receber `cmd/capturar`,
    ligar a câmera e tirar cinco fotos — não fecha a conta. O servidor
    expira em 10 s, e entre acordar o sensor e esperar o auto-exposure
    estabilizar o orçamento evapora. Pior: as cinco fotos sairiam todas
    do mesmo instante, e "confirmado em 3 de 5 frames" não valeria nada.

    A outra alternativa — inferir a cada frame e guardar as detecções —
    resolve o prazo, mas põe a NPU trabalhando o dia inteiro para
    ninguém: entre uma pessoa e outra na catraca não há nada a decidir.

    Guardando o frame cru, ficam as duas coisas. Ler um frame e copiá-lo
    para o anel é barato e mantém o sensor aquecido e exposto; a
    inferência só acontece quando alguém pergunta, sobre um histórico que
    já tem instantes diferentes para votar.

    `intervalo_min_s` é o detalhe que faz a votação continuar valendo.
    Sem ele, um laço a 30 fps encheria o anel com 15 frames de meio
    segundo — quinze retratos do mesmo instante. Espaçando as amostras,
    os mesmos 15 frames cobrem os 3 s da janela.

    O custo é memória: 15 frames de 640×480 são ~13 MB parados. Numa Pi 5
    isso não é problema; numa placa apertada, baixe `capacidade`.
    """

    def __init__(
        self,
        capacidade: int = 15,
        janela_s: float = 3.0,
        intervalo_min_s: float = 0.2,
    ) -> None:
        self.janela_s = janela_s
        self.intervalo_min_s = intervalo_min_s
        self._itens: deque[tuple[float, Any]] = deque(maxlen=capacidade)
        self._trava = threading.Lock()
        self._frames_vistos = 0
        self._ultimo_guardado = 0.0

    def registrar(self, frame: Any) -> None:
        """Chame a cada frame que o seu laço LER. Não infira antes."""
        agora = time.monotonic()
        with self._trava:
            # Conta todo frame oferecido, guardado ou não: é isto que a
            # telemetria reporta como fps do laço. Contar só os guardados
            # faria a Pi parecer travada a 5 fps com a câmera perfeita.
            self._frames_vistos += 1
            if agora - self._ultimo_guardado < self.intervalo_min_s:
                return
            self._ultimo_guardado = agora
            self._itens.append((agora, frame))

    def recentes(self, quantos: int) -> list[Any]:
        """Os últimos `quantos` frames dentro da janela de tempo."""
        limite = time.monotonic() - self.janela_s
        with self._trava:
            frescos = [f for t, f in self._itens if t >= limite]
        return frescos[-quantos:]

    def ultimo(self) -> Any | None:
        """O frame mais recente, para a evidência."""
        with self._trava:
            return self._itens[-1][1] if self._itens else None

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
