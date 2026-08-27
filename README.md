# EPI Fetin

Sistema de controle de acesso que verifica o uso de EPI antes de liberar a
catraca, com identificação por reconhecimento facial e detecção de EPI por
visão computacional na borda.

```
┌──────────┐   HTTPS/WS   ┌───────────────┐    SQL    ┌──────────────┐
│  tablet  │─────────────▶│   servidor    │──────────▶│  PostgreSQL  │
│  (totem) │              │   FastAPI     │           │  + pgvector  │
└──────────┘              └───────┬───────┘           └──────────────┘
                                  │ MQTT
┌──────────┐   HTTPS      ┌───────┴───────┐
│  admin   │─────────────▶│ broker MQTT   │
│  (web)   │              └───────┬───────┘
└──────────┘                      │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
            ┌───────────────┐          ┌────────────────┐
            │ Raspberry Pi  │          │ ESP32 + catraca│
            │ modelo de EPI │          │      relé      │
            └───────────────┘          └────────────────┘
```

## As pastas

| Pasta | O que é | Estado |
|---|---|---|
| [`servidor/`](servidor/) | API FastAPI, worker MQTT, banco e simuladores de dispositivo | Funcionando, 82 checagens |
| [`admin/`](admin/) | Painel web administrativo (React + Vite) | Funcionando |
| `tablet/` | App do totem (React Native + Expo) | Vive em outro repositório por enquanto |

O app do tablet está em
[Bunnyzzx/Detecao-de-EPI-Fetin](https://github.com/Bunnyzzx/Detecao-de-EPI-Fetin),
branch `mobile-rn`. Quando ele estabilizar, entra aqui preservando o
histórico:

```bash
git subtree add --prefix=tablet https://github.com/Bunnyzzx/Detecao-de-EPI-Fetin.git mobile-rn
```

## Subindo tudo

Precisa de Docker e Node.

```bash
cd servidor && make up      # ou .\setup.ps1 no Windows
cd ../admin && npm install && npm run dev
```

| Onde | Endereço |
|---|---|
| API e documentação interativa | http://localhost:8000/docs |
| Painel administrativo | http://localhost:5174 |
| Console do MinIO | http://localhost:9090 |

Login do seed: `admin@epiguard.com.br` / `admin123` — **troque antes de
qualquer uso real**.

Sem hardware ligado, suba os simuladores para o fluxo funcionar de ponta a
ponta:

```bash
cd servidor
python -m simuladores.raspberry     # um terminal
python -m simuladores.esp32         # outro
```

## Por que servidor e admin no mesmo repositório

Os tipos do painel são **gerados** a partir do `openapi.json` do servidor
(`npm run tipos`), não escritos à mão. Mudar um endpoint e atualizar o
painel são a mesma mudança, e precisam caber no mesmo commit — em
repositórios separados viram dois commits que ninguém garante que andam
juntos.

Se o build do painel quebrar depois de mexer na API, o contrato mudou. Essa
quebra é a funcionalidade, não o defeito.

## Três decisões que sustentam o desenho

**A decisão de liberar é do servidor.** A Raspberry relata o que viu; o
servidor aplica a política do ponto de acesso. Mudar quais EPIs uma portaria
exige é um `UPDATE` no banco — nenhum dispositivo é reprogramado.

**O tablet não diz quem é a pessoa.** Ele envia o vetor facial e recebe um
token de uso único; a identidade é resposta do servidor, nunca entrada. Um
tablet comprometido não abre verificação em nome de terceiros.

**A catraca é *fail-secure*.** Servidor fora do ar, broker fora do ar,
inferência estourando o prazo — em todos os casos ela permanece fechada.
Negar entrada indevidamente é transtorno; liberar indevidamente é acidente.

## LGPD

O sistema trata **dado biométrico**, que é dado pessoal sensível (art. 11).
Isso está no código, não só na documentação: consentimento é pré-requisito
do cadastro, a revogação **elimina os vetores** em vez de marcar uma flag, o
embedding consultado não é persistido, e toda tentativa de identificação
entra em log de auditoria. Detalhes em [`servidor/README.md`](servidor/README.md).
