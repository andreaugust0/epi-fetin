"""Identificação facial e cadastro biométrico.

Na IDENTIFICAÇÃO, o tablet roda o FaceNet localmente e manda só o
embedding: a foto do rosto nunca chega ao servidor, e o embedding
consultado não é persistido — só o resultado da comparação entra no log de
auditoria.

No CADASTRO por foto, a imagem chega aqui, é lida em memória, vira um vetor
e some. Nada é gravado em disco, nem em banco, nem em bucket. É uma exceção
consciente à regra acima, e ela existe porque a alternativa era pior:
cadastrar cada funcionário exigia alguém segurando o tablet, o que na
prática significava não cadastrar.
"""
from __future__ import annotations

import base64
import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DB, Tablet, admin_atual, confere_ponto, tablet_atual
from app.core.config import settings
from app.db.models import Biometria, Pessoa, ResultadoIdentificacao, UsuarioAdmin
from app.schemas.api import (
    BiometriaIn,
    ConsentimentoIn,
    IdentificacaoIn,
    IdentificacaoOut,
    RostoCadastradoOut,
)
from app.services import biometria as svc
from app.services import rosto as svc_rosto

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

    # `ident` foi construído com `pessoa_id=...` (não com a relação `pessoa`
    # carregada), então `ident.pessoa` dispararia um lazy-load implícito e
    # síncrono fora do bridge greenlet do SQLAlchemy async. Buscamos a
    # Pessoa com um await explícito, que é async-safe.
    #
    # `db.get` e não `db.refresh`: o get consulta primeiro o identity map da
    # sessão, e a Pessoa já está lá — o serviço de biometria acabou de
    # carregá-la para comparar os vetores. Então no caminho feliz isto não
    # custa consulta nenhuma.
    nome = None
    if ident.pessoa_id is not None:
        pessoa = await db.get(Pessoa, ident.pessoa_id)
        nome = pessoa.nome if pessoa else None

    return IdentificacaoOut(
        identificacao_id=ident.id if identificado else None,
        resultado=ident.resultado.value,
        pessoa_id=ident.pessoa_id,
        nome=nome,
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


@router.post(
    "/pessoas/{pessoa_id}/biometrias/foto",
    status_code=status.HTTP_201_CREATED,
    response_model=RostoCadastradoOut,
)
async def cadastrar_biometria_por_foto(
    pessoa_id: int,
    foto: UploadFile = File(description="JPEG ou PNG com UM rosto de frente."),
    usuario: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> RostoCadastradoOut:
    """Foto → embedding → cadastro, sem passar por tablet nenhum.

    A foto vive só em memória e é descartada assim que o vetor sai. Não há
    caminho neste endpoint que a escreva em disco.

    O retorno traz a distância entre o vetor novo e os que a pessoa já
    tinha, e isso não é enfeite: o tablet detecta rosto com ML Kit e aqui
    usamos YuNet, e dois detectores podem recortar o rosto de formas
    ligeiramente diferentes. Quando isso acontece, os vetores deixam de ser
    comparáveis — e o sintoma seria uma pessoa cadastrada com sucesso que a
    catraca nunca reconhece. A distância transforma esse risco silencioso
    num número na tela.
    """
    if await db.get(Pessoa, pessoa_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pessoa não encontrada")

    dados = await foto.read()
    if not dados:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "arquivo vazio")
    if len(dados) > settings.FOTO_CADASTRO_MAX_MB * 1024 * 1024:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"foto acima de {settings.FOTO_CADASTRO_MAX_MB} MB",
        )

    # Vetores anteriores ANTES de gravar o novo — senão a comparação
    # incluiria o próprio vetor recém-criado, distância zero, e o alerta
    # nunca dispararia.
    anteriores = list(
        (
            await db.execute(
                select(Biometria.embedding).where(Biometria.pessoa_id == pessoa_id)
            )
        )
        .scalars()
        .all()
    )

    try:
        extracao = svc_rosto.extrair(dados)
    except svc_rosto.ErroRosto as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    finally:
        # Referência solta o mais cedo possível. Não substitui a garantia
        # real (nunca gravar), mas encurta a janela em que a imagem existe.
        del dados

    try:
        bio = await svc.cadastrar(
            db,
            pessoa_id,
            extracao.embedding,
            settings.FACE_MODELO,
            extracao.confianca_deteccao,
        )
    except svc.SemConsentimento as exc:
        raise HTTPException(status.HTTP_412_PRECONDITION_FAILED, str(exc)) from exc
    except svc.ErroBiometria as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    distancia = None
    compativel = None
    if anteriores:
        distancia = min(
            svc_rosto.distancia_cosseno(extracao.embedding, v) for v in anteriores
        )
        compativel = distancia <= settings.FACE_DISTANCIA_ALERTA

    await db.commit()
    log.info(
        "biometria por foto: pessoa=%s por=%s deteccao=%.2f distancia=%s",
        pessoa_id,
        usuario.email,
        extracao.confianca_deteccao,
        f"{distancia:.4f}" if distancia is not None else "—",
    )

    return RostoCadastradoOut(
        biometria_id=bio.id,
        modelo=bio.modelo,
        qualidade=extracao.confianca_deteccao,
        caixa_rosto=extracao.caixa_bruta.como_dict(),
        caixa_recorte=extracao.caixa_recorte.como_dict(),
        recorte_base64=base64.b64encode(extracao.recorte_png).decode(),
        distancia_menor=distancia,
        compativel=compativel,
        quase_identica=(
            distancia is not None and distancia < settings.FACE_DISTANCIA_MIN_NOVA
        ),
        total_biometrias=len(anteriores) + 1,
    )
