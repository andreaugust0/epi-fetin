"""Emite o token de dispositivo para provisionar um tablet.

    docker compose exec api python -m scripts.token_tablet
    docker compose exec api python -m scripts.token_tablet --ponto portaria

Imprime o JWT que a tela de provisionamento do app pede. É a mesma coisa
que o app faria sozinho se houvesse um fluxo de registro automático —
enquanto não há, um admin emite na bancada e cola no aparelho.

O token carrega o `ponto_id` dentro dele. É isso que impede um tablet de
abrir verificação num ponto de acesso que não é o dele, mesmo que alguém
altere o corpo do request.
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
    p.add_argument("--servidor", default="http://localhost:8000")
    p.add_argument("--email", default="admin@epiguard.com.br")
    p.add_argument("--senha", default="admin123")
    p.add_argument("--ponto", help="código do ponto (padrão: o primeiro)")
    args = p.parse_args()

    base = args.servidor.rstrip("/")

    codigo, tok = pedir(base, "/api/v1/auth/login",
                        {"email": args.email, "senha": args.senha})
    if codigo != 200:
        print(f"{VERMELHO}login falhou ({codigo}): {tok}{OFF}")
        return 1
    admin = tok["access_token"]

    _, pontos = pedir(base, "/api/v1/pontos", token=admin)
    if args.ponto:
        ponto = next((x for x in pontos if x["codigo"] == args.ponto), None)
        if ponto is None:
            print(f"{VERMELHO}ponto {args.ponto!r} não existe. Há: "
                  + ", ".join(x["codigo"] for x in pontos) + OFF)
            return 1
    else:
        ponto = pontos[0]

    _, disp = pedir(base, "/api/v1/dispositivos", token=admin)
    tablet = next((d for d in disp if d["tipo"] == "TABLET"
                   and d["ponto_id"] == ponto["id"]), None)
    if tablet is None:
        print(f"{VERMELHO}o ponto {ponto['codigo']!r} não tem tablet "
              f"cadastrado{OFF}")
        return 1

    _, tt = pedir(base, f"/api/v1/auth/tablets/{tablet['id']}/token",
                  {}, token=admin, metodo="POST")

    print(f"\n{CINZA}Cole estes três valores na tela de provisionamento do "
          f"tablet:{OFF}")
    print(f"{CINZA}(abra pelo Chrome do tablet: "
          f"epifetin://provisionamento-tablet){OFF}\n")
    print(f"  URL do servidor  {CINZA}(troque pelo IP desta máquina){OFF}")
    print(f"    http://SEU-IP:8000\n")
    print(f"  Ponto de acesso")
    print(f"    {VERDE}{ponto['id']}{OFF}   {CINZA}({ponto['codigo']} — "
          f"exige {', '.join(ponto['epis_exigidos'])}){OFF}\n")
    print(f"  Token do dispositivo  {CINZA}({tablet['client_id_mqtt']}, "
          f"vence em {tt['expira_em'][:10]}){OFF}")
    print(f"    {VERDE}{tt['access_token']}{OFF}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
