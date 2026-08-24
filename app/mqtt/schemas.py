"""Contratos de payload MQTT (pydantic).

Todo payload carrega quatro campos de infraestrutura antes dos de negócio:

    v               versão do schema — deixa o consumidor rejeitar o que não entende
    msg_id          UUID da mensagem — é com isso que duplicata de QoS 1 é descartada
    ts              ISO-8601 UTC gerado na origem
    verificacao_id  correlação — amarra quatro mensagens soltas em um caso
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


def agora() -> datetime:
    return datetime.now(timezone.utc)


class Envelope(BaseModel):
    model_config = ConfigDict(extra="ignore")  # tolerante a campos novos

    v: int = 1
    msg_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    ts: datetime = Field(default_factory=agora)

    @field_validator("v")
    @classmethod
    def _versao_suportada(cls, val: int) -> int:
        if val != 1:
            raise ValueError(f"versão de schema não suportada: {val}")
        return val


# --------------------------------------------------------- servidor -> borda
class CapturarCmd(Envelope):
    verificacao_id: uuid.UUID
    epis_exigidos: list[str]
    frames: int = 5
    expira_em: datetime


class LiberarCmd(Envelope):
    verificacao_id: uuid.UUID
    acao: Literal["LIBERAR"] = "LIBERAR"
    duracao_ms: int = 5000
    expira_em: datetime


# --------------------------------------------------------- borda -> servidor
class DeteccaoItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    epi: str
    presente: bool
    confianca: float = Field(ge=0.0, le=1.0)
    frames_confirmados: int | None = None
    bbox: list[int] | None = None


class ResultadoEvt(Envelope):
    """Note o que NÃO existe aqui: um campo `aprovado`.

    A Raspberry relata percepção; quem decide conformidade é o servidor.
    """

    verificacao_id: uuid.UUID
    versao_modelo: str
    latencia_ms: int
    frames_analisados: int
    deteccoes: list[DeteccaoItem]
    evidencia_id: str | None = None


class PassagemEvt(Envelope):
    verificacao_id: uuid.UUID
    evento: Literal[
        "LIBERADO", "PASSOU", "TIMEOUT_SEM_PASSAGEM", "FALHA_RELE"
    ]


class StatusEvt(BaseModel):
    """Publicado com retain=True; também é o payload do LWT."""

    model_config = ConfigDict(extra="ignore")

    online: bool
    motivo: str | None = None
    fw: str | None = None
    modelo: str | None = None
