"""Popula o banco com histórico SINTÉTICO, para o painel ter o que mostrar.

    docker compose exec api python -m scripts.semear_demo
    docker compose exec api python -m scripts.semear_demo --dias 60
    docker compose exec api python -m scripts.semear_demo --apagar

ISTO NÃO É DADO REAL, e essa frase precisa sair da sua boca antes de a banca
perguntar. O painel executivo mostra tendência, concentração por horário e
reincidência — três coisas que precisam de semanas de histórico para dizerem
qualquer coisa. Com as poucas dezenas de verificações de teste, os gráficos
ficam vazios e a tela não comunica o que foi construída para comunicar.

Este script existe para você ensaiar a apresentação e tirar capturas de tela
com o painel cheio. Ele NÃO deve rodar num sistema que já tenha registros de
verdade — misturar as duas coisas destrói a única base real que você tem, e
não há como separá-las depois.

O que ele gera, e por que assim:

* **As pessoas têm perfis diferentes.** Todo mundo com a mesma taxa de erro
  produziria um ranking de reincidência sorteado, e a lista existe para
  apontar quem precisa de treinamento. Aqui algumas pessoas erram bem mais
  que outras — como acontece.

* **Os bloqueios se concentram no início do turno.** É o padrão real de
  campo: quem chega às sete ainda não passou no vestiário. Sem isso, o mapa
  de calor vira ruído uniforme e não sugere ação nenhuma.

* **A conformidade melhora ao longo do período.** É o efeito que o sistema
  deveria ter — as pessoas se ajustam quando a barreira é consistente. A
  curva sobe de propósito, e você precisa dizer isso ao apresentar: é a
  hipótese sendo ilustrada, não medida.

* **Fins de semana têm pouquíssimo movimento**, e alguns dias não têm nenhum.
  Uma série perfeitamente regular denuncia sozinha que é sintética.
"""
from __future__ import annotations

import argparse
import asyncio
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select

from app.core.config import settings

from app.db.models import (
    Deteccao,
    EpiExigido,
    EventoAcesso,
    Pessoa,
    PontoAcesso,
    StatusVerificacao,
    TipoEpi,
    TipoEventoAcesso,
    Verificacao,
)
from app.db.session import SessionLocal

VERDE, VERMELHO, AMARELO, CINZA, OFF = (
    "\033[32m", "\033[31m", "\033[33m", "\033[90m", "\033[0m",
)

#: Marca que identifica tudo que este script criou. É o que torna
#: `--apagar` seguro: sem ela, limpar a demonstração exigiria adivinhar
#: quais registros eram de verdade.
MARCA = "[demo]"

#: Pessoas fictícias com perfis diferentes de conformidade.
#: `descuido` é a probabilidade de a pessoa esquecer algum EPI.
#:
#: São 24, e o número não é enfeite: com dez pessoas passando duas vezes ao
#: dia, um mês e meio rende umas quatro dezenas de bloqueios espalhados por
#: 7 dias × 5 horários — quase toda célula do mapa de calor fica com zero ou
#: um, e duas coincidências numa quinta às 15h pintam de vermelho um horário
#: que não tem problema nenhum. Volume não é vaidade aqui; abaixo dele o
#: mapa mostra ruído e o ranking de reincidência é sorteio.
#:
#: A distribuição imita o que se vê em campo: a maioria cumpre, um punhado
#: escorrega às vezes, dois ou três são o problema recorrente.
ELENCO = [
    ("Ana Beatriz Ramos", "Operação", 0.04),
    ("Bruno Teixeira", "Operação", 0.07),
    ("Carlos Eduardo Lima", "Manutenção", 0.27),
    ("Daniela Souza", "Operação", 0.05),
    ("Eduardo Prado", "Logística", 0.18),
    ("Fernanda Alves", "Qualidade", 0.03),
    ("Gabriel Martins", "Manutenção", 0.35),
    ("Helena Castro", "Operação", 0.08),
    ("Igor Nascimento", "Logística", 0.12),
    ("Juliana Ferreira", "Operação", 0.05),
    ("Karina Belmiro", "Qualidade", 0.02),
    ("Lucas Andrade", "Manutenção", 0.23),
    ("Marcos Vinícius Rocha", "Logística", 0.09),
    ("Natália Peixoto", "Operação", 0.06),
    ("Otávio Bernardes", "Manutenção", 0.16),
    ("Patrícia Nogueira", "Qualidade", 0.03),
    ("Rafael Quintino", "Logística", 0.14),
    ("Sabrina Coelho", "Operação", 0.07),
    ("Thiago Marques", "Manutenção", 0.30),
    ("Vanessa Duarte", "Operação", 0.04),
    ("Wesley Antunes", "Logística", 0.11),
    ("Yasmin Pacheco", "Qualidade", 0.02),
    ("Rodrigo Sanfelice", "Operação", 0.06),
    ("Simone Batalha", "Manutenção", 0.19),
]

