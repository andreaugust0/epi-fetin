/*
 * Firmware da catraca — ESP32 + relé.
 *
 * Assina `cmd/liberar`, aciona o relé e publica `evt/passagem`. É a última
 * ponta da cadeia: tablet identifica, servidor decide, Raspberry confere os
 * EPIs, e este aqui é quem de fato abre.
 *
 * Porta o comportamento de `servidor/simuladores/esp32.py`, inclusive as
 * DUAS TRAVAS que aquele arquivo existe para demonstrar. Elas não são
 * detalhe de implementação — são o que separa um controle de acesso de um
 * botão de abrir porta pela rede:
 *
 *   1. IDEMPOTÊNCIA. MQTT QoS 1 é *at-least-once*: a mesma mensagem pode
 *      chegar duas vezes, e chega, sempre que um ACK se perde. Sem descartar
 *      repetição, a catraca abre duas vezes para uma liberação — e a segunda
 *      abertura é para quem estiver por perto.
 *
 *   2. PRAZO. O comando carrega `expira_em`. Um ESP32 que ficou sem rede e
 *      reconecta pode receber comandos velhos; executá-los abre a catraca
 *      para ninguém, minutos depois, sem nada na tela de ninguém.
 *
 * O laço nunca bloqueia. `delay()` durante a janela do relé pararia o
 * `client.loop()`, o broker derrubaria a conexão por keepalive vencido, e o
 * sintoma seria uma catraca que "desconecta sozinha toda vez que abre".
 */
#include <Arduino.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <time.h>

// `esp_random` mudou de cabeçalho entre as versões do ESP-IDF. Procurar o
// arquivo em vez de fixar um evita um erro de compilação que depende da
// versão do core instalada, e que não diz nada sobre o que fazer.
#if __has_include(<esp_random.h>)
#include <esp_random.h>
#else
#include <esp_system.h>
#endif

#include <ArduinoJson.h>

#include "config.h"

// ---------------------------------------------------------------- tópicos
// epi/v1/{site}/{ponto}/... — a mesma convenção de `app/mqtt/topics.py`.
static const char *T_LIBERAR = "epi/v1/" SITE "/" PONTO "/cmd/liberar";
static const char *T_PASSAGEM = "epi/v1/" SITE "/" PONTO "/evt/passagem";
static const char *T_STATUS = "epi/v1/" SITE "/" PONTO "/dev/" DEVICE_ID "/status";

static const char *FIRMWARE = "esp32-1.0.0";

WiFiClient rede;
PubSubClient cliente(rede);

// ------------------------------------------------------------ idempotência
/*
 * Anel dos últimos msg_id processados.
 *
 * Vinte é o mesmo tamanho do simulador, e é generoso: a reentrega de QoS 1
 * acontece em segundos, não em dezenas de comandos. Guardar mais só gastaria
 * RAM para cobrir um caso que não existe.
 */
static const size_t VISTOS_MAX = 20;
static String vistos[VISTOS_MAX];
static size_t vistos_prox = 0;

static bool jaVisto(const String &msgId) {
  if (msgId.isEmpty()) {
    return false;  // sem id não dá para deduplicar; deixa passar e loga.
  }
  for (size_t i = 0; i < VISTOS_MAX; i++) {
    if (vistos[i] == msgId) {
      return true;
    }
  }
  return false;
}

static void lembrar(const String &msgId) {
  vistos[vistos_prox] = msgId;
  vistos_prox = (vistos_prox + 1) % VISTOS_MAX;
}

// ------------------------------------------------------------------ relógio
/*
 * O prazo do comando vem em ISO-8601 UTC, e comparar com ele exige saber que
 * horas são. O ESP32 acorda achando que é 1970: sem NTP, todo comando
 * pareceria vencido, e a catraca nunca abriria.
 */
static bool relogioPronto() {
  // 1.700.000.000 é nov/2023. Qualquer coisa abaixo disso é o relógio ainda
  // no epoch, não uma data real.
  return time(nullptr) > 1700000000;
}

static void sincronizarRelogio() {
  configTime(0, 0, "pool.ntp.org", "time.google.com");
}

/** "2026-09-15T12:34:56.789Z" -> epoch UTC. Devolve 0 se não entender. */
static time_t lerIso8601(const char *texto) {
  if (texto == nullptr) {
    return 0;
  }
  int ano, mes, dia, hora, minuto, segundo;
  if (sscanf(texto, "%d-%d-%dT%d:%d:%d", &ano, &mes, &dia, &hora, &minuto,
             &segundo) != 6) {
    return 0;
  }
  /*
   * Conversão feita à mão, e de propósito.
   *
   * `mktime` interpretaria a data no fuso local e erraria por horas — em
   * silêncio, porque o resultado continua sendo uma data plausível. `timegm`
   * faz o certo, mas nem toda versão do core o expõe, e descobrir isso é um
   * erro de compilação obscuro no dia do teste.
   *
   * O algoritmo abaixo (dias desde a era civil) é exato e cabe em cinco
   * linhas. Ele trata março como início do ano para fazer o 29 de fevereiro
   * cair no fim, que é o truque que dispensa qualquer tabela de meses.
   */
  long y = ano;
  const unsigned m = (unsigned)mes;
  const unsigned d = (unsigned)dia;
  y -= m <= 2;
  const long era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  const long dias = era * 146097 + (long)doe - 719468;

  return (time_t)(dias * 86400L + hora * 3600L + minuto * 60L + segundo);
}

