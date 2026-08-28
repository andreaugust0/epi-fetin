# EPI Guard — servidor

API de controle de acesso com verificação de EPI por visão computacional na
borda e identificação por reconhecimento facial (FaceNet + pgvector).

FastAPI · SQLAlchemy 2.0 async · PostgreSQL + pgvector · MQTT (aiomqtt)

---

## Como subir

### Caminho curto (Docker)

Só precisa de Docker instalado.

```bash
make up
```

Isso cria o `.env` com um `JWT_SECRET` aleatório e sobe os serviços:
Mosquitto, PostgreSQL com pgvector, MinIO, a API e o worker. O schema e o
seed são criados automaticamente pelo serviço `init`, que roda antes da API.

| Onde | Endereço |
|---|---|
| Documentação interativa da API | http://localhost:8000/docs |
| Console do MinIO | http://localhost:9090 (`minioadmin` / `minioadmin`) |
| Broker MQTT | `localhost:1883` |

Comandos úteis:

```bash
make logs     # acompanha api e worker
make ver      # espia TODO o tráfego MQTT em tempo real
make teste    # roda os testes dentro do contêiner
make rasp     # simulador da Raspberry
make esp      # simulador do ESP32
make down     # derruba (mantém os dados)
make reset    # derruba e apaga os volumes
```

### No Windows

O `make` não existe no Windows por padrão. Use o script PowerShell, que faz
a mesma coisa (verifica o Docker, cria o `.env`, gera o segredo e sobe tudo):

```powershell
.\setup.ps1
```

Se o Windows recusar por política de execução:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\setup.ps1
```

**O Docker Desktop precisa estar aberto e rodando** — não basta estar
instalado. Se você vir este erro:

```
open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified
```

significa que o CLI do Docker está lá mas o motor não está no ar. Abra o
Docker Desktop pelo menu Iniciar e espere aparecer **"Engine running"** ao
lado do ícone da baleia. Confirme com:

```powershell
docker version
```

Se a seção **Server** aparecer com uma versão, está pronto. Se ela vier com
erro, o motor ainda não subiu.

Preferindo fazer na mão, sem o script:

```powershell
Copy-Item .env.example .env
# abra o .env num editor e troque JWT_SECRET por um valor aleatório
docker compose up -d --build
```

Um valor aleatório sem precisar de Python instalado:

```powershell
$b = New-Object byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
[Convert]::ToBase64String($b).Replace('+','-').Replace('/','_').TrimEnd('=')
```

> Não cole linhas começadas com `#` no `cmd.exe` ou no PowerShell — ali `#`
> não é comentário, e o terminal responde
> `'#' is not recognized as an internal or external command`. As linhas com
> `#` nos blocos deste README são notas para você ler, não comandos.

O app se recusa a subir se o `JWT_SECRET` ainda estiver com o valor de
exemplo — melhor falhar na largada do que rodar com um segredo que está
publicado no repositório.

### Caminho manual

Se preferir rodar o Python na sua máquina, você precisa de **PostgreSQL com
a extensão `vector`** e de um **broker MQTT** já no ar.

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(48))"   # cole em JWT_SECRET

python -m scripts.init_db          # cria a extensão vector, o schema e o seed
```

Dois processos, de propósito:

```bash
uvicorn app.main:app --reload            # API + WebSocket
python -m app.mqtt.worker                # consumidor MQTT
```

### A primeira coisa a fazer depois de subir

Abra dois terminais. Em um:

```bash
make ver     # ou: mosquitto_sub -h localhost -t 'epi/#' -v
```

No outro, rode `make teste`. Você vai ver comando e evento passando pelo
barramento, em ordem, com o payload. É a ferramenta de depuração mais útil
do projeto — e o momento em que a arquitetura deixa de ser diagrama e vira
sistema.

### Por que dois processos

Se o cliente MQTT abrisse no `lifespan` do FastAPI, subir
`uvicorn --workers 4` faria cada processo abrir a própria conexão. Todos
receberiam a mesma mensagem: a verificação seria gravada quatro vezes e a
catraca liberada quatro vezes. É um bug que não aparece em desenvolvimento e
aparece em produção.

A alternativa, se quiser um processo só, são as *shared subscriptions* do
MQTT 5 — `$share/backend/epi/v1/+/+/evt/#` —, onde o próprio broker entrega
cada mensagem a apenas um assinante do grupo.

---

## Simuladores de dispositivo

Dois scripts fazem o papel da Raspberry e do ESP32, para desenvolver e
testar **sem hardware ligado**:

```bash
python -m simuladores.raspberry     # em um terminal
python -m simuladores.esp32         # em outro
```

Sem eles o servidor recusa verificações com `503 câmera do ponto está
offline`, e quem estiver integrando o app vai achar que quebrou o próprio
código. Detalhes, flags e controle por teclado em
[`simuladores/README.md`](simuladores/README.md).

## Testes

Todos rodam contra Postgres e Mosquitto de verdade, não contra mocks.

