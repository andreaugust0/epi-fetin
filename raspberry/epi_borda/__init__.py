"""Cliente de borda do EPI Fetin — a Raspberry falando com o servidor.

    from epi_borda import Agente, Deteccao, carregar

    agente = Agente(carregar(), detector=meu_detector)
    agente.iniciar()
    ...
        agente.registrar_frame(deteccoes, frame)

Os símbolos são resolvidos sob demanda (PEP 562). Importar tudo aqui em
cima custaria o `paho` inteiro para quem só quer rodar
`python -m epi_borda.classes --do-modelo`, e faria o runpy reclamar de
módulo já importado ao executar um submódulo com `-m`.
"""
from typing import TYPE_CHECKING

__all__ = [
    "Agente",
    "BufferFrames",
    "Config",
    "Deteccao",
    "Detector",
    "carregar",
]

__version__ = "1.0.0"

_ONDE = {
    "Agente": "epi_borda.agente",
    "BufferFrames": "epi_borda.detector",
    "Deteccao": "epi_borda.detector",
    "Detector": "epi_borda.detector",
    "Config": "epi_borda.config",
    "carregar": "epi_borda.config",
}

if TYPE_CHECKING:  # para o editor e o type checker enxergarem
    from epi_borda.agente import Agente
    from epi_borda.config import Config, carregar
    from epi_borda.detector import BufferFrames, Deteccao, Detector


def __getattr__(nome: str):
    modulo = _ONDE.get(nome)
    if modulo is None:
        raise AttributeError(f"module 'epi_borda' has no attribute {nome!r}")
    from importlib import import_module

    valor = getattr(import_module(modulo), nome)
    globals()[nome] = valor  # memoiza: o segundo acesso não passa por aqui
    return valor


def __dir__() -> list[str]:
    return sorted(__all__)
