# Simuladores de dispositivo

Dois scripts que fazem o papel da Raspberry Pi e do ESP32, para você
desenvolver e testar o sistema inteiro **sem hardware nenhum ligado**.

```bash
pip install paho-mqtt        # única dependência

python -m simuladores.raspberry     # em um terminal
python -m simuladores.esp32         # em outro
```

Com os dois no ar, o servidor passa a aceitar verificações e o fluxo
completo funciona ponta a ponta.

---

## Por que eles existem

Sem eles, no momento em que o app chama `POST /api/v1/verificacoes`:

1. O servidor checa se a câmera está online. Nenhum dispositivo publicou
   status, então ele responde **`503 câmera do ponto está offline`**.
2. Se você contornar isso, o servidor publica `cmd/capturar` e **ninguém
   responde**. A verificação fica em `AGUARDANDO_ANALISE` até expirar.

Quem estiver integrando o app vai achar que quebrou o próprio código.
Os simuladores eliminam esse falso negativo.

---

## Raspberry

```bash
python -m simuladores.raspberry                        # tudo presente, aprova
python -m simuladores.raspberry --faltando capacete    # reprova
python -m simuladores.raspberry --faltando capacete,oculos
python -m simuladores.raspberry --mudo                 # não responde (testa timeout)
python -m simuladores.raspberry --offline              # testa o 503
python -m simuladores.raspberry --latencia-ms 3000     # inferência lenta
```

Ele não tem lista fixa de EPIs: responde sobre exatamente os que vieram
em `epis_exigidos` no comando. Ou seja, **os simuladores não são afetados
pelo descasamento de códigos entre app e servidor** — eles ecoam o que o
servidor pediu.

| Flag | Efeito |
|---|---|
| `--faltando a,b` | reporta esses EPIs como ausentes |
| `--mudo` | recebe o comando e ignora |
| `--offline` | sobe sem anunciar presença |
| `--latencia-ms` | tempo simulado de inferência (padrão 600) |
| `--confianca` | confiança base para EPI presente (padrão 0.94) |
| `--versao-modelo` | valor gravado em `verificacoes.versao_modelo` |

## ESP32

```bash
python -m simuladores.esp32                  # libera e a pessoa passa
python -m simuladores.esp32 --nao-passar     # libera e ninguém atravessa
python -m simuladores.esp32 --falha-rele     # relé não responde
python -m simuladores.esp32 --sem-protecao   # ver abaixo
```

O firmware simulado implementa as **duas travas** que o firmware real
precisa ter:

- **Idempotência** — guarda os últimos 20 `msg_id` e ignora repetidos.
  QoS 1 é *at-least-once*: sem isso, uma reentrega abre a catraca de novo.
- **Expiração** — descarta comando cujo `expira_em` já passou. Cobre o
  ESP32 que ficou sem rede e recebe uma fila de comandos velhos ao
  reconectar.

`--sem-protecao` desliga as duas. Rode uma vez para ver a catraca abrindo
para ninguém — vira uma boa figura na monografia.

---

## Controle ao vivo

Rodando num terminal interativo, os dois aceitam comandos de uma letra
(digite e Enter). Serve para demonstração: dá para mudar o comportamento
no meio da apresentação sem reiniciar nada.

**Raspberry**

| Tecla | Efeito |
|---|---|
| `a` | próxima verificação aprova |
| `r` | próxima reprova (falta o primeiro EPI) |
| `t` | próxima não responde |
| `o` | alterna online / offline |
| `s` | mostra o estado |
| `q` | encerra |

**ESP32**

| Tecla | Efeito |
|---|---|
| `p` | a pessoa passa |
| `n` | ninguém passa |
| `f` | falha no relé |
| `o` | alterna online / offline |
| `s` | mostra o estado |
| `q` | encerra |

---

## Roteiro de demonstração

Quatro terminais. Vale ensaiar antes da defesa.

1. `docker compose exec broker mosquitto_sub -h localhost -t 'epi/#' -v`
2. `python -m simuladores.raspberry`
3. `python -m simuladores.esp32`
4. Dispare uma verificação pelo `/docs` ou pelo app.

No terminal 1 você vê `cmd/capturar` sair, `evt/resultado` voltar,
`cmd/liberar` sair e `evt/passagem` voltar — em ordem, com o payload.
Aperte `r` no terminal 2 e dispare de novo: a catraca não abre.

---

## Detalhe de projeto

Estes simuladores **não importam nada de `app/`**.

Seria menos código reaproveitar `app.mqtt.topics` e `app.mqtt.schemas` —
e destruiria o valor do teste. Um simulador que usa os schemas do servidor
está testando o servidor contra ele mesmo: erro de contrato passa
despercebido porque os dois lados leem o mesmo arquivo.

Reescrevendo o contrato aqui, do jeito que um dispositivo real
escreveria, o acordo entre as pontas passa a ser verificado de verdade.
Por isso também usam `paho-mqtt` síncrono — o mesmo cliente que roda numa
Raspberry — em vez do cliente assíncrono do servidor.

Quando o hardware chegar, troque um simulador por vez. Se algo quebrar,
você sabe exatamente qual peça mudou.

---

## Verificação automatizada

```bash
python -m scripts.testar_simuladores
```

Sobe o worker do servidor, roda os simuladores como processos separados e
exercita seis cenários: presença via LWT, caminho feliz, reprovação,
timeout, câmera offline e liberação sem passagem. 13 checagens.
