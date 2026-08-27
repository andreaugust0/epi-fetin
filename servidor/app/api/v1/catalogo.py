"""Catálogo de EPIs e configuração da política de cada ponto de acesso.

É aqui que mora o endpoint que faltava: o que permite ao painel dizer
"a portaria passa a exigir protetor auricular" sem ninguém tocar em código
nem reprogramar dispositivo.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DB, admin_atual, exige_papel
from app.db.models import (
    EpiExigido,
    LogAuditoria,
    PontoAcesso,
    Site,
    TipoEpi,
    UsuarioAdmin,
)
from app.schemas.api import (
    EpisExigidosIn,
    PontoIn,
    PontoOut,
    PontoPatch,
    TipoEpiIn,
    TipoEpiOut,
)

router = APIRouter(tags=["catálogo"])


# --------------------------------------------------------------- tipos de EPI
@router.get("/tipos-epi", response_model=list[TipoEpiOut])
async def listar_tipos(
    _: UsuarioAdmin = Depends(admin_atual), db: AsyncSession = DB
) -> list[TipoEpiOut]:
    tipos = list(
        (await db.execute(select(TipoEpi).order_by(TipoEpi.rotulo))).scalars().all()
    )
    return [TipoEpiOut.model_validate(t) for t in tipos]


@router.post("/tipos-epi", response_model=TipoEpiOut,
             status_code=status.HTTP_201_CREATED)
async def criar_tipo(
    dados: TipoEpiIn,
    usuario: UsuarioAdmin = Depends(exige_papel("admin")),
    db: AsyncSession = DB,
) -> TipoEpiOut:
    """O `codigo` é o que trafega no MQTT e o que a borda devolve.

    Precisa bater exatamente com o identificador que o app e a Raspberry
    usam — item com código desconhecido é descartado em silêncio do outro
    lado. O `classe_modelo` é o nome da classe na saída do modelo treinado.
    """
    existe = (
        await db.execute(select(TipoEpi).where(TipoEpi.codigo == dados.codigo))
    ).scalar_one_or_none()
    if existe:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"código '{dados.codigo}' já existe"
        )
    t = TipoEpi(**dados.model_dump())
    db.add(t)
    await db.flush()
    db.add(LogAuditoria(
        ator_id=usuario.id, acao="CRIAR_TIPO_EPI", entidade="tipo_epi",
        entidade_id=str(t.id), detalhe={"codigo": t.codigo},
    ))
    await db.commit()
    return TipoEpiOut.model_validate(t)


# ------------------------------------------------------------ pontos de acesso
async def _serializar_ponto(db: AsyncSession, p: PontoAcesso) -> PontoOut:
    site = await db.get(Site, p.site_id)
    return PontoOut(
        id=p.id, codigo=p.codigo, nome=p.nome, ativo=p.ativo,
        site_codigo=site.codigo if site else "",
        epis_exigidos=[e.tipo_epi.codigo for e in p.epis_exigidos],
    )


@router.post("/pontos", response_model=PontoOut,
             status_code=status.HTTP_201_CREATED)
async def criar_ponto(
    dados: PontoIn,
    usuario: UsuarioAdmin = Depends(exige_papel("admin")),
    db: AsyncSession = DB,
) -> PontoOut:
    if await db.get(Site, dados.site_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "site não encontrado")
    p = PontoAcesso(**dados.model_dump())
    db.add(p)
    await db.flush()
    db.add(LogAuditoria(
        ator_id=usuario.id, acao="CRIAR_PONTO", entidade="ponto_acesso",
        entidade_id=str(p.id), detalhe={"codigo": p.codigo},
    ))
    await db.commit()
    await db.refresh(p, ["epis_exigidos"])
    return await _serializar_ponto(db, p)


@router.patch("/pontos/{ponto_id}", response_model=PontoOut)
async def atualizar_ponto(
    ponto_id: int,
    dados: PontoPatch,
    usuario: UsuarioAdmin = Depends(exige_papel("admin")),
    db: AsyncSession = DB,
) -> PontoOut:
    stmt = (
        select(PontoAcesso)
        .options(selectinload(PontoAcesso.epis_exigidos))
        .where(PontoAcesso.id == ponto_id)
    )
    p = (await db.execute(stmt)).scalars().unique().one_or_none()
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ponto não encontrado")

    mudancas = dados.model_dump(exclude_unset=True)
    for campo, valor in mudancas.items():
        setattr(p, campo, valor)
    db.add(LogAuditoria(
        ator_id=usuario.id, acao="EDITAR_PONTO", entidade="ponto_acesso",
        entidade_id=str(p.id), detalhe=mudancas,
    ))
    await db.commit()
    return await _serializar_ponto(db, p)


@router.put("/pontos/{ponto_id}/epis", response_model=PontoOut)
async def definir_epis_exigidos(
    ponto_id: int,
    dados: EpisExigidosIn,
    usuario: UsuarioAdmin = Depends(exige_papel("admin", "supervisor")),
    db: AsyncSession = DB,
) -> PontoOut:
    """Define a lista completa de EPIs exigidos no ponto.

    É PUT e não PATCH de propósito: a lista enviada substitui a anterior
    inteira. Assim o painel manda o estado final que o operador vê na tela,
    sem precisar calcular o que foi adicionado e o que foi removido.

    Este endpoint é o que torna verdadeira a promessa de que mudar a
    exigência de um ponto não exige tocar em código nem reprogramar
    dispositivo — a Raspberry recebe a lista nova no próximo cmd/capturar.
    """
    stmt = (
        select(PontoAcesso)
        .options(selectinload(PontoAcesso.epis_exigidos))
        .where(PontoAcesso.id == ponto_id)
    )
    p = (await db.execute(stmt)).scalars().unique().one_or_none()
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ponto não encontrado")

    tipos = list(
        (
            await db.execute(
                select(TipoEpi).where(TipoEpi.codigo.in_(dados.codigos))
            )
        ).scalars().all()
    )
    encontrados = {t.codigo for t in tipos}
    faltando = set(dados.codigos) - encontrados
    if faltando:
        # Falha alto em vez de ignorar. Aceitar um código inexistente
        # produziria um ponto que exige algo que a borda nunca vai reportar,
        # e toda verificação ali reprovaria sem explicação.
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"código(s) de EPI inexistente(s): {', '.join(sorted(faltando))}. "
            f"Cadastre em /tipos-epi antes.",
        )

    anteriores = sorted(e.tipo_epi.codigo for e in p.epis_exigidos)
    await db.execute(delete(EpiExigido).where(EpiExigido.ponto_id == ponto_id))
    for t in tipos:
        db.add(EpiExigido(ponto_id=ponto_id, tipo_epi_id=t.id))
    db.add(LogAuditoria(
        ator_id=usuario.id, acao="DEFINIR_EPIS", entidade="ponto_acesso",
        entidade_id=str(ponto_id),
        detalhe={"antes": anteriores, "depois": sorted(dados.codigos)},
    ))
    await db.commit()

    # populate_existing é obrigatório aqui. Sem ele, o `p` que já está no
    # identity map da sessão volta com a coleção `epis_exigidos` antiga em
    # cache, e a resposta mostra a lista ANTERIOR — mesmo com o banco já
    # correto. É o tipo de bug que faz o operador salvar, ver o valor velho
    # na tela e salvar de novo achando que não funcionou.
    p = (
        await db.execute(stmt.execution_options(populate_existing=True))
    ).scalars().unique().one()
    return await _serializar_ponto(db, p)
