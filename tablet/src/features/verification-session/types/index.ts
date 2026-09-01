import type { DetectedEpi, EpiDetectionResult, EpiId } from '@/features/epi-detection/types';
import type { RecognizedEmployee } from '@/features/face-recognition/types';

/**
 * Estados da sessão do terminal.
 *
 * O fluxo tem duas etapas que o funcionário inicia explicitamente: primeiro a
 * identificação facial, depois — já posicionado na marcação do chão — a
 * verificação dos equipamentos.
 */
export type SessionState =
  | 'idle'
  | 'face_scanning'
  | 'face_recognized'
  | 'face_unknown'
  | 'epi_preparation'
  | 'epi_detecting'
  | 'approved'
  | 'rejected'
  | 'error'
  | 'cancelled';

/** Estados em que a identidade do funcionário já está estabelecida. */
export type IdentifiedState = Extract<
  SessionState,
  'face_recognized' | 'epi_preparation' | 'epi_detecting' | 'approved' | 'rejected'
>;

export type SessionEvent =
  | { type: 'FACE_SCANNING' }
  | {
      type: 'FACE_RECOGNIZED';
      employee: RecognizedEmployee;
      confidence: number;
      /**
       * Token de uso único do backend (`POST /api/v1/identificacao`),
       * necessário para abrir a verificação de EPI depois. `null` quando a
       * identificação veio de um caminho sem servidor (ex.: mock).
       */
      identificationId?: string | null;
      /** ISO 8601 — quando `identificationId` deixa de ser válido no backend. */
      identificationExpiresAt?: string | null;
    }
  | { type: 'FACE_UNKNOWN'; confidence: number }
  | { type: 'EPI_PREPARATION' }
  | { type: 'EPI_STARTED'; requiredItems: EpiId[] }
  | { type: 'EPI_PROGRESS'; progress: number; items: DetectedEpi[]; currentItem: EpiId | null }
  | { type: 'EPI_COMPLETED'; detection: EpiDetectionResult };

/** Eventos internos da máquina, que não vêm dos serviços. */
export type SessionControlEvent =
  { type: 'FAILED'; error: unknown } | { type: 'CANCELLED' } | { type: 'RESET' };

export type AnySessionEvent = SessionEvent | SessionControlEvent;

export interface SessionSnapshot {
  state: SessionState;
  employee: RecognizedEmployee | null;
  faceConfidence: number | null;
  /** Token de identificação de uso único do backend — ver `SessionEvent`. */
  identificationId: string | null;
  /** ISO 8601 — validade de `identificationId` no backend. */
  identificationExpiresAt: string | null;
  /** Progresso da detecção de EPIs, entre 0 e 1. */
  progress: number;
  items: DetectedEpi[];
  currentItem: EpiId | null;
  detection: EpiDetectionResult | null;
  verifiedAt: string | null;
  error: unknown;
}
