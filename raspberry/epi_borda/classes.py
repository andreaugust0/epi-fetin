"""Tradução entre as classes do modelo e os códigos do servidor.

Este arquivo existe porque as duas pontas foram escritas por pessoas
diferentes, em momentos diferentes, e ninguém casou os nomes ainda. O
descasamento é a falha mais provável desta integração — e a mais chata,
porque ela não estoura: o servidor simplesmente ignora um EPI que não
reconhece, `_avaliar` conta a ausência de informação como reprovação, e a
catraca fica fechada sem ninguém entender por quê.

Então a regra aqui é o contrário de "tolerar": **classe desconhecida é
erro alto**, e o agente se recusa a subir com um mapa incompleto.

Como ajustar:

1. `python -m epi_borda.classes --do-modelo caminho/do/modelo.onnx`
   imprime os nomes que o seu ONNX carrega em metadata (o export do
   ultralytics grava `names` lá).
2. Preencha DE_MODELO_PARA_SERVIDOR com esses nomes à esquerda.
3. `python -m epi_borda.classes --conferir` bate o lado direito contra
   `GET /api/v1/epis` do servidor no ar e acusa o que não existir.

Quando vocês renomearem as classes no dataset, este arquivo encolhe até
virar identidade — e aí pode sumir. Enquanto não, ele é o único lugar
onde o descasamento mora.
"""
from __future__ import annotations

import argparse
import json
import sys

#: Os sete códigos que o servidor conhece hoje (scripts/init_db.py).
#: Mantido aqui como cópia deliberada: é contra isto que validamos sem
#: precisar do servidor no ar.
CODIGOS_SERVIDOR = {
    "capacete",
    "colete",
    "oculos",
    "botas",
    "auricular",
    "mascara",
    "luvas",
}

#: nome que SAI do modelo  ->  código que o SERVIDOR espera
#:
#: Os nomes à esquerda são um palpite baseado no padrão mais comum de
#: dataset de EPI. CONFIRME com --do-modelo antes de rodar em campo.
DE_MODELO_PARA_SERVIDOR: dict[str, str] = {
    # inglês, o mais comum em dataset público
    "helmet": "capacete",
    "hardhat": "capacete",
    "hard-hat": "capacete",
    "vest": "colete",
    "safety-vest": "colete",
    "goggles": "oculos",
    "glasses": "oculos",
    "boots": "botas",
    "shoes": "botas",
    "earmuffs": "auricular",
    "ear-protection": "auricular",
    "mask": "mascara",
    "gloves": "luvas",
    # português, caso o dataset seja de vocês
    "capacete": "capacete",
    "colete": "colete",
    "oculos": "oculos",
    "óculos": "oculos",
    "botas": "botas",
    "bota": "botas",
    "auricular": "auricular",
    "protetor-auricular": "auricular",
    "mascara": "mascara",
    "máscara": "mascara",
    "luvas": "luvas",
    "luva": "luvas",
}

#: Classes que o modelo emite e que NÃO são EPI — pessoa, e as negativas
#: do tipo "no-helmet". Listadas de propósito: assim o agente sabe que são
#: conhecidas e ignoradas, em vez de acusar mapa incompleto.
#:
#: As negativas merecem atenção. Um modelo que emite `no-helmet` está
#: dizendo "vi uma cabeça sem capacete" — informação boa, mas o contrato
#: não tem campo para ela: `presente: false` já cobre. Tratamos como ruído
#: aqui, e o adaptador em detectores/ decide se usa para reforçar a
#: ausência.
IGNORADAS = {
    "person", "pessoa", "head", "cabeca", "cabeça", "face", "rosto",
    "no-helmet", "no-hardhat", "no-vest", "no-mask", "no-goggles",
    "sem-capacete", "sem-colete", "sem-mascara",
}


class MapaIncompleto(RuntimeError):
    """O modelo emite uma classe que ninguém decidiu o que fazer com."""


def traduzir(classe_modelo: str) -> str | None:
    """Código do servidor, ou None se a classe é conhecida-e-ignorada.

    Levanta MapaIncompleto para classe que ninguém previu. Falhar aqui é
    melhor do que devolver None e a classe sumir sem rastro.
    """
    chave = classe_modelo.strip().lower().replace("_", "-")
    if chave in DE_MODELO_PARA_SERVIDOR:
        return DE_MODELO_PARA_SERVIDOR[chave]
    if chave in IGNORADAS:
        return None
    raise MapaIncompleto(
        f"classe {classe_modelo!r} não está em DE_MODELO_PARA_SERVIDOR nem "
        f"em IGNORADAS. Edite epi_borda/classes.py — se ela deve ser "
        f"descartada, acrescente a IGNORADAS explicitamente."
    )


