"""Confere o pipeline de rosto do servidor contra o do tablet.

    python -m scripts.testar_rosto                    # só a aritmética
    python -m scripts.testar_rosto foto.jpg           # + uma foto de verdade
    python -m scripts.testar_rosto a.jpg b.jpg c.jpg  # + distância entre elas

Dois blocos, com garantias bem diferentes.

O PRIMEIRO roda sem foto nenhuma e reproduz, em Python, os mesmos casos dos
testes do tablet (`faceGeometry.test.ts`, `facenetPreprocess.test.ts`). Se
passar, a porta do TypeScript está fiel: mesmo quadrado, mesma
padronização, mesmo tensor. Isso eu garanto.

O SEGUNDO precisa de fotos suas e responde a pergunta que a aritmética não
responde: o detector daqui (YuNet) recorta o rosto no mesmo lugar que o ML
Kit do tablet recorta? Com duas ou mais fotos da MESMA pessoa, a distância
entre os vetores deve ficar bem abaixo de 0.40 — que é o limiar de
identificação. Se ficar alta, o problema não é o modelo: é o recorte.

Para medir o descasamento de verdade contra o tablet, cadastre alguém pelo
aplicativo primeiro e depois envie uma foto dessa mesma pessoa pelo painel:
a resposta do cadastro traz `distancia_menor`, que é exatamente esse número.
"""
from __future__ import annotations

import sys
from pathlib import Path

VERDE, VERMELHO, AMARELO, CINZA, OFF = (
    "\033[32m", "\033[31m", "\033[33m", "\033[90m", "\033[0m",
)

_ok = 0
_falhas: list[str] = []


def checar(nome: str, condicao: bool, extra: str = "") -> None:
    global _ok
    if condicao:
        _ok += 1
        print(f"  {VERDE}ok{OFF}    {nome} {CINZA}{extra}{OFF}")
    else:
        _falhas.append(nome)
        print(f"  {VERMELHO}FALHA{OFF} {nome} {extra}")


def aritmetica() -> None:
    """Os mesmos casos dos testes do tablet, em Python."""
    from app.services.rosto import Caixa, _padronizar, _quadrar

    print(f"\n{CINZA}1. quadratura da caixa (porta de faceGeometry.ts){OFF}")

    q = _quadrar(Caixa(100, 100, 40, 80), 1000, 1000)
    checar("usa o lado maior", q.largura == 80 and q.altura == 80, f"({q.largura})")
    checar(
        "preserva o centro",
        abs((q.x + q.largura / 2) - 120) <= 0.5 and abs((q.y + q.altura / 2) - 140) <= 0.5,
        f"(centro {q.x + q.largura / 2}, {q.y + q.altura / 2})",
    )

    ja_quadrada = Caixa(10, 10, 50, 50)
    q = _quadrar(ja_quadrada, 1000, 1000)
    checar(
        "não adiciona margem alguma",
        (q.x, q.y, q.largura, q.altura) == (10, 10, 50, 50),
        f"({q.x},{q.y},{q.largura},{q.altura})",
    )

    q = _quadrar(Caixa(-20, 200, 100, 100), 1000, 1000)
    checar("desloca em vez de sair pela borda", q.x == 0 and q.largura == 100)

    q = _quadrar(Caixa(5, 200, 100, 100), 1000, 1000)
    checar("deixa quieta a caixa que já cabe", q.x == 5 and q.largura == 100)

    # Rosto maior que a imagem: o lado é limitado pela menor dimensão.
    q = _quadrar(Caixa(0, 0, 400, 400), 300, 200)
    checar("respeita o limite da imagem", q.largura == 200 and q.altura == 200, f"({q.largura})")

    print(f"\n{CINZA}2. padronização (porta de facenetPreprocess.ts){OFF}")
    import numpy as np

    # (p - 127.5) / 128 — os mesmos quatro valores do teste do tablet.
    esperados = {0: -0.99609375, 127: -0.00390625, 128: 0.00390625, 255: 0.99609375}
    for pixel, esperado in esperados.items():
        img = np.full((160, 160, 3), pixel, np.uint8)
        obtido = float(_padronizar(img)[0, 0, 0, 0])
        checar(
            f"pixel {pixel} vira {esperado}",
            abs(obtido - esperado) < 1e-7,
            f"({obtido})",
        )

    checar(
        "NÃO é p/255",
        abs(_padronizar(np.full((160, 160, 3), 128, np.uint8))[0, 0, 0, 0] - 128 / 255) > 0.4,
    )

    # Layout CHW: canal inteiro de cada vez, não pixel a pixel.
    img = np.zeros((160, 160, 3), np.uint8)
    img[:, :, 0] = 0
    img[:, :, 1] = 128
    img[:, :, 2] = 255
    t = _padronizar(img)
    checar("tensor sai 1x3x160x160", t.shape == (1, 3, 160, 160), f"({t.shape})")
    checar(
        "layout é CHW, não HWC",
        abs(float(t[0, 0, 5, 5]) - esperados[0]) < 1e-6
        and abs(float(t[0, 1, 5, 5]) - esperados[128]) < 1e-6
        and abs(float(t[0, 2, 5, 5]) - esperados[255]) < 1e-6,
    )


