"""Prévia da câmera no navegador, servida de dentro do próprio serviço.

O problema que isto resolve: a Pi não tem tela, e `/dev/video0` só abre uma
vez. Enquanto o `epi-borda` está de pé, nenhum outro processo consegue olhar
pela câmera — então "deixar o serviço rodando normal e abrir uma janela para
conferir o enquadramento" era, literalmente, impossível de fora.

A saída é não abrir a câmera de novo. O laço de visão já lê um frame atrás do
outro para alimentar o anel; esta prévia só pega o mesmo frame de passagem e
serve por HTTP. Nenhuma captura a mais, nenhuma disputa.

    from epi_borda.previa import ServidorPrevia

    previa = ServidorPrevia(8080)
    previa.iniciar()
    ...
        previa.publicar(frame, fps)     # no laço, depois de registrar_frame

CUSTO. `publicar` é uma atribuição sob lock: não copia, não codifica, não
toca em disco. O JPEG só é gerado dentro da thread do HTTP, e só enquanto
houver navegador conectado. Com a aba fechada, o laço de visão roda como se
isto não existisse — que é a condição para ligar a prévia sem alterar o
comportamento que se está tentando medir.

PRIVACIDADE. Isto é uma câmera apontada para pessoas, servida sem senha na
rede local. É ferramenta de instalação e de bancada, não de operação: ligue
para posicionar a câmera e marcar o chão, e tire a opção do serviço depois.
Por isso ela é opt-in por argumento, nunca padrão.
"""
from __future__ import annotations

import logging
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

log = logging.getLogger("epi_borda.previa")

IMGSZ = 640
#: Piso prático de um YOLO: abaixo disso a caixa some ou pisca.
MIN_MODELO_PX = 20
#: Tamanho confortável, onde a confiança para de depender da distância.
BOM_MODELO_PX = 40


# --------------------------------------------------------------- medidas

def medidas(largura: int, altura: int, imgsz: int = IMGSZ) -> dict:
    """Reproduz a conta do `letterbox` do epi_hailo, para exibir na tela.

    O modelo não recebe o frame de 1280x720: recebe um quadrado de 640x640
    com a imagem reduzida e centrada num fundo cinza. Com 16:9 a escala dá
    0,5 — cada pixel na tela vale meio pixel para o detector. É essa conta
    que decide se a luva ainda é detectável na distância escolhida, e é ela
    que a prévia desenha.
    """
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
        "min_tela": round(MIN_MODELO_PX / escala),
        "bom_tela": round(BOM_MODELO_PX / escala),
    }


# --------------------------------------------------------------- desenho

def _texto(img, txt, org, cor=(255, 255, 255), escala=0.5, grossura=1,
           direita=False):
    """Texto com tarja atrás — sem ela, some em cima de parede clara.

    Com `direita=True`, `org` é o canto direito do texto. Existe porque as
    legendas do lado direito do quadro saíam pela borda e ficavam cortadas
    justamente nos quadrados de referência, que são o que mais se olha aqui.
    """
    import cv2

    (w, h), base = cv2.getTextSize(txt, cv2.FONT_HERSHEY_SIMPLEX, escala, grossura)
    x, y = org
    if direita:
        x -= w
    cv2.rectangle(img, (x - 4, y - h - 5), (x + w + 4, y + base + 2), (0, 0, 0), -1)
    cv2.putText(img, txt, (x, y), cv2.FONT_HERSHEY_SIMPLEX, escala, cor,
                grossura, cv2.LINE_AA)


def _tracejada(img, p1, p2, cor, grossura=1, traco=12):
    """Linha tracejada — o OpenCV não tem, e linha cheia some no meio da cena."""
    import cv2

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


def desenhar_guias(frame, m: dict, fps: float = 0.0, margem: float = 0.08):
    """Tudo que ajuda a decidir posição de câmera e de marcação."""
    import cv2

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
        f"captura {m['largura']}x{m['altura']}" + (f"  ~{fps:.0f} fps" if fps else ""),
        f"modelo {m['util_l']}x{m['util_a']} dentro de {IMGSZ}x{IMGSZ}"
        f"  (escala {m['escala']:.2f})",
        f"altura util p/ o corpo: {m['util_a']} px no modelo",
        f"1 px no modelo = {1 / m['escala']:.1f} px nesta tela",
    ]
    for i, txt in enumerate(linhas):
        _texto(frame, txt, (10, 26 + i * 24), (255, 255, 255), 0.55)

    return frame


