import { env } from '@/services/env';

import type { EpiDetectionService } from '../types';

import { ApiEpiDetectionService } from './ApiEpiDetectionService';
import { MockEpiDetectionService } from './MockEpiDetectionService';

let cachedService: EpiDetectionService | null = null;

/**
 * Único ponto do app que decide qual implementação usar.
 * Basta preencher `EXPO_PUBLIC_EPI_API_URL` para migrar do mock para a API,
 * sem tocar em telas, hooks ou componentes.
 */
export const getEpiDetectionService = (): EpiDetectionService => {
  if (cachedService) {
    return cachedService;
  }

  cachedService = env.epiApiUrl
    ? new ApiEpiDetectionService({
        baseUrl: env.epiApiUrl,
        timeoutMs: env.epiApiTimeoutMs,
      })
    : new MockEpiDetectionService();

  return cachedService;
};
