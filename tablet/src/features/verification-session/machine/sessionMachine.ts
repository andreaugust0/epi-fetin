import type { EpiId } from '@/features/epi-detection/types';
import { toDetectedEpi } from '@/features/epi-detection/utils/buildDetectionResult';

import type { AnySessionEvent, SessionSnapshot, SessionState } from '../types';

/** Estados a partir dos quais a sessão ainda pode ser interrompida. */
const CANCELLABLE: readonly SessionState[] = ['face_scanning', 'epi_detecting'];

/** Estados em que a identidade do funcionário já está estabelecida. */
const IDENTIFIED: readonly SessionState[] = [
  'face_recognized',
  'epi_preparation',
  'epi_detecting',
  'approved',
  'rejected',
];

/** Estados a partir dos quais é válido (re)entrar na preparação para EPI. */
const CAN_PREPARE_EPI: readonly SessionState[] = ['face_recognized', 'epi_preparation', 'rejected'];

/** Estados a partir dos quais é válido iniciar o reconhecimento facial. */
const CAN_SCAN_FACE: readonly SessionState[] = ['idle', 'face_unknown', 'error', 'cancelled'];

export const createInitialSnapshot = (): SessionSnapshot => ({
  state: 'idle',
  employee: null,
  faceConfidence: null,
  identificationId: null,
  identificationExpiresAt: null,
  progress: 0,
  items: [],
  currentItem: null,
  detection: null,
  verifiedAt: null,
  error: null,
});

/** Lista inicial de equipamentos, todos aguardando avaliação. */
const buildPendingItems = (requiredItems: EpiId[]) =>
  requiredItems.map((id) => toDetectedEpi({ id, detected: false, confidence: 0 }));

/**
 * Máquina de estados da sessão do terminal.
 *
 * É uma função pura: não depende de React, de rede nem de temporizador, o que
 * permite testar todas as transições isoladamente. Transições inválidas são
 * ignoradas — o snapshot volta inalterado — para que nenhuma tela consiga
 * pular uma etapa do fluxo.
 */
export const sessionReducer = (
  snapshot: SessionSnapshot,
  event: AnySessionEvent,
): SessionSnapshot => {
  switch (event.type) {
    case 'FACE_SCANNING':
      // Uma nova identificação sempre recomeça do zero.
      return CAN_SCAN_FACE.includes(snapshot.state)
        ? { ...createInitialSnapshot(), state: 'face_scanning' }
        : snapshot;

    case 'FACE_RECOGNIZED':
      return snapshot.state === 'face_scanning'
        ? {
            ...snapshot,
            state: 'face_recognized',
            employee: event.employee,
            faceConfidence: event.confidence,
            identificationId: event.identificationId ?? null,
            identificationExpiresAt: event.identificationExpiresAt ?? null,
          }
        : snapshot;

    case 'FACE_UNKNOWN':
      return snapshot.state === 'face_scanning'
        ? {
            ...snapshot,
            state: 'face_unknown',
            employee: null,
            faceConfidence: event.confidence,
          }
        : snapshot;

    case 'EPI_PREPARATION':
      /**
       * Também é o caminho do "verificar novamente": limpa apenas a análise
       * anterior de EPI e preserva o funcionário já identificado, para não
       * repetir o reconhecimento facial.
       */
      return CAN_PREPARE_EPI.includes(snapshot.state)
        ? {
            ...snapshot,
            state: 'epi_preparation',
            progress: 0,
            items: [],
            currentItem: null,
            detection: null,
            verifiedAt: null,
            error: null,
          }
        : snapshot;

    case 'EPI_STARTED':
      return snapshot.state === 'epi_preparation'
        ? {
            ...snapshot,
            state: 'epi_detecting',
            progress: 0,
            items: buildPendingItems(event.requiredItems),
            currentItem: event.requiredItems[0] ?? null,
          }
        : snapshot;

    case 'EPI_PROGRESS':
      return snapshot.state === 'epi_detecting'
        ? {
            ...snapshot,
            progress: event.progress,
            items: event.items,
            currentItem: event.currentItem,
          }
        : snapshot;

    case 'EPI_COMPLETED':
      /**
       * `warning` (tudo presente, porém com confiança baixa) não libera acesso:
       * o terminal só tem dois desfechos, e na dúvida ele reprova.
       */
      return snapshot.state === 'epi_detecting'
        ? {
            ...snapshot,
            state: event.detection.status === 'approved' ? 'approved' : 'rejected',
            progress: 1,
            currentItem: null,
            detection: event.detection,
            verifiedAt: new Date().toISOString(),
            items: [...event.detection.detectedItems, ...event.detection.missingItems],
          }
        : snapshot;

    case 'FAILED':
      return { ...snapshot, state: 'error', error: event.error };

    case 'CANCELLED':
      // Só interrompe o que ainda está em andamento; sessões terminadas ficam.
      return CANCELLABLE.includes(snapshot.state) ? { ...snapshot, state: 'cancelled' } : snapshot;

    case 'RESET':
      return createInitialSnapshot();

    default:
      return snapshot;
  }
};

/** Verdadeiro enquanto alguma etapa está em execução. */
export const isSessionRunning = (state: SessionState): boolean => CANCELLABLE.includes(state);

/** Verdadeiro quando já existe um funcionário identificado na sessão. */
export const hasIdentifiedEmployee = (snapshot: SessionSnapshot): boolean =>
  snapshot.employee !== null && IDENTIFIED.includes(snapshot.state);
