"""ARQUIVO GERADO por contrato/gerar.py — não edite à mão.

Tradução entre as classes que o modelo emite e os códigos do
servidor. Fonte: contrato/epis.json.

Para acrescentar um sinônimo do seu modelo, edite o JSON e rode
`python3 contrato/gerar.py` — não edite aqui.
"""
from __future__ import annotations

CODIGOS_SERVIDOR = {
    'capacete',
    'colete',
    'oculos',
    'botas',
    'auricular',
    'mascara',
    'luvas',
}

#: nome que SAI do modelo  ->  código que o SERVIDOR espera
DE_MODELO_PARA_SERVIDOR: dict[str, str] = {
    'helmet': 'capacete',
    'hardhat': 'capacete',
    'hard-hat': 'capacete',
    'capacete': 'capacete',
    'vest': 'colete',
    'safety-vest': 'colete',
    'colete': 'colete',
    'goggles': 'oculos',
    'glasses': 'oculos',
    'oculos': 'oculos',
    'óculos': 'oculos',
    'boots': 'botas',
    'shoes': 'botas',
    'botas': 'botas',
    'bota': 'botas',
    'earmuffs': 'auricular',
    'ear-protection': 'auricular',
    'auricular': 'auricular',
    'protetor-auricular': 'auricular',
    'mask': 'mascara',
    'mascara': 'mascara',
    'máscara': 'mascara',
    'gloves': 'luvas',
    'luvas': 'luvas',
    'luva': 'luvas',
}

#: classes conhecidas que NÃO são EPI — descartadas de propósito
IGNORADAS = {
    'person',
    'pessoa',
    'head',
    'cabeca',
    'cabeça',
    'face',
    'rosto',
    'no-helmet',
    'no-hardhat',
    'no-vest',
    'no-mask',
    'no-goggles',
    'sem-capacete',
    'sem-colete',
    'sem-mascara',
}
