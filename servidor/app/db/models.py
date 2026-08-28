"""Modelo de dados (SQLAlchemy 2.0, estilo declarativo tipado)."""
from __future__ import annotations

import enum
import uuid
from datetime import date, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.core.config import settings


class Base(DeclarativeBase):
    pass


# --------------------------------------------------------------------- enums
class StatusVerificacao(str, enum.Enum):
    AGUARDANDO_ANALISE = "AGUARDANDO_ANALISE"
    APROVADA = "APROVADA"
    REPROVADA = "REPROVADA"
    EXPIRADA = "EXPIRADA"
    ERRO = "ERRO"


class TipoEventoAcesso(str, enum.Enum):
    LIBERADO = "LIBERADO"
    PASSOU = "PASSOU"
    NEGADO = "NEGADO"
    TIMEOUT_SEM_PASSAGEM = "TIMEOUT_SEM_PASSAGEM"
    FALHA_RELE = "FALHA_RELE"
    LIBERACAO_MANUAL = "LIBERACAO_MANUAL"


class TipoDispositivo(str, enum.Enum):
    RASPBERRY = "RASPBERRY"
    ESP32 = "ESP32"
    TABLET = "TABLET"


class ResultadoIdentificacao(str, enum.Enum):
    IDENTIFICADO = "IDENTIFICADO"
    NAO_IDENTIFICADO = "NAO_IDENTIFICADO"
    AMBIGUO = "AMBIGUO"
    SEM_CONSENTIMENTO = "SEM_CONSENTIMENTO"


def _ts() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now())


# ------------------------------------------------------------------ locais
class Site(Base):
    __tablename__ = "sites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    codigo: Mapped[str] = mapped_column(String(40), unique=True)
    nome: Mapped[str] = mapped_column(Text)
    fuso: Mapped[str] = mapped_column(String(60), default="America/Sao_Paulo")

    pontos: Mapped[list["PontoAcesso"]] = relationship(back_populates="site")


class PontoAcesso(Base):
    __tablename__ = "pontos_acesso"
    __table_args__ = (UniqueConstraint("site_id", "codigo"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id"))
    codigo: Mapped[str] = mapped_column(String(40))  # entra no tópico MQTT
    nome: Mapped[str] = mapped_column(Text)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)

    site: Mapped[Site] = relationship(back_populates="pontos")
    epis_exigidos: Mapped[list["EpiExigido"]] = relationship(
        back_populates="ponto", cascade="all, delete-orphan"
    )
    dispositivos: Mapped[list["Dispositivo"]] = relationship(back_populates="ponto")


class TipoEpi(Base):
    __tablename__ = "tipos_epi"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    codigo: Mapped[str] = mapped_column(String(40), unique=True)
    rotulo: Mapped[str] = mapped_column(Text)
    classe_modelo: Mapped[str] = mapped_column(String(60))  # classe na saída da IA


class EpiExigido(Base):
    """Política de conformidade: o que cada ponto exige.

    É esta tabela que o servidor consulta para decidir. Trocar a exigência
    de um ponto é um UPDATE — nenhum dispositivo é reprogramado.
    """

    __tablename__ = "epi_exigido"

    ponto_id: Mapped[int] = mapped_column(
        ForeignKey("pontos_acesso.id", ondelete="CASCADE"), primary_key=True
    )
    tipo_epi_id: Mapped[int] = mapped_column(
        ForeignKey("tipos_epi.id"), primary_key=True
    )

    ponto: Mapped[PontoAcesso] = relationship(back_populates="epis_exigidos")
    tipo_epi: Mapped[TipoEpi] = relationship(lazy="joined")


# ------------------------------------------------------------------ pessoas
class Pessoa(Base):
    __tablename__ = "pessoas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Opcional: nem toda operação tem matrícula. Continua UNIQUE — no
    # Postgres, UNIQUE permite vários NULL, então a restrição só vale para
    # quem de fato tem uma.
    matricula: Mapped[str | None] = mapped_column(
        String(40), unique=True, nullable=True
    )
    nome: Mapped[str] = mapped_column(Text)
    funcao: Mapped[str | None] = mapped_column(Text, nullable=True)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    criado_em: Mapped[datetime] = _ts()

    biometrias: Mapped[list["Biometria"]] = relationship(
        back_populates="pessoa", cascade="all, delete-orphan"
    )
    consentimentos: Mapped[list["ConsentimentoBiometrico"]] = relationship(
        back_populates="pessoa", cascade="all, delete-orphan"
    )


class ConsentimentoBiometrico(Base):
    """LGPD art. 11: biometria é dado pessoal SENSÍVEL.

    Exige consentimento específico e destacado, com finalidade declarada e
    possibilidade real de revogação. Sem um registro válido aqui, o serviço
    de biometria se recusa a cadastrar ou comparar o rosto da pessoa.
    """

    __tablename__ = "consentimentos_biometricos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pessoa_id: Mapped[int] = mapped_column(
        ForeignKey("pessoas.id", ondelete="CASCADE"), index=True
    )
    versao_termo: Mapped[str] = mapped_column(String(20))
    finalidade: Mapped[str] = mapped_column(Text)
    concedido_em: Mapped[datetime] = _ts()
    revogado_em: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # trilha de quem colheu o consentimento
    coletado_por_id: Mapped[int | None] = mapped_column(
        ForeignKey("usuarios_admin.id"), nullable=True
    )

    pessoa: Mapped[Pessoa] = relationship(back_populates="consentimentos")

    @property
    def vigente(self) -> bool:
        return self.revogado_em is None


