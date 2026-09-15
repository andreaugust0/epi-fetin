import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useEffect, useRef } from 'react';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const APROVADO = require('../../assets/sons/aprovado.wav');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const NEGADO = require('../../assets/sons/negado.wav');

/**
 * Anuncia o desfecho por som, uma vez, ao abrir a tela de resultado.
 *
 * Numa portaria ninguém lê a tela. A pessoa está de capacete, com as mãos
 * ocupadas, a três metros do tablet, e quem está atrás dela na fila precisa
 * saber se pode avançar. A cor da tela resolve isso para quem olha; o som
 * resolve para todo mundo, inclusive para quem não distingue verde de
 * vermelho — e daltonismo em homens adultos não é caso raro num canteiro.
 *
 * Os dois sons são desenhados para serem distinguíveis, não bonitos:
 *
 *   aprovado — duas notas SUBINDO, Lá para Mi, uma quinta justa
 *   negado   — duas notas DESCENDO, graves e mais longas
 *
 * Subir e descer é lido como sim e não em praticamente qualquer cultura que
 * use sinal sonoro, e o grave do negado atravessa ruído de fábrica melhor que
 * o agudo. A diferença sobrevive a alto-falante ruim e a galpão com eco.
 *
 * `playsInSilentMode` porque tablet de portaria vive no mudo — alguém silencia
 * para não ouvir notificação e leva junto a única informação que atravessa a
 * distância. O modo de áudio é aplicado sem travar a tela: som é reforço, e
 * falhar no som não pode impedir o resultado de aparecer.
 */
export const useSomDoResultado = (aprovado: boolean | null): void => {
  const somAprovado = useAudioPlayer(APROVADO);
  const somNegado = useAudioPlayer(NEGADO);

  /*
   * Toca UMA vez por resultado. A tela re-renderiza por vários motivos — o
   * relógio da inatividade, o nome chegando, o foco voltando — e sem esta
   * trava o terminal repetiria o bipe a cada um deles, o que soa como defeito
   * e some no meio do ruído justamente por ser repetido.
   */
  const jaTocouRef = useRef(false);

  useEffect(() => {
    if (aprovado === null || jaTocouRef.current) {
      return;
    }
    jaTocouRef.current = true;

    const tocar = async () => {
      try {
        await setAudioModeAsync({ playsInSilentMode: true });
        const som = aprovado ? somAprovado : somNegado;
        som.seekTo(0);
        som.play();
      } catch {
        // Silêncio é degradação aceitável: a tela continua dizendo tudo.
      }
    };

    void tocar();
  }, [aprovado, somAprovado, somNegado]);
};