def desenhar_deteccoes(frame, deteccoes, m: dict):
    """As caixas de uma verificação de verdade, com o tamanho em px do modelo.

    O número ao lado do nome não é a confiança: é o lado menor da caixa
    MEDIDO NA ENTRADA DO MODELO. É ele que se compara com os quadrados de
    referência — uma caixa que saiu com 14 px explica sozinha por que aquele
    EPI oscila, e nenhuma leitura de confiança conta essa parte da história.
    """
    import cv2

    for d in deteccoes:
        bbox = getattr(d, "bbox", None)
        if not bbox:
            continue
        x, y, w, h = bbox
        lado = round(min(w, h) * m["escala"])
        if lado >= BOM_MODELO_PX:
            cor = (120, 220, 120)
        elif lado >= MIN_MODELO_PX:
            cor = (0, 150, 255)
        else:
            cor = (60, 60, 255)
        cv2.rectangle(frame, (x, y), (x + w, y + h), cor, 2)
        # Só ASCII neste rótulo: as fontes Hershey do OpenCV não têm glifo
        # para acento nem para o ponto médio, e desenham "??" no lugar —
        # num rótulo que existe para ser lido de relance, isso é ruído.
        _texto(frame, f"{d.classe} {d.confianca:.2f} | {lado}px",
               (x, max(16, y - 8)), cor, 0.5)
    return frame


# ---------------------------------------------------------------- página

PAGINA = """<!doctype html><html lang="pt-br"><head><meta charset="utf-8">
<title>Previa da camera - EPI</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 body{margin:0;background:#11161a;color:#e6ecea;font:15px/1.55 system-ui,sans-serif}
 .wrap{max-width:1180px;margin:0 auto;padding:22px 18px 48px}
 h1{font-size:21px;margin:0 0 4px} p.sub{margin:0 0 20px;color:#8fa09b}
 .grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:22px}
 @media(max-width:900px){.grid{grid-template-columns:1fr}}
 img{width:100%;height:auto;display:block;border-radius:8px;background:#000}
 .card{background:#18211f;border:1px solid #2a3734;border-radius:8px;padding:16px 18px}
 .card+.card{margin-top:16px}
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
 p.nota{margin:0;color:#8fa09b;font-size:13.5px}
</style></head><body><div class="wrap">
<h1>Previa da camera</h1>
<p class="sub">Servida pelo proprio <code>epi-borda</code> — o servico segue rodando normal.</p>
<div class="grid">
  <div><img src="/previa/stream.mjpg" alt="camera ao vivo"></div>
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
    <div class="card">
      <h2>Quando alguem verificar</h2>
      <p class="nota">As caixas da verificacao aparecem por alguns segundos, com o
      lado menor ja convertido para pixels do modelo. Verde passa dos 40, laranja
      esta entre 20 e 40, vermelho nao chega ao piso.</p>
    </div>
    <div class="card">
      <h2>Cabe tudo no quadro?</h2>
      <p class="nota">Meca quantos pixels de altura a pessoa ocupa e informe a
      altura real dela.</p>
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
     v.textContent = 'O menor nao chega ao piso de 20 px. Aproxime a camera, ou gire o ' +
                     'quadro para retrato.'; }
 }
 ['px','cm'].forEach(function(id){
   document.getElementById(id).addEventListener('input', atualizar); });
 atualizar();
</script></div></body></html>"""


# --------------------------------------------------------------- servidor