```bash
python -m scripts.testar_api_admin     # 25 checagens da API do painel
python -m scripts.testar_biometria     # 11 checagens do serviço de biometria
python -m scripts.testar_fluxo         # 19 checagens do fluxo ponta a ponta
python -m scripts.testar_simuladores   # 13 checagens com os simuladores reais
python -m scripts.testar_compat_app    # 13 checagens dos embeddings do app
```

`testar_fluxo` simula a borda em memória e exercita o caminho completo:
identificação facial → `cmd/capturar` → `evt/resultado` → decisão →
`cmd/liberar` → `evt/passagem`, mais reprovação, deduplicação de QoS 1,
expiração e recusa por câmera offline. `testar_simuladores` faz o mesmo com
os simuladores rodando como processos separados, do jeito que você vai
usá-los no dia a dia.

---

## Fluxo

```
Tablet                      Servidor                Raspberry        ESP32
  |                            |                        |              |
  |-- POST /identificacao ---->|                        |              |
  |   (embedding FaceNet)      |-- pgvector (cosseno)   |              |
  |<-- identificacao_id -------|                        |              |
  |                            |                        |              |
  |-- POST /verificacoes ----->|                        |              |
  |<-- 202 + verificacao_id ---|-- cmd/capturar ------->|              |
  |                            |                        | infere       |
  |                            |<-- POST /evidencias ---|              |
  |                            |<-- evt/resultado ------|              |
  |                            |  decide conformidade   |              |
  |<== WebSocket (resultado) ==|-- cmd/liberar -------------------->|  |
  |                            |<-- evt/passagem -------------------|  |
```

Três regras que sustentam o desenho:

1. **A decisão de liberar é do servidor.** A Raspberry relata o que viu; o
   servidor aplica a política do ponto. Mudar a exigência de um ponto é um
   `UPDATE`, não uma reprogramação de campo.
2. **O tablet não diz quem é a pessoa.** Ele apresenta o token devolvido por
   `/identificacao`; o servidor resolve a pessoa a partir dele. Um tablet
   comprometido não abre verificação em nome de terceiros.
3. **A catraca é *fail-secure*.** Servidor fora do ar, broker fora do ar,
   inferência estourando o prazo — em todos os casos a catraca permanece
   fechada. Negar entrada indevidamente é transtorno; liberar indevidamente é
   acidente.

---

## Reconhecimento facial

O tablet roda o FaceNet localmente e envia **apenas o vetor**. A imagem do
rosto nunca chega ao servidor, e o embedding consultado **não é persistido**:
só o resultado da comparação entra no log de auditoria.

O matching é uma busca por distância de cosseno no pgvector (índice HNSW),
com duas regras de aceitação:

| Regra | Configuração | Para quê |
|---|---|---|
| Limiar absoluto | `FACE_DISTANCIA_MAX` | a distância precisa ser pequena o bastante |
| Teste de razão | `FACE_RAZAO_MIN` | o melhor candidato precisa ser nitidamente melhor que o segundo |

O teste de razão é o que costuma faltar. Sem ele, duas pessoas parecidas
— irmãos, e principalmente gêmeos — são identificadas com confiança indevida
sempre que ambas estão na base. Com ele, o resultado vira `AMBIGUO` e o
sistema pede outra tentativa em vez de chutar.

**`FACE_DISTANCIA_MAX = 0.40` é ponto de partida, não verdade científica.**
Calibre com a sua base: colete tentativas reais, monte a curva ROC e escolha
o ponto de operação. `GET /api/v1/relatorios/biometria` existe para alimentar
essa análise — e o resultado dela rende um capítulo de resultados no TCC.

### Trocar o modelo invalida a base

Embeddings de modelos diferentes não são comparáveis. A coluna
`biometrias.modelo` e a checagem em `validar_embedding` existem para que a
troca falhe alto, em vez de degradar em silêncio. Ao trocar de modelo, todo
mundo precisa ser recadastrado.

### Vivacidade (anti-spoofing) — limitação conhecida

**Não implementado.** Uma foto impressa ou a tela de um celular podem
enganar o FaceNet, porque ele compara aparência, não presença. Mitigações,
em ordem de esforço:

- **Desafio ativo** — pedir uma ação (piscar, virar o rosto). Barra foto e
  tela, custa ~2 s no fluxo.
- **Passivo** — classificador leve de textura/moiré. Não atrapalha o fluxo,
  exige mais um modelo.
- **Compensação operacional** — a catraca fica em área com portaria
  presencial, e o log de identificação permite auditar tentativas suspeitas.

Documentar isto explicitamente é melhor do que deixar o furo implícito: a
banca vai perguntar, e "conheço a limitação, aqui está a mitigação" é uma
resposta melhor do que uma implementação de vivacidade feita às pressas.

---

## LGPD

Biometria é **dado pessoal sensível** (art. 11), não apenas dado pessoal.
Isso muda o código, não só a documentação:

