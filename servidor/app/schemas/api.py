"""DTOs da API REST."""
from __future__ import annotations

import uuid
from datetime import date, datetime

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
    # A descrição vai no Field, não em comentário: ela viaja no OpenAPI, e
    # é de lá que o painel gera os tipos e o Swagger monta a documentação.
    # Um comentário `#:` fica bonito no arquivo e não chega em quem consome.
    aceito: bool = Field(
        description=(
            "A borda viu o equipamento E com confiança suficiente "
            "(`presente` e `confianca >= EPI_CONFIANCA_MIN`). É este campo, "
            "não `presente`, que corresponde ao que a catraca considerou. "
            "Os dois ficam separados para distinguir 'não estava usando' de "
            "'o modelo viu e não teve certeza'."
        )
    )


class RostoCadastradoOut(BaseModel):
    """Resultado de um cadastro biométrico feito a partir de uma foto.

    Devolve bem mais que "ok": devolve o que foi MEDIDO. Quem cadastra
    precisa poder ver o recorte que virou o vetor e a distância para os
    vetores que já existiam — sem isso, um cadastro errado só apareceria
    semanas depois, como uma pessoa que a catraca nunca reconhece.
    """

    biometria_id: int
    modelo: str
    qualidade: float = Field(description="Confiança do detector de rosto, 0 a 1.")
    caixa_rosto: dict[str, int] = Field(
        description="Onde o rosto foi encontrado na foto original, em pixels."
    )
    caixa_recorte: dict[str, int] = Field(
        description="O quadrado efetivamente recortado e redimensionado para 160x160."
    )
    recorte_base64: str = Field(
        description=(
            "PNG 160x160 do recorte, em base64. É o que o modelo realmente "
            "viu — a única forma de alguém perceber que o detector pegou a "
            "pessoa errada ou um pedaço do fundo."
        )
    )
    distancia_menor: float | None = Field(
        default=None,
        description=(
            "Menor distância de cosseno entre este vetor e os que a pessoa "
            "já tinha. Serve de medida de compatibilidade entre o cadastro "
            "pelo painel e o que o tablet gerou: perto de zero é o mesmo "
            "rosto no mesmo espaço; alto demais indica que os dois caminhos "
            "não estão produzindo vetores comparáveis."
        ),
    )
    compativel: bool | None = Field(
        default=None,
        description=(
            "Falso quando `distancia_menor` passou de FACE_DISTANCIA_ALERTA. "
            "Nulo quando esta é a primeira biometria da pessoa e não há com "
            "o que comparar."
        ),
    )
    quase_identica: bool = Field(
        default=False,
        description=(
            "A foto é praticamente igual a uma já cadastrada. Não é erro — "
            "foi gravada — mas não acrescenta variação, e é variação que "
            "melhora o reconhecimento."
        ),
    )
    total_biometrias: int = Field(
        description="Quantos embeddings a pessoa tem depois deste cadastro."
    )


class PoliticaOut(BaseModel):
    """Os limiares que decidem, para quem precisa explicar uma decisão.

    Somente leitura. Estes números mudam no `.env` e reiniciando o
    serviço — não pela web.
    """

    epi_confianca_min: float = Field(
        description=(
            "Confiança mínima para o servidor ACEITAR um EPI como presente. "
            "Abaixo disto a catraca não abre e a reprovação é registrada "
            "como 'não consegui confirmar', não como 'EPI ausente'."
        )
    )
    verificacao_frames: int = Field(
        description="Quantos frames a borda deve inferir por verificação."
    )
    verificacao_timeout_s: int = Field(
        description="Prazo para a borda responder antes de a verificação expirar."
    )
    identificacao_ttl_s: int = Field(
        description=(
            "Por quanto tempo uma identificação facial continua valendo — é "
            "a janela em que dá para repetir a checagem de EPI sem repetir o "
            "reconhecimento."
        )
    )
    face_distancia_max: float = Field(
        description="Distância de cosseno máxima para aceitar uma identificação."
    )
    catraca_duracao_ms: int = Field(description="Tempo que a catraca fica liberada.")


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
    site_codigo: str = ""
    epis_exigidos: list[str] = []


class PontoIn(BaseModel):
    site_id: int
    codigo: str = Field(min_length=1, max_length=40)
    nome: str = Field(min_length=1)
    ativo: bool = True


class PontoPatch(BaseModel):
    nome: str | None = None
    ativo: bool | None = None


class EpisExigidosIn(BaseModel):
    """Lista COMPLETA de códigos exigidos; substitui a anterior."""

    codigos: list[str] = Field(min_length=0, max_length=30)


class TipoEpiOut(ORMModel):
    id: int
    codigo: str
    rotulo: str
    classe_modelo: str


class TipoEpiIn(BaseModel):
    codigo: str = Field(min_length=1, max_length=40,
                        description="o que trafega no MQTT; precisa bater com "
                                    "o identificador usado no app e na borda")
    rotulo: str = Field(min_length=1)
    classe_modelo: str = Field(min_length=1, max_length=60,
                               description="nome da classe na saída do modelo")


# ------------------------------------------------------------------ pessoas
class PessoaIn(BaseModel):
    nome: str = Field(min_length=1)
    funcao: str | None = None
    setor: str | None = None
    admitido_em: date | None = None
    #: Número de registro do empregado ("Registro", no painel).
    #: Opcional — nem toda operação usa.
    matricula: str | None = Field(default=None, max_length=40)
    ativo: bool = True


class PessoaPatch(BaseModel):
    nome: str | None = None
    funcao: str | None = None
    setor: str | None = None
    admitido_em: date | None = None
    matricula: str | None = None
    ativo: bool | None = None


class PessoaOut(BaseModel):
    id: int
    matricula: str | None
    nome: str
    funcao: str | None
    setor: str | None
    admitido_em: date | None
    ativo: bool
    biometrias: int
    consentimento_vigente: bool


class PessoaDetalhe(PessoaOut):
    criado_em: datetime
    total_verificacoes: int
    ultima_verificacao: datetime | None


class PaginaPessoas(BaseModel):
    total: int
    itens: list[PessoaOut]


class LiberacaoManualIn(BaseModel):
    verificacao_id: uuid.UUID
    justificativa: str = Field(min_length=10)
