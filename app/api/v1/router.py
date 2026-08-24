"""Agregador dos routers da v1."""
from fastapi import APIRouter

from app.api.v1 import (
    auth,
    evidencias,
    identificacao,
    pontos,
    relatorios,
    verificacoes,
    ws,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(identificacao.router)
api_router.include_router(verificacoes.router)
api_router.include_router(evidencias.router)
api_router.include_router(pontos.router)
api_router.include_router(relatorios.router)

# WebSocket fora do prefixo /api/v1
ws_router = ws.router
