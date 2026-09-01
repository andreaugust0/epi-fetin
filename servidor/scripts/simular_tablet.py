"""Faz o papel do tablet inteiro, com os embeddings reais do app.

Reproduz, na ordem e com os mesmos payloads, o que o app do totem faz —
ou fará — contra o servidor:

    1. usa o token de dispositivo (o app guarda no SecureStore)
    2. POST /api/v1/identificacao   com modelo facenet512-v1 e 512 floats
    3. POST /api/v1/verificacoes    com o identificacao_id devolvido
    4. escuta /api/v1/ws/pontos/{id} e recebe o desfecho

Os embeddings vêm de `tablet/assets/mock_embeddings.json`, que são os
vetores REAIS que o FaceNet do app produziu — não números inventados aqui.

    python3 scripts/simular_tablet.py --cadastrar
    python3 scripts/simular_tablet.py
    python3 scripts/simular_tablet.py --pessoa Andre
    python3 scripts/simular_tablet.py --desconhecido
    python3 scripts/simular_tablet.py --servidor http://192.168.0.10:8000

DELIBERADAMENTE AUTÔNOMO: não importa nada de `app/`. Roda com a
biblioteca padrão, de qualquer máquina que alcance o servidor — o PC, a
Raspberry, ou de dentro do contêiner. Se `websockets` estiver instalado,
usa o WebSocket como o tablet vai usar; senão, consulta por HTTP e avisa.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import random
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent          # servidor/
PADRAO_EMBEDDINGS = RAIZ.parent / "tablet" / "assets" / "mock_embeddings.json"

VERDE, VERMELHO, AMARELO, AZUL, CINZA, OFF = (
    "\033[32m", "\033[31m", "\033[33m", "\033[36m", "\033[90m", "\033[0m"
)
CORES = {"APROVADA": VERDE, "REPROVADA": VERMELHO,
         "EXPIRADA": AMARELO, "ERRO": VERMELHO, "AGUARDANDO_ANALISE": AZUL}

MODELO = "facenet512-v1"   # tablet/src/features/face-recognition/types/identification.ts


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
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as exc:
        bruto = exc.read().decode()
        try:
            return exc.code, json.loads(bruto)
        except json.JSONDecodeError:
            return exc.code, {"detail": bruto[:300]}
    except urllib.error.URLError as exc:
        raise Erro(f"não consegui falar com {base}: {exc.reason}") from exc


# ------------------------------------------------------------- embeddings
def normalizar(v):
    n = sum(x * x for x in v) ** 0.5
    return [x / n for x in v] if n else v


def com_ruido(v, escala):
    """Simula a variação natural entre duas fotos da mesma pessoa.

    Mandar o vetor cadastrado idêntico daria distância zero e não provaria
    nada: qualquer limiar passa. Com ruído, o teste exerce de verdade o
    `FACE_DISTANCIA_MAX` e o teste de razão contra o segundo colocado.
    """
    if escala <= 0:
        return list(v)
    return normalizar([x + random.gauss(0, escala) for x in v])


def carregar_galeria(caminho: Path):
    if not caminho.is_file():
        raise Erro(
            f"não achei os embeddings em {caminho}.\n"
            f"        Passe o caminho com --embeddings, ou rode de dentro do "
            f"monorepo (o padrão é tablet/assets/mock_embeddings.json)."
        )
    galeria = json.loads(caminho.read_text(encoding="utf-8"))
    for item in galeria:
        if item.get("modelo") != MODELO:
            raise Erro(f"{item.get('nome')}: modelo {item.get('modelo')!r} "
                       f"difere do que o app manda ({MODELO!r})")
        if len(item["embedding"]) != 512:
            raise Erro(f"{item.get('nome')}: {len(item['embedding'])} valores, "
                       f"esperava 512")
    return galeria


# ----------------------------------------------------------- provisionamento
def preparar(base, email, senha, codigo_ponto):
    codigo, tok = pedir(base, "/api/v1/auth/login", {"email": email, "senha": senha})
    if codigo != 200:
        raise Erro(f"login de admin falhou ({codigo}): {tok}")
    admin = tok["access_token"]

    _, pontos = pedir(base, "/api/v1/pontos", token=admin)
    if not pontos:
        raise Erro("nenhum ponto de acesso cadastrado")
    if codigo_ponto:
        ponto = next((p for p in pontos if p["codigo"] == codigo_ponto), None)
        if ponto is None:
            raise Erro(f"ponto {codigo_ponto!r} não existe; há: "
                       + ", ".join(p["codigo"] for p in pontos))
    else:
        ponto = pontos[0]

    _, disp = pedir(base, "/api/v1/dispositivos", token=admin)
    tablet = next((d for d in disp if d["tipo"] == "TABLET"
                   and d["ponto_id"] == ponto["id"]), None)
    if tablet is None:
        raise Erro(f"o ponto {ponto['codigo']!r} não tem tablet cadastrado")

    # O app faz isto uma vez, na tela de provisionamento, e guarda o token
    # no SecureStore. Aqui emitimos a cada execução, que é equivalente.
    _, tt = pedir(base, f"/api/v1/auth/tablets/{tablet['id']}/token",
                  {}, token=admin, metodo="POST")

    camera = [d for d in disp if d["tipo"] == "RASPBERRY"
              and d["ponto_id"] == ponto["id"]]
    return admin, tt["access_token"], ponto, (camera[0] if camera else None)


def cadastrar(base, admin, galeria):
    """Cria as pessoas, registra consentimento e grava a biometria.

    A ordem importa e é imposta pelo servidor: sem consentimento vigente,
    o cadastro de biometria é recusado com 412. É o artigo 11 da LGPD
    virando regra de código, não comentário em documento.
    """
    print("\ncadastro da galeria")
    _, pagina = pedir(base, "/api/v1/pessoas", token=admin)
    ja_existem = {p["nome"]: p["id"] for p in pagina.get("itens", [])}

    for item in galeria:
        nome = item["nome"]
        pid = ja_existem.get(nome)
        if pid is None:
            codigo, p = pedir(base, "/api/v1/pessoas",
                              {"nome": nome, "funcao": "TCC"},
                              token=admin, metodo="POST")
            if codigo != 201:
                raise Erro(f"criar {nome} falhou ({codigo}): {p}")
            pid = p["id"]
            print(f"  {VERDE}+{OFF} {nome} criado (#{pid})")
        else:
            print(f"  {CINZA}={OFF} {nome} já existe (#{pid})")

        pedir(base, f"/api/v1/pessoas/{pid}/consentimento",
              {"versao_termo": "1.0"}, token=admin, metodo="POST")

        codigo, r = pedir(base, f"/api/v1/pessoas/{pid}/biometrias",
                          {"modelo": item["modelo"], "embedding": item["embedding"]},
                          token=admin, metodo="POST")
        if codigo == 201:
            print(f"    biometria gravada")
        else:
            print(f"    {AMARELO}biometria: {codigo}{OFF} {r.get('detail', r)}")


# ----------------------------------------------------------------- desfecho
def abrir_ws(base, ponto_id, token):
    """Conecta ANTES de abrir a verificação, como o tablet precisa fazer.

    A ordem não é detalhe: a inferência na Raspberry leva algumas centenas
    de milissegundos. Quem conectar depois do POST corre o risco de o
    desfecho já ter sido publicado, e o canal não guarda histórico — a
    mensagem simplesmente não chega e o tablet fica esperando para sempre.
    """
    try:
        from websockets.sync.client import connect
    except ImportError:
        return None, "websockets não instalado (pip install websockets)"

    url = (base.replace("https://", "wss://").replace("http://", "ws://")
           + f"/api/v1/ws/pontos/{ponto_id}?token={token}")
    try:
        # ExitStack e não `connect(...)` solto: a partir do websockets
        # 14, usar a conexão fora de um `with` emite DeprecationWarning
        # e não fecha o socket direito. Aqui a conexão precisa viver
        # ENTRE duas etapas do roteiro, então quem segura o contexto é
        # a pilha, fechada no fim.
        pilha = contextlib.ExitStack()
        return pilha.enter_context(connect(url, open_timeout=10)), pilha
    except Exception as exc:  # noqa: BLE001
        return None, f"{type(exc).__name__}: {exc}"


def esperar_ws(ws, verificacao_id, prazo_s):
    fim = time.time() + prazo_s
    while time.time() < fim:
        try:
            bruto = ws.recv(timeout=max(1.0, fim - time.time()))
        except TimeoutError:
            break
        except Exception as exc:  # noqa: BLE001
            return None, f"{type(exc).__name__}: {exc}"
        msg = json.loads(bruto)
        if msg.get("tipo") == "resultado" and (
            verificacao_id is None or msg.get("verificacao_id") == verificacao_id
        ):
            return msg, None
    return None, "nada chegou no prazo"


def esperar_http(base, vid, prazo_s):
    fim = time.time() + prazo_s
    atual = {}
    while time.time() < fim:
        _, atual = pedir(base, f"/api/v1/verificacoes/{vid}")
        if atual.get("status") != "AGUARDANDO_ANALISE":
            return atual
        time.sleep(0.3)
    return atual


def mostrar(v):
    st = v.get("status", "?")
    print(f"  {CORES.get(st, '')}{st}{OFF}"
          + (f" · {v['latencia_ms']} ms" if v.get("latencia_ms") else "")
          + (f" · modelo {v['versao_modelo']}" if v.get("versao_modelo") else ""))
    if v.get("pessoa_nome"):
        print(f"  {CINZA}pessoa: {v['pessoa_nome']}{OFF}")
    if v.get("motivo_falha"):
        print(f"  {CINZA}{v['motivo_falha']}{OFF}")
    if not v.get("deteccoes"):
        return
    larg = max(len(d["epi"]) for d in v["deteccoes"])
    for d in sorted(v["deteccoes"], key=lambda x: (not x["presente"], x["epi"])):
        marca = f"{VERDE}presente{OFF}" if d["presente"] else f"{VERMELHO}AUSENTE {OFF}"
        print(f"    {d['epi']:<{larg}}  {marca}  conf {d['confianca']:.3f}"
              + (f"  {d['frames_confirmados']} frames"
                 if d.get("frames_confirmados") is not None else ""))


# --------------------------------------------------------------------- main
def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--servidor", default="http://localhost:8000")
    p.add_argument("--email", default="admin@epiguard.com.br")
    p.add_argument("--senha", default="admin123")
    p.add_argument("--ponto", help="código do ponto (padrão: o primeiro)")
    p.add_argument("--embeddings", type=Path, default=PADRAO_EMBEDDINGS)
    p.add_argument("--cadastrar", action="store_true",
                   help="cadastra a galeria e sai")
    p.add_argument("--pessoa", help="nome da galeria (padrão: o primeiro)")
    p.add_argument("--desconhecido", action="store_true",
                   help="manda um vetor aleatório; espera NAO_IDENTIFICADO")
    p.add_argument("--sem-rosto", action="store_true",
                   help="pula a identificação e abre a verificação sem pessoa")
    p.add_argument("--ruido", type=float, default=0.02,
                   help="variação aplicada ao embedding cadastrado")
    p.add_argument("--prazo", type=float, default=45.0)
    args = p.parse_args()

    base = args.servidor.rstrip("/")

    try:
        codigo, saude = pedir(base, "/health")
        if codigo != 200:
            raise Erro(f"/health devolveu {codigo}")
        if saude.get("mqtt") != "conectado":
            print(f"{AMARELO}aviso:{OFF} API sem broker ({saude.get('mqtt')})")

        admin, token, ponto, camera = preparar(
            base, args.email, args.senha, args.ponto)

        if args.cadastrar:
            cadastrar(base, admin, carregar_galeria(args.embeddings))
            print()
            return 0

        estado = (f"{VERDE}online{OFF}" if camera and camera["online"]
                  else f"{VERMELHO}offline{OFF}")
        print(f"\nponto     {ponto['codigo']} · exige "
              f"{', '.join(ponto['epis_exigidos'])}")
        print(f"câmera    {camera['client_id_mqtt'] if camera else '(sem cadastro)'}"
              f" · {estado}")

        # -------------------------------------------------- identificação
        ident_id = None
        if not args.sem_rosto:
            if args.desconhecido:
                random.seed()
                vetor = normalizar([random.gauss(0, 1) for _ in range(512)])
                quem = "(rosto desconhecido)"
            else:
                galeria = carregar_galeria(args.embeddings)
                alvo = (next((g for g in galeria if g["nome"] == args.pessoa), None)
                        if args.pessoa else galeria[0])
                if alvo is None:
                    raise Erro(f"{args.pessoa!r} não está na galeria; há: "
                               + ", ".join(g["nome"] for g in galeria))
                vetor = com_ruido(alvo["embedding"], args.ruido)
                quem = alvo["nome"]

            print(f"\n1. POST /api/v1/identificacao   {CINZA}{quem}{OFF}")
            codigo, ident = pedir(
                base, "/api/v1/identificacao",
                {"ponto_id": ponto["id"], "modelo": MODELO, "embedding": vetor},
                token=token, metodo="POST",
            )
            if codigo != 200:
                print(f"  {VERMELHO}{codigo}{OFF} {ident}")
                return 1

            res = ident.get("resultado")
            cor = VERDE if res == "IDENTIFICADO" else AMARELO
            print(f"  {cor}{res}{OFF}"
                  + (f" · {ident['nome']}" if ident.get("nome") else "")
                  + (f" · distância {ident['distancia']:.4f}"
                     if ident.get("distancia") is not None else ""))

            if res != "IDENTIFICADO":
                print(f"\n  {CINZA}O app pararia aqui: sem identificação não "
                      f"há verificação. É o comportamento correto.{OFF}\n")
                return 0
            ident_id = ident["identificacao_id"]

        # -------------------------------------------------- verificação
        ws, pilha_ws = abrir_ws(base, ponto["id"], token)
        motivo_ws = None if ws is not None else pilha_ws

        print(f"\n2. POST /api/v1/verificacoes")
        corpo = {"ponto_id": ponto["id"]}
        if ident_id:
            corpo["identificacao_id"] = ident_id
        codigo, verif = pedir(base, "/api/v1/verificacoes", corpo,
                              token=token, metodo="POST")
        if codigo == 503:
            print(f"  {VERMELHO}503{OFF} {verif.get('detail')}")
            print(f"  {CINZA}A Raspberry não está anunciada como online.{OFF}\n")
            return 1
        if codigo != 202:
            print(f"  {VERMELHO}{codigo}{OFF} {verif}")
            return 1
        vid = verif["id"]
        print(f"  {AZUL}202{OFF} {vid[:8]}… · o servidor publicou cmd/capturar")

        # -------------------------------------------------- desfecho
        print(f"\n3. desfecho")
        if ws is not None:
            msg, motivo_ws = esperar_ws(ws, vid, args.prazo)
            pilha_ws.close()
            if msg is not None:
                print(f"  {VERDE}chegou pelo WebSocket{OFF} "
                      f"{CINZA}/api/v1/ws/pontos/{ponto['id']}{OFF}")
                print(f"  {CINZA}{json.dumps(msg, ensure_ascii=False)}{OFF}")
            else:
                print(f"  {AMARELO}nada pelo WebSocket{OFF} "
                      f"{CINZA}({motivo_ws}){OFF}")
        else:
            print(f"  {AMARELO}WebSocket não usado{OFF} "
                  f"{CINZA}({motivo_ws}){OFF}")

        # O detalhe completo (detecções, confiança, frames) não vem pelo
        # canal: ele carrega só o desfecho. Quem quiser a lista busca por
        # HTTP, e é o que o app fará ao montar a tela de resultado.
        mostrar(esperar_http(base, vid, args.prazo))

        print()
        return 0

    except Erro as exc:
        print(f"\n{VERMELHO}{exc}{OFF}\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
