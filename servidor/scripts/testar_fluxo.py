"""Teste de ponta a ponta do fluxo de verificação, com broker real.

Simula a Raspberry e o ESP32 em memória e exercita o caminho completo:

    identificação facial -> abrir verificação -> cmd/capturar ->
    evt/resultado -> decisão -> cmd/liberar -> evt/passagem

Exige Postgres (com pgvector) e Mosquitto no ar.

    python -m scripts.testar_fluxo
"""
from __future__ import annotations

import asyncio
import json
import random
import uuid
from datetime import datetime, timezone

import aiomqtt
from sqlalchemy import delete, select

from app.core.config import settings
from app.db.models import (
    Biometria,
    ConsentimentoBiometrico,
    Dispositivo,
    EventoAcesso,
    Identificacao,
    Pessoa,
    PontoAcesso,
    ResultadoIdentificacao,
    Site,
    StatusVerificacao,
    TipoDispositivo,
    TipoEventoAcesso,
    Verificacao,
)
from app.db.session import SessionLocal, engine
from app.mqtt import topics
from app.mqtt.publisher import publisher
from app.mqtt.schemas import PassagemEvt, ResultadoEvt, StatusEvt
from app.services import biometria as svc_bio
from app.services import dedup, presenca
from app.services import verificacao as svc

DIM = settings.FACE_EMBEDDING_DIM
MOD = settings.FACE_MODELO
rnd = random.Random(7)

ok, falhas = 0, []


def checar(nome: str, cond: bool, extra: str = "") -> None:
    global ok
    if cond:
        ok += 1
        print(f"  ok    {nome} {extra}")
    else:
        falhas.append(nome)
        print(f"  FALHA {nome} {extra}")


def vetor(semente: int) -> list[float]:
    r = random.Random(semente)
    return [r.gauss(0, 1) for _ in range(DIM)]


def ruido(base: list[float]) -> list[float]:
    return [x + rnd.gauss(0, 0.1) for x in base]


class BordaSimulada:
    """Faz o papel da Raspberry e do ESP32 num processo só."""

    def __init__(self, site: str, ponto: str, epis_presentes: set[str]) -> None:
        self.site, self.ponto = site, ponto
        self.epis_presentes = epis_presentes
        self.capturas: list[dict] = []
        self.liberacoes: list[dict] = []
        self._pronta = asyncio.Event()

    async def rodar(self, parar: asyncio.Event) -> None:
        async with aiomqtt.Client(
            hostname=settings.MQTT_HOST,
            port=settings.MQTT_PORT,
            identifier="borda-simulada",
        ) as cli:
            await cli.subscribe(topics.cmd_capturar(self.site, self.ponto), qos=1)
            await cli.subscribe(topics.cmd_liberar(self.site, self.ponto), qos=1)
            self._pronta.set()

            async def consumir() -> None:
                try:
                    async for msg in cli.messages:
                        t, p = str(msg.topic), json.loads(msg.payload)
                        if t.endswith("/cmd/capturar"):
                            self.capturas.append(p)
                            await self._responder(cli, p)
                        elif t.endswith("/cmd/liberar"):
                            self.liberacoes.append(p)
                            await self._passar(cli, p)
                except (aiomqtt.MqttError, asyncio.CancelledError):
                    pass  # encerramento normal do teste

            tarefa = asyncio.create_task(consumir())
            await parar.wait()
            tarefa.cancel()

    async def _responder(self, cli: aiomqtt.Client, cmd: dict) -> None:
        """Papel da Raspberry: infere e publica o resultado."""
        await asyncio.sleep(0.15)
        evt = ResultadoEvt(
            verificacao_id=uuid.UUID(cmd["verificacao_id"]),
            versao_modelo="yolov8n-epi-v3",
            latencia_ms=150,
            frames_analisados=5,
            deteccoes=[
                {
                    "epi": epi,
                    "presente": epi in self.epis_presentes,
                    "confianca": 0.94 if epi in self.epis_presentes else 0.21,
                    "frames_confirmados": 5 if epi in self.epis_presentes else 1,
                }
                for epi in cmd["epis_exigidos"]
            ],
        )
        await cli.publish(
            f"{topics.NS}/{topics.V}/{self.site}/{self.ponto}/evt/resultado",
            evt.model_dump_json().encode(),
            qos=1,
        )

    async def _passar(self, cli: aiomqtt.Client, cmd: dict) -> None:
        """Papel do ESP32: aciona o relé e confirma a passagem."""
        await asyncio.sleep(0.05)
        evt = PassagemEvt(
            verificacao_id=uuid.UUID(cmd["verificacao_id"]), evento="PASSOU"
        )
        await cli.publish(
            f"{topics.NS}/{topics.V}/{self.site}/{self.ponto}/evt/passagem",
            evt.model_dump_json().encode(),
            qos=1,
        )

    async def esperar_pronta(self) -> None:
        await self._pronta.wait()