/** Agora, no formato que o restante do sistema usa. */
static String agoraIso() {
  time_t t = time(nullptr);
  struct tm utc;
  gmtime_r(&t, &utc);
  char buf[32];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &utc);
  return String(buf);
}

// --------------------------------------------------------------------- uuid
/** UUID v4 para o `msg_id` das nossas próprias mensagens. */
static String novoUuid() {
  uint8_t b[16];
  for (size_t i = 0; i < sizeof(b); i++) {
    b[i] = (uint8_t)(esp_random() & 0xFF);
  }
  b[6] = (b[6] & 0x0F) | 0x40;  // versão 4
  b[8] = (b[8] & 0x3F) | 0x80;  // variante RFC 4122

  char saida[37];
  snprintf(saida, sizeof(saida),
           "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
           b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10],
           b[11], b[12], b[13], b[14], b[15]);
  return String(saida);
}

// ------------------------------------------------------------------ eventos
static void publicarPassagem(const String &verificacaoId, const char *evento) {
  JsonDocument doc;
  doc["v"] = 1;
  doc["msg_id"] = novoUuid();
  doc["ts"] = agoraIso();
  doc["verificacao_id"] = verificacaoId;
  doc["evento"] = evento;

  char corpo[256];
  size_t n = serializeJson(doc, corpo, sizeof(corpo));
  cliente.publish(T_PASSAGEM, (const uint8_t *)corpo, n, false);

  Serial.printf("[EVENTO] %s · verificação %s\n", evento,
                verificacaoId.substring(0, 8).c_str());
}

static void publicarStatus(bool online) {
  JsonDocument doc;
  doc["online"] = online;
  doc["fw"] = FIRMWARE;

  char corpo[128];
  size_t n = serializeJson(doc, corpo, sizeof(corpo));
  // `retain` verdadeiro: o servidor descobre o estado no instante em que
  // assina, sem esperar o próximo anúncio. É o que faz o painel mostrar a
  // catraca online logo depois de subir.
  cliente.publish(T_STATUS, (const uint8_t *)corpo, n, true);
}

// ----------------------------------------------------------- janela do relé
struct Janela {
  bool aberta = false;
  unsigned long fecha_em = 0;   // millis()
  String verificacao_id;
} janela;

static void acionarRele(bool ligado) {
  const int nivel = RELE_ATIVO_BAIXO ? (ligado ? LOW : HIGH) : (ligado ? HIGH : LOW);
  digitalWrite(PINO_RELE, nivel);
  digitalWrite(PINO_LED, ligado ? HIGH : LOW);
}

// -------------------------------------------------------------- recebimento
static void aoReceber(char *topico, uint8_t *dados, unsigned int tamanho) {
  (void)topico;  // só assinamos um tópico

  JsonDocument cmd;
  DeserializationError erro = deserializeJson(cmd, dados, tamanho);
  if (erro) {
    Serial.printf("[ERRO] payload ilegível: %s\n", erro.c_str());
    return;
  }

  const String msgId = cmd["msg_id"] | "";
  const String verificacaoId = cmd["verificacao_id"] | "";

  // --- Trava 1: idempotência ---------------------------------------------
  if (jaVisto(msgId)) {
    Serial.printf("[DUPLICATA] msg_id %s… já processado — ignorando.\n",
                  msgId.substring(0, 8).c_str());
    return;
  }
  lembrar(msgId);

  // --- Trava 2: prazo -----------------------------------------------------
  const char *expiraEm = cmd["expira_em"] | (const char *)nullptr;
  if (expiraEm != nullptr) {
    const time_t prazo = lerIso8601(expiraEm);
    if (prazo == 0) {
      Serial.println("[AVISO] expira_em em formato desconhecido — seguindo.");
    } else if (!relogioPronto()) {
      /*
       * Sem NTP não dá para julgar o prazo, e recusar tudo deixaria a catraca
       * travada por causa de um servidor de horário. Segue, mas denuncia: a
       * proteção está de fato desligada enquanto esta linha aparece.
       *
       * Vale notar que o risco real que ela cobre — uma fila de comandos
       * velhos chegando depois de uma reconexão — já é bem menor aqui, porque
       * a sessão é limpa (veja `conectar`) e o broker não guarda nada para
       * quem estava fora.
       */
      Serial.println("[AVISO] relógio sem NTP — prazo NÃO verificado.");
    } else if (prazo < time(nullptr)) {
      Serial.printf("[EXPIRADO] comando vencido há %lds — descartado.\n",
                    (long)(time(nullptr) - prazo));
      return;
    }
  }

  const unsigned long duracao = cmd["duracao_ms"] | 5000UL;

  /*
   * Um comando novo durante uma janela aberta REINICIA a contagem em vez de
   * ser ignorado. Duas liberações legítimas em sequência são o caso comum de
   * fila andando; fechar no prazo da primeira prenderia a segunda pessoa na
   * catraca.
   */
  janela.aberta = true;
  janela.fecha_em = millis() + duracao;
  janela.verificacao_id = verificacaoId;
  acionarRele(true);

  Serial.printf("[RELÉ] acionado · verificação %s… · %lums\n",
                verificacaoId.substring(0, 8).c_str(), duracao);

  publicarPassagem(verificacaoId, "LIBERADO");
}

