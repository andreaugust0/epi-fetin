import type { EpiVerificationService } from './EpiVerificationService';
import { MockEpiVerificationService } from './MockEpiVerificationService';

let cachedService: EpiVerificationService | null = null;

/**
 * Único ponto do aplicativo que decide qual verificação de EPI usar.
 * A IA real entra aqui; nenhuma tela precisa mudar.
 */
export const getEpiVerificationService = (): EpiVerificationService => {
  if (!cachedService) {
    cachedService = new MockEpiVerificationService();
  }
  return cachedService;
};

/** Permite substituir a implementação em testes. */
export const setEpiVerificationService = (service: EpiVerificationService | null): void => {
  cachedService = service;
};
