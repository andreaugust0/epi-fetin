"""Migração de dados para um banco que já existe.

O `init_db.py` só semeia banco vazio, então mudanças de catálogo e de schema
não chegam sozinhas a quem já tem dados. Este script aplica as duas
pendências atuais, e é seguro rodar quantas vezes quiser.

    python -m scripts.migrar_dados

Enquanto não há Alembic, é este o caminho. Quando houver, isto vira uma
revisão e o script sai.
"""
from __future__ import annotations

import asyncio

from sqlalchemy import select, text

from app.db.models import TipoEpi
from app.db.session import SessionLocal, engine

#: código antigo -> (código novo, rótulo novo)
RENOMEAR = {
    "luva": ("luvas", "Luvas"),
    "bota": ("botas", "Botas"),
}

#: os que faltavam para fechar os sete do catálogo do app
ACRESCENTAR = [
    ("auricular", "Protetor Auricular", "earmuffs"),
    ("mascara", "Máscara", "mask"),
]

#: rótulos alinhados aos do app, para as telas baterem
REROTULAR = {
    "capacete": "Capacete",
    "colete": "Colete",
    "oculos": "Óculos",
}


async def matricula_opcional() -> None:
    """Torna pessoas.matricula anulável.

    O create_all do SQLAlchemy não altera tabela existente: ele só cria o
    que falta. Sem este ALTER, cadastrar alguém sem matrícula falha com
    violação de NOT NULL num banco antigo.
    """
    async with engine.begin() as conn:
        await conn.execute(
            text("ALTER TABLE pessoas ALTER COLUMN matricula DROP NOT NULL")
        )
    print("  pessoas.matricula agora aceita NULL")


async def catalogo() -> None:
    async with SessionLocal() as db:
        existentes = {
            t.codigo: t
            for t in (await db.execute(select(TipoEpi))).scalars().all()
        }

        for antigo, (novo, rotulo) in RENOMEAR.items():
            if antigo in existentes and novo not in existentes:
                t = existentes[antigo]
                t.codigo, t.rotulo = novo, rotulo
                print(f"  {antigo} -> {novo}")
            elif antigo in existentes and novo in existentes:
                print(f"  ATENÇÃO: '{antigo}' e '{novo}' coexistem. "
                      f"Resolva à mão para não duplicar a exigência.")

        for codigo, rotulo, classe in ACRESCENTAR:
            if codigo not in existentes:
                db.add(TipoEpi(codigo=codigo, rotulo=rotulo, classe_modelo=classe))
                print(f"  + {codigo}")

        for codigo, rotulo in REROTULAR.items():
            t = existentes.get(codigo)
            if t and t.rotulo != rotulo:
                print(f"  rótulo de {codigo}: '{t.rotulo}' -> '{rotulo}'")
                t.rotulo = rotulo

        await db.commit()


async def main() -> None:
    print("1. schema")
    try:
        await matricula_opcional()
    except Exception as exc:  # noqa: BLE001
        # Já anulável, ou banco novo criado direto pelo create_all.
        print(f"  nada a fazer ({type(exc).__name__})")

    print("\n2. catálogo de EPIs")
    await catalogo()

    async with SessionLocal() as db:
        tipos = (await db.execute(select(TipoEpi).order_by(TipoEpi.codigo))).scalars().all()
        print(f"\ncatálogo final ({len(tipos)}):")
        for t in tipos:
            print(f"  {t.codigo:12} {t.rotulo}")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
