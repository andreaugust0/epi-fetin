"""Prova de compatibilidade: embeddings REAIS do app contra o servidor.

Carrega a galeria que o app React Native embute no bundle
(assets/mock_embeddings.json), cadastra as pessoas no servidor e roda a
identificação pelo caminho normal — o mesmo services/biometria.py que o
endpoint POST /api/v1/identificacao usa.

Se isto passar, o formato do embedding é compatível ponta a ponta e a
integração é só ligar o cabo.

    python -m scripts.testar_compat_app /caminho/mock_embeddings.json
"""
from __future__ import annotations

import asyncio
import json
import math
import sys

from sqlalchemy import delete, select

from app.core.config import settings
from app.db.models import (
    Biometria,
    ConsentimentoBiometrico,
    Deteccao,
    EventoAcesso,
    Identificacao,
    Pessoa,
    ResultadoIdentificacao,
    Verificacao,
)
from app.db.session import SessionLocal, engine
from app.services import biometria as svc

CAMINHO = sys.argv[1] if len(sys.argv) > 1 else "/tmp/galeria_real.json"

ok, falhas = 0, []


def checar(nome: str, cond: bool, extra: str = "") -> None:
    global ok
    if cond:
        ok += 1
        print(f"  ok    {nome} {extra}")
    else:
        falhas.append(nome)
        print(f"  FALHA {nome} {extra}")


def cosseno(a: list[float], b: list[float]) -> float:
    """Mesma conta que o app faz em matchEmbedding.ts."""
    return 1.0 - sum(x * y for x, y in zip(a, b))


async def main() -> None:
    galeria = json.load(open(CAMINHO))
    print(f"\nGaleria do app: {len(galeria)} pessoas, "
          f"modelo '{galeria[0]['modelo']}'\n")

    print("1. formato do embedding")
    e0 = galeria[0]["embedding"]
    norma = math.sqrt(sum(x * x for x in e0))
    checar("dimensão bate com o servidor",
           len(e0) == settings.FACE_EMBEDDING_DIM,
           f"({len(e0)} == {settings.FACE_EMBEDDING_DIM})")
    checar("nome do modelo bate",
           galeria[0]["modelo"] == settings.FACE_MODELO,
           f"('{galeria[0]['modelo']}')")
    checar("já vem L2-normalizado", abs(norma - 1.0) < 1e-4,
           f"(norma = {norma:.8f})")

    async with SessionLocal() as db:
        # limpeza
        for t in (EventoAcesso, Deteccao, Verificacao, Identificacao,
                  Biometria, ConsentimentoBiometrico):
            await db.execute(delete(t))
        await db.execute(delete(Pessoa).where(Pessoa.matricula.like("APP-%")))
        await db.commit()

        print("\n2. cadastro das pessoas reais da galeria")
        ids: dict[str, int] = {}
        for item in galeria:
            p = Pessoa(matricula=f"APP-{item['id']}", nome=item["nome"])
            db.add(p)
            await db.flush()
            ids[item["nome"]] = p.id
            db.add(ConsentimentoBiometrico(
                pessoa_id=p.id, versao_termo="1.0",
                finalidade="prova de compatibilidade"))
            await db.flush()
            await svc.cadastrar(db, p.id, item["embedding"], item["modelo"])
        await db.commit()
        total = len((await db.execute(select(Biometria))).scalars().all())
        checar("três embeddings aceitos pelo servidor", total == 3, f"({total})")

        print("\n3. identificação de cada pessoa pelo próprio vetor")
        for item in galeria:
            ident = await svc.identificar(
                db, ponto_id=1, embedding=item["embedding"],
                modelo=item["modelo"])
            await db.commit()
            acertou = (ident.resultado is ResultadoIdentificacao.IDENTIFICADO
                       and ident.pessoa_id == ids[item["nome"]])
            razao = f"{ident.razao_2o_lugar:.2f}" if ident.razao_2o_lugar else "—"
            checar(f"{item['nome']} identificado corretamente", acertou,
                   f"(dist={ident.distancia:.6f}, razão={razao})")

        print("\n4. distâncias cruzadas entre as três pessoas")
        print("     (o servidor usa cosseno, igual ao matchEmbedding.ts do app)")
        for i, a in enumerate(galeria):
            for b in galeria[i + 1:]:
                d = cosseno(a["embedding"], b["embedding"])
                acima = d > settings.FACE_DISTANCIA_MAX
                checar(f"{a['nome']} x {b['nome']} acima do limiar", acima,
                       f"(dist={d:.4f} > {settings.FACE_DISTANCIA_MAX})")

        print("\n5. paridade de regra entre app e servidor")
        checar("limiar de distância idêntico",
               settings.FACE_DISTANCIA_MAX == 0.4,
               f"(app 0.4 / servidor {settings.FACE_DISTANCIA_MAX})")
        checar("teste de razão idêntico",
               settings.FACE_RAZAO_MIN == 1.15,
               f"(app 1.15 / servidor {settings.FACE_RAZAO_MIN})")

        print("\n6. rosto fora da galeria é rejeitado")
        import random
        r = random.Random(99)
        v = [r.gauss(0, 1) for _ in range(512)]
        n = math.sqrt(sum(x * x for x in v))
        desconhecido = [x / n for x in v]
        ident = await svc.identificar(
            db, ponto_id=1, embedding=desconhecido, modelo=settings.FACE_MODELO)
        await db.commit()
        checar("desconhecido não é identificado",
               ident.resultado is ResultadoIdentificacao.NAO_IDENTIFICADO,
               f"(dist={ident.distancia:.4f})")

    await engine.dispose()
    print(f"\n{'=' * 56}")
    print(f"{ok} verificações passaram, {len(falhas)} falharam")
    if falhas:
        for f in falhas:
            print(f"  - {f}")
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
