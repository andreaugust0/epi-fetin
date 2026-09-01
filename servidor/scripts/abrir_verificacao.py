"""Faz o papel do tablet: abre uma verificação e mostra o desfecho.

É o botão que falta para testar a Raspberry de verdade. O tablet ainda
está em desenvolvimento, e sem alguém pedindo a verificação a Pi nunca
recebe `cmd/capturar` — ela fica no ar sem nada para responder.

    docker compose exec api python -m scripts.abrir_verificacao
    docker compose exec api python -m scripts.abrir_verificacao --vezes 3
    docker compose exec api python -m scripts.abrir_verificacao --ponto portaria

Roda DENTRO do contêiner da api, então não exige Python no Windows e fala
com a própria API em localhost. Só usa a biblioteca padrão.

O que ele faz é exatamente o que o tablet fará: login, token de
dispositivo, `POST /verificacoes`, e depois acompanha o resultado. Não
manda identificação facial por padrão — a verificação fica sem pessoa
vinculada, que é o suficiente para exercitar a câmera e a catraca.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

VERDE, VERMELHO, AMARELO, AZUL, CINZA, OFF = (
    "\033[32m", "\033[31m", "\033[33m", "\033[36m", "\033[90m", "\033[0m"
)

CORES_STATUS = {
    "APROVADA": VERDE,
    "REPROVADA": VERMELHO,
    "EXPIRADA": AMARELO,
    "ERRO": VERMELHO,
    "AGUARDANDO_ANALISE": AZUL,
}


class Erro(RuntimeError):
    pass


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
    except urllib.error.URLError as exc:
        raise Erro(f"não consegui falar com {base}: {exc.reason}") from exc


def uma(base, token_tablet, ponto, prazo_s):
    codigo, verif = pedir(
        base, "/api/v1/verificacoes", {"ponto_id": ponto["id"]},
        token=token_tablet, metodo="POST",
    )

    if codigo == 503:
        motivo = verif.get("detail", "")
        print(f"  {VERMELHO}503{OFF} {motivo}")
        if "offline" in str(motivo).lower():
            print(f"  {CINZA}A Raspberry não está anunciada como online. Ela "
                  f"publica o status ao conectar no broker — confira se o "
                  f"processo está rodando e se o DEVICE_ID bate com o "
                  f"cadastro.{OFF}")
        return None
    if codigo != 202:
        print(f"  {VERMELHO}{codigo}{OFF} {verif}")
        return None

    vid = verif["id"]
    print(f"  {AZUL}202{OFF} verificação {vid[:8]}… aberta · "
          f"aguardando a câmera")

    # O servidor expira em 10 s; damos folga para a rotina de manutenção
    # marcar a expiração, que roda a cada 30 s.
    limite = time.time() + prazo_s
    while time.time() < limite:
        _, atual = pedir(base, f"/api/v1/verificacoes/{vid}")
        if atual.get("status") != "AGUARDANDO_ANALISE":
            return atual
        time.sleep(0.3)
    return atual


def mostrar(v):
    st = v.get("status", "?")
    cor = CORES_STATUS.get(st, "")
    lat = v.get("latencia_ms")
    print(f"  {cor}{st}{OFF}"
          + (f" · {lat} ms" if lat else "")
          + (f" · modelo {v['versao_modelo']}" if v.get("versao_modelo") else ""))

    if v.get("motivo_falha"):
        print(f"  {CINZA}{v['motivo_falha']}{OFF}")

    if not v.get("deteccoes"):
        print(f"  {CINZA}nenhuma detecção gravada{OFF}")
        if st == "EXPIRADA":
            print(f"  {CINZA}A câmera não respondeu no prazo. Se o processo "
                  f"está no ar, o laço de visão pode ter parado de alimentar "
                  f"registrar_frame() — o log da borda diz 'buffer vazio'.{OFF}")
        return

    largura = max(len(d["epi"]) for d in v["deteccoes"])
    for d in sorted(v["deteccoes"], key=lambda x: (not x["presente"], x["epi"])):
        marca = f"{VERDE}presente{OFF}" if d["presente"] else f"{VERMELHO}AUSENTE {OFF}"
        frames = d.get("frames_confirmados")
        print(f"    {d['epi']:<{largura}}  {marca}  "
              f"conf {d['confianca']:.3f}"
              + (f"  {frames} frames" if frames is not None else ""))


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--servidor", default="http://localhost:8000")
    p.add_argument("--email", default="admin@epiguard.com.br")
    p.add_argument("--senha", default="admin123")
    p.add_argument("--ponto", help="código do ponto (padrão: o primeiro)")
    p.add_argument("--vezes", type=int, default=1)
    p.add_argument("--intervalo", type=float, default=3.0,
                   help="segundos entre verificações, com --vezes")
    p.add_argument("--prazo", type=float, default=45.0,
                   help="quanto esperar pelo desfecho")
    args = p.parse_args()

    base = args.servidor.rstrip("/")

    try:
        codigo, saude = pedir(base, "/health")
        if codigo != 200:
            raise Erro(f"/health devolveu {codigo}")
        if saude.get("mqtt") != "conectado":
            print(f"{AMARELO}aviso:{OFF} a API não está conectada ao broker "
                  f"({saude.get('mqtt')}). A verificação vai falhar.")

        codigo, tok = pedir(base, "/api/v1/auth/login",
                            {"email": args.email, "senha": args.senha})
        if codigo != 200:
            raise Erro(f"login falhou ({codigo}): {tok}")
        admin = tok["access_token"]

        _, pontos = pedir(base, "/api/v1/pontos", token=admin)
        if args.ponto:
            ponto = next((x for x in pontos if x["codigo"] == args.ponto), None)
            if ponto is None:
                raise Erro(f"ponto {args.ponto!r} não existe. Há: "
                           + ", ".join(x["codigo"] for x in pontos))
        else:
            if not pontos:
                raise Erro("nenhum ponto de acesso cadastrado")
            ponto = pontos[0]

        _, disp = pedir(base, "/api/v1/dispositivos", token=admin)
        tablet = next((d for d in disp
                       if d["tipo"] == "TABLET" and d["ponto_id"] == ponto["id"]),
                      None)
        if tablet is None:
            raise Erro(f"o ponto {ponto['codigo']!r} não tem tablet cadastrado")
        _, tt = pedir(base, f"/api/v1/auth/tablets/{tablet['id']}/token",
                      {}, token=admin, metodo="POST")
        token_tablet = tt["access_token"]

        camera = [d for d in disp
                  if d["tipo"] == "RASPBERRY" and d["ponto_id"] == ponto["id"]]
        estado = (f"{VERDE}online{OFF}" if camera and camera[0]["online"]
                  else f"{VERMELHO}offline{OFF}")
        visto = camera[0].get("visto_em", "—") if camera else "—"

        print(f"\nponto     {ponto['codigo']} · exige "
              f"{', '.join(ponto['epis_exigidos'])}")
        print(f"câmera    {camera[0]['client_id_mqtt'] if camera else '(sem cadastro)'}"
              f" · {estado}")
        print(f"          {CINZA}visto em {visto}{OFF}")

    except Erro as exc:
        print(f"\n{VERMELHO}{exc}{OFF}\n")
        return 1

    for n in range(1, args.vezes + 1):
        print(f"\n{n}/{args.vezes}")
        try:
            v = uma(base, token_tablet, ponto, args.prazo)
        except Erro as exc:
            print(f"  {VERMELHO}{exc}{OFF}")
            return 1
        if v:
            mostrar(v)
        if n < args.vezes:
            time.sleep(args.intervalo)

    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
