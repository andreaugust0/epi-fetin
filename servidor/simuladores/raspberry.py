"""Simulador da Raspberry Pi — faz o papel da câmera e do modelo de EPI.

Assina `cmd/capturar`, finge inferir e publica `evt/resultado`.

    python -m simuladores.raspberry
    python -m simuladores.raspberry --faltando capacete
    python -m simuladores.raspberry --mudo          # testa o timeout
    python -m simuladores.raspberry --offline       # testa o 503

Com o terminal interativo, dá para mudar o comportamento ao vivo sem
reiniciar — útil na demonstração: "agora ele tira o capacete".
"""
from __future__ import annotations

import argparse
import random
import signal
import threading
import time

from simuladores.comum import (
    Dispositivo,
    argumentos_comuns,
    envelope,
    escutar_teclado,
    log,
    t_cmd,
    t_evt,
)

AJUDA = """teclas (digite a letra e Enter):
  a  próxima verificação APROVA (todos os EPIs presentes)
  r  próxima REPROVA (falta o primeiro EPI exigido)
  t  próxima NÃO RESPONDE (o servidor vai expirar em ~10s)
  o  alterna online / offline
  s  mostra o estado atual
  q  encerra"""


class Camera:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.faltando: set[str] = set(
            x.strip() for x in args.faltando.split(",") if x.strip()
        )
        self.mudo = args.mudo
        self.latencia_ms = args.latencia_ms
        self.versao_modelo = args.versao_modelo
        self.contador = 0

        self.dev = Dispositivo(
            device_id=args.device_id,
            site=args.site,
            ponto=args.ponto,
            host=args.host,
            porta=args.porta,
            usuario=args.usuario,
            senha=args.senha,
            anunciar=not args.offline,
            extras_status={"fw": "sim-1.0.0", "modelo": args.versao_modelo},
        )
        self.dev.ao_receber(
            t_cmd(args.site, args.ponto, "capturar"), self.ao_capturar
        )

    # ------------------------------------------------------------ handler
    def ao_capturar(self, cmd: dict, topico: str) -> None:
        self.contador += 1
        verif = cmd.get("verificacao_id", "?")
        exigidos: list[str] = cmd.get("epis_exigidos", [])
        frames = cmd.get("frames", 5)

        log("azul", "COMANDO",
            f"capturar #{self.contador} · verificação {verif[:8]}… · "
            f"exige {', '.join(exigidos)}")

        if self.mudo:
            log("amarelo", "MUDO",
                "ignorando de propósito — o servidor vai expirar esta "
                "verificação")
            return

        # Simula o tempo de inferência. Numa thread, para não travar o
        # laço de rede do paho enquanto "pensa".
        threading.Thread(
            target=self._responder, args=(verif, exigidos, frames), daemon=True
        ).start()

    def _responder(self, verif: str, exigidos: list[str], frames: int) -> None:
        time.sleep(self.latencia_ms / 1000)

        deteccoes = []
        for epi in exigidos:
            presente = epi not in self.faltando
            # Ruído leve na confiança para o resultado não parecer sintético
            base = self.args.confianca if presente else 0.22
            conf = round(min(0.999, max(0.01, base + random.uniform(-0.04, 0.04))), 3)
            deteccoes.append({
                "epi": epi,
                "presente": presente,
                "confianca": conf,
                # Regra dos N frames: exigir confirmação em pelo menos 3 de 5
                # derruba muito o falso negativo por movimento e reflexo.
                "frames_confirmados": frames if presente else random.randint(0, 2),
                "bbox": [312, 88, 196, 154] if presente else None,
            })

        corpo = envelope(
            verificacao_id=verif,
            versao_modelo=self.versao_modelo,
            latencia_ms=self.latencia_ms,
            frames_analisados=frames,
            deteccoes=deteccoes,
            # Numa Raspberry real, aqui iria o id devolvido por
            # POST /api/v1/evidencias. A imagem NUNCA vai por MQTT.
            evidencia_id=None,
        )
        self.dev.publicar(t_evt(self.args.site, self.args.ponto, "resultado"), corpo)

        ausentes = [d["epi"] for d in deteccoes if not d["presente"]]
        if ausentes:
            log("vermelho", "RESULTADO",
                f"publicado · faltou: {', '.join(ausentes)}")
        else:
            log("verde", "RESULTADO",
                f"publicado · todos os {len(deteccoes)} EPIs presentes")

    # ------------------------------------------------------------ teclado
    def _teclas(self, exigidos_padrao: list[str]) -> dict:
        def aprovar() -> None:
            self.faltando.clear()
            self.mudo = False
            log("verde", "MODO", "próximas verificações APROVAM")

        def reprovar() -> None:
            alvo = exigidos_padrao[0] if exigidos_padrao else "capacete"
            self.faltando = {alvo}
            self.mudo = False
            log("vermelho", "MODO", f"próximas REPROVAM (sem {alvo})")

        def emudecer() -> None:
            self.mudo = True
            log("amarelo", "MODO", "próximas NÃO RESPONDEM (testa timeout)")

        def alternar_online() -> None:
            self.dev.publicar_status(not self.dev.online)

        def estado() -> None:
            log("azul", "ESTADO",
                f"online={self.dev.online} mudo={self.mudo} "
                f"faltando={sorted(self.faltando) or 'nada'} "
                f"latência={self.latencia_ms}ms")

        return {"a": aprovar, "r": reprovar, "t": emudecer,
                "o": alternar_online, "s": estado, "q": self._sair}

    def _sair(self) -> None:
        self.parando.set()

    # ------------------------------------------------------------ vida
    def rodar(self) -> None:
        self.parando = threading.Event()
        self.dev.iniciar()

        if self.args.offline:
            log("amarelo", "AVISO",
                "subindo OFFLINE — o servidor vai recusar verificações com "
                "503 'câmera do ponto está offline'")

        escutar_teclado(self._teclas(["capacete", "oculos", "colete"]), AJUDA)

        for sinal in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sinal, lambda *_: self.parando.set())

        log("verde", "PRONTO", "aguardando comandos de captura…")
        self.parando.wait()
        self.dev.parar()


def main() -> None:
    p = argparse.ArgumentParser(
        description="Simulador da Raspberry Pi (câmera + modelo de EPI)"
    )
    argumentos_comuns(p)
    p.add_argument("--device-id", default="rasp-planta01-portaria",
                   help="precisa bater com dispositivos.client_id_mqtt no banco")
    p.add_argument("--faltando", default="",
                   help="EPIs a reportar como AUSENTES, separados por vírgula "
                        "(ex.: capacete,oculos)")
    p.add_argument("--mudo", action="store_true",
                   help="recebe o comando e não responde — testa o timeout")
    p.add_argument("--latencia-ms", type=int, default=600,
                   help="tempo simulado de inferência")
    p.add_argument("--confianca", type=float, default=0.94,
                   help="confiança base para EPI presente")
    p.add_argument("--versao-modelo", default="yolov8n-epi-sim",
                   help="gravado em verificacoes.versao_modelo")
    Camera(p.parse_args()).rodar()


if __name__ == "__main__":
    main()
