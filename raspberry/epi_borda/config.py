"""Configuração, lida de variáveis de ambiente ou de um .env ao lado.

Sem pydantic-settings de propósito: numa Raspberry, cada dependência é
tempo de boot e MB de cartão. São vinte linhas de parsing.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def _carregar_env(caminho: Path) -> None:
    """Lê um .env simples sem sobrescrever o ambiente real.

    O ambiente vence o arquivo de propósito: no systemd a configuração vem
    por `Environment=`, e um .env esquecido no disco não pode ganhar dela.
    """
    if not caminho.is_file():
        return
    for linha in caminho.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        chave, _, valor = linha.partition("=")
        os.environ.setdefault(chave.strip(), valor.strip().strip('"').strip("'"))


def _bool(nome: str, padrao: bool) -> bool:
    val = os.getenv(nome)
    if val is None:
        return padrao
    return val.strip().lower() in {"1", "true", "sim", "yes", "on"}


@dataclass(slots=True)
class Config:
    # ---------------------------------------------------------- identidade
    #: PRECISA bater com `client_id_mqtt` do dispositivo cadastrado no
    #: servidor. Se não bater, o worker loga "status de dispositivo não
    #: cadastrado", a câmera nunca aparece online, e toda verificação é
    #: recusada com 503 antes mesmo de abrir. É o erro nº 1 desta etapa.
    device_id: str = "rasp-planta01-portaria"
    site: str = "planta01"
    ponto: str = "portaria"

    # ---------------------------------------------------------- broker
    mqtt_host: str = "localhost"
    mqtt_porta: int = 1883
    mqtt_usuario: str | None = None
    mqtt_senha: str | None = None
    mqtt_keepalive: int = 30

    # ---------------------------------------------------------- inferência
    #: Vai inteiro para `versao_modelo` em cada resultado, e daí para a
    #: coluna `verificacoes.versao_modelo`. É o que permite, depois de
    #: trocar o modelo, separar no relatório o que foi decidido por qual.
    versao_modelo: str = "epi-yolo-v1"
    modelo: str = "modelos/epi.onnx"
    confianca_min: float = 0.45
    iou_nms: float = 0.45

    #: Quantos dos N frames precisam confirmar para o EPI valer como
    #: presente. O servidor pede `frames: 5`; exigir 3 derruba muito o
    #: falso negativo de movimento e reflexo sem deixar passar quem tirou
    #: o capacete na frente da câmera.
    min_confirmacoes: int = 3

    #: Margem antes do prazo do servidor. Ele expira em 10s; respondemos
    #: até 8s. O resto é tempo de rede e de gravação no banco — resultado
    #: que chega tarde é descartado, e a pessoa fica parada à toa.
    margem_prazo_s: float = 2.0

    # ---------------------------------------------------------- evidência
    #: Envio da foto por HTTP é opcional e desligado por padrão: exige
    #: token de dispositivo e envolve imagem de pessoa (LGPD).
    evidencia_ativa: bool = False
    api_base: str = "http://localhost:8000"
    api_token: str | None = None

    # ---------------------------------------------------------- diversos
    telemetria_s: int = 60
    log_nivel: str = "INFO"

    def __post_init__(self) -> None:
        if self.min_confirmacoes < 1:
            raise ValueError("min_confirmacoes precisa ser >= 1")
        if self.evidencia_ativa and not self.api_token:
            raise ValueError(
                "EVIDENCIA_ATIVA=1 exige API_TOKEN. Emita com "
                "POST /api/v1/auth/tablets/{id}/token usando o login admin."
            )


def carregar(env: Path | None = None) -> Config:
    _carregar_env(env or RAIZ / ".env")
    g = os.getenv
    return Config(
        device_id=g("DEVICE_ID", "rasp-planta01-portaria"),
        site=g("SITE", "planta01"),
        ponto=g("PONTO", "portaria"),
        mqtt_host=g("MQTT_HOST", "localhost"),
        mqtt_porta=int(g("MQTT_PORT", "1883")),
        mqtt_usuario=g("MQTT_USER") or None,
        mqtt_senha=g("MQTT_PASS") or None,
        mqtt_keepalive=int(g("MQTT_KEEPALIVE", "30")),
        versao_modelo=g("VERSAO_MODELO", "epi-yolo-v1"),
        modelo=g("MODELO", "modelos/epi.onnx"),
        confianca_min=float(g("CONFIANCA_MIN", "0.45")),
        iou_nms=float(g("IOU_NMS", "0.45")),
        min_confirmacoes=int(g("MIN_CONFIRMACOES", "3")),
        margem_prazo_s=float(g("MARGEM_PRAZO_S", "2.0")),
        evidencia_ativa=_bool("EVIDENCIA_ATIVA", False),
        api_base=g("API_BASE", "http://localhost:8000").rstrip("/"),
        api_token=g("API_TOKEN") or None,
        telemetria_s=int(g("TELEMETRIA_S", "60")),
        log_nivel=g("LOG_NIVEL", "INFO").upper(),
    )
