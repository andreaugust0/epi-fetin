"""Relatórios de conformidade — o que a banca vai querer ver em gráfico."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DB, admin_atual
from app.db.models import (
    Deteccao,
    PontoAcesso,
    StatusVerificacao,
    TipoEpi,
    UsuarioAdmin,
    Verificacao,
)

router = APIRouter(tags=["relatórios"])


@router.get("/relatorios/conformidade")
async def conformidade(
    dias: int = Query(30, ge=1, le=365),
    _: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> dict:
    """Taxa de aprovação por ponto no período."""
    desde = datetime.now(timezone.utc) - timedelta(days=dias)
    aprovadas = func.count(
        case((Verificacao.status == StatusVerificacao.APROVADA, 1))
    )
    stmt = (
        select(
            PontoAcesso.id,
            PontoAcesso.nome,
            func.count(Verificacao.id).label("total"),
            aprovadas.label("aprovadas"),
        )
        .join(Verificacao, Verificacao.ponto_id == PontoAcesso.id)
        .where(Verificacao.iniciada_em >= desde)
        .group_by(PontoAcesso.id, PontoAcesso.nome)
        .order_by(PontoAcesso.nome)
    )
    linhas = (await db.execute(stmt)).all()
    return {
        "periodo_dias": dias,
        "pontos": [
            {
                "ponto_id": pid,
                "nome": nome,
                "total": total,
                "aprovadas": aprov,
                "taxa_conformidade": round(100 * aprov / total, 1) if total else None,
            }
            for pid, nome, total, aprov in linhas
        ],
    }


@router.get("/relatorios/epis-faltantes")
async def epis_faltantes(
    dias: int = Query(30, ge=1, le=365),
    _: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> dict:
    """EPI mais esquecido por ponto — o relatório que vira ação de treinamento."""
    desde = datetime.now(timezone.utc) - timedelta(days=dias)
    faltas = func.count(case((Deteccao.presente.is_(False), 1)))
    stmt = (
        select(
            PontoAcesso.nome,
            TipoEpi.rotulo,
            func.count(Deteccao.id).label("total"),
            faltas.label("faltas"),
        )
        .join(Verificacao, Verificacao.id == Deteccao.verificacao_id)
        .join(PontoAcesso, PontoAcesso.id == Verificacao.ponto_id)
        .join(TipoEpi, TipoEpi.id == Deteccao.tipo_epi_id)
        .where(Verificacao.iniciada_em >= desde)
        .group_by(PontoAcesso.nome, TipoEpi.rotulo)
        .order_by(faltas.desc())
    )
    linhas = (await db.execute(stmt)).all()
    return {
        "periodo_dias": dias,
        "itens": [
            {
                "ponto": ponto,
                "epi": epi,
                "total": total,
                "faltas": f,
                "pct_falta": round(100 * f / total, 1) if total else None,
            }
            for ponto, epi, total, f in linhas
        ],
    }


@router.get("/relatorios/biometria")
async def desempenho_biometria(
    dias: int = Query(30, ge=1, le=365),
    _: UsuarioAdmin = Depends(admin_atual),
    db: AsyncSession = DB,
) -> dict:
    """Desempenho da identificação facial em campo.

    É o dado que permite calibrar FACE_DISTANCIA_MAX com evidência em vez de
    com chute — e rende um capítulo inteiro de resultados no TCC.
    """
    from app.db.models import Identificacao

    desde = datetime.now(timezone.utc) - timedelta(days=dias)
    stmt = (
        select(
            Identificacao.resultado,
            func.count(Identificacao.id),
            func.avg(Identificacao.distancia),
        )
        .where(Identificacao.criada_em >= desde)
        .group_by(Identificacao.resultado)
    )
    linhas = (await db.execute(stmt)).all()
    return {
        "periodo_dias": dias,
        "por_resultado": [
            {
                "resultado": r.value,
                "quantidade": qtd,
                "distancia_media": round(float(dist), 4) if dist else None,
            }
            for r, qtd, dist in linhas
        ],
    }