#: Chance de a pessoa aparecer num dia útil. O resto é férias, atestado,
#: folga — e é o que faz o total diário oscilar sem parecer sorteado.
PRESENCA = 0.88

#: Num fim de semana só uma equipe reduzida entra.
EQUIPE_FDS = (3, 6)

#: Peso de cada EPI ser o esquecido. Protetor auricular e óculos lideram
#: porque incomodam; capacete quase ninguém esquece.
PESO_ESQUECIMENTO = {
    "auricular": 5,
    "oculos": 4,
    "luvas": 3,
    "mascara": 2,
    "colete": 1,
    "botas": 1,
    "capacete": 1,
}


#: O fuso em que a fábrica vive. O banco guarda tudo em UTC, mas o turno
#: começa às sete DAQUI — e é assim que o mapa de horários do painel corta
#: os dados (`func.timezone(settings.TZ_EXIBICAO, ...)`).
#:
#: Gravar 07:00 UTC direto colocaria o pico das quatro da manhã no painel, e
#: o gráfico contaria uma história sobre um turno da madrugada que não
#: existe. O relógio da simulação é local; a conversão para UTC é a última
#: coisa que acontece.
FUSO = ZoneInfo(settings.TZ_EXIBICAO)


def _horario(dia: datetime, tipo: str, rnd: random.Random) -> datetime:
    """Posiciona uma passagem no relógio local e devolve o instante em UTC.

    A jornada não é uniforme: quase todo mundo cruza a catraca às sete e de
    novo depois do almoço, e umas poucas passagens acontecem à tarde. Sortear
    a hora livremente espalharia o movimento por nove colunas do mapa de
    calor e apagaria justamente o padrão que ele existe para mostrar.

    `dia` é meia-noite local, com fuso.
    """
    if tipo == "entrada":
        hora, minuto = 7, rnd.randint(0, 44)
    elif tipo == "almoco":
        hora, minuto = 13, rnd.randint(0, 34)
    else:
        # A saída da tarde é uma janela só, não três.
        #
        # Espalhada entre 14h e 16h, cada célula do mapa (um dia da semana ×
        # uma hora) ficava com quatro ou cinco passagens no mês — abaixo do
        # mínimo que o mapa exige para colorir, então a tarde inteira saía
        # hachurada. Concentrada às 15h, a coluna tem amostra de verdade e o
        # contraste com o início de turno passa a significar alguma coisa.
        hora, minuto = 15, rnd.randint(0, 59)
    local = dia.replace(hour=hora, minute=minuto, second=rnd.randint(0, 59))
    return local.astimezone(timezone.utc)


def _passagens(rnd: random.Random) -> list[str]:
    """Os motivos pelos quais uma pessoa cruza a catraca num dia.

    Entrada e volta do almoço são a regra; a ida à tarde (almoxarifado,
    outra área) é ocasional.
    """
    motivos = ["entrada", "almoco"]
    if rnd.random() < 0.22:
        motivos.append("tarde")
    return motivos


async def apagar(db) -> int:
    """Remove só o que este script criou."""
    pessoas = (
        await db.execute(select(Pessoa.id).where(Pessoa.nome.like(f"%{MARCA}")))
    ).scalars().all()
    if not pessoas:
        return 0

    verifs = (
        await db.execute(
            select(Verificacao.id).where(Verificacao.pessoa_id.in_(pessoas))
        )
    ).scalars().all()

    if verifs:
        await db.execute(delete(EventoAcesso).where(EventoAcesso.verificacao_id.in_(verifs)))
        await db.execute(delete(Deteccao).where(Deteccao.verificacao_id.in_(verifs)))
        await db.execute(delete(Verificacao).where(Verificacao.id.in_(verifs)))
    await db.execute(delete(Pessoa).where(Pessoa.id.in_(pessoas)))
    await db.commit()
    return len(verifs)


