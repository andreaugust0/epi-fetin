"""Aplicação FastAPI.

Este processo serve HTTP e WebSocket. Ele PUBLICA no MQTT (para disparar
cmd/capturar), mas NÃO consome — quem consome é `app.mqtt.worker`, em
processo separado. Ver o docstring do worker para o porquê.
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router, ws_router
from app.core.config import settings
from app.core.logging import configurar_logging
from app.db.session import engine
from app.mqtt.publisher import publisher
from app.realtime.ponte import ponte

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    configurar_logging()
    log.info("subindo %s (env=%s)", settings.APP_NAME, settings.ENV)
    await publisher.start()
    # Assina o canal interno de desfecho e reemite para os WebSockets
    # deste processo. O client_id leva o PID: com --workers N, cada
    # processo precisa da própria conexão, senão o broker derruba um
    # ao outro e só o último a conectar recebe os avisos.
    await ponte.start(f"{settings.MQTT_CLIENT_ID_API}-ws-{os.getpid()}")
    yield
    await ponte.stop()
    await publisher.stop()
    await engine.dispose()
    log.info("encerrado")


app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    description=(
        "API de controle de acesso com verificação de EPI por visão "
        "computacional na borda e identificação facial por embedding."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.DEBUG else [],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)
app.include_router(ws_router)


@app.get("/health", tags=["infra"])
async def health() -> dict:
    """Inclui o estado do broker de propósito.

    Sem MQTT o sistema não abre catraca nenhuma — reportar "saudável" nesse
    estado seria mentira útil para ninguém.
    """
    return {
        "status": "ok",
        "mqtt": "conectado" if publisher.conectado else "desconectado",
        "env": settings.ENV,
    }


@app.exception_handler(Exception)
async def erro_nao_tratado(request: Request, exc: Exception) -> JSONResponse:
    log.exception("erro não tratado em %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "erro interno" if not settings.DEBUG else str(exc)},
    )
