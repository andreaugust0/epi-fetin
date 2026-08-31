"""O agente: liga o seu laço de visão ao servidor.

Responsabilidade única — receber `cmd/capturar`, consultar o buffer de
frames que o seu laço vem alimentando, e publicar `evt/resultado` dentro
do prazo. Ele não abre câmera, não carrega modelo e não decide nada sobre
conformidade.

Uso mínimo, dentro do laço que você já tem:

    from epi_borda import Agente, Deteccao, carregar

    agente = Agente(carregar(), detector=meu_detector)
    agente.iniciar()

    while True:
        frame = camera.read()
        deteccoes = meu_detector.detectar(frame)   # o seu código de hoje
        desenhar(frame, deteccoes)                 # segue igual
        agente.registrar_frame(deteccoes, frame)   # a única linha nova
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable

from epi_borda import classes, contrato, evidencia
from epi_borda.config import Config
from epi_borda.detector import BufferFrames, Deteccao, Detector, votar
from epi_borda.mqtt_cliente import ClienteBorda

log = logging.getLogger(__name__)


class Agente:
    def __init__(
        self,
        cfg: Config,
        detector: Detector | None = None,
        *,
        buffer: BufferFrames | None = None,
        codificar_jpeg: Callable[[Any], bytes] | None = None,
    ) -> None:
        self.cfg = cfg
        self.detector = detector
        self.buffer = buffer or BufferFrames()
        self._codificar_jpeg = codificar_jpeg
        self._ultimo_frame: Any = None
        self._trava_frame = threading.Lock()
        self._parando = threading.Event()
        self._atendidas: set[str] = set()
        self._trava_atendidas = threading.Lock()

        # Validação do mapa ANTES de qualquer rede. Um mapa incompleto
        # tem que estourar aqui, na bancada, com o traceback na cara —
        # não em campo, como uma catraca que não abre.
        if detector is not None:
            classes.validar_mapa(list(detector.nomes_classes))
            log.info("mapa de classes validado: %d classes do modelo",
                     len(detector.nomes_classes))

        self.mqtt = ClienteBorda(cfg)
        self.mqtt.definir_extras_status(fw="epi-borda-1.0.0", modelo=cfg.versao_modelo)
        self.mqtt.assinar(
            contrato.t_cmd(cfg.site, cfg.ponto, "capturar"), self._ao_capturar
        )

    # ------------------------------------------------------------- vida
    def iniciar(self) -> None:
        self.mqtt.iniciar()
        threading.Thread(target=self._laco_telemetria, daemon=True).start()

    def parar(self) -> None:
        self._parando.set()
        self.mqtt.parar()

    def __enter__(self) -> Agente:
        self.iniciar()
        return self

    def __exit__(self, *_exc) -> None:
        self.parar()

    # --------------------------------------------------- entrada do laço
    def registrar_frame(self, deteccoes: list[Deteccao], frame: Any = None) -> None:
        """Chame a cada frame inferido. É o único ponto de contato.

        Guardar o frame é opcional e só serve para a evidência. Guardamos
        apenas o mais recente, e por referência: copiar cada frame para
        uma fila seria alocar dezenas de MB/s numa máquina que não tem.
        """
        self.buffer.registrar(deteccoes)
        if frame is not None and self.cfg.evidencia_ativa:
            with self._trava_frame:
                self._ultimo_frame = frame

    # ------------------------------------------------------- comando
    def _ao_capturar(self, payload: dict, topico: str) -> None:
        """Roda na thread de rede do paho — precisa devolver rápido."""
        try:
            cmd = contrato.ComandoCapturar(payload)
        except contrato.ErroContrato as exc:
            log.error("cmd/capturar inválido: %s", exc)
            return

        # Idempotência por verificação, além do msg_id: se o broker
        # reentregar o mesmo comando com outro envelope, não queremos
        # inferir de novo nem publicar dois resultados.
        with self._trava_atendidas:
            if cmd.verificacao_id in self._atendidas:
                log.info("verificação %s já atendida; ignorando",
                         cmd.verificacao_id[:8])
                return
            self._atendidas.add(cmd.verificacao_id)
            if len(self._atendidas) > 128:
                self._atendidas = set(list(self._atendidas)[-64:])

        restante = cmd.prazo_s
        if restante <= 0:
            # Chegou depois do prazo — provavelmente estava na fila do
            # broker durante uma queda nossa. Responder seria gastar CPU
            # para o servidor descartar como resultado tardio.
            log.warning("cmd/capturar já vencido (%.1fs); ignorando", restante)
            return

        log.info("capturar %s · exige %s · %.1fs de prazo",
                 cmd.verificacao_id[:8], ", ".join(cmd.epis_exigidos), restante)

        # Trabalho longo sai da thread de rede. Travar aqui pararia os
        # PINGREQ e o broker nos derrubaria por keepalive.
        threading.Thread(
            target=self._responder, args=(cmd,), daemon=True
        ).start()

    def _responder(self, cmd: contrato.ComandoCapturar) -> None:
        inicio = time.monotonic()
        orcamento = cmd.prazo_s - self.cfg.margem_prazo_s

        amostras = self._colher(cmd.frames, orcamento)
        if not amostras:
            # Sem nada no buffer: o laço de visão parou. Melhor não
            # responder do que responder "não vi nada", que o servidor
            # leria como reprovação e negaria a passagem de alguém que
            # talvez estivesse com tudo. O timeout do servidor cuida, e
            # a verificação fica registrada como EXPIRADA — que é a
            # verdade: a câmera não respondeu.
            log.error("buffer vazio: o laço de visão não está alimentando "
                      "registrar_frame(). Não vou responder.")
            return

        votos = votar(
            amostras,
            cmd.epis_exigidos,
            classes.traduzir,
            self.cfg.min_confirmacoes,
        )

        deteccoes = [
            contrato.item_deteccao(
                epi=codigo,
                presente=v.presente,
                confianca=v.confianca,
                frames_confirmados=v.confirmacoes,
                bbox=list(v.bbox) if v.bbox else None,
            )
            for codigo, v in votos.items()
        ]

        evidencia_id = self._talvez_evidencia(cmd.verificacao_id)

        latencia = int((time.monotonic() - inicio) * 1000)
        corpo = contrato.evt_resultado(
            verificacao_id=cmd.verificacao_id,
            versao_modelo=self.cfg.versao_modelo,
            latencia_ms=latencia,
            frames_analisados=len(amostras),
            deteccoes=deteccoes,
            evidencia_id=evidencia_id,
        )
        self.mqtt.publicar(
            contrato.t_evt(self.cfg.site, self.cfg.ponto, "resultado"), corpo
        )

        ausentes = [d["epi"] for d in deteccoes if not d["presente"]]
        if ausentes:
            log.info("resultado em %dms · faltou: %s", latencia, ", ".join(ausentes))
        else:
            log.info("resultado em %dms · todos os %d EPIs presentes",
                     latencia, len(deteccoes))

    def _colher(self, quantos: int, orcamento_s: float) -> list[list[Deteccao]]:
        """Pega N frames do buffer, esperando um pouco se faltarem.

        Numa Raspberry a 6 fps, cinco frames são pouco menos de um
        segundo. Se o comando chegar logo depois de o laço começar, vale
        esperar o buffer encher — dentro do orçamento, nunca além dele.
        """
        limite = time.monotonic() + max(0.0, orcamento_s)
        while True:
            amostras = self.buffer.recentes(quantos)
            if len(amostras) >= quantos or time.monotonic() >= limite:
                return amostras
            time.sleep(0.05)

    def _talvez_evidencia(self, verificacao_id: str) -> str | None:
        if not self.cfg.evidencia_ativa or self._codificar_jpeg is None:
            return None
        with self._trava_frame:
            frame = self._ultimo_frame
        if frame is None:
            return None
        try:
            jpeg = self._codificar_jpeg(frame)
        except Exception:
            log.exception("falha ao codificar a evidência")
            return None
        return evidencia.enviar(
            api_base=self.cfg.api_base,
            token=self.cfg.api_token or "",
            verificacao_id=verificacao_id,
            jpeg=jpeg,
            # O borrão é responsabilidade de quem codifica o JPEG. O
            # servidor loga alto quando chega sem borrar.
            rosto_borrado=True,
        )

    # -------------------------------------------------------- telemetria
    def _laco_telemetria(self) -> None:
        """Sinal de vida com números, em QoS 0.

        QoS 0 de propósito: telemetria perdida não importa, e não vale
        ocupar a fila persistente do broker com ela.
        """
        topico = contrato.t_telemetria(
            self.cfg.site, self.cfg.ponto, self.cfg.device_id
        )
        anterior = 0
        while not self._parando.wait(self.cfg.telemetria_s):
            atual = self.buffer.frames_vistos
            fps = (atual - anterior) / self.cfg.telemetria_s
            anterior = atual
            self.mqtt.publicar(
                topico,
                contrato.envelope(fps=round(fps, 2), buffer=len(self.buffer)),
                qos=0,
            )
            if fps < 0.5:
                log.warning("laço de visão a %.2f fps — a câmera travou?", fps)
