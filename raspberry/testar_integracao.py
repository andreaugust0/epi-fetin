"""Prova o cliente de borda contra o servidor de verdade.

Nada de mock: sobe o detector falso como um processo à parte — do jeito
que a Raspberry vai rodar —, abre verificações pela API como o tablet
abre, e confere no banco o que o servidor decidiu.

    python3 testar_integracao.py

Precisa do servidor no ar (API + worker + broker + banco).
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
API = os.getenv("API_BASE", "http://localhost:8000")
EMAIL = os.getenv("ADMIN_EMAIL", "admin@epiguard.com.br")
SENHA = os.getenv("ADMIN_SENHA", "admin123")

VERDE, VERMELHO, AMARELO, CINZA, OFF = (
    "\033[32m", "\033[31m", "\033[33m", "\033[90m", "\033[0m"
)

_passou = _falhou = 0


def checar(ok: bool, descricao: str, detalhe: str = "") -> bool:
    global _passou, _falhou
    if ok:
        _passou += 1
        print(f"  {VERDE}ok{OFF}    {descricao}")
    else:
        _falhou += 1
        print(f"  {VERMELHO}FALHA{OFF} {descricao}")
        if detalhe:
            print(f"        {CINZA}{detalhe}{OFF}")
    return ok


def titulo(texto: str) -> None:
    print(f"\n{texto}\n{'-' * len(texto)}")


# ------------------------------------------------------------------ http
def pedir(caminho: str, corpo=None, token=None, metodo=None):
    dados = json.dumps(corpo).encode() if corpo is not None else None
    cab = {"Content-Type": "application/json"} if dados else {}
    if token:
        cab["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        f"{API}{caminho}", data=dados, headers=cab, method=metodo
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as exc:
        corpo_erro = exc.read().decode()
        try:
            return exc.code, json.loads(corpo_erro)
        except json.JSONDecodeError:
            return exc.code, {"detail": corpo_erro[:200]}


# ------------------------------------------------------------------ borda
class Borda:
    """O detector falso rodando como processo separado."""

    def __init__(self, *args: str) -> None:
        self.args = args
        self.proc: subprocess.Popen | None = None
        self._saida = ""

    def __enter__(self) -> "Borda":
        env = dict(os.environ, PYTHONUNBUFFERED="1")
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "detectores.falso", *self.args],
            cwd=RAIZ, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        return self

    def __exit__(self, *_exc) -> None:
        if not self.proc:
            return
        if self.proc.poll() is None:
            self.proc.send_signal(signal.SIGTERM)
        try:
            self._saida = self.proc.communicate(timeout=10)[0] or ""
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self._saida = self.proc.communicate()[0] or ""

    def saida(self) -> str:
        """Só faz sentido depois do `with` — antes, o processo ainda escreve."""
        return self._saida


def zerar_presenca(device_id: str) -> None:
    import paho.mqtt.client as mqtt

    from epi_borda import contrato
    from epi_borda.config import carregar

    cfg = carregar()
    cli = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="teste-zerar")
    if cfg.mqtt_usuario:
        cli.username_pw_set(cfg.mqtt_usuario, cfg.mqtt_senha)
    cli.connect(cfg.mqtt_host, cfg.mqtt_porta, 15)
    cli.loop_start()
    cli.publish(
        contrato.t_status(cfg.site, cfg.ponto, device_id),
        json.dumps({"online": False, "motivo": "reset-de-teste"}),
        qos=1, retain=True,
    ).wait_for_publish(5)
    cli.loop_stop()
    cli.disconnect()


def esperar_camera(token: str, online: bool, prazo_s: float = 20.0) -> bool:
    """Espera a presença da Raspberry mudar, vista pelo servidor."""
    limite = time.time() + prazo_s
    while time.time() < limite:
        _, disp = pedir("/api/v1/dispositivos", token=token)
        rasp = [d for d in disp if d["tipo"] == "RASPBERRY"]
        if rasp and rasp[0]["online"] is online:
            return True
        time.sleep(0.4)
    return False


def esperar_desfecho(vid: str, prazo_s: float = 20.0) -> dict:
    limite = time.time() + prazo_s
    ultimo: dict = {}
    while time.time() < limite:
        _, ultimo = pedir(f"/api/v1/verificacoes/{vid}")
        if ultimo.get("status") != "AGUARDANDO_ANALISE":
            return ultimo
        time.sleep(0.3)
    return ultimo


def verificar_onnx() -> None:
    """Testa o decodificador e o NMS sem carregar modelo nenhum.

    O onnxruntime é substituído por um stub: o que está sob teste aqui é
    aritmética de caixa, e ela não precisa de um .onnx de 12 MB para ser
    verificada. Se o numpy não estiver instalado, a seção é pulada — o
    adaptador é opcional, o pacote `epi_borda` não depende dele.
    """
    import types

    try:
        import numpy as np
    except ImportError:
        print(f"  {AMARELO}pulado{OFF} numpy não instalado (adaptador é opcional)")
        return

    sys.modules.setdefault(
        "onnxruntime",
        types.SimpleNamespace(
            InferenceSession=object,
            SessionOptions=object,
            GraphOptimizationLevel=types.SimpleNamespace(ORT_ENABLE_ALL=0),
        ),
    )
    from detectores.onnx_yolo import DetectorOnnx, _nms

    caixas = np.array([[0, 0, 100, 100], [5, 5, 105, 105], [300, 300, 400, 400]],
                      dtype=float)
    checar(_nms(caixas, np.array([0.9, 0.8, 0.7]), 0.45) == [0, 2],
           "NMS descarta a caixa sobreposta e mantém a distante")

    d = DetectorOnnx.__new__(DetectorOnnx)
    d.confianca_min = 0.4
    d.nomes_classes = ["helmet", "vest", "gloves"]
    nc, n = 3, 5

    s = np.zeros((4 + nc, n), np.float32)
    s[:4, 0] = [50, 60, 20, 40]
    s[4:, 0] = [0.1, 0.95, 0.2]
    s[:4, 1] = [10, 10, 4, 4]
    s[4:, 1] = [0.1, 0.1, 0.1]           # abaixo do limiar, some

    cx, cf, ids = d._decodificar(s[None])
    checar(len(cf) == 1 and ids[0] == 1 and abs(cf[0] - 0.95) < 1e-6,
           "saída v8 (4+nc, N): pega a classe vencedora e corta o resto")
    checar(cx[0].tolist() == [40.0, 40.0, 60.0, 80.0],
           "cxcywh vira xyxy corretamente", str(cx[0].tolist()))
    cx2, _, _ = d._decodificar(s.T[None])
    checar(np.allclose(cx2, cx), "mesma saída já transposta dá o mesmo resultado")

    s5 = np.zeros((n, 5 + nc), np.float32)
    s5[0, :4] = [50, 60, 20, 40]
    s5[0, 4] = 0.9
    s5[0, 5:] = [0.1, 0.9, 0.2]
    _, cf5, ids5 = d._decodificar(s5[None])
    checar(len(cf5) == 1 and ids5[0] == 1 and abs(cf5[0] - 0.81) < 1e-5,
           "saída v5 (N, 5+nc): objectness multiplica o score da classe",
           str(cf5))

    d.nomes_classes = ["a", "b"]
    try:
        d._decodificar(s5[None])
        checar(False, "número de classes errado falha com mensagem clara")
    except RuntimeError as exc:
        checar("não bate com 2 classes" in str(exc),
               "número de classes errado falha com mensagem clara", str(exc))


def main() -> int:
    print(f"\n{'=' * 62}\n  cliente de borda × servidor EPI Fetin\n{'=' * 62}")

    # ---------------------------------------------------------- preparo
    titulo("0. preparo")
    codigo, saude = pedir("/health")
    if not checar(codigo == 200 and saude.get("mqtt") == "conectado",
                  "servidor no ar e conectado ao broker", json.dumps(saude)):
        print("\nSuba o servidor antes: make up (ou .\\setup.ps1)")
        return 1

    codigo, tok = pedir("/api/v1/auth/login", {"email": EMAIL, "senha": SENHA})
    if not checar(codigo == 200, "login de admin", json.dumps(tok)):
        return 1
    admin = tok["access_token"]

    _, pontos = pedir("/api/v1/pontos", token=admin)
    ponto = pontos[0]
    exigidos = list(ponto["epis_exigidos"])
    checar(bool(exigidos), f"ponto '{ponto['codigo']}' exige {exigidos}")

    _, disp = pedir("/api/v1/dispositivos", token=admin)
    tablet_disp = next(d for d in disp if d["tipo"] == "TABLET")
    _, tok_t = pedir(f"/api/v1/auth/tablets/{tablet_disp['id']}/token",
                     {}, token=admin, metodo="POST")
    tablet = tok_t["access_token"]
    checar(bool(tablet), "token de dispositivo emitido para o tablet")

    rasp = next(d for d in disp if d["tipo"] == "RASPBERRY")
    checar(rasp["client_id_mqtt"] == "rasp-planta01-portaria",
           f"Raspberry cadastrada como {rasp['client_id_mqtt']}")

    # Zera a presença antes de começar. A coluna `online` sobrevive a um
    # restart do servidor, então uma execução anterior deixa a câmera
    # marcada como de pé. Publicamos o status retido de "offline" pelo
    # mesmo caminho que um dispositivo real usaria — nada de UPDATE no
    # banco por baixo do pano, que mascararia o mecanismo sob teste.
    zerar_presenca(rasp["client_id_mqtt"])
    checar(esperar_camera(admin, False, prazo_s=10),
           "presença zerada antes do teste (status retido de offline)")

    def abrir():
        return pedir("/api/v1/verificacoes", {"ponto_id": ponto["id"]},
                     token=tablet, metodo="POST")

    # ------------------------------------------ 1. câmera offline
    titulo("1. sem a borda no ar, o servidor recusa antes de esperar")
    codigo, corpo = abrir()
    checar(codigo == 503, "abrir verificação devolve 503",
           f"veio {codigo}: {corpo}")
    checar("offline" in str(corpo.get("detail", "")).lower(),
           "e o motivo diz que a câmera está offline", str(corpo))

    # ------------------------------------------ 2. aprovação
    titulo("2. borda no ar, todos os EPIs presentes")
    with Borda() as borda:
        if not checar(esperar_camera(admin, True),
                      "servidor viu a câmera ficar online (status retido)"):
            print(borda.saida())
            return 1

        codigo, v = abrir()
        checar(codigo == 202, f"verificação aceita com 202 (veio {codigo})", str(v))
        desfecho = esperar_desfecho(v["id"])
        checar(desfecho.get("status") == "APROVADA",
               f"desfecho APROVADA (veio {desfecho.get('status')})",
               str(desfecho.get("motivo_falha")))

        det = {d["epi"]: d for d in desfecho.get("deteccoes", [])}
        checar(set(det) == set(exigidos),
               f"o servidor gravou uma detecção por EPI exigido: {sorted(det)}")
        checar(all(d["presente"] for d in det.values()),
               "todas marcadas como presentes")
        checar(all(0.0 <= d["confianca"] <= 1.0 for d in det.values()),
               "confianças dentro de [0, 1]",
               str({k: d["confianca"] for k, d in det.items()}))
        checar(all(d.get("frames_confirmados", 0) >= 3 for d in det.values()),
               "frames_confirmados >= 3 (a votação funcionou)",
               str({k: d.get("frames_confirmados") for k, d in det.items()}))
        checar(desfecho.get("versao_modelo") == "epi-yolo-v1",
               "versao_modelo chegou ao banco",
               str(desfecho.get("versao_modelo")))
        lat = desfecho.get("latencia_ms") or 0
        checar(0 < lat < 8000, f"latência de ponta a ponta: {lat}ms")

    checar(esperar_camera(admin, False),
           "ao encerrar, o servidor viu a câmera sair (despedida limpa)")

    # ------------------------------------------ 3. reprovação
    titulo("3. faltando um EPI exigido")
    alvo = exigidos[0]
    # traduz o código do servidor de volta para um nome do modelo
    from epi_borda.classes import DE_MODELO_PARA_SERVIDOR

    nome_modelo = next(k for k, v in DE_MODELO_PARA_SERVIDOR.items() if v == alvo)

    with Borda("--faltando", nome_modelo) as borda:
        if not checar(esperar_camera(admin, True), "câmera online de novo"):
            print(borda.saida())
            return 1
        codigo, v = abrir()
        desfecho = esperar_desfecho(v["id"])
        checar(desfecho.get("status") == "REPROVADA",
               f"desfecho REPROVADA (veio {desfecho.get('status')})")
        checar(alvo in str(desfecho.get("motivo_falha", "")).lower()
               or any(not d["presente"] and d["epi"] == alvo
                      for d in desfecho.get("deteccoes", [])),
               f"o motivo aponta o EPI ausente ({alvo})",
               str(desfecho.get("motivo_falha")))
        ausente = next(
            (d for d in desfecho.get("deteccoes", []) if d["epi"] == alvo), None
        )
        checar(ausente is not None and ausente["confianca"] == 0.0,
               "o ausente foi relatado com confiança 0, não omitido",
               str(ausente))

    esperar_camera(admin, False)

    # ------------------------------------------ 4. timeout
    titulo("4. borda viva mas cega (o laço de visão travou)")
    with Borda("--mudo") as borda:
        if not checar(esperar_camera(admin, True),
                      "câmera anuncia online mesmo sem alimentar o buffer"):
            print(borda.saida())
            return 1
        codigo, v = abrir()
        checar(codigo == 202, "verificação é aberta (o servidor não tem como saber)")
        desfecho = esperar_desfecho(v["id"], prazo_s=45)
        checar(desfecho.get("status") == "EXPIRADA",
               f"e expira sozinha (veio {desfecho.get('status')})",
               str(desfecho))
        checar(not desfecho.get("deteccoes"),
               "sem detecções inventadas: a borda calou em vez de chutar")

    saida = borda.saida()
    checar("buffer vazio" in saida,
           "e o log da borda diz por quê", saida[-400:])

    # ------------------------------------------ 5. contrato
    titulo("5. contrato — o que a borda recusa")
    from epi_borda import contrato

    def recusa(payload: dict, motivo: str) -> None:
        try:
            contrato.ComandoCapturar(payload)
            checar(False, motivo, "aceitou um comando que deveria recusar")
        except contrato.ErroContrato:
            checar(True, motivo)

    from datetime import datetime, timedelta, timezone

    futuro = contrato.iso(datetime.now(timezone.utc) + timedelta(seconds=10))
    base = {"v": 1, "msg_id": "x", "ts": futuro,
            "verificacao_id": "abc", "epis_exigidos": ["capacete"],
            "expira_em": futuro}

    checar(contrato.ComandoCapturar(base).frames == 5,
           "comando válido é aceito, com frames=5 por padrão")
    recusa({**base, "v": 2}, "recusa schema de versão desconhecida")
    recusa({**base, "epis_exigidos": []}, "recusa lista de EPIs vazia")
    recusa({k: v for k, v in base.items() if k != "expira_em"},
           "recusa comando sem expira_em")
    recusa({**base, "epis_exigidos": ["capacete", 7]},
           "recusa item que não é string")

    from epi_borda.classes import MapaIncompleto, traduzir, validar_mapa

    checar(traduzir("helmet") == "capacete", "traduz helmet -> capacete")
    checar(traduzir("person") is None, "descarta 'person' silenciosamente")
    try:
        traduzir("banana")
        checar(False, "classe desconhecida levanta MapaIncompleto")
    except MapaIncompleto:
        checar(True, "classe desconhecida levanta MapaIncompleto")
    try:
        validar_mapa(["helmet", "capacete-de-obra"])
        checar(False, "validar_mapa barra a subida com mapa incompleto")
    except MapaIncompleto as exc:
        checar("capacete-de-obra" in str(exc),
               "validar_mapa barra a subida e nomeia a classe faltante")

    # ------------------------------------------ 6. votação
    titulo("6. votação em N frames")
    from epi_borda.detector import Deteccao, votar

    def frames(*presencas):
        return [
            [Deteccao("helmet", 0.9, (1, 2, 3, 4))] if p else [] for p in presencas
        ]

    v = votar(frames(1, 1, 0, 0, 0), ["capacete"], traduzir, 3)
    checar(not v["capacete"].presente and v["capacete"].confirmacoes == 2,
           "2 de 5 frames não confirma (mínimo 3)")
    v = votar(frames(1, 1, 1, 0, 0), ["capacete"], traduzir, 3)
    checar(v["capacete"].presente and v["capacete"].confirmacoes == 3,
           "3 de 5 confirma")
    v = votar([[Deteccao("helmet", 0.9), Deteccao("helmet", 0.95)]],
              ["capacete"], traduzir, 1)
    checar(v["capacete"].confirmacoes == 1,
           "duas caixas no MESMO frame contam como uma confirmação só")
    v = votar([[Deteccao("helmet", 0.5)], [Deteccao("helmet", 0.9)],
               [Deteccao("helmet", 0.99)]], ["capacete"], traduzir, 1)
    checar(abs(v["capacete"].confianca - 0.9) < 1e-9,
           f"confiança é a mediana, não a máxima (veio {v['capacete'].confianca})")
    v = votar([[]], ["capacete"], traduzir, 1)
    checar(v["capacete"].confianca == 0.0 and v["capacete"].bbox is None,
           "EPI nunca visto vira confiança 0 sem caixa")

    # ------------------------------------------ 7. clamp
    titulo("7. payload defensivo")
    item = contrato.item_deteccao(epi="capacete", presente=True, confianca=1.0000001)
    checar(item["confianca"] == 1.0,
           "confiança acima de 1 é grampeada (o servidor recusaria o payload)")
    item = contrato.item_deteccao(epi="capacete", presente=False, confianca=-0.2)
    checar(item["confianca"] == 0.0, "e abaixo de 0 também")
    env = contrato.envelope(verificacao_id="x")
    checar({"v", "msg_id", "ts", "verificacao_id"} <= set(env),
           "o envelope carrega v, msg_id e ts")
    checar(env["ts"].endswith("Z"), f"ts em UTC com Z ({env['ts']})")

    # ------------------------------------------ 8. adaptador ONNX
    titulo("8. adaptador ONNX (matemática pura, sem modelo)")
    verificar_onnx()

    # ---------------------------------------------------------- resumo
    print(f"\n{'=' * 62}")
    total = _passou + _falhou
    cor = VERDE if _falhou == 0 else VERMELHO
    print(f"  {cor}{_passou}/{total}{OFF} checagens passaram")
    print(f"{'=' * 62}\n")
    return 0 if _falhou == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