async def worker_local(parar: asyncio.Event) -> None:
    """Mesma lógica de app.mqtt.worker, embutida para o teste."""
    from app.mqtt.worker import despachar

    async with aiomqtt.Client(
        hostname=settings.MQTT_HOST,
        port=settings.MQTT_PORT,
        identifier="worker-teste",
    ) as cli:
        for topico, qos in topics.ASSINATURAS:
            await cli.subscribe(topico, qos=qos)

        async def consumir() -> None:
            try:
                async for msg in cli.messages:
                    try:
                        await despachar(str(msg.topic), msg.payload)
                    except Exception as exc:  # noqa: BLE001
                        print(f"  [worker] erro em {msg.topic}: {exc!r}")
            except (aiomqtt.MqttError, asyncio.CancelledError):
                pass  # encerramento normal do teste

        tarefa = asyncio.create_task(consumir())
        await parar.wait()
        tarefa.cancel()


async def preparar() -> tuple[int, int, str, str]:
    """Limpa e monta o cenário. Devolve (ponto_id, pessoa_id, site, ponto)."""
    async with SessionLocal() as db:
        for tabela in (EventoAcesso, Verificacao, Identificacao, Biometria,
                       ConsentimentoBiometrico):
            await db.execute(delete(tabela))
        await db.execute(delete(Pessoa).where(Pessoa.matricula.like("E2E-%")))
        await db.commit()

        site = (await db.execute(select(Site))).scalars().first()
        ponto = (await db.execute(select(PontoAcesso))).scalars().first()

        pessoa = Pessoa(matricula="E2E-001", nome="Joana Silva", funcao="Soldadora")
        db.add(pessoa)
        await db.flush()
        pessoa_id = pessoa.id
        db.add(
            ConsentimentoBiometrico(
                pessoa_id=pessoa_id, versao_termo="1.0", finalidade="teste e2e"
            )
        )
        await db.flush()
        for _ in range(3):
            await svc_bio.cadastrar(db, pessoa_id, ruido(vetor(11)), MOD)

        await db.commit()
        return ponto.id, pessoa_id, site.codigo, ponto.codigo


async def anunciar_presenca(site: str, ponto: str) -> None:
    """Publica status retido pelos dois dispositivos, como eles fariam.

    Escrever `online = True` direto no banco não funciona: se o broker
    ainda tiver um status retido dizendo `offline` — de uma execução
    anterior dos simuladores, por exemplo —, ele reentrega essa mensagem
    assim que o worker assina, e o worker sobrescreve o banco de volta
    para offline.

    Isso é o retain fazendo exatamente o que deve. A correção é anunciar
    presença pelo caminho de verdade, que também limpa o estado retido.
    """
    for device_id in ("rasp-planta01-portaria", "esp32-planta01-portaria"):
        await publisher.publicar(
            f"{topics.NS}/{topics.V}/{site}/{ponto}/dev/{device_id}/status",
            StatusEvt(online=True, fw="1.4.2", modelo="yolov8n-epi-v3"),
            qos=1,
            retain=True,
        )


