"""Abertura e consulta de verificações."""
from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DB, Tablet, admin_atual, confere_ponto, tablet_atual
from app.db.models import StatusVerificacao, UsuarioAdmin, Verificacao
from app.schemas.api import (
    DeteccaoOut,
    PaginaVerificacoes,
    VerificacaoIn,
    VerificacaoOut,
)
from app.services import biometria as svc_bio
from app.services import verificacao as svc

router = APIRouter(tags=["verificações"])


def _serializar(v: Verificacao) -> VerificacaoOut:
    return VerificacaoOut(
        id=v.id,
        ponto_id=v.ponto_id,
        status=v.status.value,
        pessoa_id=v.pessoa_id,
        pessoa_nome=v.pessoa.nome if v.pessoa else None,
        iniciada_em=v.iniciada_em,
        concluida_em=v.concluida_em,
        expira_em=v.expira_em,
        latencia_ms=v.latencia_ms,
        versao_modelo=v.versao_modelo,
        motivo_falha=v.motivo_falha,
        deteccoes=[
            DeteccaoOut(
                epi=d.tipo_epi.codigo,
                rotulo=d.tipo_epi.rotulo,
                presente=d.presente,
                confianca=float(d.confianca),
                frames_confirmados=d.frames_confirmados,
            )
            for d in v.deteccoes
        ],
    )


@router.post(
    "/verificacoes",
    response_model=VerificacaoOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def abrir_verificacao(
    dados: VerificacaoIn,
    response: Response,
    tablet: Tablet = Depends(tablet_atual),
    db: AsyncSession = DB,
) -> VerificacaoOut:
    """202, não 200 — e isso é decisão de projeto, não detalhe.

    A verificação ainda não terminou: ela depende de uma resposta assíncrona
    vinda da borda. O tablet recebe o id e aguarda o desfecho no WebSocket.
    Fazer este endpoint bloquear até a Raspberry responder acoplaria um
    request HTTP à latência da inferência e derrubaria tudo quando a Pi
    travasse.
    """
    confere_ponto(tablet, dados.ponto_id)

    ident = None
    if dados.identificacao_id is not None:
        try:
            ident = await svc_bio.consumir(db, dados.identificacao_id)
        except svc_bio.ErroBiometria as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
        if ident.ponto_id != dados.ponto_id:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "identificação foi feita em outro ponto de acesso",
            )

    try:
        verif = await svc.abrir(db, ponto_id=dados.ponto_id, identificacao=ident)
    except svc.PontoIndisponivel as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except svc.ErroVerificacao as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    await db.commit()
    await db.refresh(verif)
    response.headers["Location"] = f"/api/v1/verificacoes/{verif.id}"
    return _serializar(verif)


@router.get("/verificacoes/{verificacao_id}", response_model=VerificacaoOut)
async def obter(verificacao_id: uuid.UUID, db: AsyncSession = DB) -> VerificacaoOut:
    verif = await db.get(Verificacao, verificacao_id)
    if verif is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "verificação não encontrada")
    return _serializar(verif)


@router.get("/verificacoes", response_model=PaginaVerificacoes)
async def listar(
    ponto_id: int | None = None,
    pessoa_id: int | None = None,
    situacao: StatusVerificacao | None = None,
    desde: datetime | None = None,
    ate: datetime | None = None,
    limite: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> PaginaVerificacoes:
    filtros = []
    if ponto_id is not None:
        filtros.append(Verificacao.ponto_id == ponto_id)
    if pessoa_id is not None:
        filtros.append(Verificacao.pessoa_id == pessoa_id)
    if situacao is not None:
        filtros.append(Verificacao.status == situacao)
    if desde is not None:
        filtros.append(Verificacao.iniciada_em >= desde)
    if ate is not None:
        filtros.append(Verificacao.iniciada_em <= ate)

    total = (
        await db.execute(select(func.count(Verificacao.id)).where(*filtros))
    ).scalar_one()

    stmt = (
        select(Verificacao)
        .where(*filtros)
        .order_by(Verificacao.iniciada_em.desc())
        .limit(limite)
        .offset(offset)
    )
    itens = list((await db.execute(stmt)).scalars().unique().all())
    return PaginaVerificacoes(total=total, itens=[_serializar(v) for v in itens])