async def semear(dias: int, semente: int) -> int:
    rnd = random.Random(semente)

    async with SessionLocal() as db:
        ponto = (await db.execute(select(PontoAcesso).limit(1))).scalar_one_or_none()
        if ponto is None:
            print(f"{VERMELHO}nenhum ponto de acesso. Rode antes: "
                  f"python -m scripts.init_db{OFF}")
            return 1

        exigidos = list(
            (
                await db.execute(
                    select(TipoEpi)
                    .join(EpiExigido, EpiExigido.tipo_epi_id == TipoEpi.id)
                    .where(EpiExigido.ponto_id == ponto.id)
                )
            ).scalars().all()
        )
        if not exigidos:
            print(f"{VERMELHO}o ponto {ponto.codigo!r} não exige nenhum EPI. "
                  f"Configure antes: python -m scripts.exigir_epis capacete "
                  f"colete oculos{OFF}")
            return 1

        # Recusa rodar sobre base real. Verificações de pessoas que não são
        # da demonstração são dado de verdade, e não há como desfazer a
        # mistura depois.
        reais = (
            await db.execute(
                select(func.count(Verificacao.id))
                .join(Pessoa, Pessoa.id == Verificacao.pessoa_id)
                .where(Pessoa.nome.not_like(f"%{MARCA}"))
            )
        ).scalar_one()
        if reais > 0:
            print(
                f"{VERMELHO}há {reais} verificação(ões) de pessoas reais neste "
                f"banco.{OFF}\n"
                f"{CINZA}Semear a demonstração por cima misturaria dado real com "
                f"sintético, e depois não há como separar. Use um banco limpo "
                f"para ensaiar a apresentação.{OFF}"
            )
            return 1

        await apagar(db)

        pessoas = []
        for nome, funcao, descuido in ELENCO:
            p = Pessoa(nome=f"{nome} {MARCA}", funcao=funcao, ativo=True)
            db.add(p)
            pessoas.append((p, descuido))
        await db.flush()

        pesos = [PESO_ESQUECIMENTO.get(e.codigo, 1) for e in exigidos]
        agora = datetime.now(FUSO)
        criadas = 0

        for d in range(dias, 0, -1):
            # Meia-noite LOCAL: é o calendário da fábrica que decide o que é
            # fim de semana, e é nele que o dia da semana do mapa é lido.
            dia = (agora - timedelta(days=d)).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            fds = dia.weekday() >= 5

            # Alguns dias simplesmente não têm movimento — feriado, parada
            # de fábrica. Uma série sem buracos não parece operação real.
            if rnd.random() < (0.55 if fds else 0.04):
                continue

            # Quem trabalha hoje. Num dia útil quase todo mundo; num fim de
            # semana, uma equipe reduzida. Sortear passagens soltas em vez de
            # montar a escala pessoa a pessoa daria a um funcionário 26
            # passagens e a outro 50 — e aí o ranking de reincidência estaria
            # comparando taxas medidas com precisões diferentes.
            if fds:
                escala = rnd.sample(pessoas, rnd.randint(*EQUIPE_FDS))
            else:
                escala = [p for p in pessoas if rnd.random() < PRESENCA]

            # A conformidade melhora ao longo do período: no começo o
            # descuido é maior que o nominal, no fim cai à metade.
            progresso = 1 - (d / dias)
            fator = 1.15 - 0.65 * progresso

            agenda = [
                (pessoa, descuido, tipo)
                for pessoa, descuido in escala
                for tipo in _passagens(rnd)
            ]

            for pessoa, descuido, tipo in agenda:
                quando = _horario(dia, tipo, rnd)

                # No pico da entrada erra-se mais: a pessoa vem do vestiário.
                risco = descuido * fator * (1.7 if tipo == "entrada" else 0.6)
                reprovada = rnd.random() < risco

                v = Verificacao(
                    id=uuid.uuid4(),
                    ponto_id=ponto.id,
                    pessoa_id=pessoa.id,
                    status=(
                        StatusVerificacao.REPROVADA if reprovada
                        else StatusVerificacao.APROVADA
                    ),
                    iniciada_em=quando,
                    concluida_em=quando + timedelta(milliseconds=rnd.randint(90, 900)),
                    expira_em=quando + timedelta(seconds=10),
                    latencia_ms=rnd.randint(80, 850),
                    versao_modelo="epi-hailo-int8-v1",
                )

                faltando: set[int] = set()
                if reprovada:
                    quantos = min(1 if rnd.random() < 0.82 else 2, len(exigidos))
                    # Sorteio ponderado SEM repetição: retirar o escolhido a
                    # cada rodada. `rnd.choices` sortearia com reposição e
                    # poderia devolver o mesmo EPI duas vezes, produzindo uma
                    # reprovação por "dois capacetes ausentes".
                    restantes = list(zip(exigidos, pesos))
                    for _ in range(quantos):
                        itens, ws = zip(*restantes)
                        escolhido = rnd.choices(itens, weights=ws, k=1)[0]
                        faltando.add(escolhido.id)
                        restantes = [(e, w) for e, w in restantes if e.id != escolhido.id]
                    v.motivo_falha = "EPI ausente: " + ", ".join(
                        sorted(e.rotulo for e in exigidos if e.id in faltando)
                    )

                db.add(v)
                await db.flush()

                for epi in exigidos:
                    ausente = epi.id in faltando
                    db.add(
                        Deteccao(
                            verificacao_id=v.id,
                            tipo_epi_id=epi.id,
                            presente=not ausente,
                            # Presente sai com folga acima do limiar; ausente
                            # sai baixo, como o modelo real reporta.
                            confianca=(
                                round(rnd.uniform(0.10, 0.35), 3) if ausente
                                else round(rnd.uniform(0.72, 0.98), 3)
                            ),
                            frames_confirmados=0 if ausente else rnd.randint(3, 5),
                        )
                    )

                db.add(
                    EventoAcesso(
                        verificacao_id=v.id,
                        evento=(
                            TipoEventoAcesso.NEGADO if reprovada
                            else TipoEventoAcesso.LIBERADO
                        ),
                        ocorrido_em=v.concluida_em,
                    )
                )

                # Liberação manual: rara, e só depois de uma reprovação —
                # é o supervisor destravando alguém que ficou preso.
                if reprovada and rnd.random() < 0.05:
                    db.add(
                        EventoAcesso(
                            verificacao_id=v.id,
                            evento=TipoEventoAcesso.LIBERACAO_MANUAL,
                            ocorrido_em=v.concluida_em + timedelta(minutes=rnd.randint(1, 6)),
                            justificativa=rnd.choice(
                                [
                                    "Colete danificado; substituído no almoxarifado.",
                                    "Falha de leitura; conferido presencialmente.",
                                    "Visitante acompanhado pela segurança.",
                                ]
                            ),
                        )
                    )

                criadas += 1

        await db.commit()
        return 0 if criadas else 1


