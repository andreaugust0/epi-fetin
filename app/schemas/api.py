"""DTOs da API REST."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.core.config import settings


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------- auth
class LoginIn(BaseModel):
    email: EmailStr
    senha: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expira_em: datetime


# ----------------------------------------------------------- identificação
class IdentificacaoIn(BaseModel):
    """O tablet envia APENAS o vetor. A imagem do rosto não sai do tablet."""

    ponto_id: int
    modelo: str = Field(
        description="Identificador do modelo que gerou o embedding. "
        "Embeddings de modelos diferentes não são comparáveis."
    )
    embedding: list[float] = Field(
        min_length=64,
        max_length=2048,
        description=f"Vetor FaceNet. Dimensão esperada: "
        f"{settings.FACE_EMBEDDING_DIM}.",
    )


class IdentificacaoOut(BaseModel):
    identificacao_id: uuid.UUID | None
    resultado: str
    pessoa_id: int | None = None
    nome: str | None = None
    # `distancia` só volta em ambiente de desenvolvimento: em produção é
    # informação que ajuda um atacante a calibrar tentativas contra o limiar.
    distancia: float | None = None
    expira_em: datetime | None = None


class BiometriaIn(BaseModel):
    modelo: str
    embedding: list[float] = Field(min_length=64, max_length=2048)
    qualidade: float | None = Field(default=None, ge=0.0, le=1.0)


class ConsentimentoIn(BaseModel):
    versao_termo: str
    finalidade: str = (
        "Identificação do trabalhador para verificação de uso de EPI no "
        "controle de acesso."
    )


# ----------------------------------------------------------- verificações
class VerificacaoIn(BaseModel):
    """O tablet NÃO informa pessoa_id.

    Ele apresenta o token devolvido por /identificacao; o servidor resolve a
    pessoa a partir dele. Um tablet comprometido não consegue abrir
    verificação em nome de terceiros.
    """

    ponto_id: int
    identificacao_id: uuid.UUID | None = None


class DeteccaoOut(ORMModel):
    epi: str
    rotulo: str
    presente: bool
    confianca: float
    frames_confirmados: int | None


class VerificacaoOut(BaseModel):
    id: uuid.UUID
    ponto_id: int
    status: str
    pessoa_id: int | None
    pessoa_nome: str | None
    iniciada_em: datetime
    concluida_em: datetime | None
    expira_em: datetime
    latencia_ms: int | None
    versao_modelo: str | None
    motivo_falha: str | None
    deteccoes: list[DeteccaoOut] = []


class PaginaVerificacoes(BaseModel):
    total: int
    itens: list[VerificacaoOut]


# ------------------------------------------------------------- evidências
class EvidenciaOut(BaseModel):
    evidencia_id: str
    expira_em: datetime


# ------------------------------------------------------------ dispositivos
class DispositivoOut(ORMModel):
    id: int
    ponto_id: int
    tipo: str
    client_id_mqtt: str
    online: bool
    visto_em: datetime | None
    firmware: str | None
    versao_modelo: str | None


# ------------------------------------------------------------------ pontos
class PontoOut(ORMModel):
    id: int
    codigo: str
    nome: str
    ativo: bool
    epis_exigidos: list[str] = []


class LiberacaoManualIn(BaseModel):
    verificacao_id: uuid.UUID
    justificativa: str = Field(min_length=10)