def com_fotos(caminhos: list[Path]) -> None:
    from app.core.config import settings
    from app.services import rosto as svc

    print(f"\n{CINZA}3. fotos de verdade{OFF}")

    extracoes = []
    for caminho in caminhos:
        if not caminho.is_file():
            checar(f"{caminho.name} existe", False)
            continue
        try:
            e = svc.extrair(caminho.read_bytes())
        except svc.ErroRosto as exc:
            checar(f"{caminho.name}: extrai um rosto", False, f"({exc})")
            continue

        checar(
            f"{caminho.name}: extrai um rosto",
            True,
            f"(det {e.confianca_deteccao:.2f} · recorte {e.caixa_recorte.largura}px "
            f"de {e.largura_imagem}x{e.altura_imagem})",
        )
        checar(
            f"{caminho.name}: vetor com 512 dimensões e norma 1",
            len(e.embedding) == 512
            and abs(sum(v * v for v in e.embedding) ** 0.5 - 1.0) < 1e-3,
        )

        # Gravar o recorte é o único jeito de alguém VER o que o modelo viu.
        saida = caminho.with_name(f"{caminho.stem}-recorte.png")
        saida.write_bytes(e.recorte_png)
        print(f"        {CINZA}recorte salvo em {saida}{OFF}")
        extracoes.append((caminho, e))

    if len(extracoes) < 2:
        print(
            f"\n  {AMARELO}Com uma foto só não dá para medir distância.{OFF}\n"
            f"  {CINZA}Passe 2 ou mais fotos da MESMA pessoa para ver se os "
            f"vetores se aproximam.{OFF}"
        )
        return

    print(f"\n{CINZA}4. distância entre as fotos{OFF}")
    print(
        f"  {CINZA}Se forem da mesma pessoa, espere bem abaixo de "
        f"{settings.FACE_DISTANCIA_MAX} (o limiar de identificação).{OFF}\n"
    )
    for i in range(len(extracoes)):
        for j in range(i + 1, len(extracoes)):
            (ca, ea), (cb, eb) = extracoes[i], extracoes[j]
            d = svc.distancia_cosseno(ea.embedding, eb.embedding)
            cor = VERDE if d <= settings.FACE_DISTANCIA_MAX else AMARELO
            print(f"    {ca.name} ↔ {cb.name}   {cor}{d:.4f}{OFF}")


def main() -> int:
    caminhos = [Path(a) for a in sys.argv[1:]]

    print(f"\n{CINZA}Pipeline de rosto do servidor — conferência{OFF}")
    aritmetica()

    if caminhos:
        com_fotos(caminhos)
    else:
        print(
            f"\n  {AMARELO}Sem fotos, só a aritmética foi conferida.{OFF}\n"
            f"  {CINZA}A aritmética prova que o recorte e a normalização "
            f"batem com o tablet.\n  Ela NÃO prova que o detector daqui "
            f"acha o rosto no mesmo lugar que o ML Kit acha —\n  para isso, "
            f"passe fotos: python -m scripts.testar_rosto foto1.jpg foto2.jpg{OFF}"
        )

    print(f"\n{'=' * 56}")
    print(f"{_ok} verificações passaram, {len(_falhas)} falharam")
    for f in _falhas:
        print(f"  - {f}")
    return 1 if _falhas else 0


if __name__ == "__main__":
    sys.exit(main())
