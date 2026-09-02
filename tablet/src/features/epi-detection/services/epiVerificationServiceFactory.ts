import { isFaceApiConfigured } from '@/features/face-recognition/services/faceApiConfig';

import type { EpiVerificationService } from './EpiVerificationService';
import { MockEpiVerificationService } from './MockEpiVerificationService';
import { ServidorEpiVerificationService } from './ServidorEpiVerificationService';

let cachedService: EpiVerificationService | null = null;

/**
 * Único ponto do aplicativo que decide qual verificação de EPI usar.
 *
 * Com o tablet provisionado (URL do servidor e ponto de acesso definidos),
 * quem verifica é o servidor: ele manda a Raspberry inferir e confronta o
 * resultado com a política do ponto. Sem provisionamento, cai no mock — o
 * app continua demonstrável numa mesa, sem servidor e sem câmera.
 *
 * A decisão é assíncrona porque a configuração vive em AsyncStorage e o
 * token no SecureStore. `getEpiVerificationService` continua síncrona para
 * não obrigar as telas a mudar: o serviço do servidor resolve a
 * configuração dentro do próprio `run`, e a fábrica só precisa saber se
 * existe provisionamento.
 */
export const getEpiVerificationService = (): EpiVerificationService => {
  if (!cachedService) {
    cachedService = new MockEpiVerificationService();
  }
  return cachedService;
};

/**
 * Escolhe a implementação conforme o provisionamento. Chame uma vez na
 * subida do app, antes da primeira verificação.
 */
export const resolveEpiVerificationService =
  async (): Promise<EpiVerificationService> => {
    const provisionado = await isFaceApiConfigured();
    cachedService = provisionado
      ? new ServidorEpiVerificationService()
      : new MockEpiVerificationService();
    return cachedService;
  };

/** Permite substituir a implementação em testes. */
export const setEpiVerificationService = (service: EpiVerificationService | null): void => {
  cachedService = service;
};
