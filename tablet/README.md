# Detecção de EPI — FETIN

Aplicativo mobile para verificação de **Equipamentos de Proteção Individual (EPIs)** por câmera ou
imagem da galeria. O usuário captura uma foto, o app analisa quais equipamentos estão presentes e
apresenta um resultado de **aprovado**, **atenção** ou **reprovado**, com nível de confiança e lista
de itens detectados e ausentes.

O aplicativo é a adaptação mobile nativa do protótipo
[tape-crab-67490107.figma.site](https://tape-crab-67490107.figma.site) — layout, cores, textos e
fluxo foram preservados e reorganizados para uma experiência de celular real (sem WebView).

> ⚠️ O sistema auxilia a inspeção de EPIs, mas **não substitui a avaliação de um profissional de
> segurança do trabalho**.

---

## Sumário

- [Tecnologias](#tecnologias)
- [Pré-requisitos](#pré-requisitos)
- [Instalação](#instalação)
- [Configuração do `.env`](#configuração-do-env)
- [Executando](#executando)
- [Estrutura de pastas](#estrutura-de-pastas)
- [Telas e fluxo](#telas-e-fluxo)
- [Serviço de detecção](#serviço-de-detecção)
- [Substituindo o mock por uma API real](#substituindo-o-mock-por-uma-api-real)
- [Armazenamento local](#armazenamento-local)
- [Área administrativa](#área-administrativa)
- [Qualidade: testes, lint e tipos](#qualidade-testes-lint-e-tipos)
- [Limitações atuais](#limitações-atuais)
- [Próximos passos sugeridos](#próximos-passos-sugeridos)

---

## Tecnologias

| Camada | Tecnologia |
| --- | --- |
| Framework | React Native 0.86 + Expo SDK 57 |
| Linguagem | TypeScript (modo estrito) |
| Navegação | Expo Router (file-based) |
| Câmera / Galeria | `expo-camera`, `expo-image-picker` |
| Estilo | `StyleSheet` + tema centralizado (`src/theme`) |
| Formulários | React Hook Form + Zod |
| Persistência | AsyncStorage (via repositórios) |
| Ícones | `@expo/vector-icons` (MaterialCommunityIcons) |
| Gráficos | `react-native-svg` + componentes próprios |
| Animação | `react-native-reanimated` |
| Testes | Jest (`jest-expo`) + Testing Library React Native |
| Qualidade | ESLint (`eslint-config-expo`) + Prettier |

---

## Pré-requisitos

- **Node.js 20 ou superior** (o projeto foi validado com Node 24)
- **npm 10+**
- Aplicativo **Expo Go** no celular, ou um emulador Android / simulador iOS configurado
- Para iOS nativo: macOS com Xcode

---

## Instalação

```bash
npm install
```

## Configuração do `.env`

Copie o arquivo de exemplo e ajuste conforme necessário:

```bash
cp .env.example .env
```

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `EXPO_PUBLIC_EPI_API_URL` | Não | URL base da API de detecção. **Se vazia, o app usa o serviço simulado.** |
| `EXPO_PUBLIC_EPI_API_TIMEOUT_MS` | Não | Timeout das requisições, em ms. Padrão: `20000`. |

O arquivo `.env` está no `.gitignore`; apenas o `.env.example` é versionado. **Nenhuma URL, chave ou
token é escrito diretamente no código.**

---

## Executando

```bash
npm install
npx expo start
```

O terminal exibe um QR Code e as opções de plataforma.

### Android

```bash
npm run android
```

Requer Android Studio com um emulador criado, ou um aparelho conectado via USB com depuração
ativada.

### iOS

```bash
npm run ios
```

Requer macOS com Xcode instalado. Em outros sistemas operacionais, use o Expo Go em um iPhone.

### Expo Go

1. Instale o **Expo Go** ([Android](https://play.google.com/store/apps/details?id=host.exp.exponent) /
   [iOS](https://apps.apple.com/app/expo-go/id982107779)).
2. Rode `npx expo start`.
3. Escaneie o QR Code — no Android pelo próprio Expo Go, no iOS pela câmera do sistema.
4. O celular e o computador precisam estar na mesma rede. Em redes restritas, use
   `npx expo start --tunnel`.

> A câmera **não funciona em emuladores sem câmera virtual** nem no navegador sem HTTPS. Nesses
> casos, o app detecta a indisponibilidade e oferece a seleção pela galeria.

---

## Estrutura de pastas

```text
src/
├── app/                              # Rotas (Expo Router)
│   ├── _layout.tsx                   # Stack raiz + provedores de contexto
│   ├── index.tsx                     # Tela inicial
│   ├── camera.tsx                    # Captura com permissões e enquadramento
│   ├── preview.tsx                   # Pré-visualização e disparo da análise
│   ├── result.tsx                    # Resultado (atual ou vindo do histórico)
│   ├── history.tsx                   # Histórico local de análises
│   └── admin/
│       ├── _layout.tsx
│       ├── index.tsx                 # Login administrativo
│       └── panel.tsx                 # Painel com as três seções
│
├── components/
│   ├── ui/                           # Button, Card, Badge, Text, TextField, Switch...
│   ├── layout/                       # Screen, ScreenHeader, StepIndicator, TerminalStatusBar
│   ├── camera/                       # ScanFrame, CaptureControls
│   └── feedback/                     # StateView, LoadingState, ErrorState, EmptyState
│
├── features/
│   ├── epi-detection/
│   │   ├── components/               # HomeHero, EpiGrid, EpiChecklistItem, ResultSummaryCard...
│   │   ├── hooks/                    # AnalysisContext, useDetectionHistory, useRequiredEpis
│   │   ├── services/                 # Mock, API, fábrica e repositórios
│   │   ├── mocks/                    # Cenários e caixas delimitadoras simuladas
│   │   ├── types/                    # Domínio, contrato da API e catálogo
│   │   └── utils/                    # Status, montagem do resultado e mapeamento da resposta
│   └── admin/
│       ├── components/               # Gráficos, cartões, formulário e seções do painel
│       ├── hooks/                    # AdminAuthContext, useUsers
│       ├── schemas/                  # Validações Zod
│       ├── services/                 # Autenticação simulada e repositório de usuários
│       ├── mocks/                    # Operadores de exemplo
│       ├── types/
│       └── utils/                    # Cálculo dos indicadores do dashboard
│
├── services/
│   ├── errors/                       # AppError e normalização/apresentação de erros
│   ├── http/                         # Cliente HTTP com timeout
│   ├── storage/                      # Único ponto de acesso ao AsyncStorage
│   └── env.ts                        # Leitura das variáveis de ambiente
│
├── hooks/                            # useAsyncResource, useImagePicker, useHaptics, useClock...
├── constants/                        # Catálogo de EPIs, textos e limiares
├── theme/                            # Cores, espaçamentos, tipografia, raios e sombras
└── utils/                            # Formatação, identificadores e utilitários
```

---

## Telas e fluxo

```text
Início ──► Câmera ──► Pré-visualização ──► Análise ──► Resultado ──► Início
   │           ▲              ▲                            │
   ├── Galeria ┘──────────────┘                            ├─► Nova análise
   ├── Histórico ─► Detalhe da análise                     └─► Continuar para a área
   └── Admin ─► Login ─► Dashboard / Usuários / EPIs Ativos
```

Estados previstos em todas as telas de análise: **inicial**, **carregando**, **sucesso**, **erro**,
**sem conexão**, **permissão negada**, **nenhuma imagem selecionada**, **resultado sem objetos
reconhecidos**, **resultado com baixa confiança** e **dispositivo sem câmera compatível**. Todos são
renderizados pelos componentes reutilizáveis de `src/components/feedback`.

---

## Serviço de detecção

A interface do domínio está em `src/features/epi-detection/types/detection.ts`:

```ts
export interface EpiDetectionService {
  analyzeImage(input: AnalyzeImageInput): Promise<EpiDetectionResult>;
}
```

> A assinatura foi estendida em relação ao esboço original (`analyzeImage(imageUri: string)`) para
> receber também os equipamentos exigidos e a origem da imagem. Sem isso, o serviço não conseguiria
> respeitar a configuração de "EPIs Ativos" nem registrar de onde veio a foto.

### Como o mock funciona

`MockEpiDetectionService` (`src/features/epi-detection/services/MockEpiDetectionService.ts`):

1. Valida a entrada (imagem presente e ao menos um equipamento exigido).
2. Aguarda um tempo aleatório entre 900 ms e 1800 ms, simulando o processamento.
3. Sorteia um **cenário** de `src/features/epi-detection/mocks/detectionScenarios.ts`, com pesos
   diferentes:

   | Cenário | Efeito | Status resultante |
   | --- | --- | --- |
   | `conformidade-total` | Todos detectados com confiança alta | `approved` |
   | `confianca-baixa` | Todos detectados, confiança reduzida | `warning` |
   | `falta-oculos` | Um item ausente | `warning` |
   | `falta-luvas-e-mascara` | Dois itens ausentes | `rejected` |
   | `sem-capacete-e-colete` | Dois itens ausentes | `rejected` |
   | `nada-reconhecido` | Nenhum item detectado | `rejected` |

4. Gera confianças a partir da confiança-base de cada EPI no catálogo, com uma pequena variação.
5. Passa tudo por `buildDetectionResult`, o **mesmo** caminho usado pela API real.

A aleatoriedade é injetável (`random`), assim como o cenário (`forcedScenario`) e os tempos — é o que
permite testar os três status de forma determinística.

**Nenhum componente de interface gera resultados por conta própria.** Todo resultado simulado nasce
no serviço.

### Regra de decisão do status

Implementada em `resolveDetectionStatus.ts` e coberta por testes:

- `rejected` — nada foi reconhecido, **ou** dois ou mais equipamentos ausentes, **ou** ausência em
  uma configuração com menos de três equipamentos exigidos;
- `warning` — tudo presente porém com confiança média abaixo de 70%, **ou** exatamente um
  equipamento ausente entre três ou mais exigidos;
- `approved` — nenhum ausente e confiança acima do limiar.

Um item só conta como detectado se a confiança for **≥ 60%** (`DETECTION_THRESHOLDS`). A regra é
intencionalmente conservadora: na dúvida, exige revisão humana.

---

## Substituindo o mock por uma API real

1. **Preencha a variável de ambiente:**

   ```env
   EXPO_PUBLIC_EPI_API_URL=https://sua-api.exemplo/v1
   ```

2. **Pronto.** `getEpiDetectionService()` passa a devolver `ApiEpiDetectionService` automaticamente.
   Nenhuma tela, hook ou componente precisa mudar.

O `ApiEpiDetectionService` envia `multipart/form-data` para `POST {BASE_URL}/analyze` com os campos
`image` (arquivo) e `requiredItems` (ids separados por vírgula), e espera:

```jsonc
{
  "id": "opcional",
  "analyzedAt": "2026-08-03T15:32:00.000Z", // opcional
  "processingTimeMs": 820,                   // opcional
  "items": [
    {
      "id": "capacete",       // um dos ids do catálogo
      "detected": true,
      "confidence": 0.97,     // aceita 0–1 ou 0–100
      "boundingBox": { "x": 0.38, "y": 0.06, "width": 0.24, "height": 0.12 } // opcional, normalizado
    }
  ]
}
```

Se o backend adotar outro contrato, **só dois arquivos mudam**:

- `services/ApiEpiDetectionService.ts` — endpoint, método e formato do envio;
- `utils/mapDetectionResponse.ts` — conversão da resposta para o domínio.

O mapeador já descarta itens desconhecidos, ignora caixas delimitadoras incompletas, normaliza a
confiança e lança `AppError('invalid_response')` para respostas fora do formato.

---

## Armazenamento local

Nenhuma tela chama o AsyncStorage diretamente. O acesso passa por `storageClient` e, acima dele, por
repositórios:

| Repositório | Responsabilidade |
| --- | --- |
| `detectionHistoryRepository` | Histórico das análises (máx. 50, mais recentes primeiro) |
| `epiSettingsRepository` | Equipamentos exigidos na verificação |
| `usersRepository` | Cadastro local de operadores |

Todos validam o conteúdo lido e descartam registros corrompidos.

---

## Área administrativa

Acessível pelo botão **Admin** na tela inicial. Credenciais de demonstração exibidas na própria tela:
`admin` / `admin` (autenticação simulada, apenas em memória — nada é persistido).

| Seção | O que faz |
| --- | --- |
| **Dashboard** | Verificações de hoje e da semana, taxa de conformidade, gráfico de barras conformes × não conformes, rosca de resultado geral e ranking de EPIs mais ausentes |
| **Usuários** | Busca, cadastro, edição e remoção de operadores, com validação por React Hook Form + Zod |
| **EPIs Ativos** | Liga/desliga cada equipamento exigido, com pré-visualização em tempo real |

Os indicadores do dashboard são calculados **a partir do histórico real do aparelho** — no protótipo
web eram números fixos.

---

## Qualidade: testes, lint e tipos

```bash
npm run lint        # ESLint, falha com qualquer aviso
npm run typecheck   # tsc --noEmit em modo estrito
npm test            # Jest
```

Outros scripts disponíveis:

```bash
npm run lint:fix      # corrige o que for automatizável
npm run format        # Prettier (escrita)
npm run format:check  # Prettier (verificação)
npm run test:watch    # Jest em modo observador
```

### Cobertura de testes

66 testes em 10 suítes, cobrindo:

- transformação da resposta da API (`mapDetectionResponse`);
- montagem do resultado e separação detectados × ausentes (`buildDetectionResult`);
- regra de status aprovado / atenção / reprovado (`resolveDetectionStatus`);
- serviço mock nos seis cenários e nos erros de entrada;
- repositórios de histórico e de configuração (limite, remoção, dados corrompidos);
- indicadores do dashboard;
- componentes de resultado (`ResultSummaryCard`, `EpiChecklistItem`), incluindo acessibilidade.

### Estado da verificação

Executados neste projeto, todos sem erros nem avisos: `npm run lint`, `npm run typecheck`,
`npm test`, `npx expo install --check` e `npx expo export --platform android` (bundle gerado com
sucesso).

---

## Limitações atuais

- **Não há detecção real.** Os resultados vêm do `MockEpiDetectionService`; nenhum modelo de visão
  computacional está embarcado ou conectado.
- **Não há backend.** Autenticação, usuários, histórico e configuração são locais ao aparelho.
- **Caixas delimitadoras não são desenhadas sobre a imagem.** O domínio e o mock já as produzem, mas
  a sobreposição visual foi deixada para quando houver coordenadas reais.
- **A fonte Inter do protótipo não é carregada**; usa-se a fonte de sistema, geometricamente
  próxima, para manter o app leve e sem download de fontes.
- **Sem detecção ativa de conectividade.** O estado "sem conexão" é derivado da falha da requisição,
  não de um monitor de rede.
- **Layout de duas colunas do protótipo foi empilhado verticalmente** — necessário em telas de
  375–430 px.
- **A verificação contínua em tempo real do protótipo virou captura + análise**, que é o padrão de
  UX em celulares e o que o briefing pede.
- **Gráficos são simplificados** em relação ao Recharts do protótipo (que é exclusivo para web).

## Próximos passos sugeridos

1. Publicar a API de inferência e preencher `EXPO_PUBLIC_EPI_API_URL`.
2. Desenhar as caixas delimitadoras sobre a imagem na tela de resultado.
3. Avaliar um modelo local (TensorFlow Lite / ONNX) para análise offline.
4. Autenticação real com backend, papéis e sessão persistida com segurança.
5. Sincronizar o histórico com um servidor e vinculá-lo ao operador identificado.
6. Exportar relatórios de inspeção em PDF ou CSV.
7. Detecção de conectividade com `expo-network` e fila de reenvio.
8. Testes de integração de fluxo (captura → análise → resultado) e testes E2E com Maestro.
9. Suporte a tema escuro completo e ajuste de tamanho de fonte do sistema.
10. Internacionalização, caso o sistema atenda unidades fora do Brasil.
