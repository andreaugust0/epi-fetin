"""Identificação facial por busca vetorial (FaceNet + pgvector).

Desenho:

  1. O tablet roda o FaceNet e envia apenas o *embedding*. A imagem do rosto
     nunca chega ao servidor — minimização de dado sensível.
  2. O servidor busca os vizinhos mais próximos na galeria (pgvector, índice
     HNSW, distância de cosseno) e aplica duas regras antes de aceitar.
  3. O tablet NÃO informa quem é a pessoa. Ele recebe um `identificacao_id`
     de curta duração que o endpoint de verificação consome. Um tablet
     comprometido não consegue abrir verificação em nome de terceiros.

As duas regras de aceitação:

  * limiar absoluto  — a distância precisa ser <= FACE_DISTANCIA_MAX
  * teste de razão   — o melhor candidato precisa ser FACE_RAZAO_MIN vezes
                       melhor que o segundo colocado

A segunda regra é a que costuma faltar em implementação de TCC. Sem ela,
duas pessoas parecidas (irmãos, e principalmente gêmeos) são identificadas
com confiança indevida sempre que ambas estão na base.
"""
from __future__ import annotations

import logging
import math
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import (
    Biometria,
    ConsentimentoBiometrico,
    Identificacao,
    Pessoa,
    ResultadoIdentificacao,
)

log = logging.getLogger(__name__)


class ErroBiometria(Exception):
    pass


class ModeloIncompativel(ErroBiometria):
    pass


class SemConsentimento(ErroBiometria):
    pass


# --------------------------------------------------------------- utilidades
def normalizar(vetor: list[float]) -> list[float]:
    """Normaliza para norma L2 = 1.

    Com vetores unitários, a distância de cosseno vira função monotônica do
    produto interno, o índice HNSW fica bem-comportado e o limiar passa a ser
    comparável entre capturas. Normalizamos na entrada e no cadastro — nunca
    confie que o cliente fez isso.
    """
    norma = math.sqrt(sum(x * x for x in vetor))
    if norma == 0:
        raise ErroBiometria("embedding com norma zero")
    return [x / norma for x in vetor]


def validar_embedding(vetor: list[float], modelo: str) -> list[float]:
    if modelo != settings.FACE_MODELO:
        raise ModeloIncompativel(
            f"embedding gerado por '{modelo}', servidor espera "
            f"'{settings.FACE_MODELO}'. Embeddings de modelos diferentes "
            f"não são comparáveis."
        )
    if len(vetor) != settings.FACE_EMBEDDING_DIM:
        raise ErroBiometria(
            f"dimensão {len(vetor)} != {settings.FACE_EMBEDDING_DIM}"
        )
    return normalizar(vetor)


async def consentimento_vigente(
    db: AsyncSession, pessoa_id: int
) -> ConsentimentoBiometrico | None:
    stmt = (
        select(ConsentimentoBiometrico)
        .where(
            ConsentimentoBiometrico.pessoa_id == pessoa_id,
            ConsentimentoBiometrico.revogado_em.is_(None),
        )
        .order_by(ConsentimentoBiometrico.concedido_em.desc())
        .limit(1)
    )
    return (await db.execute(stmt)).scalar_one_or_none()


# ----------------------------------------------------------------- cadastro
async def cadastrar(
    db: AsyncSession, pessoa_id: int, embedding: list[float], modelo: str,
    qualidade: float | None = None,
) -> Biometria:
    """Registra um embedding de enrollment.

    Cadastre de 3 a 5 capturas por pessoa, em ângulos e iluminações
    diferentes. Melhora bastante o recall sem precisar afrouxar o limiar —
    que é o que se costuma fazer por engano, e o que dispara o falso
    positivo.
    """
    if await consentimento_vigente(db, pessoa_id) is None:
        raise SemConsentimento(
            "não há consentimento biométrico vigente para esta pessoa"
        )
    vetor = validar_embedding(embedding, modelo)
    bio = Biometria(
        pessoa_id=pessoa_id, embedding=vetor, modelo=modelo, qualidade=qualidade
    )
    db.add(bio)
    await db.flush()
    return bio


async def revogar_consentimento(db: AsyncSession, pessoa_id: int) -> int:
    """Revogação real: apaga os embeddings, não só marca uma flag.

    A LGPD garante eliminação do dado após revogação do consentimento
    (art. 18). Manter o vetor "só por garantia" descumpre isso — e o vetor
    é justamente o dado sensível.
    """
    consentimento = await consentimento_vigente(db, pessoa_id)
    if consentimento is not None:
        consentimento.revogado_em = datetime.now(timezone.utc)

    biometrias = (
        await db.execute(select(Biometria).where(Biometria.pessoa_id == pessoa_id))
    ).scalars().all()
    for bio in biometrias:
        await db.delete(bio)
    await db.flush()
    log.info("biometria de pessoa %s eliminada (%d vetores)", pessoa_id, len(biometrias))
    return len(biometrias)


