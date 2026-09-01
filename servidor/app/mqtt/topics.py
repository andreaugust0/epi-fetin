"""Construção e parse de tópicos MQTT — um lugar só.

Convenção:

    epi/{versao}/{site}/{ponto}/{classe}/{acao}
    epi/{versao}/{site}/{ponto}/dev/{device_id}/{acao}
    epi/{versao}/{site}/config/{device_id}

`site` e `ponto` vêm antes da ação de propósito: é o que permite escrever
um ACL no broker restringindo cada dispositivo ao próprio ponto.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.core.config import settings

NS = settings.MQTT_NAMESPACE
V = f"v{settings.MQTT_VERSAO}"

# ------------------------------------------------------------------ publish
def cmd_capturar(site: str, ponto: str) -> str:
    return f"{NS}/{V}/{site}/{ponto}/cmd/capturar"


def cmd_liberar(site: str, ponto: str) -> str:
    return f"{NS}/{V}/{site}/{ponto}/cmd/liberar"


def config_dispositivo(site: str, device_id: str) -> str:
    return f"{NS}/{V}/{site}/config/{device_id}"


#: Canal interno do backend: o worker decide o desfecho, os processos da API
#: reemitem para os WebSockets que cada um segura.
#:
#: Fora da árvore `{site}/{ponto}` de propósito. Ali cada dispositivo tem
#: permissão de publicar no próprio ponto, e um ESP32 comprometido poderia
#: forjar um desfecho "APROVADA" direto para a tela do tablet. Aqui, o ACL
#: do broker libera `epi/v1/backend/#` apenas para o backend.
AVISOS_TABLET = f"{NS}/{V}/backend/avisos"


# ------------------------------------------------------------------ subscribe
#: Assinaturas do worker. Curinga em site/ponto: adicionar um ponto de acesso
#: novo não exige tocar no servidor.
ASSINATURAS: list[tuple[str, int]] = [
    (f"{NS}/{V}/+/+/evt/#", 1),
    (f"{NS}/{V}/+/+/dev/+/status", 1),
    (f"{NS}/{V}/+/+/dev/+/telemetria", 0),
]


@dataclass(frozen=True, slots=True)
class TopicoLido:
    site: str
    ponto: str
    classe: str            # "evt" | "dev"
    acao: str              # "resultado" | "passagem" | "status" | "telemetria"
    device_id: str | None  # preenchido apenas quando classe == "dev"


def parse(topico: str) -> TopicoLido | None:
    """Devolve os componentes de um tópico, ou None se não reconhecer.

    Retornar None em vez de levantar exceção é deliberado: o worker apenas
    ignora o que não entende, em vez de derrubar o laço de consumo.
    """
    p = topico.split("/")
    if len(p) < 6 or p[0] != NS or p[1] != V:
        return None

    site, ponto, classe = p[2], p[3], p[4]

    if classe == "evt" and len(p) == 6:
        return TopicoLido(site, ponto, "evt", p[5], None)
    if classe == "dev" and len(p) == 7:
        return TopicoLido(site, ponto, "dev", p[6], p[5])
    return None
