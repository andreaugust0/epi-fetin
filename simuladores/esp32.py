"""Simulador do ESP32 — faz o papel da catraca.

Assina `cmd/liberar`, aciona um relé imaginário e publica `evt/passagem`.

    python -m simuladores.esp32
    python -m simuladores.esp32 --nao-passar      # libera e ninguém entra
    python -m simuladores.esp32 --sem-protecao    # mostra o bug (ver abaixo)

As duas travas que o firmware real precisa ter estão implementadas aqui,
e a flag `--sem-protecao` desliga as duas para você ver o que acontece sem
elas. Vale rodar uma vez: é demonstração pronta para a monografia.
"""
from __future__ import annotations

import argparse
import signal
import threading
import time
from collections import deque

from simuladores.comum import (
    Dispositivo,
    agora,
    argumentos_comuns,
    envelope,
    escutar_teclado,
    ler_ts,
    log,
    t_cmd,
    t_evt,
)

AJUDA = """teclas (digite a letra e Enter):
  p  próxima liberação: a pessoa PASSA
  n  próxima liberação: NINGUÉM passa (timeout)
  f  próxima liberação: FALHA NO RELÉ
  o  alterna online / offline
  s  mostra o estado atual
  q  encerra"""


class Catraca:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.comportamento = (
            "FALHA_RELE" if args.falha_rele
            else "TIMEOUT_SEM_PASSAGEM" if args.nao_passar
            else "PASSOU"
        )
        self.protegido = not args.sem_protecao

        # Buffer circular de msg_id já processados. QoS 1 é at-least-once:
        # a MESMA mensagem pode chegar duas vezes. Sem isto, uma reentrega
        # abre a catraca de novo.
        self.vistos: deque[str] = deque(maxlen=20)
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
            extras_status={"fw": "sim-1.0.0"},
        )
        self.dev.ao_receber(
            t_cmd(args.site, args.ponto, "liberar"), self.ao_liberar
        )

    # ------------------------------------------------------------ handler
    def ao_liberar(self, cmd: dict, topico: str) -> None:
        msg_id = cmd.get("msg_id", "")
        verif = cmd.get("verificacao_id", "?")

        # --- Trava 1: idempotência -------------------------------------
        if self.protegido and msg_id in self.vistos:
            log("amarelo", "DUPLICATA",
                f"msg_id {msg_id[:8]}… já processado — ignorando. "
                f"Sem esta trava a catraca abriria duas vezes.")
            return
        self.vistos.append(msg_id)

        # --- Trava 2: expiração ----------------------------------------
        expira = cmd.get("expira_em")
        if expira:
            try:
                venceu = ler_ts(expira) < agora()
            except ValueError:
                venceu = False
            if venceu:
                if self.protegido:
                    log("amarelo", "EXPIRADO",
                        "comando fora do prazo — descartado. Cobre o caso do "
                        "ESP32 que ficou sem rede e recebe uma fila de "
                        "comandos velhos ao reconectar.")
                    return
                log("vermelho", "PERIGO",
                    "comando VENCIDO sendo executado — a catraca está "
                    "abrindo para ninguém (proteção desligada)")

        self.contador += 1
        duracao = cmd.get("duracao_ms", 5000)
        log("verde", "RELÉ",
            f"acionado #{self.contador} · verificação {verif[:8]}… · "
            f"{duracao}ms")

        threading.Thread(
            target=self._ciclo, args=(verif, duracao), daemon=True
        ).start()

    def _ciclo(self, verif: str, duracao_ms: int) -> None:
        # Evento 1: a catraca destravou.
        self._publicar(verif, "LIBERADO")

        if self.comportamento == "FALHA_RELE":
            time.sleep(0.2)
            self._publicar(verif, "FALHA_RELE")
            log("vermelho", "FALHA", "relé não respondeu")
            return

        if self.comportamento == "TIMEOUT_SEM_PASSAGEM":
            # Espera a janela inteira e reporta que ninguém entrou.
            time.sleep(duracao_ms / 1000)
            self._publicar(verif, "TIMEOUT_SEM_PASSAGEM")
            log("amarelo", "PASSAGEM",
                "janela fechou sem ninguém passar — liberar NÃO é o mesmo "
                "que passar, e a auditoria vive dessa diferença")
            return

        # Caminho normal: alguém gira a catraca no meio da janela.
        time.sleep(min(1.2, duracao_ms / 1000 / 2))
        self._publicar(verif, "PASSOU")
        log("verde", "PASSAGEM", "pessoa passou")

    def _publicar(self, verif: str, evento: str) -> None:
        self.dev.publicar(
            t_evt(self.args.site, self.args.ponto, "passagem"),
            envelope(verificacao_id=verif, evento=evento),
        )

    # ------------------------------------------------------------ teclado
    def _teclas(self) -> dict:
        def modo(valor: str, cor: str, texto: str):
            def _acao() -> None:
                self.comportamento = valor
                log(cor, "MODO", texto)
            return _acao

        def estado() -> None:
            log("azul", "ESTADO",
                f"online={self.dev.online} comportamento={self.comportamento} "
                f"proteções={'ligadas' if self.protegido else 'DESLIGADAS'} "
                f"aberturas={self.contador}")

        return {
            "p": modo("PASSOU", "verde", "próxima: a pessoa passa"),
            "n": modo("TIMEOUT_SEM_PASSAGEM", "amarelo",
                      "próxima: ninguém passa"),
            "f": modo("FALHA_RELE", "vermelho", "próxima: falha no relé"),
            "o": lambda: self.dev.publicar_status(not self.dev.online),
            "s": estado,
            "q": self._sair,
        }

    def _sair(self) -> None:
        self.parando.set()

    # ------------------------------------------------------------ vida
    def rodar(self) -> None:
        self.parando = threading.Event()
        self.dev.iniciar()

        if not self.protegido:
            log("vermelho", "AVISO",
                "PROTEÇÕES DESLIGADAS — sem idempotência e sem checagem de "
                "expiração. É assim que um firmware ingênuo se comporta.")

        escutar_teclado(self._teclas(), AJUDA)

        for sinal in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sinal, lambda *_: self.parando.set())

        log("verde", "PRONTO", "aguardando comandos de liberação…")
        self.parando.wait()
        self.dev.parar()


def main() -> None:
    p = argparse.ArgumentParser(description="Simulador do ESP32 (catraca)")
    argumentos_comuns(p)
    p.add_argument("--device-id", default="esp32-planta01-portaria",
                   help="precisa bater com dispositivos.client_id_mqtt no banco")
    p.add_argument("--nao-passar", action="store_true",
                   help="libera, mas ninguém atravessa (TIMEOUT_SEM_PASSAGEM)")
    p.add_argument("--falha-rele", action="store_true",
                   help="reporta FALHA_RELE após liberar")
    p.add_argument("--sem-protecao", action="store_true",
                   help="desliga idempotência e checagem de expiração, para "
                        "você ver o que acontece sem elas")
    Catraca(p.parse_args()).rodar()


if __name__ == "__main__":
    main()