async def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--dias", type=int, default=45, help="quantos dias de histórico")
    p.add_argument("--semente", type=int, default=7, help="para repetir o mesmo cenário")
    p.add_argument("--apagar", action="store_true", help="remove só os dados de demonstração")
    args = p.parse_args()

    if args.apagar:
        async with SessionLocal() as db:
            n = await apagar(db)
        print(f"{VERDE}removidas {n} verificações de demonstração{OFF}")
        return 0

    print(
        f"\n{AMARELO}Estes dados são SINTÉTICOS.{OFF} {CINZA}Servem para ensaiar a "
        f"apresentação e ver o painel cheio.\nAo mostrar a alguém, diga que são "
        f"simulados — a tendência de melhora é a hipótese\nsendo ilustrada, não "
        f"medida.{OFF}\n"
    )

    codigo = await semear(args.dias, args.semente)
    if codigo:
        return codigo

    async with SessionLocal() as db:
        total = (
            await db.execute(
                select(func.count(Verificacao.id))
                .join(Pessoa, Pessoa.id == Verificacao.pessoa_id)
                .where(Pessoa.nome.like(f"%{MARCA}"))
            )
        ).scalar_one()
        reprovadas = (
            await db.execute(
                select(func.count(Verificacao.id))
                .join(Pessoa, Pessoa.id == Verificacao.pessoa_id)
                .where(
                    Pessoa.nome.like(f"%{MARCA}"),
                    Verificacao.status == StatusVerificacao.REPROVADA,
                )
            )
        ).scalar_one()

    print(f"{VERDE}{total}{OFF} verificações em {args.dias} dias · "
          f"{VERMELHO}{reprovadas}{OFF} bloqueios "
          f"({100 * reprovadas / total:.1f}%)")
    print(f"{CINZA}para desfazer: python -m scripts.semear_demo --apagar{OFF}\n")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
