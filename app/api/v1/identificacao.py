"""Identificação facial — consumido pelo tablet.

O tablet roda o FaceNet localmente e manda só o embedding. A foto do rosto
nunca chega ao servidor, e o embedding consultado não é persistido: só o
resultado da comparação entra no log de auditoria.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DB, Tablet, admin_atual, confere_ponto, tablet_atual
from app.core.config import settings
from app.db.models import Pessoa, ResultadoIdentificacao, UsuarioAdmin
from app.schemas.api import (
    BiometriaIn,
    ConsentimentoIn,
    IdentificacaoIn,
    IdentificacaoOut,
)
from app.services import biometria as svc

log = logging.getLogger(__name__)
router = APIRouter(tags=["identificação"])


@router.post("/identificacao", response_model=IdentificacaoOut)
async def identificar(
    dados: IdentificacaoIn,
    tablet: Tablet = Depends(tablet_atual),
    db: AsyncSession = DB,
) -> IdentificacaoOut:
    confere_ponto(tablet, dados.ponto_id)
    try:
        ident = await svc.identificar(
            db,
            ponto_id=dados.ponto_id,
            embedding=dados.embedding,
            modelo=dados.modelo,
        )
    except svc.ModeloIncompativel as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except svc.ErroBiometria as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    await db.commit()

    identificado = ident.resultado is ResultadoIdentificacao.IDENTIFICADO
    return IdentificacaoOut(
        identificacao_id=ident.id if identificado else None,
        resultado=ident.resultado.value,
        pessoa_id=ident.pessoa_id,
        nome=ident.pessoa.nome if ident.pessoa else None,
        distancia=ident.distancia if settings.DEBUG else None,
        expira_em=ident.expira_em if identificado else None,
    )


# ------------------------------------------------- cadastro (enrollment)
@router.post(
    "/pessoas/{pessoa_id}/consentimento",
    status_code=status.HTTP_201_CREATED,
)
async def registrar_consentimento(
    pessoa_id: int,
    dados: ConsentimentoIn,
    usuario: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> dict:
    """LGPD art. 11: biometria exige consentimento específico e destacado.

    Sem um registro vigente aqui, o cadastro biométrico é recusado.
    """
    from app.db.models import ConsentimentoBiometrico

    pessoa = await db.get(Pessoa, pessoa_id)
    if pessoa is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pessoa não encontrada")

    consentimento = ConsentimentoBiometrico(
        pessoa_id=pessoa_id,
        versao_termo=dados.versao_termo,
        finalidade=dados.finalidade,
        coletado_por_id=usuario.id,
    )
    db.add(consentimento)
    await db.commit()
    return {"ok": True, "consentimento_id": consentimento.id}


@router.delete("/pessoas/{pessoa_id}/consentimento")
async def revogar_consentimento(
    pessoa_id: int,
    usuario: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> dict:
    """Revogação elimina os vetores — não apenas marca uma flag.

    A LGPD garante eliminação do dado após revogação (art. 18). Manter o
    embedding "por garantia" descumpriria isso.
    """
    apagados = await svc.revogar_consentimento(db, pessoa_id)
    await db.commit()
    log.info("consentimento revogado para pessoa %s por %s", pessoa_id, usuario.email)
    return {"ok": True, "biometrias_eliminadas": apagados}


@router.post(
    "/pessoas/{pessoa_id}/biometrias", status_code=status.HTTP_201_CREATED
)
async def cadastrar_biometria(
    pessoa_id: int,
    dados: BiometriaIn,
    usuario: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> dict:
    """Cadastre 3 a 5 capturas por pessoa, em ângulos e luzes diferentes.

    Melhora o recall sem precisar afrouxar o limiar de distância — que é o
    ajuste que costuma ser feito por engano e que dispara o falso positivo.
    """
    if await db.get(Pessoa, pessoa_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pessoa não encontrada")
    try:
        bio = await svc.cadastrar(
            db, pessoa_id, dados.embedding, dados.modelo, dados.qualidade
        )
    except svc.SemConsentimento as exc:
        raise HTTPException(status.HTTP_412_PRECONDITION_FAILED, str(exc)) from exc
    except svc.ErroBiometria as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    await db.commit()
    return {"biometria_id": bio.id, "modelo": bio.modelo}
