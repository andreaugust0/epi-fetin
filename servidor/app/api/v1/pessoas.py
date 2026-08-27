"""CRUD de pessoas — consumido pelo painel administrativo.

O cadastro biométrico em si vive em `identificacao.py`; aqui ficam os dados
cadastrais e a visão de quem já tem rosto cadastrado.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DB, admin_atual, exige_papel
from app.db.models import (
    Biometria,
    ConsentimentoBiometrico,
    LogAuditoria,
    Pessoa,
    UsuarioAdmin,
    Verificacao,
)
from app.schemas.api import (
    PaginaPessoas,
    PessoaDetalhe,
    PessoaIn,
    PessoaOut,
    PessoaPatch,
)

router = APIRouter(tags=["pessoas"])


async def _resumo_biometria(db: AsyncSession, pessoa_id: int) -> tuple[int, bool]:
    """(quantos vetores cadastrados, consentimento vigente)."""
    n = (
        await db.execute(
            select(func.count(Biometria.id)).where(Biometria.pessoa_id == pessoa_id)
        )
    ).scalar_one()
    consent = (
        await db.execute(
            select(ConsentimentoBiometrico.id).where(
                ConsentimentoBiometrico.pessoa_id == pessoa_id,
                ConsentimentoBiometrico.revogado_em.is_(None),
            ).limit(1)
        )
    ).scalar_one_or_none()
    return n, consent is not None


@router.get("/pessoas", response_model=PaginaPessoas)
async def listar(
    busca: str | None = Query(None, description="filtra por nome ou matrícula"),
    ativo: bool | None = None,
    com_biometria: bool | None = Query(
        None, description="true = só quem já tem rosto cadastrado"
    ),
    limite: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> PaginaPessoas:
    filtros = []
    if busca:
        alvo = f"%{busca.strip()}%"
        filtros.append(Pessoa.nome.ilike(alvo) | Pessoa.matricula.ilike(alvo))
    if ativo is not None:
        filtros.append(Pessoa.ativo.is_(ativo))

    total = (
        await db.execute(select(func.count(Pessoa.id)).where(*filtros))
    ).scalar_one()

    stmt = (
        select(Pessoa).where(*filtros)
        .order_by(Pessoa.nome).limit(limite).offset(offset)
    )
    pessoas = list((await db.execute(stmt)).scalars().all())

    itens: list[PessoaOut] = []
    for p in pessoas:
        n, consent = await _resumo_biometria(db, p.id)
        if com_biometria is True and n == 0:
            continue
        if com_biometria is False and n > 0:
            continue
        itens.append(PessoaOut(
            id=p.id, matricula=p.matricula, nome=p.nome, funcao=p.funcao,
            ativo=p.ativo, biometrias=n, consentimento_vigente=consent,
        ))
    return PaginaPessoas(total=total, itens=itens)


@router.post("/pessoas", response_model=PessoaOut,
             status_code=status.HTTP_201_CREATED)
async def criar(
    dados: PessoaIn,
    usuario: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> PessoaOut:
    ja_existe = (
        await db.execute(
            select(Pessoa).where(Pessoa.matricula == dados.matricula)
        )
    ).scalar_one_or_none()
    if ja_existe:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"já existe alguém com a matrícula {dados.matricula}",
        )

    p = Pessoa(**dados.model_dump())
    db.add(p)
    await db.flush()
    db.add(LogAuditoria(
        ator_id=usuario.id, acao="CRIAR_PESSOA", entidade="pessoa",
        entidade_id=str(p.id), detalhe={"matricula": p.matricula},
    ))
    await db.commit()
    return PessoaOut(
        id=p.id, matricula=p.matricula, nome=p.nome, funcao=p.funcao,
        ativo=p.ativo, biometrias=0, consentimento_vigente=False,
    )


@router.get("/pessoas/{pessoa_id}", response_model=PessoaDetalhe)
async def obter(
    pessoa_id: int,
    _: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> PessoaDetalhe:
    p = await db.get(Pessoa, pessoa_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pessoa não encontrada")

    n, consent = await _resumo_biometria(db, pessoa_id)
    total_verif = (
        await db.execute(
            select(func.count(Verificacao.id))
            .where(Verificacao.pessoa_id == pessoa_id)
        )
    ).scalar_one()
    ultima = (
        await db.execute(
            select(Verificacao.iniciada_em)
            .where(Verificacao.pessoa_id == pessoa_id)
            .order_by(Verificacao.iniciada_em.desc()).limit(1)
        )
    ).scalar_one_or_none()

    return PessoaDetalhe(
        id=p.id, matricula=p.matricula, nome=p.nome, funcao=p.funcao,
        ativo=p.ativo, biometrias=n, consentimento_vigente=consent,
        criado_em=p.criado_em, total_verificacoes=total_verif,
        ultima_verificacao=ultima,
    )


@router.patch("/pessoas/{pessoa_id}", response_model=PessoaOut)
async def atualizar(
    pessoa_id: int,
    dados: PessoaPatch,
    usuario: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> PessoaOut:
    p = await db.get(Pessoa, pessoa_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pessoa não encontrada")

    mudancas = dados.model_dump(exclude_unset=True)
    for campo, valor in mudancas.items():
        setattr(p, campo, valor)
    db.add(LogAuditoria(
        ator_id=usuario.id, acao="EDITAR_PESSOA", entidade="pessoa",
        entidade_id=str(p.id), detalhe=mudancas,
    ))
    await db.commit()

    n, consent = await _resumo_biometria(db, pessoa_id)
    return PessoaOut(
        id=p.id, matricula=p.matricula, nome=p.nome, funcao=p.funcao,
        ativo=p.ativo, biometrias=n, consentimento_vigente=consent,
    )


@router.delete("/pessoas/{pessoa_id}")
async def desativar(
    pessoa_id: int,
    usuario: UsuarioAdmin = Depends(exige_papel("admin")),
    db: AsyncSession = DB,
) -> dict:
    """Desativa a pessoa, sem apagar o histórico.

    Apagar a linha levaria junto as verificações dela — e histórico de acesso
    é registro de auditoria de segurança do trabalho, que precisa sobreviver
    ao desligamento do funcionário.

    Para eliminar o dado biométrico, o caminho é revogar o consentimento:
    `DELETE /pessoas/{id}/consentimento` apaga os vetores de verdade.
    """
    p = await db.get(Pessoa, pessoa_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pessoa não encontrada")
    p.ativo = False
    db.add(LogAuditoria(
        ator_id=usuario.id, acao="DESATIVAR_PESSOA", entidade="pessoa",
        entidade_id=str(p.id),
    ))
    await db.commit()
    return {"ok": True, "aviso": "para eliminar a biometria, revogue o consentimento"}
