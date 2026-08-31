"""Confere as quatro pontas contra `epis.json`.

    python3 conferir.py                      # o que estiver no disco
    python3 conferir.py --servidor http://192.168.0.10:8000

Sai com código 1 na primeira divergência, para poder virar passo de CI ou
gancho de pre-commit. As pontas conferidas:

    servidor   tabela tipos_epi, pela API (precisa do servidor no ar)
    tablet     src/constants/epiCatalog.ts
    admin      src/tema.ts
    raspberry  epi_borda/classes.py

Cada uma é lida como TEXTO, não importada. É de propósito: o conferidor
precisa rodar sem instalar as dependências dos quatro projetos, e
precisa acusar um arquivo que alguém editou à mão mesmo que ele continue
compilando.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
MONOREPO = RAIZ.parent
CATALOGO = json.loads((RAIZ / "epis.json").read_text(encoding="utf-8"))
ESPERADO = [e["codigo"] for e in CATALOGO["epis"]]
ROTULOS = {e["codigo"]: e["rotulo"] for e in CATALOGO["epis"]}

VERDE, VERMELHO, AMARELO, CINZA, OFF = (
    "\033[32m", "\033[31m", "\033[33m", "\033[90m", "\033[0m"
)

problemas: list[str] = []


def ok(msg: str) -> None:
    print(f"  {VERDE}ok{OFF}      {msg}")


def falha(msg: str, detalhe: str = "") -> None:
    problemas.append(msg)
    print(f"  {VERMELHO}DIVERGE{OFF} {msg}")
    if detalhe:
        print(f"          {CINZA}{detalhe}{OFF}")


def pulado(msg: str) -> None:
    print(f"  {AMARELO}pulado{OFF}  {msg}")


def comparar(nome: str, achados: list[str]) -> None:
    """Compara conjunto E ordem não importa; o que importa é o conjunto."""
    faltam = [c for c in ESPERADO if c not in achados]
    sobram = [c for c in achados if c not in ESPERADO]
    if faltam or sobram:
        partes = []
        if faltam:
            partes.append(f"faltam: {', '.join(faltam)}")
        if sobram:
            partes.append(f"sobram: {', '.join(sobram)}")
        falha(f"{nome} — {len(achados)} códigos", " · ".join(partes))
    else:
        ok(f"{nome} — os {len(ESPERADO)} códigos batem")


# ------------------------------------------------------------- servidor
def conferir_servidor(base: str, email: str, senha: str) -> None:
    def pedir(caminho, corpo=None, token=None):
        dados = json.dumps(corpo).encode() if corpo is not None else None
        cab = {"Content-Type": "application/json"} if dados else {}
        if token:
            cab["Authorization"] = f"Bearer {token}"
        req = urllib.request.Request(f"{base}{caminho}", data=dados, headers=cab)
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.load(r)

    try:
        token = pedir("/api/v1/auth/login",
                      {"email": email, "senha": senha})["access_token"]
        tipos = pedir("/api/v1/tipos-epi", token=token)
    except (urllib.error.URLError, OSError) as exc:
        pulado(f"servidor — não respondeu em {base} ({exc.__class__.__name__})")
        return

    comparar("servidor (tabela tipos_epi)", [t["codigo"] for t in tipos])

    divergentes = [
        f"{t['codigo']}: '{t['rotulo']}' != '{ROTULOS[t['codigo']]}'"
        for t in tipos
        if t["codigo"] in ROTULOS and t["rotulo"] != ROTULOS[t["codigo"]]
    ]
    if divergentes:
        # Rótulo divergente é aviso, não erro: ele não trafega, só é
        # exibido. Vale saber, não vale barrar um build.
        pulado("servidor — rótulos diferentes do canônico: "
               + "; ".join(divergentes))
    else:
        ok("servidor — rótulos idênticos ao canônico")


# ------------------------------------------------------------- arquivos
def _corpo(texto: str, declaracao: str) -> str | None:
    """O miolo de `NOME ... = { ... }`, ancorado no início de linha.

    A âncora `^` não é preciosismo: `CATALOGO_EPI` e
    `DE_MODELO_PARA_SERVIDOR` também aparecem em comentários e docstrings
    nos mesmos arquivos. Sem ela, a busca casa a menção no comentário,
    `[^=]*` atravessa linhas até o próximo `= {` que encontrar, e o
    conferidor passa a ler o bloco errado — dizendo que faltam todos os
    códigos quando na verdade eles estão lá.
    """
    achado = re.search(
        rf"^(?:export const )?{declaracao}[^=]*=\s*\{{(.*?)^\}}",
        texto, re.S | re.M,
    )
    return achado.group(1) if achado else None


def codigos_de_ts(texto: str) -> list[str]:
    """Chaves do objeto CATALOGO_EPI num arquivo TypeScript."""
    corpo = _corpo(texto, "CATALOGO_EPI")
    if corpo is None:
        return []
    return re.findall(r"^\s{2}(\w+)\s*:", corpo, re.M)


def conferir_ts(nome: str, caminho: Path) -> None:
    if not caminho.is_file():
        pulado(f"{nome} — {caminho.relative_to(MONOREPO)} não existe aqui")
        return
    comparar(f"{nome} ({caminho.name})", codigos_de_ts(
        caminho.read_text(encoding="utf-8")))


def conferir_borda(caminho: Path) -> None:
    if not caminho.is_file():
        pulado(f"raspberry — {caminho.name} não existe aqui")
        return
    corpo = _corpo(caminho.read_text(encoding="utf-8"),
                   "DE_MODELO_PARA_SERVIDOR")
    if corpo is None:
        falha("raspberry — não achei DE_MODELO_PARA_SERVIDOR")
        return

    destinos = re.findall(r":\s*[\"'](\w+)[\"']", corpo)
    unicos = list(dict.fromkeys(destinos))  # únicos, na ordem de leitura
    comparar(f"raspberry (mapa de {len(destinos)} sinônimos)", unicos)

    # Cada EPI precisa de pelo menos um sinônimo, senão o modelo nunca
    # consegue relatá-lo e o ponto que o exigir reprova todo mundo.
    sem_rota = [c for c in ESPERADO if c not in destinos]
    if sem_rota:
        falha("raspberry — EPIs sem nenhum sinônimo de modelo",
              ", ".join(sem_rota))


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--servidor", default="http://localhost:8000")
    p.add_argument("--email", default="admin@epiguard.com.br")
    p.add_argument("--senha", default="admin123")
    p.add_argument("--tablet", type=Path,
                   default=MONOREPO / "tablet/src/constants/epiCatalog.ts")
    args = p.parse_args()

    print(f"\ncanônico: contrato/epis.json — {len(ESPERADO)} EPIs")
    print("  " + ", ".join(ESPERADO) + "\n")

    conferir_servidor(args.servidor.rstrip("/"), args.email, args.senha)
    conferir_ts("admin", MONOREPO / "admin/src/tema.ts")
    conferir_ts("tablet", args.tablet)
    conferir_borda(MONOREPO / "raspberry/epi_borda/classes.py")

    print()
    if problemas:
        print(f"{VERMELHO}{len(problemas)} divergência(s).{OFF} "
              f"Rode `python3 contrato/gerar.py` e leve os arquivos de "
              f"gerado/ para os seus lugares.\n")
        return 1
    print(f"{VERDE}As pontas conferidas falam os mesmos códigos.{OFF}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
