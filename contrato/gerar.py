"""Gera, a partir de `epis.json`, o catálogo de cada ponta do sistema.

    python3 gerar.py            # escreve em gerado/
    python3 gerar.py --stdout capacete_ts

Nenhum arquivo gerado deve ser editado à mão. Se alguém editar, o
`conferir.py` acusa na próxima execução — que é justamente o ponto.

Por que gerar em vez de cada repositório escrever o seu: os quatro
catálogos já divergiram uma vez neste projeto (`luva`/`luvas`,
`bota`/`botas`, e dois EPIs que existiam no app e não no servidor). O
descasamento não estoura sozinho — o servidor ignora o código que não
conhece, conta ausência de informação como reprovação, e a catraca fica
fechada sem erro em lugar nenhum. Um arquivo só, gerado, torna esse bug
impossível em vez de improvável.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
CATALOGO = json.loads((RAIZ / "epis.json").read_text(encoding="utf-8"))
EPIS = CATALOGO["epis"]
IGNORADAS = CATALOGO["ignoradas_no_modelo"]

AVISO = "ARQUIVO GERADO por contrato/gerar.py — não edite à mão."


def _camel_mdi(kebab: str) -> str:
    """hard-hat -> mdiHardHat, o nome do export em @mdi/js."""
    return "mdi" + "".join(p.capitalize() for p in kebab.split("-"))


# ------------------------------------------------------------ tablet (RN)
def tablet_ts() -> str:
    linhas = [
        "/**",
        f" * {AVISO}",
        " *",
        " * Catálogo de EPIs do EPI Fetin. Os `codigo` são exatamente o que",
        " * trafega em MQTT, HTTP e banco — o servidor não conhece outro nome.",
        " *",
        " * O `icone` é um nome de MaterialCommunityIcons, a mesma família que",
        " * o painel administrativo usa via @mdi/js. Os dois desenham o mesmo",
        " * traço nas duas telas.",
        " *",
        " * Fonte: contrato/epis.json na raiz do monorepo.",
        " */",
        "",
        "export type CodigoEpi =",
    ]
    for i, e in enumerate(EPIS):
        fim = ";" if i == len(EPIS) - 1 else ""
        linhas.append(f"  | '{e['codigo']}'{fim}")
    linhas += [
        "",
        "export interface ItemEpi {",
        "  codigo: CodigoEpi;",
        "  rotulo: string;",
        "  descricao: string;",
        "  /** nome em MaterialCommunityIcons (@expo/vector-icons) */",
        "  icone: string;",
        "}",
        "",
        "export const CATALOGO_EPI: Record<CodigoEpi, ItemEpi> = {",
    ]
    for e in EPIS:
        linhas.append(
            f"  {e['codigo']}: {{ codigo: '{e['codigo']}', "
            f"rotulo: '{e['rotulo']}', "
            f"descricao: '{e['descricao']}', "
            f"icone: '{e['icone_mdi']}' }},"
        )
    linhas += [
        "};",
        "",
        "export const CODIGOS_EPI = Object.keys(CATALOGO_EPI) as CodigoEpi[];",
        "",
        "/** Ícone de reserva para código que o servidor tem e este catálogo não. */",
        "export const ICONE_DESCONHECIDO = 'help-circle-outline';",
        "",
        "/**",
        " * Nunca indexe CATALOGO_EPI direto com string vinda do servidor.",
        " * Um código novo cadastrado no painel chegaria aqui como undefined e",
        " * a tela quebraria em runtime; assim ele aparece com ícone genérico e",
        " * o próprio nome, que é sinal visível de que os catálogos divergiram.",
        " */",
        "export function epiDoCatalogo(codigo: string): ItemEpi {",
        "  return (",
        "    CATALOGO_EPI[codigo as CodigoEpi] ?? {",
        "      codigo: codigo as CodigoEpi,",
        "      rotulo: codigo,",
        "      descricao: 'Não está no catálogo do app',",
        "      icone: ICONE_DESCONHECIDO,",
        "    }",
        "  );",
        "}",
        "",
    ]
    return "\n".join(linhas)


# ------------------------------------------------------------ admin (web)
def admin_ts() -> str:
    usados = sorted({_camel_mdi(e["icone_mdi"]) for e in EPIS})
    linhas = [
        "/**",
        f" * {AVISO}",
        " *",
        " * Espelho do catálogo do app do totem, para as duas telas",
        " * desenharem o mesmo traço. Fonte: contrato/epis.json.",
        " */",
        "",
        "import {",
    ]
    linhas += [f"  {n}," for n in usados]
    linhas += [
        "} from '@mdi/js';",
        "",
        "export const CATALOGO_EPI: Record<",
        "  string,",
        "  { rotulo: string; descricao: string; icone: string }",
        "> = {",
    ]
    for e in EPIS:
        linhas.append(
            f"  {e['codigo']}: {{ rotulo: '{e['rotulo']}', "
            f"descricao: '{e['descricao']}', "
            f"icone: {_camel_mdi(e['icone_mdi'])} }},"
        )
    linhas += ["};", ""]
    return "\n".join(linhas)


# ------------------------------------------------------------ raspberry
def borda_py() -> str:
    linhas = [
        '"""' + AVISO,
        "",
        "Tradução entre as classes que o modelo emite e os códigos do",
        "servidor. Fonte: contrato/epis.json.",
        "",
        "Para acrescentar um sinônimo do seu modelo, edite o JSON e rode",
        "`python3 contrato/gerar.py` — não edite aqui.",
        '"""',
        "from __future__ import annotations",
        "",
        "CODIGOS_SERVIDOR = {",
    ]
    linhas += [f"    {e['codigo']!r}," for e in EPIS]
    linhas += [
        "}",
        "",
        "#: nome que SAI do modelo  ->  código que o SERVIDOR espera",
        "DE_MODELO_PARA_SERVIDOR: dict[str, str] = {",
    ]
    for e in EPIS:
        for s in e["sinonimos_modelo"]:
            linhas.append(f"    {s!r}: {e['codigo']!r},")
    linhas += [
        "}",
        "",
        "#: classes conhecidas que NÃO são EPI — descartadas de propósito",
        "IGNORADAS = {",
    ]
    linhas += [f"    {c!r}," for c in IGNORADAS]
    linhas += ["}", ""]
    return "\n".join(linhas)


