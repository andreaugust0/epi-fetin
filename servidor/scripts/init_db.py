"""Cria o schema e popula dados mínimos para desenvolvimento.

Para valer, use Alembic. Este script existe para você conseguir subir a API
hoje sem configurar migrations — e para deixar explícito o CREATE EXTENSION
vector, que precisa rodar antes de qualquer tabela com coluna de embedding.

    python -m scripts.init_db
"""
from __future__ import annotations

import asyncio

from sqlalchemy import select, text

from app.core.config import settings
from app.core.security import hash_senha
from app.db.models import (
    Base,
    Dispositivo,
    EpiExigido,
    PontoAcesso,
    Site,
    TipoDispositivo,
    TipoEpi,
    UsuarioAdmin,
)
from app.db.session import SessionLocal, engine

EPIS = [
    ("capacete", "Capacete", "helmet"),
    ("oculos", "Óculos de proteção", "goggles"),
    ("colete", "Colete refletivo", "vest"),
    ("luva", "Luvas", "gloves"),
    ("bota", "Botas de segurança", "boots"),
]


async def criar_schema() -> None:
    async with engine.begin() as conn:
        # pgvector precisa existir ANTES das tabelas com coluna Vector
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)
    print("schema criado")


async def semear() -> None:
    async with SessionLocal() as db:
        if (await db.execute(select(Site).limit(1))).scalar_one_or_none():
            print("banco já semeado; nada a fazer")
            return

        site = Site(codigo="planta01", nome="Planta 01")
        db.add(site)
        await db.flush()

        ponto = PontoAcesso(
            site_id=site.id, codigo="portaria", nome="Portaria principal"
        )
        db.add(ponto)
        await db.flush()

        tipos = {}
        for codigo, rotulo, classe in EPIS:
            t = TipoEpi(codigo=codigo, rotulo=rotulo, classe_modelo=classe)
            db.add(t)
            tipos[codigo] = t
        await db.flush()

        for codigo in ("capacete", "oculos", "colete"):
            db.add(EpiExigido(ponto_id=ponto.id, tipo_epi_id=tipos[codigo].id))

        db.add_all(
            [
                Dispositivo(
                    ponto_id=ponto.id,
                    tipo=TipoDispositivo.RASPBERRY,
                    client_id_mqtt="rasp-planta01-portaria",
                ),
                Dispositivo(
                    ponto_id=ponto.id,
                    tipo=TipoDispositivo.ESP32,
                    client_id_mqtt="esp32-planta01-portaria",
                ),
                Dispositivo(
                    ponto_id=ponto.id,
                    tipo=TipoDispositivo.TABLET,
                    client_id_mqtt="tablet-planta01-portaria",
                ),
            ]
        )
        db.add(
            UsuarioAdmin(
                email="admin@epiguard.com.br",
                nome="Administrador",
                senha_hash=hash_senha("admin123"),
                papel="admin",
            )
        )
        await db.commit()
        print("dados de desenvolvimento criados")
        print("  login: admin@epiguard.com.br / admin123   (TROQUE ISTO)")
        print(f"  embedding dim: {settings.FACE_EMBEDDING_DIM}")


async def main() -> None:
    await criar_schema()
    await semear()
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
