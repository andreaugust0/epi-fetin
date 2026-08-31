"""O contrato com o servidor, escrito de novo deste lado.

DECISÃO IMPORTANTE, a mesma dos simuladores: este pacote **não importa
nada de `servidor/app/`**. A tentação é reaproveitar `app.mqtt.topics` e
`app.mqtt.schemas` — seria menos código e destruiria o valor do acordo.
Dois lados lendo o mesmo arquivo não têm contrato nenhum: têm uma variável
compartilhada. Escrevendo aqui do jeito que um dispositivo escreveria, um
descasamento vira erro em vez de coincidência silenciosa.

Também é o que permite instalar isto numa Raspberry sem levar junto
SQLAlchemy, FastAPI e pgvector.

Referência do lado servidor (para conferência humana, não por import):
    servidor/app/mqtt/topics.py     — a forma dos tópicos
    servidor/app/mqtt/schemas.py    — os campos de cada payload
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

NS = "epi"
V = "v1"

#: Versão do schema de payload. O servidor rejeita o que não for 1.
SCHEMA = 1


# ------------------------------------------------------------------ tópicos
# epi/v1/{site}/{ponto}/cmd/{acao}
# epi/v1/{site}/{ponto}/evt/{acao}
# epi/v1/{site}/{ponto}/dev/{device_id}/{acao}
#
# site e ponto vêm antes da ação de propósito: é o que permite escrever um
# ACL no broker prendendo cada dispositivo ao próprio ponto de acesso.
def t_cmd(site: str, ponto: str, acao: str) -> str:
    return f"{NS}/{V}/{site}/{ponto}/cmd/{acao}"


def t_evt(site: str, ponto: str, acao: str) -> str:
    return f"{NS}/{V}/{site}/{ponto}/evt/{acao}"


def t_status(site: str, ponto: str, device_id: str) -> str:
    return f"{NS}/{V}/{site}/{ponto}/dev/{device_id}/status"


def t_telemetria(site: str, ponto: str, device_id: str) -> str:
    return f"{NS}/{V}/{site}/{ponto}/dev/{device_id}/telemetria"


# ------------------------------------------------------------------ envelope
def agora() -> datetime:
    return datetime.now(timezone.utc)


def iso(momento: datetime) -> str:
    return momento.isoformat().replace("+00:00", "Z")


def ler_ts(valor: str) -> datetime:
    """Lê um ISO-8601 do servidor tolerando o sufixo Z.

    `datetime.fromisoformat` só aceita 'Z' a partir do Python 3.11; a
    troca manual mantém isto rodando no 3.9 do Raspberry Pi OS antigo.
    """
    return datetime.fromisoformat(valor.replace("Z", "+00:00"))


def envelope(**campos: Any) -> dict:
    """Os quatro campos de infraestrutura que todo payload carrega.

    v               deixa o consumidor rejeitar o que não entende
    msg_id          é com isto que duplicata de QoS 1 é descartada
    ts              gerado na ORIGEM, não na chegada
    verificacao_id  amarra quatro mensagens soltas num caso só
    """
    return {
        "v": SCHEMA,
        "msg_id": str(uuid.uuid4()),
        "ts": iso(agora()),
        **campos,
    }


# ------------------------------------------------- servidor -> Raspberry
class ErroContrato(ValueError):
    """O payload recebido não é o que o contrato promete."""


class ComandoCapturar:
    """`cmd/capturar` — o servidor pedindo uma inferência.

    Validamos aqui, na entrada, em vez de espalhar `.get()` com valor
    padrão pelo código. Um comando malformado deve morrer num ponto só,
    com mensagem clara, e não virar uma lista vazia de EPIs exigidos que
    aprova todo mundo.
    """

    __slots__ = ("verificacao_id", "epis_exigidos", "frames", "expira_em")

    def __init__(self, payload: dict) -> None:
        if payload.get("v") != SCHEMA:
            raise ErroContrato(f"schema não suportado: {payload.get('v')!r}")

        try:
            self.verificacao_id: str = str(payload["verificacao_id"])
            exigidos = payload["epis_exigidos"]
            self.expira_em: datetime = ler_ts(payload["expira_em"])
        except KeyError as exc:
            raise ErroContrato(f"campo obrigatório ausente: {exc}") from exc
        except (TypeError, ValueError) as exc:
            raise ErroContrato(f"campo malformado: {exc}") from exc

        if not isinstance(exigidos, list) or not exigidos:
            raise ErroContrato("epis_exigidos vazio ou não é lista")
        if not all(isinstance(e, str) for e in exigidos):
            raise ErroContrato("epis_exigidos contém item que não é string")

        self.epis_exigidos: list[str] = list(exigidos)
        self.frames: int = int(payload.get("frames", 5))

    @property
    def prazo_s(self) -> float:
        """Segundos que ainda restam. Negativo se já venceu."""
        return (self.expira_em - agora()).total_seconds()

    def __repr__(self) -> str:
        return (
            f"ComandoCapturar({self.verificacao_id[:8]}…, "
            f"exige={self.epis_exigidos}, frames={self.frames})"
        )


# ------------------------------------------------- Raspberry -> servidor
def evt_resultado(
    *,
    verificacao_id: str,
    versao_modelo: str,
    latencia_ms: int,
    frames_analisados: int,
    deteccoes: list[dict],
    evidencia_id: str | None = None,
) -> dict:
    """Monta o payload de `evt/resultado`.

    Note o que NÃO existe aqui: um campo `aprovado`. A borda relata
    percepção; quem decide conformidade é o servidor, com a política do
    ponto de acesso na mão. Se este payload trouxesse a decisão, mudar a
    regra exigiria atualizar firmware em campo.
    """
    return envelope(
        verificacao_id=verificacao_id,
        versao_modelo=versao_modelo,
        latencia_ms=int(latencia_ms),
        frames_analisados=int(frames_analisados),
        deteccoes=deteccoes,
        evidencia_id=evidencia_id,
    )


def item_deteccao(
    *,
    epi: str,
    presente: bool,
    confianca: float,
    frames_confirmados: int | None = None,
    bbox: list[int] | None = None,
) -> dict:
    """Um EPI observado. `bbox` é [x, y, largura, altura] em pixels."""
    return {
        "epi": epi,
        "presente": bool(presente),
        # O servidor valida 0.0 <= confianca <= 1.0 e recusa o payload
        # inteiro fora disso. Grampeamos aqui para um NMS mal calibrado
        # não derrubar a verificação toda por causa de um 1.0000001.
        "confianca": round(min(1.0, max(0.0, float(confianca))), 4),
        "frames_confirmados": frames_confirmados,
        "bbox": bbox,
    }


def payload_status(online: bool, **extras: Any) -> dict:
    """Publicado com retain=True; é também o corpo do LWT.

    Quando offline, não mandamos os extras: firmware e versão de modelo
    de um dispositivo morto são informação velha se passarem por cima do
    que o servidor já tinha.
    """
    if not online:
        return {"online": False}
    return {"online": True, **{k: v for k, v in extras.items() if v is not None}}
