import type { FaceRecognitionService } from '../types';

import { MockFaceRecognitionService } from './MockFaceRecognitionService';

let cachedService: FaceRecognitionService | null = null;

/**
 * Único ponto do aplicativo que decide qual reconhecimento facial usar.
 *
 * O reconhecimento roda no próprio tablet, usando a câmera dele. Hoje é
 * simulado; quando o modelo local existir, um `LocalFaceRecognitionService`
 * entra aqui e nenhuma tela precisa mudar.
 */
export const getFaceRecognitionService = (): FaceRecognitionService => {
  if (!cachedService) {
    cachedService = new MockFaceRecognitionService();
  }
  return cachedService;
};

/** Permite substituir a implementação em testes. */
export const setFaceRecognitionService = (service: FaceRecognitionService | null): void => {
  cachedService = service;
};
