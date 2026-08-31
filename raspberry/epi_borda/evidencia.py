"""Envio da foto da verificação — por HTTP, nunca por MQTT.

Um JPEG de 300 KB vira ~400 KB em base64 que o broker precisa segurar na
RAM para cada assinante, e uma retransmissão de QoS 1 duplica o tráfego.
MQTT carrega fatos; mídia vai por HTTP. O `evt/resultado` leva só o
`evidencia_id` devolvido aqui.

Desligado por padrão (`EVIDENCIA_ATIVA=0`). É imagem de pessoa: só ligue
com a retenção acertada no servidor e o rosto borrado antes de sair
daqui.
"""
from __future__ import annotations

import logging
import mimetypes
import urllib.error
import urllib.request
import uuid

log = logging.getLogger(__name__)

TAMANHO_MAX = 5 * 1024 * 1024  # o servidor recusa acima disso com 413


def enviar(
    *,
    api_base: str,
    token: str,
    verificacao_id: str,
    jpeg: bytes,
    rosto_borrado: bool,
    timeout: float = 4.0,
) -> str | None:
    """POST multipart em /api/v1/evidencias. Devolve o id, ou None.

    Devolve None em vez de levantar: a evidência é acessório. Se o upload
    falhar, o resultado ainda precisa sair no prazo — perder a foto é
    ruim, travar a catraca por causa dela é pior.
    """
    if len(jpeg) > TAMANHO_MAX:
        log.warning("evidência de %d bytes acima do limite; descartada", len(jpeg))
        return None

    limite = f"----epi{uuid.uuid4().hex}"
    corpo = _multipart(
        limite,
        campos={
            "verificacao_id": verificacao_id,
            "rosto_borrado": "true" if rosto_borrado else "false",
        },
        arquivo=("arquivo", "captura.jpg", "image/jpeg", jpeg),
    )
    req = urllib.request.Request(
        f"{api_base}/api/v1/evidencias",
        data=corpo,
        method="POST",
        headers={
            "Content-Type": f"multipart/form-data; boundary={limite}",
            "Authorization": f"Bearer {token}",
            "Content-Length": str(len(corpo)),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            import json

            return json.load(r)["evidencia_id"]
    except urllib.error.HTTPError as exc:
        log.warning("evidência recusada (%s): %s", exc.code, exc.read()[:200])
    except OSError as exc:
        log.warning("falha ao enviar evidência: %s", exc)
    return None


def _multipart(limite: str, campos: dict[str, str], arquivo) -> bytes:
    nome, filename, tipo, dados = arquivo
    partes: list[bytes] = []
    for chave, valor in campos.items():
        partes.append(
            f'--{limite}\r\nContent-Disposition: form-data; name="{chave}"'
            f"\r\n\r\n{valor}\r\n".encode()
        )
    partes.append(
        f'--{limite}\r\nContent-Disposition: form-data; name="{nome}"; '
        f'filename="{filename}"\r\nContent-Type: '
        f"{tipo or mimetypes.guess_type(filename)[0]}\r\n\r\n".encode()
    )
    partes.append(dados)
    partes.append(f"\r\n--{limite}--\r\n".encode())
    return b"".join(partes)
