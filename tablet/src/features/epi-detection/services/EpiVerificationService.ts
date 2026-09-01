import type { DetectedEpi, EpiDetectionResult, EpiId } from '../types';

export interface EpiVerificationInput {
  requiredItems: EpiId[];
  signal?: AbortSignal;
}

/** Progresso emitido a cada equipamento avaliado. */
export type EpiVerificationEvent = {
  type: 'EPI_PROGRESS';
  progress: number;
  items: DetectedEpi[];
  currentItem: EpiId | null;
};

export type EpiVerificationEventListener = (event: EpiVerificationEvent) => void;

/**
 * Contrato da verificação de EPIs.
 *
 * Avalia os equipamentos exigidos e devolve o resultado final, emitindo
 * progresso pelo caminho. É o ponto que o dispositivo embarcado (ou a IA
 * local do próprio tablet, na arquitetura atual) vai implementar no lugar do
 * mock — nenhuma tela precisa mudar quando isso acontecer.
 */
export interface EpiVerificationService {
  run(
    input: EpiVerificationInput,
    onEvent: EpiVerificationEventListener,
  ): Promise<EpiDetectionResult>;
}
