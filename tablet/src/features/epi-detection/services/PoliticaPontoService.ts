import { resolveFaceApiConfig } from '@/features/face-recognition/services/faceApiConfig';
import { AppError } from '@/services/errors';

import { isEpiId, type EpiId } from '../types';

/** O ponto de acesso, como `GET /api/v1/pontos` devolve. */
interface PontoDoServidor {
  id: number;
  codigo: string;
  nome: string;
  ativo: boolean;
  epis_exigidos: string[];
}

const TEMPO_LIMITE_MS = 8000;

/**
 * Quais EPIs o ponto deste tablet exige, segundo o SERVIDOR.
 *
 * A exigência é política do ponto de acesso, não preferência do aparelho:
 * quem decide é o painel administrativo, e trocar a lista lá precisa aparecer
 * aqui sem reprogramar nada. Era assim que o servidor já se comportava na
 * verificação — só a tela inicial do tablet continuava lendo a lista antiga,
 * guardada localmente desde a época em que a configuração morava no aparelho.
 *
 * `GET /pontos` não exige autenticação (é catálogo, não dado pessoal), então
 * a chamada não depende do token do dispositivo — só de o tablet saber a URL
 * e o próprio `ponto_id`, que é exatamente o que o provisionamento define.
 *
 * Devolve `null` quando não há provisionamento: nesse caso quem responde é o
 * repositório local, e a tela continua utilizável numa mesa sem servidor.
 */
export const buscarEpisExigidos = async (
  signal?: AbortSignal,
): Promise<EpiId[] | null> => {
  const { baseUrl, pointId } = await resolveFaceApiConfig();
  if (!baseUrl || !pointId) {
    return null;
  }

  const relogio = new AbortController();
  const expirar = setTimeout(() => relogio.abort(), TEMPO_LIMITE_MS);
  const cancelar = () => relogio.abort();
  signal?.addEventListener('abort', cancelar);

  try {
    const resposta = await fetch(`${baseUrl}/api/v1/pontos`, {
      headers: { Accept: 'application/json' },
      signal: relogio.signal,
    });

    if (!resposta.ok) {
      throw new AppError(
        'network',
        `Não consegui ler a configuração do ponto (HTTP ${resposta.status}).`,
      );
    }

    const pontos = (await resposta.json()) as PontoDoServidor[];
    const meu = Array.isArray(pontos)
      ? pontos.find((p) => p.id === pointId)
      : undefined;

    if (!meu) {
      throw new AppError(
        'invalid_response',
        `O servidor não conhece o ponto de acesso ${pointId}. ` +
          'Confira o provisionamento deste tablet.',
      );
    }

    /*
     * Códigos desconhecidos são DESCARTADOS, não exibidos.
     *
     * O servidor pode ter um EPI que este aplicativo ainda não sabe desenhar
     * — é o preço de as duas pontas evoluírem em ritmos diferentes. Mostrar
     * um item sem ícone nem rótulo seria pior que omiti-lo, e a decisão de
     * aprovar continua sendo do servidor, que conhece a lista inteira. A
     * tela inicial informa; ela não julga.
     */
    return meu.epis_exigidos.filter((codigo): codigo is EpiId => isEpiId(codigo));
  } finally {
    clearTimeout(expirar);
    signal?.removeEventListener('abort', cancelar);
  }
};