static void cuidarDaJanela() {
  if (!janela.aberta || (long)(millis() - janela.fecha_em) < 0) {
    return;
  }
  janela.aberta = false;
  acionarRele(false);

  /*
   * Sem sensor de giro, a única verdade que este firmware pode afirmar é que
   * a janela fechou. Reportar PASSOU aqui seria inventar um fato: liberar não
   * é o mesmo que passar, e a auditoria vive dessa diferença — o painel
   * distingue quem foi autorizado de quem realmente entrou.
   *
   * Quando houver barreira óptica ou o contato da catraca num pino, é aqui
   * que entra o PASSOU, disparado pela borda do sensor.
   */
  publicarPassagem(janela.verificacao_id, "TIMEOUT_SEM_PASSAGEM");
  Serial.println("[PASSAGEM] janela fechou — sem sensor para confirmar giro.");
}

// ------------------------------------------------------------------ conexão
static void conectarWifi() {
  Serial.printf("[WIFI] conectando em %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  // O ESP32 dorme o rádio por padrão e perde mensagens que chegam enquanto
  // isso. Numa catraca, o comando perdido é a pessoa parada esperando.
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_SENHA);

  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print('.');
  }
  Serial.printf("\n[WIFI] conectado · IP %s\n", WiFi.localIP().toString().c_str());
}

static void conectar() {
  while (!cliente.connected()) {
    Serial.printf("[MQTT] conectando em %s:%d como %s… ", MQTT_HOST, MQTT_PORTA,
                  DEVICE_ID);

    JsonDocument testamento;
    testamento["online"] = false;
    testamento["motivo"] = "lwt";
    char corpoLwt[96];
    serializeJson(testamento, corpoLwt, sizeof(corpoLwt));

    /*
     * O testamento (LWT). Se a placa cair na tomada, o BROKER publica isto
     * por ela, e o painel mostra a catraca offline em segundos — sem nenhum
     * polling do servidor.
     *
     * `cleanSession` verdadeiro, e isto é decisão de segurança, não de
     * performance: com sessão persistente o broker guardaria os comandos
     * publicados enquanto a placa estivesse fora e os entregaria todos de uma
     * vez na volta. A catraca abriria em sequência, para ninguém, por
     * liberações que já não valem.
     */
    /*
     * Credencial vazia precisa virar `nullptr`, não string vazia. O
     * PubSubClient só omite o campo quando recebe ponteiro nulo; com "" ele
     * envia um usuário em branco, e um broker configurado para anônimo
     * rejeita a conexão com rc=5 — que se lê como "senha errada" quando não
     * há senha nenhuma.
     */
    const char *usuario = strlen(MQTT_USUARIO) > 0 ? MQTT_USUARIO : nullptr;
    const char *senha = strlen(MQTT_SENHA) > 0 ? MQTT_SENHA : nullptr;

    const bool ok = cliente.connect(DEVICE_ID, usuario, senha, T_STATUS, 1, true,
                                    corpoLwt, true);
    if (!ok) {
      Serial.printf("falhou (rc=%d); nova tentativa em 3s\n", cliente.state());
      delay(3000);
      continue;
    }

    Serial.println("conectado");
    publicarStatus(true);
    cliente.subscribe(T_LIBERAR, 1);
    Serial.printf("[MQTT] escutando %s\n", T_LIBERAR);
  }
}

// --------------------------------------------------------------------- vida
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\n=== catraca EPI · %s · %s ===\n", FIRMWARE, DEVICE_ID);

  pinMode(PINO_RELE, OUTPUT);
  pinMode(PINO_LED, OUTPUT);
  /*
   * Relé desligado ANTES de qualquer outra coisa.
   *
   * A catraca é fail-secure: o estado seguro é fechada. Um pino que fica
   * flutuando durante a partida pode fechar o contato por alguns
   * milissegundos, e uma catraca que dá um estalo a cada reset é uma catraca
   * que abre sozinha na queda de energia.
   */
  acionarRele(false);

  conectarWifi();
  sincronizarRelogio();

  cliente.setServer(MQTT_HOST, MQTT_PORTA);
  cliente.setCallback(aoReceber);
  cliente.setBufferSize(MQTT_MAX_PACKET_SIZE);
  conectar();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WIFI] caiu — reconectando");
    conectarWifi();
  }
  if (!cliente.connected()) {
    conectar();
  }
  cliente.loop();
  cuidarDaJanela();
}
