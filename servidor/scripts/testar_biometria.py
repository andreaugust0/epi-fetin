"""Teste de fumaça do serviço de biometria contra um Postgres real.

Exercita as regras que costumam passar despercebidas: limiar de distância,
teste de razão contra o segundo colocado, bloqueio por falta de
consentimento, uso único do token e eliminação de vetores na revogação.

    python -m scripts.testar_biometria
"""
from __future__ import annotations

import asyncio
import random

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

DIM = settings.FACE_EMBEDDING_DIM
MOD = settings.FACE_MODELO
rnd = random.Random(42)


def vetor(semente: int) -> list[float]:
    r = random.Random(semente)
    return [r.gauss(0, 1) for _ in range(DIM)]


def perturbar(base: list[float], forca: float) -> list[float]:
    """Simula outra captura da mesma pessoa: mesmo vetor + ruído."""
    return [x + rnd.gauss(0, forca) for x in base]


ok = 0
falhas: list[str] = []


def checar(nome: str, condicao: bool, extra: str = "") -> None:
    global ok
    if condicao:
        ok += 1
        print(f"  ok    {nome} {extra}")
    else:
        falhas.append(nome)
        print(f"  FALHA {nome} {extra}")


async def main() -> None:
    async with SessionLocal() as db:
        # ---------------------------------------------------- limpeza
        # A ordem importa: `verificacoes` referencia `identificacoes`, que
        # referencia `pessoas`. Apagar de fora para dentro evita violar
        # chave estrangeira quando este teste roda depois do de fluxo.
        await db.execute(delete(EventoAcesso))
        await db.execute(delete(Deteccao))
        await db.execute(delete(Verificacao))
        await db.execute(delete(Identificacao))
        await db.execute(delete(Biometria))
        await db.execute(delete(ConsentimentoBiometrico))
        await db.execute(
            delete(Pessoa).where(Pessoa.matricula.like("TESTE-%"))
        )
        await db.commit()

        # ---------------------------------------------------- cenário
        ana = Pessoa(matricula="TESTE-001", nome="Ana")
        bruno = Pessoa(matricula="TESTE-002", nome="Bruno")
        carla = Pessoa(matricula="TESTE-003", nome="Carla")
        db.add_all([ana, bruno, carla])
        await db.flush()

        # Guardamos os ids como int: depois de um rollback os objetos ORM
        # ficam expirados, e tocar em `ana.id` dispararia um refresh
        # síncrono dentro do event loop (MissingGreenlet).
        ana_id, bruno_id, carla_id = ana.id, bruno.id, carla.id

        for pid in (ana_id, bruno_id):
            db.add(
                ConsentimentoBiometrico(
                    pessoa_id=pid, versao_termo="1.0", finalidade="teste"
                )
            )
        await db.flush()

        rosto_ana = vetor(1)
        rosto_bruno = vetor(2)

        print("\n1. cadastro (enrollment)")
        # 3 capturas por pessoa, como recomendado
        for i in range(3):
            await svc.cadastrar(db, ana_id, perturbar(rosto_ana, 0.10), MOD)
            await svc.cadastrar(db, bruno_id, perturbar(rosto_bruno, 0.10), MOD)
        await db.commit()
        n = (await db.execute(select(Biometria))).scalars().all()
        checar("6 vetores cadastrados", len(n) == 6, f"({len(n)})")

        print("\n2. consentimento é pré-requisito do cadastro")
        try:
            await svc.cadastrar(db, carla_id, vetor(3), MOD)
            checar("cadastro sem consentimento é bloqueado", False)
        except svc.SemConsentimento:
            checar("cadastro sem consentimento é bloqueado", True)
        await db.rollback()

        print("\n3. modelo incompatível é recusado")
        try:
            await svc.identificar(
                db, ponto_id=1, embedding=vetor(1), modelo="outro-modelo-v9"
            )
            checar("modelo divergente é recusado", False)
        except svc.ModeloIncompativel:
            checar("modelo divergente é recusado", True)
        await db.rollback()

        print("\n4. identificação de rosto conhecido")
        ident = await svc.identificar(
            db, ponto_id=1, embedding=perturbar(rosto_ana, 0.12), modelo=MOD
        )
        await db.commit()
        checar(
            "Ana é identificada",
            ident.resultado is ResultadoIdentificacao.IDENTIFICADO
            and ident.pessoa_id == ana_id,
            f"(dist={ident.distancia:.4f}, razao={ident.razao_2o_lugar:.2f})",
        )

        print("\n5. rosto desconhecido é rejeitado")
        ident2 = await svc.identificar(
            db, ponto_id=1, embedding=vetor(999), modelo=MOD
        )
        await db.commit()
        checar(
            "desconhecido não é identificado",
            ident2.resultado is ResultadoIdentificacao.NAO_IDENTIFICADO,
            f"(dist={ident2.distancia:.4f})",
        )

        print("\n6. teste de razão: dois rostos quase idênticos na base")
        # Sósia de Ana: vetor praticamente igual, cadastrado como outra pessoa
        db.add(
            ConsentimentoBiometrico(
                pessoa_id=carla_id, versao_termo="1.0", finalidade="teste"
            )
        )
        await db.flush()
        for _ in range(3):
            await svc.cadastrar(db, carla_id, perturbar(rosto_ana, 0.10), MOD)
        await db.commit()

        ident3 = await svc.identificar(
            db, ponto_id=1, embedding=perturbar(rosto_ana, 0.10), modelo=MOD
        )
        await db.commit()
        checar(
            "ambiguidade é detectada, não 'resolvida' no chute",
            ident3.resultado is ResultadoIdentificacao.AMBIGUO,
            f"(razao={ident3.razao_2o_lugar:.3f} < {settings.FACE_RAZAO_MIN})",
        )

        print("\n7. token de identificação é de uso único")
        await svc.consumir(db, ident.id)
        await db.commit()
        try:
            await svc.consumir(db, ident.id)
            checar("segundo uso do token é bloqueado", False)
        except svc.ErroBiometria:
            checar("segundo uso do token é bloqueado", True)
        await db.rollback()

        print("\n8. token de identificação sem sucesso não abre verificação")
        try:
            await svc.consumir(db, ident2.id)
            checar("token de não-identificado é recusado", False)
        except svc.ErroBiometria:
            checar("token de não-identificado é recusado", True)
        await db.rollback()

        print("\n9. revogação elimina os vetores (LGPD art. 18)")
        apagados = await svc.revogar_consentimento(db, ana_id)
        await db.commit()
        restantes = (
            await db.execute(select(Biometria).where(Biometria.pessoa_id == ana_id))
        ).scalars().all()
        checar(
            "vetores de Ana eliminados",
            apagados == 3 and len(restantes) == 0,
            f"(apagados={apagados})",
        )

        ident4 = await svc.identificar(
            db, ponto_id=1, embedding=perturbar(rosto_ana, 0.12), modelo=MOD
        )
        await db.commit()
        checar(
            "Ana não é mais reconhecida após revogação",
            ident4.pessoa_id != ana_id,
            f"({ident4.resultado.value})",
        )

        print("\n10. auditoria registra toda tentativa")
        tentativas = (await db.execute(select(Identificacao))).scalars().all()
        checar(
            "todas as tentativas ficaram registradas",
            len(tentativas) >= 4,
            f"({len(tentativas)} registros)",
        )

    await engine.dispose()
    print(f"\n{'=' * 52}")
    print(f"{ok} verificações passaram, {len(falhas)} falharam")
    if falhas:
        for f in falhas:
            print(f"  - {f}")
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