# ------------------------------------------------------------ servidor
def servidor_py() -> str:
    linhas = [
        '"""' + AVISO,
        "",
        "Catálogo semeado pelo init_db e conferido pelo migrar_dados.",
        "Fonte: contrato/epis.json.",
        '"""',
        "from __future__ import annotations",
        "",
        "#: (codigo, rotulo, classe_modelo)",
        "EPIS: list[tuple[str, str, str]] = [",
    ]
    for e in EPIS:
        linhas.append(
            f"    ({e['codigo']!r}, {e['rotulo']!r}, {e['classe_modelo']!r}),"
        )
    linhas += ["]", ""]
    return "\n".join(linhas)


SAIDAS = {
    "tablet_ts": ("gerado/epiCatalog.ts", tablet_ts),
    "admin_ts": ("gerado/catalogoEpi.ts", admin_ts),
    "borda_py": ("gerado/catalogo_epi.py", borda_py),
    "servidor_py": ("gerado/catalogo_epi_servidor.py", servidor_py),
}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--stdout", choices=sorted(SAIDAS),
                   help="imprime um dos arquivos em vez de escrever tudo")
    args = p.parse_args()

    if args.stdout:
        print(SAIDAS[args.stdout][1](), end="")
        return 0

    (RAIZ / "gerado").mkdir(exist_ok=True)
    for chave, (destino, fn) in sorted(SAIDAS.items()):
        caminho = RAIZ / destino
        caminho.write_text(fn(), encoding="utf-8")
        print(f"  {destino}")
    print(f"\n{len(EPIS)} EPIs: " + ", ".join(e["codigo"] for e in EPIS))
    return 0


if __name__ == "__main__":
    sys.exit(main())