class ServidorPrevia:
    """Serve o último frame do laço de visão, com as guias por cima."""

    def __init__(self, porta: int = 8080, *, margem: float = 0.08,
                 qualidade: int = 75) -> None:
        self.porta = porta
        self.margem = margem
        self.qualidade = qualidade

        self._cond = threading.Condition()
        self._frame: Any = None
        self._fps = 0.0
        self._serie = 0
        self._medidas: dict | None = None

        #: Frame já anotado de uma verificação real, e até quando mostrá-lo.
        self._analise: tuple[Any, float] | None = None

        self._clientes = 0
        self._srv: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    # ------------------------------------------------------------- vida
    def iniciar(self) -> None:
        self._srv = ThreadingHTTPServer(("0.0.0.0", self.porta), self._handler())
        self._srv.daemon_threads = True
        self._thread = threading.Thread(target=self._srv.serve_forever, daemon=True)
        self._thread.start()
        log.info("previa em http://%s:%d/previa", ip_local(), self.porta)

    def fechar(self) -> None:
        if self._srv is not None:
            self._srv.shutdown()
            self._srv.server_close()
        with self._cond:
            self._cond.notify_all()

    def __enter__(self) -> "ServidorPrevia":
        self.iniciar()
        return self

    def __exit__(self, *_exc) -> None:
        self.fechar()

    # ---------------------------------------------------------- entrada
    @property
    def assistindo(self) -> bool:
        return self._clientes > 0

    def publicar(self, frame: Any, fps: float = 0.0) -> None:
        """Chame a cada frame do laço. Não copia e não codifica."""
        with self._cond:
            self._frame = frame
            self._fps = fps
            self._serie += 1
            if self._medidas is None:
                h, w = frame.shape[:2]
                self._medidas = medidas(w, h)
            self._cond.notify_all()

    def mostrar_analise(self, frame: Any, deteccoes, segundos: float = 8.0) -> None:
        """Congela na tela o que uma verificação REAL enxergou.

        Este é o único ponto em que a prévia mostra caixa, e de propósito:
        desenhar caixa ao vivo exigiria rodar o modelo continuamente, que é
        exatamente o que a arquitetura evita — a NPU fica parada entre
        verificações, e ligar a aba do navegador não pode mudar isso.

        Em troca, o que aparece aqui não é uma aproximação: é o frame que
        decidiu, com as caixas que decidiram.
        """
        if self._medidas is None or frame is None:
            return
        try:
            anotado = desenhar_deteccoes(frame.copy(), deteccoes, self._medidas)
        except Exception:
            log.exception("falha ao anotar a previa; seguindo sem ela")
            return
        with self._cond:
            self._analise = (anotado, time.monotonic() + segundos)
            self._serie += 1
            self._cond.notify_all()

    # ------------------------------------------------------------- HTTP
    def _proximo(self, visto: int, espera: float = 2.0):
        """Espera um frame mais novo que `visto`. Devolve (serie, imagem)."""
        with self._cond:
            self._cond.wait_for(lambda: self._serie != visto, timeout=espera)
            if self._frame is None:
                return self._serie, None
            if self._analise is not None:
                anotado, ate = self._analise
                if time.monotonic() < ate:
                    return self._serie, anotado
                self._analise = None
            return self._serie, self._frame

    def _handler(self):
        previa = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a):  # silencia o log por requisição
                pass

            def do_GET(self):
                if self.path.startswith("/previa/stream"):
                    return self._stream()
                if self.path.rstrip("/") in ("", "/previa"):
                    return self._pagina()
                self.send_error(404)

            def _pagina(self):
                m = previa._medidas
                if m is None:
                    self.send_error(503, "ainda sem frame da camera")
                    return
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
                import cv2

                self.send_response(200)
                self.send_header("Age", "0")
                self.send_header("Cache-Control", "no-cache, private")
                self.send_header(
                    "Content-Type", "multipart/x-mixed-replace; boundary=quadro")
                self.end_headers()

                with previa._cond:
                    previa._clientes += 1
                visto = -1
                try:
                    while True:
                        visto, imagem = previa._proximo(visto)
                        if imagem is None:
                            continue
                        # A cópia é aqui, e só aqui: o desenho não pode
                        # rabiscar o frame que o anel guardou para a
                        # verificação. Foi o erro mais provável deste
                        # arquivo, e o único que corromperia uma decisão.
                        quadro = imagem.copy()
                        if previa._medidas is not None:
                            desenhar_guias(quadro, previa._medidas,
                                           previa._fps, previa.margem)
                        ok, buf = cv2.imencode(
                            ".jpg", quadro,
                            [cv2.IMWRITE_JPEG_QUALITY, previa.qualidade])
                        if not ok:
                            continue
                        dados = buf.tobytes()
                        self.wfile.write(b"--quadro\r\n")
                        self.wfile.write(b"Content-Type: image/jpeg\r\n")
                        self.wfile.write(b"Content-Length: %d\r\n\r\n" % len(dados))
                        self.wfile.write(dados)
                        self.wfile.write(b"\r\n")
                except (BrokenPipeError, ConnectionResetError):
                    pass  # o navegador fechou a aba; não é erro
                finally:
                    with previa._cond:
                        previa._clientes -= 1

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
