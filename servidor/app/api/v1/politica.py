"""Os limiares que decidem, expostos para quem precisa explicá-los.

Existe por uma pergunta que o painel não sabia responder: por que esta
verificação reprovou se o capacete aparece na lista?

A resposta é um número — `EPI_CONFIANCA_MIN` — que vivia só no `.env` do
servidor. Quem olhava o painel via "Capacete · 55%" e uma reprovação, sem
nada ligando as duas coisas. Um limiar que decide e não se mostra obriga
todo mundo a decorá-lo ou a ir ler o código.

Nada aqui é gravável de propósito. Mudar limiar em produção pela web é o
tipo de botão que alguém aperta na véspera de uma auditoria; estes valores
mudam no `.env` e reiniciando o serviço, que deixa rastro em quem
administra a máquina. O endpoint é uma janela, não um painel de controle.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import admin_atual
from app.core.config import settings
from app.db.models import UsuarioAdmin
from app.schemas.api import PoliticaOut

router = APIRouter(tags=["política"])


@router.get("/politica", response_model=PoliticaOut)
async def obter_politica(_: UsuarioAdmin = Depends(admin_atual)) -> PoliticaOut:
    """Os parâmetros de decisão em vigor NESTE servidor, agora."""
    return PoliticaOut(
        epi_confianca_min=settings.EPI_CONFIANCA_MIN,
        verificacao_frames=settings.VERIFICACAO_FRAMES,
        verificacao_timeout_s=settings.VERIFICACAO_TIMEOUT_S,
        identificacao_ttl_s=settings.IDENTIFICACAO_TTL_S,
        face_distancia_max=settings.FACE_DISTANCIA_MAX,
        catraca_duracao_ms=settings.CATRACA_DURACAO_MS,
    )
