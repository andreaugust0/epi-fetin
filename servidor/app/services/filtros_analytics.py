"""Filtros globais da área de Relatórios e Analytics.

Todo endpoint em `app.api.v1.analytics` lê o mesmo conjunto de parâmetros e
aplica as mesmas condições sobre `Verificacao`. Sem este módulo, cada
endpoint reimplementaria "junta com Pessoa para achar o setor" e "existe uma
Deteccao deste tipo de EPI nesta verificação" — e um dia os dois
implementariam de um jeito ligeiramente diferente.

As condições devolvidas por `condicoes()` funcionam tanto em consultas que
selecionam colunas soltas (`select(func.count(...))`) quanto em consultas que
selecionam a entidade inteira (`select(Verificacao)`), porque usam
subconsultas (`IN`) em vez de `JOIN` — um `JOIN` explícito colidiria com o
`lazy="joined"` que `Verificacao.pessoa` já declara no modelo.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import Query
from sqlalchemy import ColumnElement, select

from app.core.config import settings
from app.db.models import Deteccao, Pessoa, StatusVerificacao, TipoEpi, Verificacao


@dataclass(frozen=True, slots=True)
class FiltrosAnalytics:
    """`desde` e `ate_exclusivo` já vêm convertidos para UTC — um intervalo
    semiaberto `[desde, ate_exclusivo)` — a partir do dia de calendário
    escolhido no fuso de exibição do servidor. Ver `_inicio_do_dia_local`."""

    desde: datetime | None
    ate_exclusivo: datetime | None
    ponto_id: int | None
    situacao: StatusVerificacao | None
    setor: str | None
    tipo_epi: str | None
    pessoa_id: int | None
    versao_modelo: str | None


def _inicio_do_dia_local(d: date) -> datetime:
    """Meia-noite de `d` no fuso de exibição do servidor, convertida a UTC.

    Uma verificação às 22h de horário local em `America/Sao_Paulo` (UTC-3) é
    01h UTC do dia SEGUINTE. Comparar a data escolhida no filtro diretamente
    contra meia-noite UTC — em vez de meia-noite local — jogaria essa
    verificação para o dia errado: ausente do dia em que de fato aconteceu,
    presente no seguinte. `ZoneInfo` (não um deslocamento fixo de -3h) porque
    é o mesmo mecanismo que `horarios()` já usa via `func.timezone()`, e
    resolve corretamente qualquer fuso configurado, com ou sem horário de
    verão.
    """
    tz = ZoneInfo(settings.TZ_EXIBICAO)
    return datetime(d.year, d.month, d.day, tzinfo=tz).astimezone(timezone.utc)


def filtros_analytics(
    desde: date | None = Query(
        None,
        description="primeiro dia do período, no calendário local do servidor (inclusive)",
    ),
    ate: date | None = Query(
        None,
        description="último dia do período, no calendário local do servidor (inclusive)",
    ),
    ponto_id: int | None = Query(None, description="filtra por ponto de acesso"),
    situacao: StatusVerificacao | None = Query(None, description="status da verificação"),
    setor: str | None = Query(None, description="Pessoa.setor exato"),
    tipo_epi: str | None = Query(
        None, description="código do tipo de EPI (precisa ter sido inspecionado)"
    ),
    pessoa_id: int | None = Query(None, description="filtra por uma pessoa"),
    versao_modelo: str | None = Query(None, description="versão do modelo de visão"),
) -> FiltrosAnalytics:
    return FiltrosAnalytics(
        desde=_inicio_do_dia_local(desde) if desde is not None else None,
        ate_exclusivo=(
            _inicio_do_dia_local(ate + timedelta(days=1)) if ate is not None else None
        ),
        ponto_id=ponto_id,
        situacao=situacao,
        setor=setor,
        tipo_epi=tipo_epi,
        pessoa_id=pessoa_id,
        versao_modelo=versao_modelo,
    )


def condicoes(f: FiltrosAnalytics) -> list[ColumnElement[bool]]:
    """Condições WHERE para uma consulta cujo `FROM` é `Verificacao`."""
    cond: list[ColumnElement[bool]] = []
    if f.desde is not None:
        cond.append(Verificacao.iniciada_em >= f.desde)
    if f.ate_exclusivo is not None:
        cond.append(Verificacao.iniciada_em < f.ate_exclusivo)
    if f.ponto_id is not None:
        cond.append(Verificacao.ponto_id == f.ponto_id)
    if f.situacao is not None:
        cond.append(Verificacao.status == f.situacao)
    if f.pessoa_id is not None:
        cond.append(Verificacao.pessoa_id == f.pessoa_id)
    if f.versao_modelo is not None:
        cond.append(Verificacao.versao_modelo == f.versao_modelo)
    if f.setor is not None:
        cond.append(
            Verificacao.pessoa_id.in_(
                select(Pessoa.id).where(Pessoa.setor == f.setor)
            )
        )
    if f.tipo_epi is not None:
        cond.append(
            Verificacao.id.in_(
                select(Deteccao.verificacao_id)
                .join(TipoEpi, TipoEpi.id == Deteccao.tipo_epi_id)
                .where(TipoEpi.codigo == f.tipo_epi)
            )
        )
    return cond


def periodo_anterior(f: FiltrosAnalytics) -> tuple[datetime | None, datetime | None]:
    """`[desde, ate_exclusivo)` do período imediatamente anterior, de mesma
    duração — o fim exclusivo do período anterior é exatamente o início do
    atual, então os dois intervalos não se sobrepõem nem deixam um instante
    de fora.

    Sem `desde` e `ate` definidos não há como saber a duração — nesse caso o
    chamador simplesmente não tem período anterior para comparar.
    """
    if f.desde is None or f.ate_exclusivo is None:
        return None, None
    duracao = f.ate_exclusivo - f.desde
    return f.desde - duracao, f.desde
