"""Ferramenta de bancada para decidir onde a câmera fica e onde a marcação vai.

A Pi não tem tela, então `cv2.imshow` não serve: `--mostrar` só funciona com
monitor ligado nela. Aqui a imagem vai para o navegador do notebook por MJPEG,
com as guias desenhadas por cima.

    # na Pi, com o serviço parado (veja abaixo)
    python3 enquadrar.py

    # no notebook
    http://raspberrypi.local:8080

    # comparando o giro para retrato, que quase dobra os pixels na pessoa
    python3 enquadrar.py --girar 90

PARE O SERVIÇO ANTES. O `epi-borda` segura o /dev/video0 e duas aberturas do
mesmo dispositivo não convivem — a segunda falha, ou pior, entrega frames
pretos sem erro nenhum:

    sudo systemctl stop epi-borda
    ...
    sudo systemctl start epi-borda

---------------------------------------------------------------------------

O QUE AS GUIAS QUEREM DIZER

O modelo não recebe o frame de 1280x720. Ele recebe um quadrado de 640x640,
montado pelo `letterbox` do `epi_hailo.py`: a imagem é reduzida mantendo a
proporção e centrada num fundo cinza. Com 16:9, a conta dá

    escala = min(640/1280, 640/720) = 0.5
    imagem útil = 640 x 360, com 140 px de cinza em cima e 140 embaixo

Duas consequências que mudam o enquadramento:

1. NADA É CORTADO. O que aparece na tela é exatamente o que o modelo vê. Não
   existe uma região central "de verdade" menor que o frame — a única coisa
   que se perde é resolução.

2. CADA PIXEL NA TELA VALE MEIO PIXEL NO MODELO. Um objeto de 40 px aqui chega
   ao modelo com 20 px. E 20 px é, na prática, o piso de um YOLO: abaixo disso
   a detecção vira sorte. É por isso que os quadrados de referência no canto
   existem — compare a luva na tela com eles, não com a sua intuição.

O caso ruim não é o capacete, que é grande e fica no alto. São luva e óculos:
os dois menores da lista, e os dois que decidem se vale a pena aproximar a
marcação ou girar a câmera.

Sobre girar: em pé, uma pessoa é alta e estreita, e o quadro deitado está com
o eixo comprido atravessado em relação a ela. Girando a câmera 90 graus
(`--girar 90`), a captura vira 720x1280 e o letterbox entrega 360x640 — a
mesma escala de 0,5, mas agora a pessoa atravessa 1280 px de captura em vez de
720, e chega ao modelo com 640 px de altura em vez de 360. São 1,8x mais
pixels em cima de cada EPI sem trocar de câmera.

Repare no que NÃO muda: a proporção cinza continua a mesma, 44% nos dois
casos, porque 16:9 e 9:16 desperdiçam igual dentro de um quadrado. O que muda
é de que lado fica o cinza — e cinza nas laterais de uma pessoa em pé é espaço
que ela não usaria mesmo. Por isso a linha que interessa comparar entre as
duas orientações é a "altura util", não a do desperdício.

Use esta ferramenta para ver a diferença antes de decidir; se adotar o giro,
ele tem de entrar também no laço de captura do serviço, senão a bancada e a
produção enquadram diferente.
"""
from __future__ import annotations

import argparse
import logging
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2

log = logging.getLogger("enquadrar")

IMGSZ = 640
#: Piso prático de um YOLO: abaixo disso a caixa some ou pisca.
MIN_MODELO_PX = 20
#: Tamanho confortável, onde a confiança para de depender da distância.
BOM_MODELO_PX = 40

GIROS = {
    0: None,
    90: cv2.ROTATE_90_CLOCKWISE,
    180: cv2.ROTATE_180,
    270: cv2.ROTATE_90_COUNTERCLOCKWISE,
}


# --------------------------------------------------------------- desenho

