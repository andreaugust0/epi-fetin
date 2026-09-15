# EPI Fetin — firmware da catraca (ESP32)

A última ponta da cadeia. O tablet identifica, o servidor decide, a Raspberry
confere os EPIs — e este aqui é quem abre.

Assina `cmd/liberar`, aciona o relé por uma janela de tempo e publica
`evt/passagem`. Porta o comportamento de
[`servidor/simuladores/esp32.py`](../servidor/simuladores/esp32.py), que
continua útil para testar o servidor sem hardware na mesa.

---

## Antes do primeiro build

```bash
cp src/config.exemplo.h src/config.h
```

Preencha o `config.h` com a rede, o IP do servidor e os pinos. Ele **não é
versionado**: guarda a senha do Wi-Fi.

Um campo merece atenção especial:

```c
#define DEVICE_ID "esp32-planta01-portaria"
```

Precisa bater letra por letra com `dispositivos.client_id_mqtt` no banco.
Divergir aqui não dá erro em lugar nenhum — a catraca abre normalmente, e o
painel mostra o dispositivo offline para sempre.

## Gravar e acompanhar

```bash
pio run -t upload
pio device monitor
```

No log você deve ver, nesta ordem: Wi-Fi conectado com IP, MQTT conectado,
e `escutando epi/v1/planta01/portaria/cmd/liberar`.

## Ligação

Sem nada ligado, o **LED da placa (GPIO2)** já pisca junto com o relé — dá
para provar o fluxo inteiro com a placa pelada na mesa.

Para ligar um módulo relé:

| ESP32 | módulo relé |
|---|---|
| `GPIO26` | IN |
| `5V` (VIN) | VCC |
| `GND` | GND |

A bobina do relé puxa mais corrente do que a USB do notebook entrega com
folga. Se a placa reiniciar no instante em que o relé clica, é isso: alimente
o módulo por fonte separada, com o GND em comum.

Quase todo módulo de prateleira é **ativo em nível baixo** — o pino vai a zero
para fechar o contato. Se o seu acionar invertido, troque `RELE_ATIVO_BAIXO`
para `0` no `config.h`.

### Por que o GPIO26

No DevKit V1, evite 0, 2, 12 e 15 para atuador. O nível deles no instante do
boot decide como a placa inicia, e um relé preso num deles pode impedir a
própria partida. Os do ADC2 (4, 12–15, 25–27) não podem ser lidos como
analógicos com o Wi-Fi ligado, mas como **saída digital** funcionam sem
restrição — que é o nosso caso.

## Testar sem o sistema inteiro

Grave o firmware, suba só um broker e exercite a placa na mesa:

```bash
# um broker anônimo, descartável
docker run --rm -p 1883:1883 eclipse-mosquitto:2 mosquitto -c /mosquitto-no-auth.conf

# noutro terminal
pip install paho-mqtt
python testar_catraca.py --host SEU_IP
```

O script publica um `cmd/liberar` à mão e imprime o que a placa responde. As
duas travas têm demonstração pronta:

```bash
python testar_catraca.py --host SEU_IP --repetir   # mesma mensagem 2x: abre UMA
python testar_catraca.py --host SEU_IP --vencido   # comando expirado: NÃO abre
```

---

## As duas travas

Não são detalhe de implementação. São o que separa um controle de acesso de um
botão de abrir porta pela rede.

**Idempotência.** MQTT QoS 1 é *at-least-once*: a mesma mensagem chega duas
vezes sempre que um ACK se perde. Sem descartar repetição, a catraca abre duas
vezes para uma liberação — e a segunda abertura é para quem estiver por perto.
O firmware guarda os últimos 20 `msg_id` e ignora o que já viu.

**Prazo.** O comando carrega `expira_em`. Um ESP32 que ficou sem rede e
reconecta poderia receber uma fila de comandos velhos e abrir a catraca para
ninguém, minutos depois. O firmware compara com o relógio (sincronizado por
NTP) e descarta o que venceu.

Há ainda uma terceira proteção, que não aparece como código e sim como escolha
de conexão: a sessão MQTT é **limpa** (`cleanSession`). Com sessão persistente,
o broker guardaria os comandos publicados enquanto a placa estivesse fora e os
entregaria todos de uma vez na volta.

Para ver o que acontece sem as duas primeiras, rode o simulador em Python com
`--sem-protecao`. É demonstração pronta para a monografia.

---

## O que este firmware não faz

**Não sabe se a pessoa passou.** Sem sensor de giro, a única verdade que ele
pode afirmar é que a janela abriu e fechou. Por isso reporta `LIBERADO` no
início e `TIMEOUT_SEM_PASSAGEM` no fim — nunca `PASSOU`.

Isso não é limitação a esconder: liberar não é o mesmo que passar, e o painel
distingue quem foi autorizado de quem realmente entrou. Quando houver barreira
óptica ou o contato da própria catraca num pino, o `PASSOU` entra em
`cuidarDaJanela()`, disparado pela borda do sensor.

---

## Quando não funcionar

**`rc=5` na conexão MQTT** — credencial recusada. Confira se `MQTT_USUARIO` e
`MQTT_SENHA` estão vazios quando o broker aceita conexão anônima.

**Conecta e nunca recebe comando** — o `SITE` ou o `PONTO` do `config.h` não
batem com os do banco, e a assinatura foi para um tópico onde ninguém publica.
Confira com o log do servidor, que imprime o tópico ao publicar.

**A catraca abre, mas o painel diz offline** — é o `DEVICE_ID`.

**Reinicia ao acionar o relé** — alimentação. Veja a seção de ligação.

**Todo comando vira "expirado"** — o NTP não sincronizou. Sem internet, a rede
local precisa de um servidor de horário, ou a checagem de prazo fica desligada
(o firmware avisa no log quando isso acontece).
