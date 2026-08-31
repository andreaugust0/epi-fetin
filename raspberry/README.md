# EPI Fetin — cliente de borda (Raspberry Pi)

Faz a Raspberry conversar com o servidor. Assina `cmd/capturar`, consulta
os frames que o seu laço de visão já vem produzindo, e publica
`evt/resultado` dentro do prazo.

**Não substitui o seu código de detecção.** O acoplamento é de dois
membros: uma lista de nomes de classe e um método `detectar(frame)`.

Dependência obrigatória: `paho-mqtt`. Só isso.

---

## O descompasso que este pacote resolve

O seu laço é **contínuo**: lê frame, infere, desenha, repete. O servidor é
**sob demanda**: uma pessoa encosta o rosto no tablet, ele identifica, o
servidor manda `cmd/capturar` e espera um resultado em 10 segundos.

A ligação ingênua — ao receber o comando, tirar cinco fotos e inferir —
não fecha a conta. Entre acordar o sensor, esperar o auto-exposure e rodar
cinco inferências numa CPU ARM, o orçamento evapora. E as cinco fotos
sairiam do mesmo instante, então "confirmado em 3 de 5 frames" não valeria
nada.

A ligação certa é um **anel dos últimos frames já inferidos**. O laço
segue como está e empurra cada resultado para o anel; responder um comando
vira leitura de memória, com um histórico real de instantes diferentes
para votar em cima.

```
     seu laço (contínuo)                     servidor (sob demanda)
  ┌────────────────────────┐                ┌──────────────────────┐
  │ frame → detectar → 📦  │                │  cmd/capturar        │
  │            ↓            │                └──────────┬───────────┘
  │      registrar_frame ───┼──→ [anel de 15] ←─────────┘
  │            ↓            │         │
  │        desenhar         │         └──→ votar → evt/resultado
  └────────────────────────┘
```

---

## Integrando no que você já tem

Três linhas. Uma no topo, uma antes do laço, uma dentro dele.

```python
from epi_borda import Agente, Deteccao, carregar

class MeuDetector:
    """Envelope em volta do que você já escreveu."""
    nomes_classes = ["helmet", "vest", "goggles", "boots",
                     "earmuffs", "mask", "gloves", "person"]

    def detectar(self, frame):
        saida = []
        for cx, cy, w, h, conf, cls in a_sua_inferencia(frame):
            saida.append(Deteccao(
                classe=self.nomes_classes[int(cls)],
                confianca=float(conf),
                bbox=(int(cx - w / 2), int(cy - h / 2), int(w), int(h)),
            ))
        return saida

detector = MeuDetector()
agente = Agente(carregar(), detector=detector)
agente.iniciar()

while True:
    frame = camera.read()
    deteccoes = detector.detectar(frame)
    desenhar(frame, deteccoes)          # continua igual
    agente.registrar_frame(deteccoes)   # a linha nova
```

`bbox` é **x, y, largura, altura** em pixels do frame original, canto
superior esquerdo — não o `cxcywh` normalizado que sai da rede. Pode ser
`None` se não quiser mandar caixa.

Se preferir um serviço pronto que abre a câmera e carrega o ONNX sozinho,
existe: `python -m epi_borda`. Mas se o seu laço já funciona, o caminho
acima é menos código e menos coisa para quebrar.

---

## Os nomes das classes precisam ser casados

Este é o ponto mais frágil da integração, e ele **não estoura sozinho**: o
servidor ignora um EPI que não reconhece, conta ausência de informação
como reprovação, e a catraca fica fechada sem erro em lugar nenhum.

Por isso `epi_borda/classes.py` é uma tabela explícita, e classe fora dela
levanta exceção **na subida**, não em campo.

```bash
python -m epi_borda.classes --do-modelo modelos/epi.onnx   # o que o modelo emite
python -m epi_borda.classes --conferir                     # bate com o servidor
```

Os sete códigos do servidor hoje: `capacete`, `colete`, `oculos`,
`botas`, `auricular`, `mascara`, `luvas`.

Classes que não são EPI (`person`, `head`, `no-helmet`) vão em `IGNORADAS`
— também explicitamente, para "descartada" ser uma decisão e não um
esquecimento.

---

## Instalação na Raspberry

```bash
sudo apt install -y python3-pip
pip install paho-mqtt --break-system-packages

cp .env.example .env
nano .env          # DEVICE_ID e MQTT_HOST são os que importam
```

`DEVICE_ID` **precisa bater** com o `client_id_mqtt` cadastrado no
servidor (`rasp-planta01-portaria` no seed). Se não bater, o worker loga
`status de dispositivo não cadastrado`, a câmera nunca aparece online, e
toda verificação é recusada com 503 antes de abrir. É o erro nº 1 desta
etapa.

Para conferir do lado do servidor:

```bash
curl -s localhost:8000/api/v1/dispositivos -H "Authorization: Bearer $TOKEN"
```

### Como serviço

```ini
# /etc/systemd/system/epi-borda.service
[Unit]
Description=EPI Fetin — cliente de borda
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/epi-fetin/raspberry
ExecStart=/usr/bin/python3 -m epi_borda
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now epi-borda
journalctl -u epi-borda -f
```

