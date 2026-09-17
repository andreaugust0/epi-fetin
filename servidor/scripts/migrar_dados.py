"""Migração de dados para um banco que já existe.

O `init_db.py` só semeia banco vazio, então mudanças de catálogo e de schema
não chegam sozinhas a quem já tem dados. Este script aplica as pendências
atuais, e é seguro rodar quantas vezes quiser.

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


#: Colunas cadastrais acrescentadas depois que a tabela já existia.
#: `ADD COLUMN IF NOT EXISTS` torna o passo repetível sem try/except em
#: volta — o Postgres decide se há o que fazer, em vez de nós adivinharmos
#: pelo tipo da exceção.
COLUNAS_PESSOA = [
    ("setor", "TEXT"),
    ("admitido_em", "DATE"),
]


async def campos_cadastrais() -> None:
    """Acrescenta setor e data de admissão a `pessoas`.

    São dados que o RH preenche e que o painel usa para dizer QUEM precisa
    de treinamento e ONDE — sem setor, o relatório de reincidência aponta
    dez nomes soltos em vez de "a manutenção do turno da manhã".

    Ambas são anuláveis de propósito: quem já está cadastrado não some nem
    vira inválido por não ter esses campos.
    """
    async with engine.begin() as conn:
        for coluna, tipo in COLUNAS_PESSOA:
            await conn.execute(
                text(f"ALTER TABLE pessoas ADD COLUMN IF NOT EXISTS {coluna} {tipo}")
            )
            print(f"  pessoas.{coluna} presente ({tipo})")


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


async def indice_periodo_verificacoes() -> None:
    """Índice em `verificacoes.iniciada_em`, para os filtros de período da
    área de Relatórios e Analytics.

    Esses filtros costumam vir sem `ponto_id` nem `pessoa_id` — "todas as
    verificações entre duas datas" — e os índices compostos que já existem
    (`ix_verif_ponto_data`, `ix_verif_pessoa_data`) não atendem bem esse
    caso: o período não é a coluna líder em nenhum dos dois, então o
    Postgres não pode usá-los para um filtro só de data.

    `CONCURRENTLY` evita travar `verificacoes` para escrita durante a
    construção — ela é a tabela que mais cresce no sistema, e provavelmente
    já tem histórico quando este script rodar num banco existente. Por isso
    roda em `AUTOCOMMIT`, fora de uma transação: o Postgres recusa
    `CREATE INDEX CONCURRENTLY` dentro de um `BEGIN`/`COMMIT`.

    Banco novo (`init_db.py` -> `create_all`) já nasce com este índice
    junto dos outros declarados no modelo; isto aqui é só para quem já
    tinha `verificacoes` antes dele existir no código.
    """
    async with engine.connect() as conn:
        conn = await conn.execution_options(isolation_level="AUTOCOMMIT")
        await conn.execute(
            text(
                "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_verif_iniciada "
                "ON verificacoes (iniciada_em)"
            )
        )
    print("  ix_verif_iniciada presente em verificacoes(iniciada_em)")


async def main() -> None:
    print("1. schema")
    try:
        await matricula_opcional()
    except Exception as exc:  # noqa: BLE001
        # Já anulável, ou banco novo criado direto pelo create_all.
        print(f"  nada a fazer ({type(exc).__name__})")

    print("\n2. campos cadastrais de pessoas")
    await campos_cadastrais()

    print("\n3. catálogo de EPIs")
    await catalogo()

    print("\n4. índices da área de Relatórios e Analytics")
    await indice_periodo_verificacoes()

    async with SessionLocal() as db:
        tipos = (await db.execute(select(TipoEpi).order_by(TipoEpi.codigo))).scalars().all()
        print(f"\ncatálogo final ({len(tipos)}):")
        for t in tipos:
            print(f"  {t.codigo:12} {t.rotulo}")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
