# EPI Fetin

Sistema de controle de acesso que verifica o uso de EPI antes de liberar a
catraca, com identificação por reconhecimento facial e detecção de EPI por
visão computacional na borda.

**As quatro pontas já rodaram juntas com hardware real** — tablet, servidor,
Raspberry Pi com Hailo-8 e ESP32 acionando uma trava solenoide de 12 V. O que
está descrito abaixo foi exercitado, não projetado.

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
| [`servidor/`](servidor/) | API FastAPI, worker MQTT, banco e simuladores de dispositivo | Funcionando |
| [`admin/`](admin/) | Painel web administrativo (React + Vite), com a área de Relatórios e Analytics | Funcionando |
| [`tablet/`](tablet/) | App do totem (React Native + Expo) | Funcionando, 335 testes |
| [`raspberry/`](raspberry/) | Agente de borda: infere EPI sob demanda no Hailo-8, e serve a prévia da câmera para enquadramento | Funcionando |
| [`esp32/`](esp32/) | Firmware da catraca: aciona o relé e reporta a passagem | Funcionando |
| [`contrato/`](contrato/) | O catálogo de EPIs canônico e o conferidor das quatro pontas | — |

O [`servidor/simuladores/esp32.py`](servidor/simuladores/) continua no
repositório e continua útil: ele exercita o servidor inteiro sem hardware na
mesa, e a flag `--sem-protecao` desliga a idempotência e a checagem de prazo
para mostrar o que acontece sem elas.

Uma coisa a dizer antes de perguntarem, ao demonstrar: **o firmware não sabe
se a pessoa passou.** Sem sensor de giro, ele afirma apenas que a janela abriu
e fechou — reporta `LIBERADO` e `TIMEOUT_SEM_PASSAGEM`, nunca `PASSOU`.
Liberar não é o mesmo que passar, e o painel distingue os dois.

Dois arquivos grandes não estão versionados, de propósito, e precisam ser
levados à mão para uma instalação nova:

| O quê | Onde mora | Por quê |
|---|---|---|
| `.hef` do modelo de EPI | `~/epi-testes` na Raspberry | compilado para o Hailo, específico do aparelho |
| `.env` de cada ponta | ao lado do `.env.example` | segredos e endereços de rede |

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

Depois de um `git pull` que mexa em `servidor/requirements.txt` ou nos
modelos, dois passos não são opcionais:

```bash
docker compose up -d --build            # dependência nova não entra sem rebuild
docker compose exec api python -m scripts.migrar_dados
```

Pular o primeiro dá `ModuleNotFoundError` na subida; pular o segundo deixa
índices faltando, e o sintoma é relatório lento, não erro.

Sem hardware ligado, suba os simuladores para o fluxo funcionar de ponta a
ponta:

```bash
cd servidor
python -m simuladores.raspberry     # um terminal
python -m simuladores.esp32         # outro
```

Para não perder os cadastros ao trocar de máquina — o volume do Postgres é
local e não acompanha o repositório —, `servidor/backup.ps1` faz o dump, o
restaura num banco descartável para provar que ele presta, e guarda os dez
mais recentes. `-Restaurar` traz de volta.

## Rodando em rede real

Em `localhost` tudo funciona. O que custa tempo é a primeira vez com os
aparelhos em rede, e a causa é sempre a mesma: **o endereço do servidor mora
em três lugares, e os três precisam concordar.**

| Onde | O quê | Como muda |
|---|---|---|
| Tablet | URL base da API | toque longo no título → provisionamento |
| Raspberry | `MQTT_HOST` no `.env` | editar e `systemctl restart epi-borda` |
| ESP32 | `MQTT_HOST` no `config.h` | editar e **regravar a placa** |

O ESP32 é o traiçoeiro: o endereço está compilado no binário, então trocar de
rede exige `pio run -t upload` de novo. Se tudo voltar a funcionar menos a
catraca, é isso.

Duas armadilhas que se parecem com defeito e não são:

**O tablet volta a dar 401 depois de trocar de servidor.** O token carrega o
ponto de acesso e é assinado por aquela instalação; outro banco, outro
segredo. Emita um novo em *Dispositivos → Emitir token*.

**A Raspberry aparece offline com a câmera funcionando.** Captura e MQTT são
independentes: o laço de visão roda a ~13 fps mesmo sem broker. O sintoma real
está no log, como `publish ... falhou: rc=4` a cada 60 s — `rc=4` é
*sem conexão*.

```bash
journalctl -u epi-borda -f          # os rc=4 sumindo = broker alcançado
```

Se preferir não repetir isso a cada rede, reserve um IP fixo para o servidor
no DHCP do roteador.

## Onde a câmera fica, e por que isso é medida e não gosto

O modelo não recebe o frame de 1280×720: recebe 640×640, e o letterbox reduz
tudo para **640×360 com escala 0,5**. Cada pixel na tela vale meio pixel para
o detector, e 20 px é o piso prático de um YOLO — abaixo disso a caixa pisca.
Capacete e colete sobram em qualquer distância razoável; quem decide onde fica
a marcação do chão são **luva e óculos**.

Como a Pi não tem tela, a prévia é servida pelo próprio serviço, com as guias
desenhadas por cima e sem abrir a câmera uma segunda vez:

```
ExecStart=... -m detectores.hailo modelo.hef --camera 0 --previa 8080
```

