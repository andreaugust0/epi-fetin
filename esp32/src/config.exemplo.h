/*
 * Copie este arquivo para `config.h` e preencha.
 *
 * O `config.h` não é versionado: ele guarda a senha do Wi-Fi. O exemplo fica
 * no repositório para quem clonar saber o que precisa preencher.
 */
#pragma once

// ------------------------------------------------------------------- rede
#define WIFI_SSID "EPI-Fetin"
#define WIFI_SENHA "troque-isto"

// IP do computador que roda o docker compose. Muda a cada rede — é o mesmo
// número que vai no `~/servidor.sh` da Raspberry e no provisionamento do
// tablet.
#define MQTT_HOST "172.20.10.4"
#define MQTT_PORTA 1883

// Vazios enquanto o broker aceita conexão anônima (é o caso do
// docker-compose de desenvolvimento). Preencha quando ligar autenticação.
#define MQTT_USUARIO ""
#define MQTT_SENHA ""

// ------------------------------------------------------------- identidade
/*
 * Precisa bater LETRA POR LETRA com `dispositivos.client_id_mqtt` no banco.
 *
 * Divergir aqui não dá erro em lugar nenhum: o ESP32 conecta, assina o
 * tópico, recebe o comando e abre a catraca — e o painel continua mostrando
 * a catraca como offline para sempre, porque o status chega num tópico que
 * o servidor não associa a dispositivo nenhum.
 */
#define DEVICE_ID "esp32-planta01-portaria"
#define SITE "planta01"
#define PONTO "portaria"

// --------------------------------------------------------------- hardware
/*
 * GPIO do relé. 26 é uma escolha segura no DevKit V1: não é pino de boot
 * (strapping), não some durante o reset e não briga com o rádio Wi-Fi como
 * os do ADC2.
 *
 * Evite 0, 2, 12 e 15 para atuador: o nível deles no instante do boot decide
 * como a placa inicia, e um relé preso neles pode impedir a própria partida.
 */
#define PINO_RELE 26

/*
 * Quase todo módulo relé de prateleira é ATIVO EM NÍVEL BAIXO: o pino vai a
 * zero para fechar o contato. Se o seu acionar invertido — clica ao ligar a
 * placa e solta ao liberar — troque para 0.
 */
#define RELE_ATIVO_BAIXO 1

/*
 * LED da placa. No DevKit V1 é o GPIO2, ao lado do regulador. Ele acende
 * junto com o relé e serve de sinal visível quando ainda não há relé ligado.
 */
#define PINO_LED 2
