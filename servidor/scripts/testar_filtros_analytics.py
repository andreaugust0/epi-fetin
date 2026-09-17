"""Testa a lógica pura de `app.services.filtros_analytics` — sem banco.

    python -m scripts.testar_filtros_analytics

Cobre especificamente o que motivou este script: a conversão de "dia
escolhido no filtro" para o instante UTC correto, dado o fuso de exibição
do servidor (`TZ_EXIBICAO`, padrão `America/Sao_Paulo`, UTC-3). Uma
verificação feita às 23h de horário local precisa continuar pertencendo ao
dia em que de fato aconteceu — não ao dia seguinte só porque em UTC o
relógio já virou.

Não precisa de Postgres nem de MQTT: `filtros_analytics()` e
`periodo_anterior()` são funções puras, e é isso que torna possível testar
esta regra isoladamente, sem depender da infraestrutura inteira do projeto
só para verificar uma conta de fuso horário.
"""
from __future__ import annotations

import os

os.environ.setdefault("JWT_SECRET", "x" * 40)
os.environ.setdefault("MQTT_CLIENT_ID_API", "teste-filtros-analytics")

from datetime import date, datetime, timezone  # noqa: E402

from app.services.filtros_analytics import (  # noqa: E402
    filtros_analytics,
    periodo_anterior,
)
from app.db.models import StatusVerificacao  # noqa: E402

ok, falhas = 0, []


def checar(nome: str, cond: bool, extra: str = "") -> None:
    global ok
    if cond:
        ok += 1
        print(f"  ok    {nome} {extra}")
    else:
        falhas.append(nome)
        print(f"  FALHA {nome} {extra}")


def _filtros(desde=None, ate=None, **resto):
    padrao = dict(
        ponto_id=None, situacao=None, setor=None, tipo_epi=None,
        pessoa_id=None, versao_modelo=None,
    )
    padrao.update(resto)
    return filtros_analytics(desde=desde, ate=ate, **padrao)


def main() -> None:
    print("1. um único dia vira uma janela de 24h no fuso local")
    f = _filtros(desde=date(2026, 9, 17), ate=date(2026, 9, 17))
    checar(
        "início = meia-noite local em UTC (03:00 para UTC-3)",
        f.desde == datetime(2026, 9, 17, 3, 0, tzinfo=timezone.utc),
        f"(veio {f.desde})",
    )
    checar(
        "fim exclusivo = meia-noite local do dia seguinte",
        f.ate_exclusivo == datetime(2026, 9, 18, 3, 0, tzinfo=timezone.utc),
        f"(veio {f.ate_exclusivo})",
    )
    checar(
        "a janela tem exatamente 24 horas",
        (f.ate_exclusivo - f.desde).total_seconds() == 24 * 3600,
    )

    print("\n2. verificação perto da meia-noite cai no dia certo")
    # 23h30 local do dia 17 == 02h30 UTC do dia 18.
    verif_2330_dia17 = datetime(2026, 9, 18, 2, 30, tzinfo=timezone.utc)
    checar(
        "23h30 local do dia 17 pertence ao filtro do dia 17",
        f.desde <= verif_2330_dia17 < f.ate_exclusivo,
    )
    # 00h30 local do dia 17 == 03h30 UTC do dia 17.
    verif_0030_dia17 = datetime(2026, 9, 17, 3, 30, tzinfo=timezone.utc)
    checar(
        "00h30 local do dia 17 pertence ao filtro do dia 17",
        f.desde <= verif_0030_dia17 < f.ate_exclusivo,
    )
    # 23h30 local do dia 16 (véspera) == 02h30 UTC do dia 17 — não deveria
    # aparecer no filtro do dia 17. Este é exatamente o caso que o bug
    # original quebrava (usando `{data}T00:00:00Z` ingênuo).
    verif_2330_dia16 = datetime(2026, 9, 17, 2, 30, tzinfo=timezone.utc)
    checar(
        "23h30 local do dia 16 NÃO pertence ao filtro do dia 17",
        not (f.desde <= verif_2330_dia16 < f.ate_exclusivo),
    )

    print("\n3. intervalo de vários dias")
    f2 = _filtros(desde=date(2026, 9, 1), ate=date(2026, 9, 17))
    dias = (f2.ate_exclusivo - f2.desde).days
    checar(f"01/09 a 17/09 (inclusive) = 17 dias exatos", dias == 17, f"(veio {dias})")

    print("\n4. período anterior")
    desde_ant, ate_ant = periodo_anterior(f2)
    checar("fim do período anterior == início do período atual", ate_ant == f2.desde)
    checar(
        "período anterior tem a mesma duração do atual",
        (ate_ant - desde_ant) == (f2.ate_exclusivo - f2.desde),
    )

    print("\n5. sem desde/ate não há período anterior")
    f3 = _filtros()
    checar(
        "desde e ate_exclusivo ficam None",
        f3.desde is None and f3.ate_exclusivo is None,
    )
    checar(
        "período anterior é (None, None) — não inventa comparação",
        periodo_anterior(f3) == (None, None),
    )

    print("\n6. situação é convertida corretamente")
    f4 = _filtros(situacao=StatusVerificacao.REPROVADA)
    checar("situacao preservada", f4.situacao == StatusVerificacao.REPROVADA)

    print(f"\n{'=' * 56}")
    print(f"{ok} verificações passaram, {len(falhas)} falharam")
    if falhas:
        for nome in falhas:
            print(f"  - {nome}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
