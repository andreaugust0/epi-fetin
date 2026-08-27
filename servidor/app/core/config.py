"""Configuração central da aplicação, lida do ambiente."""
from __future__ import annotations

import ssl
from functools import lru_cache

from pydantic import Field, computed_field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

#: Valor que vem no .env.example. Se chegar aqui, a pessoa copiou o arquivo
#: e não trocou o segredo.
_SEGREDO_PLACEHOLDER = "troque-isto-por-um-segredo-de-pelo-menos-32-caracteres"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # ---------------------------------------------------------------- app
    APP_NAME: str = "EPI Guard API"
    ENV: str = "dev"
    DEBUG: bool = True
    TZ_EXIBICAO: str = "America/Sao_Paulo"

    # ---------------------------------------------------------------- auth
    JWT_SECRET: str = Field(min_length=32)
    JWT_ALG: str = "HS256"
    JWT_EXPIRA_MIN: int = 60 * 8
    JWT_DISPOSITIVO_EXPIRA_DIAS: int = 365

    @field_validator("JWT_SECRET")
    @classmethod
    def _segredo_foi_trocado(cls, val: str) -> str:
        """Recusa o placeholder do .env.example.

        Sem esta checagem o app subiria normalmente com um segredo que está
        publicado no repositório — e qualquer pessoa poderia forjar um token
        de administrador. Falhar na largada é muito melhor do que rodar
        parecendo seguro.
        """
        if val.strip() == _SEGREDO_PLACEHOLDER:
            raise ValueError(
                "JWT_SECRET ainda está com o valor de exemplo. Gere um "
                "segredo real:\n"
                '  python -c "import secrets; print(secrets.token_urlsafe(48))"\n'
                "e cole o resultado no seu arquivo .env."
            )
        return val

    # ---------------------------------------------------------------- banco
    DB_HOST: str = "localhost"
    DB_PORT: int = 5432
    DB_NAME: str = "epi"
    DB_USER: str = "postgres"
    DB_PASS: str = "postgres"
    DB_ECHO: bool = False

    @computed_field
    @property
    def DATABASE_URL(self) -> str:
        return (
            f"postgresql+asyncpg://{self.DB_USER}:{self.DB_PASS}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )

    # ---------------------------------------------------------------- mqtt
    MQTT_HOST: str = "localhost"
    MQTT_PORT: int = 1883
    MQTT_USER: str | None = None
    MQTT_PASS: str | None = None
    MQTT_TLS: bool = False
    MQTT_CA_CERT: str | None = None
    MQTT_CLIENT_ID_API: str = "backend-api"
    MQTT_CLIENT_ID_WORKER: str = "backend-worker"
    MQTT_NAMESPACE: str = "epi"
    MQTT_VERSAO: int = 1

    def tls_context(self) -> ssl.SSLContext | None:
        """Contexto TLS para o cliente MQTT, ou None em desenvolvimento."""
        if not self.MQTT_TLS:
            return None
        ctx = ssl.create_default_context(cafile=self.MQTT_CA_CERT)
        ctx.check_hostname = True
        ctx.verify_mode = ssl.CERT_REQUIRED
        return ctx

    # ---------------------------------------------------------------- biometria
    # Dimensão do embedding. FaceNet clássico = 128; InceptionResnetV1
    # (facenet-pytorch) e Facenet512 = 512. Precisa bater com o modelo
    # que roda no tablet, senão a busca vetorial não faz sentido.
    FACE_EMBEDDING_DIM: int = 512
    FACE_MODELO: str = "facenet512-v1"

    # Distância de cosseno máxima para aceitar uma identificação.
    # ATENÇÃO: este número precisa ser calibrado com a SUA base (curva ROC /
    # EER). O valor abaixo é ponto de partida, não verdade científica.
    FACE_DISTANCIA_MAX: float = 0.40

    # Teste de razão: o melhor candidato precisa ser this% melhor que o
    # segundo colocado. Evita identificar pessoas parecidas com confiança
    # indevida (irmãos, gêmeos, base pequena).
    FACE_RAZAO_MIN: float = 1.15

    # Quantos vizinhos buscar no pgvector antes de aplicar as regras.
    FACE_TOP_K: int = 5

    # Janela de validade do token de identificação (segundos).
    IDENTIFICACAO_TTL_S: int = 60

    # ---------------------------------------------------------------- fluxo
    VERIFICACAO_TIMEOUT_S: int = 10
    VERIFICACAO_FRAMES: int = 5
    CATRACA_DURACAO_MS: int = 5000
    LIBERACAO_TTL_S: int = 10

    # ---------------------------------------------------------------- storage
    S3_ENDPOINT: str = "http://localhost:9000"
    S3_BUCKET: str = "evidencias"
    S3_ACCESS_KEY: str = "minioadmin"
    S3_SECRET_KEY: str = "minioadmin"
    EVIDENCIA_RETENCAO_DIAS: int = 90


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