Abra `http://IP-DA-PI:8080/previa`. Quando uma verificação de verdade
acontece, as caixas dela aparecem por alguns segundos com o lado menor já
convertido para pixels do modelo. **Tire a opção depois de posicionar a
câmera**: é uma câmera apontada para pessoas, servida sem senha na rede.

## O catálogo de EPIs é um contrato

Os sete códigos de EPI aparecem em quatro lugares — banco, painel, app e
agente de borda — e um deles escrito diferente quebra a cadeia em silêncio:
a Raspberry relata `capacete`, o servidor procura `capacetes`, e a
verificação reprova alguém que estava com o equipamento.

`contrato/epis.json` é o canônico, e `contrato/conferir.py` compara as
quatro pontas contra ele lendo os arquivos como texto — sem instalar
dependência de nenhum dos projetos, e acusando um arquivo editado à mão
mesmo que ele continue compilando.

```bash
python3 contrato/conferir.py                       # o que estiver no disco
python3 contrato/conferir.py --servidor http://IP:8000
```

Sai com código 1 na primeira divergência, para virar passo de CI ou gancho
de pre-commit.

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

## O orçamento de tempo

Os prazos não são folclore: cada um está no código e sustenta uma decisão de
projeto.

| Quanto | Onde | O que ele protege |
|---|---|---|
| 5 frames, espaçados 0,2 s | `VERIFICACAO_FRAMES`, `intervalo_min_s` | ~1 s de história para votar — não cinco fotos do mesmo instante |
| 3 de 5 confirmações | `min_confirmacoes` | derruba falso negativo de movimento e reflexo sem deixar passar quem tirou o capacete |
| 10 s de prazo, resposta em 8 s | `margem_prazo_s` | sobra tempo para rede e gravação; resultado que chega tarde é descartado |
| 180 s de identificação | `IDENTIFICACAO_TTL_S` | cabe vestir o equipamento; vencido, o rosto é pedido de novo |
| 10 s de validade do comando | `LIBERACAO_TTL_S` | um ESP32 que reconectou não abre a catraca para ninguém, minutos depois |
| 0,40 de distância máxima | `FACE_DISTANCIA_MAX` | limiar do reconhecimento facial, com desempate por `razao_2o_lugar` |

O tablet obedece ao servidor nesses prazos em vez de ter os seus. Se três
minutos não bastarem para vestir tudo, mexe-se em `IDENTIFICACAO_TTL_S` e o
aplicativo acompanha — sem build novo.

## Como demonstrar

Ordem pensada para a banca. Os quatro primeiros passos são o sistema; os três
últimos são o que separa um controle de acesso de um botão de abrir porta.

**1. O parque.** Painel → *Dispositivos*: tablet, Raspberry e ESP32 online,
com firmware e versão de modelo. O status vem do MQTT retido, não de um
`ping` — por isso ele é honesto quando algo cai.

**2. O caminho feliz.** Identificação facial no tablet, caminhada até a
marcação, verificação, aprovação, clique do relé, trava recolhendo.

**3. O registro.** Painel → *Verificações*: a passagem recém-feita, com os
EPIs detectados e a confiança de cada um.

**4. A recusa.** Tire o capacete e repita. A tela diz o que faltou e a
catraca **não** abre. É o caminho que importa demonstrar.

**4b. O que o histórico responde.** Painel → *Relatórios*: tendência,
conformidade por ponto, EPIs mais ausentes, distribuição por horário e por
setor, reincidência. É onde o sistema deixa de ser uma catraca e vira
informação de segurança do trabalho — a pergunta "qual turno mais esquece o
protetor auricular" passa a ter resposta. A exportação em CSV converte para
`TZ_EXIBICAO` antes de escrever, porque hora em UTC aponta o turno errado.

**5. As duas travas do firmware**, na bancada:

```bash
python testar_catraca.py --host IP --repetir   # mesma mensagem 2x: abre UMA vez
python testar_catraca.py --host IP --vencido   # comando expirado: não abre
```

MQTT QoS 1 é *at-least-once*: a mesma mensagem chega duas vezes sempre que um
ACK se perde, e sem descartar repetição a catraca abriria duas vezes — a
segunda para quem estivesse por perto. Para mostrar o que acontece **sem**
elas, o simulador aceita `--sem-protecao`.

**6. Fail-secure, ao vivo.** Derrube o servidor no meio de uma verificação. A
catraca permanece fechada, e o painel passa a mostrar a câmera offline pelo
testamento (LWT) do MQTT, que sai mesmo em queda abrupta.

Isso já aconteceu sem ensaio: um erro de digitação no `ExecStart` deixou o
serviço da Raspberry em ciclo de reinício por treze minutos, e a catraca ficou
fechada o tempo todo. O `journalctl` datado é a melhor evidência que o projeto
tem de que o comportamento seguro é real.

**7. O que o sistema não afirma.** Sem sensor de giro, ele reporta `LIBERADO`
e `TIMEOUT_SEM_PASSAGEM`, nunca `PASSOU`. Liberar não é passar, e o painel
distingue os dois. Dizer isso antes de perguntarem vale mais do que responder
depois.

## LGPD

O sistema trata **dado biométrico**, que é dado pessoal sensível (art. 11).
Isso está no código, não só na documentação: consentimento é pré-requisito
do cadastro, a revogação **elimina os vetores** em vez de marcar uma flag, o
embedding consultado não é persistido, e toda tentativa de identificação
entra em log de auditoria. Detalhes em [`servidor/README.md`](servidor/README.md).
