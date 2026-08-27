# EPI Guard — painel administrativo

Aplicação web que consome a API do servidor EPI Guard. Substitui o admin da
branch `main` do app do totem, que guardava tudo no `localStorage`.

React 19 · TypeScript · Vite · sem biblioteca de UI, sem biblioteca de gráfico

---

## Como rodar

O **servidor precisa estar no ar** (`make up` no projeto `epi-server`).

```bash
npm install
cp .env.example .env      # só se o servidor não estiver em localhost:8000
npm run dev
```

Abre em `http://localhost:5174`. Login do seed:
`admin@epiguard.com.br` / `admin123`.

O Vite faz proxy de `/api` para o servidor, então não há CORS para
configurar nem URL absoluta espalhada pelo código. Para apontar para outra
máquina, mude `VITE_API_ALVO` no `.env`.

| Comando | O que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento com proxy |
| `npm run build` | build de produção em `dist/` |
| `npm run tipos` | **regenera os tipos a partir do OpenAPI do servidor** |
| `node verificar.mjs` | percorre o painel num navegador real (20 checagens) |

---

## Os tipos vêm do servidor, não são escritos à mão

`src/api/servidor.d.ts` é **gerado** a partir de
`http://localhost:8000/openapi.json`. Nada do contrato é escrito duas vezes.

Isso resolve, para este projeto, a classe de bug que já mordeu vocês uma vez:
o descasamento silencioso entre os códigos de EPI do app e os do servidor.
Aqui, se um campo mudar no servidor, o `tsc` acusa — em vez de o painel
exibir `undefined` sem avisar.

Depois de qualquer mudança na API:

```bash
npm run tipos && npm run build
```

Se o build quebrar, o contrato mudou e o painel precisa acompanhar. Essa
quebra é a funcionalidade, não o defeito.

---

## Telas

| Tela | O que faz |
|---|---|
| **Painel** | Conformidade do período, ranking de EPIs mais esquecidos, presença dos dispositivos ao vivo |
| **Verificações** | Histórico com filtro por situação e ponto, paginado, com as detecções de cada verificação |
| **Pessoas** | Cadastro, busca, e o controle de consentimento biométrico |
| **Pontos de acesso** | Quais EPIs cada ponto exige |

### O que o painel deliberadamente NÃO faz

**Cadastrar rosto.** O embedding é calculado no tablet, que tem a câmera e o
modelo. Esta tela controla quem existe e quem consentiu — e o consentimento
é pré-requisito: o servidor recusa cadastrar biometria sem ele.

**Decidir aprovação.** Quem decide é o servidor. O painel só mostra.

---

## Decisões de interface

**Estado codificado em forma, não só em cor.** Cada pastilha tem um ponto
além da cor e do texto. Quem não distingue as cores continua lendo o estado,
e a tela sobrevive a uma impressão em preto e branco.

**Um gráfico só.** O ranking de EPIs faltantes é a única coisa nesta tela em
que a comparação visual entrega mais que o número. Conformidade, contagens e
presença são métricas e pastilhas, porque é assim que se lê mais rápido.
Gráfico onde bastava um número é ruído.

**O gráfico tem visão de tabela.** Botão "Ver como tabela" ao lado. Série
única, sem legenda — o título nomeia a série e a categoria está escrita no
eixo, então a cor não carrega informação nenhuma.

**Nada é truncado em silêncio.** O ranking mostra os oito primeiros e agrupa
o resto numa linha "outros (N)", em vez de cortar e parecer completo.

**A confirmação de revogação diz o que vai acontecer.** Não é "tem certeza?":
ela informa quantos vetores serão apagados e que a LGPD exige a eliminação —
não há como desfazer.

**Tema claro e escuro.** Ambos escolhidos, não invertidos automaticamente.
Acompanha a preferência do sistema.

---

## Verificação

```bash
node verificar.mjs
```

Sobe um navegador de verdade, faz login (inclusive testando senha errada),
percorre as quatro telas, cria uma pessoa, registra consentimento, altera a
política de EPIs de um ponto e confere que o tema escuro repinta. Falha se
qualquer erro de JavaScript ou resposta 5xx aparecer.

Capturas ficam em `/tmp/capturas`.

Precisa do servidor no ar e de um Chromium. Se o Playwright reclamar da
versão do navegador, aponte o executável:

```bash
CHROME_BIN=/caminho/para/chrome node verificar.mjs
```

---

## Estrutura

```
src/
├── api/
│   ├── servidor.d.ts     GERADO — não edite à mão
│   └── cliente.ts        fetch + JWT + tradução de erro do FastAPI
├── auth/                 sessão; o 401 derruba o login de qualquer lugar
├── componentes/
│   ├── basicos.tsx       pastilha, métrica, aviso, campo
│   └── BarrasRanking.tsx gráfico em SVG, sem dependência externa
├── paginas/              Login, Painel, Verificações, Pessoas, Pontos
└── styles.css            tokens de cor e tema, claro e escuro
```

O gráfico é SVG escrito à mão de propósito: um ranking horizontal não
justifica os ~500 KB de uma biblioteca, e escrevendo à mão dá para controlar
o arredondamento só na ponta de dados, o espaçamento entre barras e a área
de acionamento do hover.