| Exigência | Onde está no código |
|---|---|
| Consentimento específico e destacado | `ConsentimentoBiometrico`; sem registro vigente, o cadastro é recusado com `412` |
| Revogação com eliminação do dado (art. 18) | `revogar_consentimento` **apaga os vetores**, não marca uma flag |
| Minimização | guardamos embedding, não foto; a consulta não é persistida |
| Retenção definida | `evidencias.expira_em` + `storage.expurgar_vencidas` |
| Prestação de contas | `identificacoes` registra toda tentativa; `log_auditoria` registra todo override |
| Finalidade declarada | campo `finalidade` no consentimento |

Duas coisas que o código **não** resolve e você precisa providenciar: o termo
de consentimento em si (com versão, para casar com `versao_termo`) e o aviso
visível no ponto de acesso informando a captura, a finalidade e o prazo de
guarda.

---

## Estrutura

```
app/
├── main.py                  FastAPI: HTTP + WebSocket. Publica no MQTT, não consome.
├── core/
│   ├── config.py            pydantic-settings
│   ├── security.py          JWT (audiences separadas) + bcrypt
│   └── logging.py
├── db/
│   ├── models.py            SQLAlchemy 2.0; Vector(512) em biometrias
│   └── session.py           engine async + session_scope para o worker
├── mqtt/
│   ├── topics.py            monta e faz parse de tópicos — um lugar só
│   ├── schemas.py           contratos de payload
│   ├── publisher.py         conexão de publicação da API
│   └── worker.py            PROCESSO SEPARADO: consome evt/* e dev/*
├── services/
│   ├── biometria.py         busca vetorial, limiar, teste de razão, consentimento
│   ├── verificacao.py       regra de conformidade — o cérebro
│   ├── presenca.py          status de dispositivos via LWT
│   ├── dedup.py             descarte de duplicata de QoS 1
│   └── storage.py           evidências em S3/MinIO + expurgo por retenção
├── api/v1/                  routers REST + WebSocket
├── realtime/hub.py          push para o tablet
└── schemas/api.py           DTOs
```

---

## Endpoints

| Rota | Quem usa | Nota |
|---|---|---|
| `POST /api/v1/auth/login` | Admin | |
| `POST /api/v1/auth/tablets/{id}/token` | Admin | token de dispositivo, carrega `ponto_id` |
| `POST /api/v1/identificacao` | Tablet | recebe embedding, devolve token de curta duração |
| `POST /api/v1/pessoas/{id}/consentimento` | Admin | pré-requisito do cadastro biométrico |
| `DELETE /api/v1/pessoas/{id}/consentimento` | Admin | revoga **e elimina** os vetores |
| `POST /api/v1/pessoas/{id}/biometrias` | Admin | enrollment; cadastre 3 a 5 capturas |
| `POST /api/v1/verificacoes` | Tablet | responde **202**, não 200 |
| `GET /api/v1/verificacoes/{id}` | Tablet, admin | |
| `GET /api/v1/verificacoes` | Admin | filtros + paginação |
| `POST /api/v1/evidencias` | Raspberry | multipart; imagem **não** vai por MQTT |
| `GET /api/v1/dispositivos` | Admin | presença ao vivo, sem polling |
| `POST /api/v1/pontos/{id}/liberacao-manual` | Supervisor | sempre auditado |
| `GET /api/v1/relatorios/*` | Admin | conformidade, EPIs faltantes, biometria |
| `WS /ws/pontos/{id}` | Tablet | resultado em tempo real |

### Por que `202` e não `200`

A verificação ainda não terminou quando o endpoint responde: ela depende de
uma resposta assíncrona vinda da borda. O tablet recebe o id e aguarda o
desfecho no WebSocket. Fazer o endpoint bloquear até a Raspberry responder
acoplaria um request HTTP à latência da inferência e derrubaria tudo quando a
Pi travasse.

---

## Banco que já existe

`init_db.py` só semeia banco vazio. Para aplicar mudanças de schema e de
catálogo a um banco com dados:

```bash
python -m scripts.migrar_dados
```

É idempotente. Hoje ele torna `pessoas.matricula` anulável e alinha o
catálogo aos sete EPIs do app do totem (`luva`→`luvas`, `bota`→`botas`,
mais `mascara` e `auricular`).

---

## O que falta

Estes itens ficaram fora deste pacote e são os próximos passos naturais:

- **Alembic** — `scripts/init_db.py` cria o schema para você começar hoje,
  mas migrations de verdade são necessárias assim que o schema mudar.
- **TLS e ACL no broker** — o `mosquitto.conf` sobe anônimo e sem TLS, que é
  o certo para desenvolver. As duas seções comentadas no fim do arquivo, mais
  o `acl.exemplo`, mostram como travar. Sem o ACL, um ESP32 comprometido
  consegue publicar resultado de EPI falso.
- **Cliente do tablet** — captura, FaceNet, chamada ao `/identificacao`.
- **Hub via Redis** — o `hub.py` atual é em memória e só alcança tablets
  conectados ao mesmo processo da API. Com mais de um worker web, troque o
  corpo de `publicar` por um pub/sub compartilhado.
- **Rotina diária de expurgo** — `storage.expurgar_vencidas` existe mas não
  tem agendador chamando.