`Restart=always` é seguro aqui: a catraca é fail-secure. Uma borda que
reinicia em looping deixa a catraca fechada, que é o estado correto — e
aparece no painel como câmera offline, porque o testamento (LWT) sai
mesmo em queda abrupta.

---

## Sem hardware nenhum

```bash
python -m detectores.falso                 # aprova tudo
python -m detectores.falso --faltando helmet
python -m detectores.falso --mudo          # deixa o servidor expirar
```

É o mesmo pacote, com o detector trocado. Serve para provar a integração
antes de a Pi existir e para demonstrar o caminho de erro na
apresentação sem pedir para ninguém tirar o capacete.

---

## Verificação

```bash
python3 testar_integracao.py
```

51 checagens contra o **servidor de verdade** — API, worker, broker e
banco no ar. Abre verificações pelo mesmo endpoint que o tablet usa e
confere no banco o que o servidor decidiu:

| Seção | O que prova |
|---|---|
| 1 | sem a borda no ar, abrir verificação devolve 503 na hora |
| 2 | todos os EPIs presentes → APROVADA, com detecções e latência gravadas |
| 3 | faltando um EPI → REPROVADA, e o ausente vai relatado, não omitido |
| 4 | laço de visão travado → EXPIRADA, sem detecção inventada |
| 5 | o que a borda recusa (schema, campo faltando, classe desconhecida) |
| 6 | a votação em N frames |
| 7 | grampeamento de confiança e forma do envelope |
| 8 | decodificação de saída YOLO e NMS |

Precisa do servidor no ar. `MQTT_HOST` e `API_BASE` saem do mesmo `.env`.

---

## Decisões

**O contrato é reescrito deste lado, não importado do servidor.** Seria
menos código reaproveitar `app/mqtt/schemas.py` — e não haveria contrato
nenhum, só uma variável compartilhada. Escrevendo aqui do jeito que um
dispositivo escreveria, um descasamento vira erro em vez de coincidência.
Também é o que permite instalar isto numa Pi sem SQLAlchemy e FastAPI
junto.

**Nenhum payload carrega `aprovado`.** A borda relata percepção; quem
decide conformidade é o servidor, com a política do ponto na mão. Se a
decisão viesse daqui, mudar a regra exigiria atualizar firmware em campo.

**A confiança relatada é a mediana, não a máxima.** Com a máxima, um
frame sortudo com um reflexo faz o número parecer ótimo — e o relatório
do TCC passa a mentir sobre a qualidade do modelo.

**Cada EPI conta uma vez por frame.** Sem isso, alguém com as duas luvas
visíveis produziria duas confirmações no mesmo instante, e o mínimo de
três seria atingido com um frame e meio.

**Buffer vazio: a borda cala.** Se o laço de visão parou, responder "não
vi nada" negaria a passagem de alguém que talvez estivesse com tudo. O
timeout do servidor cuida, e a verificação fica registrada como EXPIRADA
— que é a verdade: a câmera não respondeu.

**O status online só sai depois do SUBACK.** Anunciando logo após o
`SUBSCRIBE`, existe uma janela de milissegundos em que o servidor já nos
considera de pé e o broker ainda não registrou a assinatura. O primeiro
`cmd/capturar` cai nesse buraco e a verificação expira sem erro em lugar
nenhum. Na bancada é invisível — só a primeira verificação depois de
ligar a Pi. Em campo é a pessoa que chega primeiro no turno. Custou uma
verificação perdida para aparecer no teste.

**`clean_session=False`.** O broker guarda as mensagens QoS 1 destinadas
a nós enquanto estivermos fora do ar. Sem isso, um `cmd/capturar`
publicado durante um reboot de 4 s some.

**A imagem nunca vai por MQTT.** Um JPEG em base64 é payload que o broker
segura na RAM para cada assinante, e a retransmissão de QoS 1 duplica.
MQTT carrega fatos; a evidência vai por HTTP e o resultado leva só o id
(`EVIDENCIA_ATIVA=1`, desligado por padrão — é imagem de pessoa).

**Teto de fps no laço.** Sem ele a inferência come 100% da CPU e a Pi
passa a levar throttling térmico, que derruba justamente o fps que se
queria alto.

---

## Estrutura

```
epi_borda/
├── contrato.py       tópicos e payloads, espelhados do servidor
├── classes.py        tradução das classes do modelo  ← o que você edita
├── config.py         .env sem dependência externa
├── detector.py       o protocolo Detector, o anel de frames e a votação
├── mqtt_cliente.py   paho, LWT, status retido, dedup, reconexão
├── agente.py         cmd/capturar → votação → evt/resultado
├── evidencia.py      POST /api/v1/evidencias (opcional)
└── __main__.py       serviço pronto: câmera + ONNX + agente

detectores/
├── onnx_yolo.py      adaptador de exemplo (letterbox, decode v5/v8, NMS)
└── falso.py          sem câmera e sem modelo
```
