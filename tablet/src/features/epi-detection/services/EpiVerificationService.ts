import type { DetectedEpi, EpiDetectionResult, EpiId } from '../types';

export interface EpiVerificationInput {
  requiredItems: EpiId[];
  signal?: AbortSignal;
  /**
   * Token de uso único devolvido por `POST /api/v1/identificacao`.
   *
   * É o que amarra a verificação à pessoa reconhecida. Sem ele o servidor
   * ainda abre a verificação, mas ela fica sem pessoa vinculada — a
   * passagem não vai para o histórico de ninguém, e o relatório de
   * conformidade perde a linha. O mock ignora este campo.
   */
  identificacaoId?: string | null;
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