class Biometria(Base):
    """Um embedding facial cadastrado (enrollment).

    Guardamos VÁRIOS por pessoa (3 a 5 capturas em ângulos e iluminações
    diferentes) porque isso melhora bastante o recall sem afrouxar o limiar.

    Não guardamos a foto: o embedding basta para comparar e é menos
    reversível que a imagem original — princípio da minimização.
    """

    __tablename__ = "biometrias"
    __table_args__ = (
        Index(
            "ix_biometrias_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
        Index("ix_biometrias_pessoa", "pessoa_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pessoa_id: Mapped[int] = mapped_column(
        ForeignKey("pessoas.id", ondelete="CASCADE")
    )
    # O vetor JÁ CHEGA normalizado (norma L2 = 1). Ver services/biometria.py.
    embedding: Mapped[list[float]] = mapped_column(
        Vector(settings.FACE_EMBEDDING_DIM)
    )
    # Embeddings de modelos diferentes são incomparáveis. Sem este campo,
    # trocar o modelo corrompe silenciosamente todas as comparações.
    modelo: Mapped[str] = mapped_column(String(60))
    qualidade: Mapped[float | None] = mapped_column(Float, nullable=True)
    criada_em: Mapped[datetime] = _ts()

    pessoa: Mapped[Pessoa] = relationship(back_populates="biometrias")


class Identificacao(Base):
    """Cada tentativa de identificação facial, para auditoria e para servir
    de token de curta duração entre /identificacao e /verificacoes.

    NÃO guardamos o embedding consultado — só o resultado. Guardar a
    consulta transformaria esta tabela num histórico biométrico de
    movimentação, que é exatamente o que a minimização pede para evitar.
    """

    __tablename__ = "identificacoes"
    __table_args__ = (Index("ix_ident_criada", "criada_em"),)

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    ponto_id: Mapped[int] = mapped_column(ForeignKey("pontos_acesso.id"))
    pessoa_id: Mapped[int | None] = mapped_column(
        ForeignKey("pessoas.id"), nullable=True
    )
    resultado: Mapped[ResultadoIdentificacao] = mapped_column(
        Enum(ResultadoIdentificacao, name="resultado_identificacao")
    )
    distancia: Mapped[float | None] = mapped_column(Float, nullable=True)
    razao_2o_lugar: Mapped[float | None] = mapped_column(Float, nullable=True)
    modelo: Mapped[str] = mapped_column(String(60))
    criada_em: Mapped[datetime] = _ts()
    expira_em: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    consumida_em: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    pessoa: Mapped[Pessoa | None] = relationship(lazy="joined")


# -------------------------------------------------------------- dispositivos
class Dispositivo(Base):
    __tablename__ = "dispositivos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ponto_id: Mapped[int] = mapped_column(ForeignKey("pontos_acesso.id"))
    tipo: Mapped[TipoDispositivo] = mapped_column(
        Enum(TipoDispositivo, name="tipo_dispositivo")
    )
    client_id_mqtt: Mapped[str] = mapped_column(String(80), unique=True)
    online: Mapped[bool] = mapped_column(Boolean, default=False)
    visto_em: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    firmware: Mapped[str | None] = mapped_column(String(40), nullable=True)
    versao_modelo: Mapped[str | None] = mapped_column(String(60), nullable=True)

    ponto: Mapped[PontoAcesso] = relationship(back_populates="dispositivos")


# ------------------------------------------------------------- verificações
class Verificacao(Base):
    __tablename__ = "verificacoes"
    __table_args__ = (
        Index("ix_verif_ponto_data", "ponto_id", "iniciada_em"),
        Index("ix_verif_pessoa_data", "pessoa_id", "iniciada_em"),
        Index(
            "ix_verif_reprovadas",
            "iniciada_em",
            postgresql_where=(
                "status = 'REPROVADA'"  # índice parcial: relatório de não conformidade
            ),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    ponto_id: Mapped[int] = mapped_column(ForeignKey("pontos_acesso.id"))
    pessoa_id: Mapped[int | None] = mapped_column(
        ForeignKey("pessoas.id"), nullable=True
    )
    identificacao_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("identificacoes.id"), nullable=True
    )
    status: Mapped[StatusVerificacao] = mapped_column(
        Enum(StatusVerificacao, name="status_verificacao"),
        default=StatusVerificacao.AGUARDANDO_ANALISE,
    )
    iniciada_em: Mapped[datetime] = _ts()
    concluida_em: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    expira_em: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    latencia_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    versao_modelo: Mapped[str | None] = mapped_column(String(60), nullable=True)
    motivo_falha: Mapped[str | None] = mapped_column(Text, nullable=True)

    pessoa: Mapped[Pessoa | None] = relationship(lazy="joined")
    ponto: Mapped[PontoAcesso] = relationship(lazy="joined")
    deteccoes: Mapped[list["Deteccao"]] = relationship(
        back_populates="verificacao", cascade="all, delete-orphan", lazy="selectin"
    )
    evidencias: Mapped[list["Evidencia"]] = relationship(
        back_populates="verificacao", cascade="all, delete-orphan", lazy="selectin"
    )
    eventos: Mapped[list["EventoAcesso"]] = relationship(
        back_populates="verificacao", cascade="all, delete-orphan", lazy="selectin"
    )


class Deteccao(Base):
    __tablename__ = "deteccoes"
    __table_args__ = (Index("ix_det_verif", "verificacao_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    verificacao_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("verificacoes.id", ondelete="CASCADE")
    )
    tipo_epi_id: Mapped[int] = mapped_column(ForeignKey("tipos_epi.id"))
    presente: Mapped[bool] = mapped_column(Boolean)
    confianca: Mapped[float] = mapped_column(Numeric(4, 3))
    frames_confirmados: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    bbox: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    verificacao: Mapped[Verificacao] = relationship(back_populates="deteccoes")
    tipo_epi: Mapped[TipoEpi] = relationship(lazy="joined")


class Evidencia(Base):
    __tablename__ = "evidencias"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    verificacao_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("verificacoes.id", ondelete="CASCADE")
    )
    storage_key: Mapped[str] = mapped_column(Text)
    sha256: Mapped[str] = mapped_column(String(64))
    bytes: Mapped[int] = mapped_column(Integer)
    rosto_borrado: Mapped[bool] = mapped_column(Boolean, default=True)
    criada_em: Mapped[datetime] = _ts()
    expira_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

    verificacao: Mapped[Verificacao] = relationship(back_populates="evidencias")


class EventoAcesso(Base):
    __tablename__ = "eventos_acesso"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    verificacao_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("verificacoes.id", ondelete="CASCADE")
    )
    evento: Mapped[TipoEventoAcesso] = mapped_column(
        Enum(TipoEventoAcesso, name="tipo_evento_acesso")
    )
    ocorrido_em: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    autor_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("usuarios_admin.id"), nullable=True
    )
    justificativa: Mapped[str | None] = mapped_column(Text, nullable=True)

    verificacao: Mapped[Verificacao] = relationship(back_populates="eventos")


# ---------------------------------------------------------------- admin
class UsuarioAdmin(Base):
    __tablename__ = "usuarios_admin"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(160), unique=True)
    nome: Mapped[str] = mapped_column(Text)
    senha_hash: Mapped[str] = mapped_column(Text)
    papel: Mapped[str] = mapped_column(String(20), default="operador")
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    criado_em: Mapped[datetime] = _ts()


class MensagemProcessada(Base):
    """Deduplicação de mensagens MQTT.

    QoS 1 é at-least-once: a mesma mensagem PODE chegar duas vezes. Sem esta
    tabela, uma reentrega grava a verificação em dobro e libera a catraca
    duas vezes.
    """

    __tablename__ = "mensagens_processadas"

    msg_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    topico: Mapped[str] = mapped_column(Text)
    processada_em: Mapped[datetime] = _ts()


class LogAuditoria(Base):
    __tablename__ = "log_auditoria"
    __table_args__ = (
        Index("ix_audit_data", "ocorrido_em"),
        CheckConstraint("length(acao) > 0", name="ck_audit_acao"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ator_id: Mapped[int | None] = mapped_column(
        ForeignKey("usuarios_admin.id"), nullable=True
    )
    acao: Mapped[str] = mapped_column(String(60))
    entidade: Mapped[str] = mapped_column(String(60))
    entidade_id: Mapped[str | None] = mapped_column(String(60), nullable=True)
    detalhe: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    ocorrido_em: Mapped[datetime] = _ts()
