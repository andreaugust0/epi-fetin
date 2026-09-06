"""Define quais EPIs um ponto de acesso exige.

    docker compose exec api python -m scripts.exigir_epis --listar
    docker compose exec api python -m scripts.exigir_epis capacete
    docker compose exec api python -m scripts.exigir_epis --todos
    docker compose exec api python -m scripts.exigir_epis capacete colete oculos

Trocar a exigência é um UPDATE no banco: nenhum dispositivo é
reprogramado, e o próximo `cmd/capturar` já sai com a lista nova.

Serve para dois momentos bem diferentes. Na depuração, reduzir a um EPI
isola o que está falhando — com quatro exigidos, basta um falhar para
reprovar e você não descobre qual. Na demonstração, é como se mostra que
a política mora no servidor.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

VERDE, VERMELHO, CINZA, OFF = "\033[32m", "\033[31m", "\033[90m", "\033[0m"


def pedir(base, caminho, corpo=None, token=None, metodo=None):
    dados = json.dumps(corpo).encode() if corpo is not None else None
    cab = {"Content-Type": "application/json"} if dados else {}
    if token:
        cab["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        f"{base}{caminho}", data=dados, headers=cab, method=metodo
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as exc:
        bruto = exc.read().decode()
        try:
            return exc.code, json.loads(bruto)
        except json.JSONDecodeError:
            return exc.code, {"detail": bruto[:300]}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("epis", nargs="*", help="códigos a exigir")
    p.add_argument("--todos", action="store_true", help="exige o catálogo inteiro")
    p.add_argument("--listar", action="store_true", help="só mostra a situação")
    p.add_argument("--ponto", help="código do ponto (padrão: o primeiro)")
    p.add_argument("--servidor", default="http://localhost:8000")
    p.add_argument("--email", default="admin@epiguard.com.br")
    p.add_argument("--senha", default="admin123")
    args = p.parse_args()

    base = args.servidor.rstrip("/")

    codigo, tok = pedir(base, "/api/v1/auth/login",
                        {"email": args.email, "senha": args.senha})
    if codigo != 200:
        print(f"{VERMELHO}login falhou ({codigo}): {tok}{OFF}")
        return 1
    admin = tok["access_token"]

    _, catalogo = pedir(base, "/api/v1/tipos-epi", token=admin)
    disponiveis = [t["codigo"] for t in catalogo]

    _, pontos = pedir(base, "/api/v1/pontos", token=admin)
    ponto = (next((x for x in pontos if x["codigo"] == args.ponto), None)
             if args.ponto else pontos[0])
    if ponto is None:
        print(f"{VERMELHO}ponto {args.ponto!r} não existe; há: "
              + ", ".join(x["codigo"] for x in pontos) + OFF)
        return 1

    if args.listar or (not args.epis and not args.todos):
        print(f"\nponto {VERDE}{ponto['codigo']}{OFF} (id {ponto['id']}) exige:")
        for c in ponto["epis_exigidos"]:
            print(f"  {VERDE}✓{OFF} {c}")
        resto = [c for c in disponiveis if c not in ponto["epis_exigidos"]]
        for c in resto:
            print(f"  {CINZA}·{OFF} {CINZA}{c}{OFF}")
        print(f"\n{CINZA}para mudar: ... exigir_epis capacete colete{OFF}\n")
        return 0

    novos = disponiveis if args.todos else args.epis
    invalidos = [c for c in novos if c not in disponiveis]
    if invalidos:
        print(f"{VERMELHO}código inexistente: {', '.join(invalidos)}{OFF}")
        print(f"{CINZA}disponíveis: {', '.join(disponiveis)}{OFF}")
        return 1

    codigo, r = pedir(base, f"/api/v1/pontos/{ponto['id']}/epis",
                      {"codigos": novos}, token=admin, metodo="PUT")
    if codigo != 200:
        print(f"{VERMELHO}falhou ({codigo}): {r}{OFF}")
        return 1

    print(f"\nponto {VERDE}{ponto['codigo']}{OFF} agora exige "
          f"{VERDE}{len(r['epis_exigidos'])}{OFF}: "
          + ", ".join(r["epis_exigidos"]) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