def validar_mapa(nomes_do_modelo: list[str]) -> None:
    """Confere o mapa contra as classes reais do modelo, na subida.

    Chamado pelo agente antes de conectar no broker. O objetivo é que um
    mapa errado apareça no `systemctl status` na bancada, e não numa
    catraca travada com alguém parado na frente.
    """
    desconhecidas = []
    for nome in nomes_do_modelo:
        try:
            traduzir(nome)
        except MapaIncompleto:
            desconhecidas.append(nome)
    if desconhecidas:
        raise MapaIncompleto(
            "o modelo emite classes que o mapa não cobre: "
            + ", ".join(sorted(desconhecidas))
            + "\nEdite epi_borda/classes.py antes de subir."
        )

    invalidos = sorted(set(DE_MODELO_PARA_SERVIDOR.values()) - CODIGOS_SERVIDOR)
    if invalidos:
        raise MapaIncompleto(
            "o mapa aponta para códigos que o servidor não conhece: "
            + ", ".join(invalidos)
        )


# ------------------------------------------------------------ ferramentas
def _nomes_do_onnx(caminho: str) -> list[str]:
    """Lê `names` do metadata que o export do ultralytics grava no ONNX."""
    import onnxruntime as ort  # importado aqui: só esta função precisa

    sessao = ort.InferenceSession(caminho, providers=["CPUExecutionProvider"])
    meta = sessao.get_modelmeta().custom_metadata_map
    if "names" not in meta:
        raise SystemExit(
            "este ONNX não traz 'names' no metadata. Veja as classes no "
            "data.yaml do treino e preencha o mapa à mão."
        )
    # O ultralytics grava uma repr de dict Python: {0: 'helmet', 1: ...}
    bruto = meta["names"]
    try:
        return list(json.loads(bruto.replace("'", '"')).values())
    except json.JSONDecodeError:
        import ast

        return list(ast.literal_eval(bruto).values())


def _conferir_com_servidor(base_url: str, email: str, senha: str) -> int:
    """Bate o mapa contra GET /api/v1/tipos-epi.

    O catálogo é rota autenticada, então fazemos login antes. Vale a
    pena: é a única checagem que olha para o banco de verdade, e não
    para a cópia de `CODIGOS_SERVIDOR` que envelhece aqui.
    """
    import urllib.request

    def pedir(caminho: str, corpo: dict | None = None, token: str | None = None):
        dados = json.dumps(corpo).encode() if corpo is not None else None
        cabecalhos = {"Content-Type": "application/json"} if dados else {}
        if token:
            cabecalhos["Authorization"] = f"Bearer {token}"
        req = urllib.request.Request(
            f"{base_url}{caminho}", data=dados, headers=cabecalhos
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.load(r)

    token = pedir("/api/v1/auth/login", {"email": email, "senha": senha})[
        "access_token"
    ]
    catalogo = pedir("/api/v1/tipos-epi", token=token)
    do_servidor = {e["codigo"] for e in catalogo}

    faltando_na_copia = sorted(do_servidor ^ CODIGOS_SERVIDOR)
    if faltando_na_copia:
        print(
            "aviso: CODIGOS_SERVIDOR neste arquivo não bate com o servidor "
            f"({', '.join(faltando_na_copia)}). Atualize a cópia.\n"
        )

    alvos = set(DE_MODELO_PARA_SERVIDOR.values())
    faltam = sorted(alvos - do_servidor)
    sobram = sorted(do_servidor - alvos)

    print(f"servidor conhece {len(do_servidor)}: {', '.join(sorted(do_servidor))}")
    print(f"o mapa produz  {len(alvos)}: {', '.join(sorted(alvos))}")
    if faltam:
        print(f"\nERRO: o mapa aponta para códigos inexistentes: {', '.join(faltam)}")
    if sobram:
        print(
            f"\naviso: o servidor conhece EPIs que o modelo não detecta: "
            f"{', '.join(sobram)} — um ponto que exija um destes vai "
            f"reprovar sempre, porque ausência de informação conta como "
            f"reprovação."
        )
    if not faltam and not sobram:
        print("\nok: as duas pontas falam exatamente os mesmos códigos.")
    return 1 if faltam else 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--do-modelo", metavar="ONNX",
                   help="imprime as classes gravadas no metadata do ONNX")
    p.add_argument("--conferir", action="store_true",
                   help="bate o mapa contra o catálogo do servidor no ar")
    p.add_argument("--servidor", default="http://localhost:8000")
    p.add_argument("--email", default="admin@epiguard.com.br")
    p.add_argument("--senha", default="admin123")
    args = p.parse_args()

    if args.do_modelo:
        nomes = _nomes_do_onnx(args.do_modelo)
        print(f"{len(nomes)} classes no modelo:\n")
        for nome in nomes:
            try:
                destino = traduzir(nome)
                estado = f"-> {destino}" if destino else "-> (ignorada)"
            except MapaIncompleto:
                estado = "-> FALTA NO MAPA"
            print(f"  {nome:<22} {estado}")
        return 0

    if args.conferir:
        return _conferir_com_servidor(
            args.servidor.rstrip("/"), args.email, args.senha
        )

    p.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