def _texto(img, txt, org, cor=(255, 255, 255), escala=0.5, grossura=1,
           direita=False):
    """Texto com tarja atrás — sem ela, some em cima de parede clara.

    Com `direita=True`, `org` é o canto direito do texto. Existe porque as
    legendas do lado direito do quadro saíam pela borda e ficavam cortadas
    justamente nos quadrados de referência, que são o que mais se olha aqui.
    """
    (w, h), base = cv2.getTextSize(txt, cv2.FONT_HERSHEY_SIMPLEX, escala, grossura)
    x, y = org
    if direita:
        x -= w
    cv2.rectangle(img, (x - 4, y - h - 5), (x + w + 4, y + base + 2), (0, 0, 0), -1)
    cv2.putText(img, txt, (x, y), cv2.FONT_HERSHEY_SIMPLEX, escala, cor,
                grossura, cv2.LINE_AA)


def _tracejada(img, p1, p2, cor, grossura=1, traco=12):
    """Linha tracejada — o OpenCV não tem, e linha cheia some no meio da cena."""
    x1, y1 = p1
    x2, y2 = p2
    comp = int(((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5)
    if comp == 0:
        return
    passos = max(1, comp // traco)
    for i in range(0, passos, 2):
        a = i / passos
        b = min(1.0, (i + 1) / passos)
        cv2.line(img,
                 (int(x1 + (x2 - x1) * a), int(y1 + (y2 - y1) * a)),
                 (int(x1 + (x2 - x1) * b), int(y1 + (y2 - y1) * b)),
                 cor, grossura, cv2.LINE_AA)


def medidas(largura: int, altura: int, imgsz: int = IMGSZ) -> dict:
    """Reproduz a conta do `letterbox` do epi_hailo, para exibir na tela."""
    escala = min(imgsz / largura, imgsz / altura)
    nl, na = round(largura * escala), round(altura * escala)
    return {
        "largura": largura,
        "altura": altura,
        "escala": escala,
        "util_l": nl,
        "util_a": na,
        "faixa_x": (imgsz - nl) // 2,
        "faixa_y": (imgsz - na) // 2,
        "desperdicio": 1.0 - (nl * na) / (imgsz * imgsz),
        "min_tela": round(MIN_MODELO_PX / escala),
        "bom_tela": round(BOM_MODELO_PX / escala),
    }


def desenhar_guias(frame, m: dict, fps: float, margem: float = 0.08):
    """Tudo que ajuda a decidir posição de câmera e de marcação."""
    h, w = frame.shape[:2]
    ciano = (255, 220, 0)
    laranja = (0, 150, 255)
    verde = (120, 220, 120)

    # Margens de cabeça e pés. Não são enfeite: a caixa de um EPI cortada pela
    # borda perde área, e o score cai junto — bota encostada no limite inferior
    # é a falha mais comum de enquadramento.
    topo, base = int(h * margem), int(h * (1 - margem))
    _tracejada(frame, (0, topo), (w, topo), ciano, 2)
    _tracejada(frame, (0, base), (w, base), ciano, 2)
    # A legenda da cabeça vai para a direita: à esquerda ela cai debaixo do
    # bloco de leitura numérica e desaparece.
    _texto(frame, "cabeca acima desta linha", (w - 12, topo - 10), ciano,
           direita=True)
    _texto(frame, "pes abaixo desta linha", (12, base + 24), ciano)

    # Centro, para alinhar a marcação do chão com o eixo da lente.
    _tracejada(frame, (w // 2, 0), (w // 2, h), (160, 160, 160), 1)

    # Os dois quadrados de referência. É a parte que responde "a luva cabe?".
    # Ficam no alto à direita: embaixo eles brigavam com a linha dos pés, que
    # é justamente onde a bota precisa ficar visível.
    x0, y0 = w - m["bom_tela"] - 24, topo + 26
    cv2.rectangle(frame, (x0, y0), (x0 + m["bom_tela"], y0 + m["bom_tela"]),
                  verde, 2)
    cv2.rectangle(frame, (x0, y0), (x0 + m["min_tela"], y0 + m["min_tela"]),
                  laranja, 2)
    abaixo = y0 + m["bom_tela"]
    _texto(frame, f"{BOM_MODELO_PX}px no modelo = confortavel",
           (w - 12, abaixo + 22), verde, direita=True)
    _texto(frame, f"{MIN_MODELO_PX}px no modelo = limite",
           (w - 12, abaixo + 44), laranja, direita=True)

    # Leitura numérica, canto superior esquerdo.
    #
    # A linha da "altura util" está aqui no lugar da proporção de cinza, que
    # parecia a métrica óbvia e não é: 16:9 e 9:16 desperdiçam exatamente o
    # mesmo dentro de um quadrado, então aquele número fica idêntico girando
    # ou não a câmera, e não ajuda a escolher. Esta muda — 360 deitado, 640
    # em pé — e é o que de fato limita o tamanho de cada EPI.
    linhas = [
        f"captura {m['largura']}x{m['altura']}  ~{fps:.0f} fps",
        f"modelo {m['util_l']}x{m['util_a']} dentro de {IMGSZ}x{IMGSZ}"
        f"  (escala {m['escala']:.2f})",
        f"altura util p/ o corpo: {m['util_a']} px no modelo",
        f"1 px no modelo = {1 / m['escala']:.1f} px nesta tela",
    ]
    for i, txt in enumerate(linhas):
        _texto(frame, txt, (10, 26 + i * 24), (255, 255, 255), 0.55)

    return frame


# --------------------------------------------------------------- captura

class Camera:
    """Laço de captura próprio, numa thread, com o último frame sempre pronto.

    Sem a thread, um navegador lento seguraria o `read()` e o buffer da
    câmera encheria de frames velhos — a imagem chegaria atrasada e daria a
    impressão de que a Pi não dá conta, quando o problema seria o HTTP.
    """

    def __init__(self, indice: int, largura: int, altura: int, girar: int):
        self.girar = GIROS[girar]
        self.cap = self._abrir(indice, largura, altura)
        self.frame = None
        self.fps = 0.0
        self.cond = threading.Condition()
        self.parar = threading.Event()
        self.t = threading.Thread(target=self._laco, daemon=True)
        self.t.start()

    @staticmethod
    def _abrir(indice, largura, altura):
        cap = cv2.VideoCapture(indice, cv2.CAP_V4L2)
        if not cap.isOpened():
            raise SystemExit(
                f"nao consegui abrir /dev/video{indice}.\n\n"
                "Quase sempre e o servico segurando a camera. Pare ele:\n"
                "    sudo systemctl stop epi-borda\n\n"
                "Se nao for isso, veja o que existe:  v4l2-ctl --list-devices"
            )
        # Mesmas opções do epi_hailo.abrir_camera: MJPG porque em YUYV a
        # webcam cai para 5 fps em 720p, e buffer 1 para não acumular atraso.
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, largura)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, altura)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return cap

    def _laco(self):
        n, t0 = 0, time.time()
        while not self.parar.is_set():
            ok, frame = self.cap.read()
            if not ok:
                time.sleep(0.1)
                continue
            if self.girar is not None:
                frame = cv2.rotate(frame, self.girar)
            n += 1
            if n % 15 == 0:
                agora = time.time()
                self.fps = 15 / (agora - t0)
                t0 = agora
            with self.cond:
                self.frame = frame
                self.cond.notify_all()

    def pegar(self, anterior=None, espera=2.0):
        with self.cond:
            self.cond.wait_for(lambda: self.frame is not None, timeout=espera)
            return self.frame

    def fechar(self):
        self.parar.set()
        self.t.join(timeout=2)
        self.cap.release()


# ------------------------------------------------------------------ HTTP

PAGINA = """<!doctype html><html lang="pt-br"><head><meta charset="utf-8">
<title>Enquadramento - EPI</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 body{margin:0;background:#11161a;color:#e6ecea;font:15px/1.55 system-ui,sans-serif}
 .wrap{max-width:1180px;margin:0 auto;padding:22px 18px 48px}
 h1{font-size:21px;margin:0 0 4px} p.sub{margin:0 0 20px;color:#8fa09b}
 .grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:22px}
 @media(max-width:900px){.grid{grid-template-columns:1fr}}
 img{width:100%;height:auto;display:block;border-radius:8px;background:#000}
 .card{background:#18211f;border:1px solid #2a3734;border-radius:8px;padding:16px 18px}
 h2{font-size:13px;letter-spacing:.09em;text-transform:uppercase;color:#8fa09b;margin:0 0 12px}
 dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0;font-size:14px}
 dt{color:#8fa09b} dd{margin:0;font-family:ui-monospace,monospace}
 label{display:block;font-size:13px;color:#8fa09b;margin:14px 0 5px}
 input{width:100%;box-sizing:border-box;background:#0f1614;border:1px solid #2a3734;
       color:#e6ecea;border-radius:5px;padding:8px 10px;font:14px ui-monospace,monospace}
 table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13.5px}
 th,td{text-align:left;padding:6px 4px;border-bottom:1px solid #2a3734}
 th{color:#8fa09b;font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:.06em}
 td.n{font-family:ui-monospace,monospace;text-align:right}
 .ok{color:#6fd6c7} .lim{color:#f0a05a} .ruim{color:#ef7765}
 code{background:#0f1614;padding:1px 5px;border-radius:3px;font-size:13px}
</style></head><body><div class="wrap">
<h1>Enquadramento da camera</h1>
<p class="sub">Pare o servico antes: <code>sudo systemctl stop epi-borda</code></p>
<div class="grid">
  <div><img src="/stream.mjpg" alt="camera ao vivo"></div>
  <div>
    <div class="card">
      <h2>Do jeito que esta</h2>
      <dl>
        <dt>captura</dt><dd>__CAP__</dd>
        <dt>entrada do modelo</dt><dd>__UTIL__ em 640x640</dd>
        <dt>escala</dt><dd>__ESC__</dd>
        <dt>altura util</dt><dd>__ALTUTIL__ px no modelo</dd>
      </dl>
    </div>
    <div class="card" style="margin-top:16px">
      <h2>Cabe tudo no quadro?</h2>
      <p style="margin:0;color:#8fa09b;font-size:13.5px">
        Na imagem, meca quantos pixels de altura a pessoa ocupa (use as linhas
        de cabeca e pes como referencia) e informe a altura real dela.</p>
      <label for="px">altura da pessoa na imagem, em pixels</label>
      <input id="px" type="number" value="__ALTPAD__" min="50" step="10">
      <label for="cm">altura real da pessoa, em cm</label>
      <input id="cm" type="number" value="175" min="100" step="1">
      <table><thead><tr><th>EPI</th><th>tam. real</th><th class="n">no modelo</th></tr></thead>
      <tbody id="linhas"></tbody></table>
      <p id="veredito" style="margin:14px 0 0;font-size:13.5px"></p>
    </div>
  </div>
</div>
<script>
 var ESCALA = __ESCNUM__;
 // Larguras tipicas do lado menor de cada equipamento, em cm. Sao as
 // dimensoes que o detector enxerga, nao o tamanho da peca inteira.
 var EPIS = [
   ["Capacete", 25], ["Colete", 40], ["Protetor auricular", 16],
   ["Mascara", 15], ["Oculos", 14], ["Luvas", 11], ["Botas", 11]
 ];
 function atualizar(){
   var px = +document.getElementById('px').value || 1;
   var cm = +document.getElementById('cm').value || 1;
   var pxPorCm = px / cm;
   var corpo = document.getElementById('linhas'), html = '', pior = null;
   EPIS.forEach(function(e){
     var noModelo = e[1] * pxPorCm * ESCALA;
     var cls = noModelo >= 40 ? 'ok' : (noModelo >= 20 ? 'lim' : 'ruim');
     if (pior === null || noModelo < pior) pior = noModelo;
     html += '<tr><td>' + e[0] + '</td><td class="n">' + e[1] + ' cm</td>' +
             '<td class="n ' + cls + '">' + noModelo.toFixed(0) + ' px</td></tr>';
   });
   corpo.innerHTML = html;
   var v = document.getElementById('veredito');
   if (pior >= 40) { v.className='ok';
     v.textContent = 'Todos com folga. Da para afastar mais a marcacao se precisar.'; }
   else if (pior >= 20) { v.className='lim';
     v.textContent = 'O menor esta na faixa limite. Funciona, mas vai oscilar com luz ruim ' +
                     'ou pessoa de lado. Aproxime a marcacao se puder.'; }
   else { v.className='ruim';
     v.textContent = 'O menor nao chega ao piso de 20 px. Aproxime a camera, ou rode com ' +
                     '--girar 90 para usar o quadro em pe.'; }
 }
 ['px','cm'].forEach(function(id){
   document.getElementById(id).addEventListener('input', atualizar); });
 atualizar();
</script></div></body></html>"""


def fazer_handler(cam: Camera, m: dict):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):  # silencia o log por requisição
            pass

        def do_GET(self):
            if self.path.startswith("/stream"):
                return self._stream()
            if self.path in ("/", "/index.html"):
                return self._pagina()
            self.send_error(404)

        def _pagina(self):
            corpo = (
                PAGINA
                .replace("__CAP__", f"{m['largura']}x{m['altura']}")
                .replace("__UTIL__", f"{m['util_l']}x{m['util_a']}")
                .replace("__ESC__", f"{m['escala']:.3f}")
                .replace("__ALTUTIL__", str(m["util_a"]))
                .replace("__ESCNUM__", f"{m['escala']:.4f}")
                .replace("__ALTPAD__", str(int(m["altura"] * 0.84)))
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(corpo)))
            self.end_headers()
            self.wfile.write(corpo)

        def _stream(self):
            self.send_response(200)
            self.send_header("Age", "0")
            self.send_header("Cache-Control", "no-cache, private")
            self.send_header(
                "Content-Type", "multipart/x-mixed-replace; boundary=quadro")
            self.end_headers()
            try:
                while True:
                    frame = cam.pegar()
                    if frame is None:
                        break
                    quadro = desenhar_guias(frame.copy(), m, cam.fps)
                    ok, buf = cv2.imencode(
                        ".jpg", quadro, [cv2.IMWRITE_JPEG_QUALITY, 75])
                    if not ok:
                        continue
                    dados = buf.tobytes()
                    self.wfile.write(b"--quadro\r\n")
                    self.wfile.write(b"Content-Type: image/jpeg\r\n")
                    self.wfile.write(
                        b"Content-Length: %d\r\n\r\n" % len(dados))
                    self.wfile.write(dados)
                    self.wfile.write(b"\r\n")
            except (BrokenPipeError, ConnectionResetError):
                pass  # o navegador fechou a aba; não é erro

    return Handler


def ip_local() -> str:
    """O IP que a Pi usa para sair — serve só para imprimir a URL certa."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "IP-DA-PI"
    finally:
        s.close()


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--camera", type=int, default=0)
    p.add_argument("--porta", type=int, default=8080)
    p.add_argument("--largura", type=int, default=1280)
    p.add_argument("--altura", type=int, default=720)
    p.add_argument("--girar", type=int, choices=sorted(GIROS), default=0,
                   help="gira o frame; 90 deixa o quadro em pe")
    args = p.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    cam = Camera(args.camera, args.largura, args.altura, args.girar)
    frame = cam.pegar(espera=5.0)
    if frame is None:
        cam.fechar()
        raise SystemExit("a camera abriu mas nao entregou nenhum frame em 5s.")

    h, w = frame.shape[:2]
    m = medidas(w, h)

    log.info("")
    log.info("  captura ............ %dx%d", w, h)
    log.info("  entrada do modelo .. %dx%d dentro de %dx%d (escala %.3f)",
             m["util_l"], m["util_a"], IMGSZ, IMGSZ, m["escala"])
    log.info("  altura util ........ %d px no modelo (pessoa em pe)",
             m["util_a"])
    log.info("  piso de %d px no modelo = %d px na tela",
             MIN_MODELO_PX, m["min_tela"])
    log.info("")
    log.info("  abra no notebook:  http://%s:%d", ip_local(), args.porta)
    log.info("  (Ctrl+C para sair)")
    log.info("")

    servidor = ThreadingHTTPServer(("0.0.0.0", args.porta),
                                   fazer_handler(cam, m))
    servidor.daemon_threads = True
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        log.info("encerrando")
    finally:
        servidor.server_close()
        cam.fechar()
    return 0


if __name__ == "__main__":
    sys.exit(main())
