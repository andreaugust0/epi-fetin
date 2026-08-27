"""Verifica os simuladores contra o servidor de verdade.

Sobe o worker MQTT do servidor, deixa os simuladores rodarem como
processos separados (exatamente como seu amigo vai rodar) e exercita os
quatro cenários que importam.

Pré-requisitos: Postgres e Mosquitto no ar.

    python -m scripts.testar_simuladores
"""
from __future__ import annotations

import asyncio
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

from app.db.models import (
    Deteccao,
    Dispositivo,
    EventoAcesso,
    Identificacao,
    PontoAcesso,
    StatusVerificacao,
    TipoEventoAcesso,
    Verificacao,
)
from app.db.session import SessionLocal, engine
from app.mqtt.publisher import publisher
from app.services import verificacao as svc

ok, falhas = 0, []


def checar(nome: str, cond: bool, extra: str = "") -> None:
    global ok
    if cond:
        ok += 1
        print(f"  ok    {nome} {extra}")
    else:
        falhas.append(nome)
        print(f"  FALHA {nome} {extra}")


def subir(modulo: str, *flags: str) -> subprocess.Popen:
    return subprocess.Popen(
        [sys.executable, "-m", modulo, *flags],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


async def worker(parar: asyncio.Event) -> None:
    """O consumidor real do servidor, embutido para o teste."""
    import aiomqtt
    from app.core.config import settings
    from app.mqtt import topics
    from app.mqtt.worker import despachar

    async with aiomqtt.Client(
        hostname=settings.MQTT_HOST, port=settings.MQTT_PORT,
        identifier="worker-teste-sim",
    ) as cli:
        for topico, qos in topics.ASSINATURAS:
            await cli.subscribe(topico, qos=qos)

        async def consumir() -> None:
            try:
                async for msg in cli.messages:
                    try:
                        await despachar(str(msg.topic), msg.payload)
                    except Exception as exc:  # noqa: BLE001
                        print(f"    [worker] {msg.topic}: {exc!r}")
            except (aiomqtt.MqttError, asyncio.CancelledError):
                pass

        t = asyncio.create_task(consumir())
        await parar.wait()
        t.cancel()


async def limpar() -> int:
    async with SessionLocal() as db:
        for t in (EventoAcesso, Deteccao, Verificacao, Identificacao):
            await db.execute(delete(t))
        await db.commit()
        ponto = (await db.execute(select(PontoAcesso))).scalars().first()
        return ponto.id


async def abrir_e_esperar(ponto_id: int, segundos: float) -> Verificacao | None:
    async with SessionLocal() as db:
        try:
            v = await svc.abrir(db, ponto_id=ponto_id, identificacao=None)
        except svc.PontoIndisponivel:
            return None
        await db.commit()
        vid = v.id
    await asyncio.sleep(segundos)
    async with SessionLocal() as db:
        return await db.get(Verificacao, vid)


async def presenca(client_id: str) -> bool:
    async with SessionLocal() as db:
        d = (await db.execute(
            select(Dispositivo).where(Dispositivo.client_id_mqtt == client_id)
        )).scalar_one_or_none()
        return bool(d and d.online)


async def main() -> None:
    ponto_id = await limpar()
    parar = asyncio.Event()
    await publisher.start()
    tarefa_worker = asyncio.create_task(worker(parar))
    await asyncio.sleep(1.0)

    procs: list[subprocess.Popen] = []

    try:
        # ---------------------------------------------- 1. presença via LWT
        print("\n1. os simuladores se anunciam pelo status retido")
        procs += [subir("simuladores.raspberry"), subir("simuladores.esp32")]
        await asyncio.sleep(3.0)
        checar("Raspberry marcada online",
               await presenca("rasp-planta01-portaria"))
        checar("ESP32 marcado online",
               await presenca("esp32-planta01-portaria"))

        # ---------------------------------------------- 2. caminho feliz
        print("\n2. caminho feliz — todos os EPIs presentes")
        v = await abrir_e_esperar(ponto_id, 4.0)
        checar("verificação aprovada",
               v is not None and v.status is StatusVerificacao.APROVADA,
               f"({v.status.value if v else 'não abriu'})")
        if v:
            checar("três detecções persistidas", len(v.deteccoes) == 3,
                   f"({len(v.deteccoes)})")
            checar("versão do modelo veio do simulador",
                   v.versao_modelo == "yolov8n-epi-sim", f"({v.versao_modelo})")
            eventos = {e.evento for e in v.eventos}
            checar("LIBERADO e PASSOU registrados",
                   {TipoEventoAcesso.LIBERADO, TipoEventoAcesso.PASSOU} <= eventos,
                   f"({sorted(e.value for e in eventos)})")

        # ---------------------------------------------- 3. reprovação
        print("\n3. reprovação — Raspberry reporta capacete ausente")
        for p in procs:
            p.terminate()
        await asyncio.sleep(1.5)
        procs = [subir("simuladores.raspberry", "--faltando", "capacete"),
                 subir("simuladores.esp32")]
        await asyncio.sleep(3.0)

        v = await abrir_e_esperar(ponto_id, 4.0)
        checar("verificação reprovada",
               v is not None and v.status is StatusVerificacao.REPROVADA,
               f"({v.motivo_falha if v else 'não abriu'})")
        if v:
            checar("evento NEGADO registrado",
                   any(e.evento is TipoEventoAcesso.NEGADO for e in v.eventos))
            checar("catraca não foi liberada",
                   not any(e.evento is TipoEventoAcesso.LIBERADO
                           for e in v.eventos))

        # ---------------------------------------------- 4. timeout
        print("\n4. Raspberry muda — comando ignorado de propósito")
        for p in procs:
            p.terminate()
        await asyncio.sleep(1.5)
        procs = [subir("simuladores.raspberry", "--mudo"),
                 subir("simuladores.esp32")]
        await asyncio.sleep(3.0)

        async with SessionLocal() as db:
            v = await svc.abrir(db, ponto_id=ponto_id, identificacao=None)
            await db.commit()
            vid = v.id
        await asyncio.sleep(1.0)
        # Força o vencimento em vez de esperar os 10s reais
        async with SessionLocal() as db:
            pend = await db.get(Verificacao, vid)
            pend.expira_em = datetime.now(timezone.utc) - timedelta(seconds=1)
            await db.commit()
            n = await svc.expirar_pendentes(db)
            await db.commit()
            v = await db.get(Verificacao, vid)
        checar("verificação sem resposta vira EXPIRADA",
               v.status is StatusVerificacao.EXPIRADA, f"({n} expirada(s))")

        # ---------------------------------------------- 5. câmera offline
        print("\n5. Raspberry offline — servidor recusa na hora")
        for p in procs:
            p.terminate()
        await asyncio.sleep(2.5)  # dá tempo do LWT/despedida chegar
        checar("Raspberry marcada offline",
               not await presenca("rasp-planta01-portaria"))

        async with SessionLocal() as db:
            try:
                await svc.abrir(db, ponto_id=ponto_id, identificacao=None)
                checar("abertura recusada com câmera offline", False)
            except svc.PontoIndisponivel as exc:
                checar("abertura recusada com câmera offline", True, f"({exc})")
            await db.rollback()

        # ---------------------------------------------- 6. liberar sem passar
        print("\n6. catraca libera e ninguém atravessa")
        procs = [subir("simuladores.raspberry"),
                 subir("simuladores.esp32", "--nao-passar")]
        await asyncio.sleep(3.0)
        v = await abrir_e_esperar(ponto_id, 8.0)
        if v:
            eventos = {e.evento for e in v.eventos}
            checar("aprovada, mas com TIMEOUT_SEM_PASSAGEM",
                   v.status is StatusVerificacao.APROVADA
                   and TipoEventoAcesso.TIMEOUT_SEM_PASSAGEM in eventos,
                   f"({sorted(e.value for e in eventos)})")
        else:
            checar("aprovada, mas com TIMEOUT_SEM_PASSAGEM", False, "(não abriu)")

    finally:
        for p in procs:
            p.terminate()
        parar.set()
        tarefa_worker.cancel()
        await asyncio.gather(tarefa_worker, return_exceptions=True)
        await publisher.stop()
        await engine.dispose()

    print(f"\n{'=' * 56}")
    print(f"{ok} verificações passaram, {len(falhas)} falharam")
    if falhas:
        for f in falhas:
            print(f"  - {f}")
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
