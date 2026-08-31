# contrato/ — o catálogo de EPIs

`epis.json` é a **fonte de verdade única**. Servidor, tablet, painel
administrativo e Raspberry derivam dele; nenhum dos quatro decide sozinho
como um EPI se chama.

```
                          contrato/epis.json
                                  │
              ┌───────────┬───────┴───────┬────────────┐
           servidor    tablet          admin       raspberry
         tipos_epi  epiCatalog.ts    tema.ts      classes.py
```

---

## As três regras

**1. O código é identificador, não texto.**
Minúsculas, ASCII sem acento, sem espaço e sem hífen. `oculos`, nunca
`óculos`. É ele que trafega em MQTT, HTTP e banco.

**2. Nunca renomeie um código.**
Renomear quebra as quatro pontas ao mesmo tempo e ainda invalida o
histórico de verificações já gravado. Se o nome ficou ruim, mude o
**rótulo** — ele existe exatamente para isso. Código errado se aposenta,
não se renomeia.

**3. Rótulo e ícone nunca saem do dispositivo que desenha a tela.**
O servidor manda `capacete`; quem escreve "Capacete" e escolhe o desenho
do capacete é a tela. Assim dá para corrigir um texto sem mexer no
protocolo.

Os códigos de hoje misturam singular e plural — `capacete` mas `luvas`,
`botas`, `oculos`. Isso é **deliberado e está congelado**: eles seguem o
português natural (ninguém diz "um luva"), e regularizar agora custaria
migração nas quatro pontas em troca de nada.

---

## Os sete

| Código | Rótulo | Ícone | Classe no modelo |
|---|---|---|---|
| `capacete` | Capacete | `hard-hat` | `helmet` |
| `colete` | Colete | `tshirt-crew` | `vest` |
| `oculos` | Óculos | `safety-goggles` | `goggles` |
| `botas` | Botas | `shoe-formal` | `boots` |
| `auricular` | Protetor Auricular | `headphones` | `earmuffs` |
| `mascara` | Máscara | `face-mask` | `mask` |
| `luvas` | Luvas | `hand-back-right` | `gloves` |

Os ícones são nomes de **MaterialCommunityIcons**. O tablet os usa via
`@expo/vector-icons`; o painel web via `@mdi/js`. É a mesma família, então
o traço é idêntico nas duas telas.

`classe_modelo` é o nome que a IA emite. Ele **não precisa** ser igual ao
código: a Raspberry traduz. É por isso que o modelo pode continuar em
inglês sem obrigar ninguém a retreinar.

---

## Para o tablet

```bash
python3 contrato/gerar.py
cp contrato/gerado/epiCatalog.ts tablet/src/constants/epiCatalog.ts
```

O arquivo exporta `CodigoEpi` (union type), `CATALOGO_EPI`, `CODIGOS_EPI`
e `epiDoCatalogo(codigo)`.

**Use sempre `epiDoCatalogo`, nunca `CATALOGO_EPI[codigo]` direto.** Um
código novo cadastrado pelo painel chegaria como `undefined` e quebraria a
tela em runtime; a função devolve um item com ícone genérico e o próprio
código como rótulo — que é sinal visível de que os catálogos divergiram,
em vez de o item sumir em silêncio.

O que o tablet manda e recebe do servidor é **só o código**:

```jsonc
// resposta de GET /api/v1/pontos
{ "id": 1, "codigo": "portaria", "epis_exigidos": ["capacete", "oculos", "colete"] }
```

Nada de rótulo, nada de ícone, nada de acento. Se o app estiver enviando
`"Óculos"` ou `"oculos_protecao"` em algum lugar, é aí que quebra.

---

## Para conferir

```bash
python3 contrato/conferir.py
```

Lê as quatro pontas e sai com código 1 na primeira divergência — dá para
pendurar num passo de CI ou num `pre-commit`. Exemplo de saída quando
alguém edita um catálogo à mão:

```
  DIVERGE admin (tema.ts) — 7 códigos
          faltam: luvas · sobram: luva
```

O servidor é conferido pela API (`/api/v1/tipos-epi`), então ele precisa
estar no ar; sem servidor, a checagem é pulada e as outras três seguem.

Os arquivos são lidos como **texto**, não importados: o conferidor roda
sem instalar as dependências dos quatro projetos, e acusa um arquivo
editado à mão mesmo que ele continue compilando.

### Por que copiar em vez de importar

O natural seria cada projeto importar `contrato/epis.json` direto. Não dá,
por dois motivos concretos: o contexto de build do Docker é a pasta
`servidor/`, então nada acima dela entra na imagem; e a Raspberry recebe só
a pasta `raspberry/`, não o monorepo inteiro. Copiar arquivo gerado é a
troca honesta — o custo é lembrar de rodar o `gerar.py`, e é exatamente
esse esquecimento que o `conferir.py` pega.

---

## Para acrescentar um EPI

1. Acrescente o objeto em `epis.json` — código novo, nunca reaproveitado.
2. `python3 contrato/gerar.py`
3. Leve os quatro arquivos de `gerado/` para os seus lugares.
4. No servidor, insira a linha em `tipos_epi` (via painel, ou pelo
   `scripts/migrar_dados.py`).
5. Treine o modelo para a classe nova, ou o EPI nunca será relatado — e
   um ponto que o exija passa a reprovar todo mundo, porque ausência de
   informação conta como reprovação.
6. `python3 contrato/conferir.py`

O passo 5 é o que costuma ser esquecido. O `conferir.py` avisa quando um
código canônico não tem nenhum sinônimo de modelo apontando para ele.

---

## Por que tanto cuidado com isto

Os catálogos já divergiram uma vez neste projeto: o app tinha `luva` e
`bota`, o servidor tinha `luvas` e `botas`, e dois EPIs existiam de um
lado só.

O descasamento **não estoura**. O servidor descarta em silêncio um código
que não conhece, `_avaliar` conta ausência de informação como reprovação,
e a catraca fica fechada com alguém na frente e nenhum erro em lugar
nenhum — nem no log da Pi, nem no do servidor, nem na tela do tablet.

Um arquivo só, gerado e conferido, troca esse bug por uma mensagem de
build.
