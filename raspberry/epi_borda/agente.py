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
        agente.registrar_frame(frame)   # só guarda; não infere

O laço NÃO chama o detector. Guardar frame é barato; inferir não é, e
não há o que decidir enquanto ninguém está na catraca. O modelo roda
dentro de `_responder`, sobre os frames colhidos, quando `cmd/capturar`
chega — que é o que o servidor pediu e mais nada.
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
    def registrar_frame(self, frame: Any) -> None:
        """Chame a cada frame que o seu laço LER. É o único ponto de contato.

        Não infira antes de chamar: o modelo roda aqui dentro, e só
        quando o servidor pede. O seu laço vira leitura de câmera e mais
        nada, e a NPU passa o tempo ocioso realmente ociosa.
        """
        self.buffer.registrar(frame)

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

        frames = self._colher(cmd.frames, orcamento)
        if not frames:
            # Sem nada no buffer: o laço de visão parou. Melhor não
            # responder do que responder "não vi nada", que o servidor
            # leria como reprovação e negaria a passagem de alguém que
            # talvez estivesse com tudo. O timeout do servidor cuida, e
            # a verificação fica registrada como EXPIRADA — que é a
            # verdade: a câmera não respondeu.
            log.error("buffer vazio: o laço de visão não está alimentando "
                      "registrar_frame(). Não vou responder.")
            return

        amostras = self._inferir(frames, inicio + orcamento)
        if not amostras:
            log.error("nenhum frame inferido dentro do prazo; não vou responder")
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

    def _colher(self, quantos: int, orcamento_s: float) -> list[Any]:
        """Pega N frames do buffer, esperando um pouco se faltarem.

        Com o espaçamento de 0,2 s do buffer, cinco frames são um
        segundo de história. Se o comando chegar logo depois de o laço
        começar, vale esperar o anel encher — dentro do orçamento, nunca
        além dele.
        """
        limite = time.monotonic() + max(0.0, orcamento_s)
        while True:
            frames = self.buffer.recentes(quantos)
            if len(frames) >= quantos or time.monotonic() >= limite:
                return frames
            time.sleep(0.05)

    def _inferir(self, frames: list[Any], prazo: float) -> list[list[Deteccao]]:
        """Roda o modelo sobre os frames colhidos. É o único lugar que infere.

        Para no meio se o prazo acabar. Votar sobre três frames é pior do
        que votar sobre cinco, mas é infinitamente melhor do que perder o
        prazo e deixar a verificação expirar — e o `frames_analisados` que
        vai no resultado conta quantos realmente entraram, então o
        servidor registra a diferença em vez de fingir que foram cinco.
        """
        if self.detector is None:
            log.error("agente sem detector: não há como inferir")
            return []

        amostras: list[list[Deteccao]] = []
        for i, frame in enumerate(frames):
            if i and time.monotonic() >= prazo:
                log.warning("prazo estourou após %d de %d frames",
                            i, len(frames))
                break
            try:
                amostras.append(self.detector.detectar(frame))
            except Exception:
                # Um frame corrompido não pode derrubar a verificação
                # inteira: os outros quatro ainda decidem.
                log.exception("falha ao inferir um frame; seguindo com os demais")
        return amostras

    def _talvez_evidencia(self, verificacao_id: str) -> str | None:
        if not self.cfg.evidencia_ativa or self._codificar_jpeg is None:
            return None
        # O anel já guarda o frame cru; não há mais um "último frame"
        # separado para manter em sincronia.
        frame = self.buffer.ultimo()
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