async def main() -> None:
    ponto_id, pessoa_id, site_cod, ponto_cod = await preparar()
    parar = asyncio.Event()

    # Client_id próprio: com o mesmo id da API que já está no ar, o
    # broker derruba uma das duas conexões e o teste falha com
    # "broker MQTT indisponível" por um motivo que não tem nada a ver
    # com o que ele testa.
    await publisher.start("teste-fluxo")
    await asyncio.sleep(0.6)
    checar("publicador conectado ao broker", publisher.conectado)

    borda = BordaSimulada(site_cod, ponto_cod, {"capacete", "oculos", "colete"})
    tarefas = [
        asyncio.create_task(borda.rodar(parar)),
        asyncio.create_task(worker_local(parar)),
    ]
    await borda.esperar_pronta()
    await asyncio.sleep(0.4)

    # ------------------------------------------------- 1. presença via LWT
    print("\n1. presença de dispositivo via status retido")
    await anunciar_presenca(site_cod, ponto_cod)
    await asyncio.sleep(1.0)   # o worker precisa processar os dois status
    async with SessionLocal() as db:
        esp = (
            await db.execute(
                select(Dispositivo).where(
                    Dispositivo.client_id_mqtt == "esp32-planta01-portaria"
                )
            )
        ).scalar_one()
        rasp = (
            await db.execute(
                select(Dispositivo).where(
                    Dispositivo.client_id_mqtt == "rasp-planta01-portaria"
                )
            )
        ).scalar_one()
        checar("ESP32 marcado online", esp.online and esp.firmware == "1.4.2")
        checar("Raspberry marcada online", rasp.online)

    # ------------------------------------------- 2. caminho feliz completo
    print("\n2. fluxo completo com todos os EPIs presentes")
    async with SessionLocal() as db:
        ident = await svc_bio.identificar(
            db, ponto_id=ponto_id, embedding=ruido(vetor(11)), modelo=MOD
        )
        await db.commit()
        checar(
            "identificação facial reconhece a pessoa",
            ident.resultado is ResultadoIdentificacao.IDENTIFICADO,
            f"(dist={ident.distancia:.4f})",
        )
        ident_consumida = await svc_bio.consumir(db, ident.id)
        verif = await svc.abrir(db, ponto_id=ponto_id, identificacao=ident_consumida)
        await db.commit()
        verif_id = verif.id

    await asyncio.sleep(1.6)

    checar("cmd/capturar chegou na Raspberry", len(borda.capturas) == 1)
    if borda.capturas:
        checar(
            "comando trouxe os EPIs exigidos",
            set(borda.capturas[0]["epis_exigidos"]) == {"capacete", "oculos", "colete"},
        )

    async with SessionLocal() as db:
        v = await db.get(Verificacao, verif_id)
        checar(
            "verificação aprovada",
            v.status is StatusVerificacao.APROVADA,
            f"({v.status.value}, latência={v.latencia_ms}ms)",
        )
        checar("pessoa vinculada à verificação", v.pessoa_id == pessoa_id)
        checar("versão do modelo registrada", v.versao_modelo == "yolov8n-epi-v3")
        checar("3 detecções persistidas", len(v.deteccoes) == 3)
        eventos = {e.evento for e in v.eventos}
        checar(
            "eventos LIBERADO e PASSOU registrados",
            {TipoEventoAcesso.LIBERADO, TipoEventoAcesso.PASSOU} <= eventos,
            f"({[e.value for e in eventos]})",
        )

    checar("cmd/liberar publicado", len(borda.liberacoes) == 1)
    if borda.liberacoes:
        checar(
            "comando de liberação tem prazo de validade",
            "expira_em" in borda.liberacoes[0],
        )

    # ------------------------------------------------ 3. reprovação
    print("\n3. fluxo com EPI faltando")
    borda.epis_presentes = {"capacete", "colete"}  # sem óculos
    async with SessionLocal() as db:
        v2 = await svc.abrir(db, ponto_id=ponto_id, identificacao=None)
        await db.commit()
        v2_id = v2.id

    await asyncio.sleep(1.2)

    async with SessionLocal() as db:
        v2 = await db.get(Verificacao, v2_id)
        checar(
            "verificação reprovada",
            v2.status is StatusVerificacao.REPROVADA,
            f"({v2.motivo_falha})",
        )
        checar(
            "motivo nomeia o EPI que faltou",
            v2.motivo_falha and "Óculos" in v2.motivo_falha,
        )
        checar("catraca NÃO foi liberada", len(borda.liberacoes) == 1)
        checar(
            "evento NEGADO registrado",
            any(e.evento is TipoEventoAcesso.NEGADO for e in v2.eventos),
        )

    # ------------------------------------------------ 4. deduplicação
    print("\n4. duplicata de QoS 1 é descartada")
    async with SessionLocal() as db:
        msg_id = uuid.uuid4()
        primeira = await dedup.registrar(db, msg_id, "t")
        segunda = await dedup.registrar(db, msg_id, "t")
        await db.commit()
        checar("primeira passa, segunda é bloqueada", primeira and not segunda)

    # ------------------------------------------------ 5. expiração
    print("\n5. verificação sem resposta expira")
    async with SessionLocal() as db:
        pendente = Verificacao(
            id=uuid.uuid4(),
            ponto_id=ponto_id,
            expira_em=datetime(2020, 1, 1, tzinfo=timezone.utc),
        )
        db.add(pendente)
        await db.commit()
        pid = pendente.id
        n = await svc.expirar_pendentes(db)
        await db.commit()
        v3 = await db.get(Verificacao, pid)
        checar(
            "pendente virou EXPIRADA",
            n >= 1 and v3.status is StatusVerificacao.EXPIRADA,
        )

    # ------------------------------------------------ 6. ponto offline
    print("\n6. câmera offline recusa a verificação na hora")
    async with SessionLocal() as db:
        rasp = (
            await db.execute(
                select(Dispositivo).where(
                    Dispositivo.tipo == TipoDispositivo.RASPBERRY
                )
            )
        ).scalars().first()
        rasp.online = False
        await db.commit()
        try:
            await svc.abrir(db, ponto_id=ponto_id, identificacao=None)
            checar("abertura é recusada com câmera offline", False)
        except svc.PontoIndisponivel as exc:
            checar("abertura é recusada com câmera offline", True, f"({exc})")
        await db.rollback()

    parar.set()
    for t in tarefas:
        t.cancel()
    await asyncio.gather(*tarefas, return_exceptions=True)
    await publisher.stop()
    await engine.dispose()

    print(f"\n{'=' * 52}")
    print(f"{ok} verificações passaram, {len(falhas)} falharam")
    if falhas:
        for f in falhas:
            print(f"  - {f}")
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