# ------------------------------------------------------------- identificação
class Candidato:
    __slots__ = ("pessoa_id", "nome", "distancia")

    def __init__(self, pessoa_id: int, nome: str, distancia: float) -> None:
        self.pessoa_id = pessoa_id
        self.nome = nome
        self.distancia = distancia


async def _vizinhos(
    db: AsyncSession, vetor: list[float], modelo: str, k: int
) -> list[Candidato]:
    """Top-k vizinhos por distância de cosseno, um por pessoa.

    DISTINCT ON dá o melhor vetor de cada pessoa: sem ele, as 5 capturas de
    enrollment de uma mesma pessoa ocupariam as 5 vagas do top-k e o teste
    de razão compararia a pessoa consigo mesma.
    """
    dist = Biometria.embedding.cosine_distance(vetor).label("distancia")
    sub = (
        select(Biometria.pessoa_id, dist)
        .where(Biometria.modelo == modelo)
        .order_by(Biometria.pessoa_id, dist)
        .distinct(Biometria.pessoa_id)
        .subquery()
    )
    stmt = (
        select(sub.c.pessoa_id, Pessoa.nome, sub.c.distancia)
        .join(Pessoa, Pessoa.id == sub.c.pessoa_id)
        .where(Pessoa.ativo.is_(True))
        .order_by(sub.c.distancia)
        .limit(k)
    )
    linhas = (await db.execute(stmt)).all()
    return [Candidato(pid, nome, float(d)) for pid, nome, d in linhas]


async def identificar(
    db: AsyncSession, *, ponto_id: int, embedding: list[float], modelo: str
) -> Identificacao:
    """Identifica e registra a tentativa. Sempre devolve um Identificacao.

    Mesmo quando ninguém é reconhecido, gravamos a tentativa: é o log de
    auditoria exigido pelo princípio de prestação de contas, e é o dado que
    permite medir a taxa de falsa rejeição do sistema em campo.
    """
    vetor = validar_embedding(embedding, modelo)
    candidatos = await _vizinhos(db, vetor, modelo, settings.FACE_TOP_K)

    resultado = ResultadoIdentificacao.NAO_IDENTIFICADO
    pessoa_id: int | None = None
    distancia: float | None = None
    razao: float | None = None

    if candidatos:
        melhor = candidatos[0]
        distancia = melhor.distancia

        if len(candidatos) > 1 and melhor.distancia > 0:
            razao = candidatos[1].distancia / melhor.distancia

        dentro_do_limiar = melhor.distancia <= settings.FACE_DISTANCIA_MAX
        sem_ambiguidade = razao is None or razao >= settings.FACE_RAZAO_MIN

        if dentro_do_limiar and sem_ambiguidade:
            if await consentimento_vigente(db, melhor.pessoa_id) is None:
                # A pessoa tem vetor na base mas revogou o consentimento:
                # tratamos como não identificada e sinalizamos ao operador.
                resultado = ResultadoIdentificacao.SEM_CONSENTIMENTO
            else:
                resultado = ResultadoIdentificacao.IDENTIFICADO
                pessoa_id = melhor.pessoa_id
        elif dentro_do_limiar and not sem_ambiguidade:
            resultado = ResultadoIdentificacao.AMBIGUO

    agora = datetime.now(timezone.utc)
    ident = Identificacao(
        id=uuid.uuid4(),
        ponto_id=ponto_id,
        pessoa_id=pessoa_id,
        resultado=resultado,
        distancia=distancia,
        razao_2o_lugar=razao,
        modelo=modelo,
        expira_em=agora + timedelta(seconds=settings.IDENTIFICACAO_TTL_S),
    )
    db.add(ident)
    await db.flush()
    # NOTA: o embedding consultado não é persistido em lugar nenhum.
    return ident


async def consumir(db: AsyncSession, identificacao_id: uuid.UUID) -> Identificacao:
    """Valida e queima o token de identificação (uso único)."""
    ident = await db.get(Identificacao, identificacao_id)
    if ident is None:
        raise ErroBiometria("identificação não encontrada")
    if ident.consumida_em is not None:
        raise ErroBiometria("identificação já utilizada")
    if ident.expira_em < datetime.now(timezone.utc):
        raise ErroBiometria("identificação expirada")
    if ident.resultado is not ResultadoIdentificacao.IDENTIFICADO:
        raise ErroBiometria(f"identificação inválida: {ident.resultado.value}")
    ident.consumida_em = datetime.now(timezone.utc)
    await db.flush()
    return ident
