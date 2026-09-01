import type { EpiDetectionResult, EpiId } from '@/features/epi-detection/types';
import { buildDetectionResult } from '@/features/epi-detection/utils/buildDetectionResult';
import type { RecognizedEmployee } from '@/features/face-recognition/types';

import type { AnySessionEvent, SessionSnapshot } from '../../types';
import {
  createInitialSnapshot,
  hasIdentifiedEmployee,
  isSessionRunning,
  sessionReducer,
} from '../sessionMachine';

const REQUIRED: EpiId[] = ['capacete', 'colete'];

const EMPLOYEE: RecognizedEmployee = {
  id: 'employee-001',
  nome: 'Caio de Castro Yarouhas',
  email: 'caio@empresa.com',
  matricula: '001',
  setor: 'Segurança',
};

/** Resultado de EPI com todos os equipamentos detectados ou não. */
const makeDetection = (allDetected: boolean): EpiDetectionResult =>
  buildDetectionResult({
    requiredItems: REQUIRED,
    detections: REQUIRED.map((id) => ({
      id,
      detected: allDetected,
      confidence: allDetected ? 0.95 : 0.2,
    })),
    engine: 'mock',
    processingTimeMs: 1000,
  });

/** Aplica uma sequência de eventos a partir do estado inicial. */
const run = (...events: AnySessionEvent[]): SessionSnapshot =>
  events.reduce(sessionReducer, createInitialSnapshot());

/** Caminho até um funcionário identificado, pronto para a preparação. */
const IDENTIFY: AnySessionEvent[] = [
  { type: 'FACE_SCANNING' },
  { type: 'FACE_RECOGNIZED', employee: EMPLOYEE, confidence: 0.94 },
];

/** Caminho até uma reprovação de EPI. */
const REJECT: AnySessionEvent[] = [
  ...IDENTIFY,
  { type: 'EPI_PREPARATION' },
  { type: 'EPI_STARTED', requiredItems: REQUIRED },
  { type: 'EPI_COMPLETED', detection: makeDetection(false) },
];

describe('sessionMachine — transições válidas', () => {
  it('começa em idle, sem funcionário nem resultado', () => {
    const snapshot = createInitialSnapshot();

    expect(snapshot.state).toBe('idle');
    expect(snapshot.employee).toBeNull();
    expect(snapshot.detection).toBeNull();
    expect(snapshot.progress).toBe(0);
  });

  it('FACE_SCANNING inicia a identificação a partir de idle', () => {
    expect(run({ type: 'FACE_SCANNING' }).state).toBe('face_scanning');
  });

  it('FACE_RECOGNIZED guarda o funcionário e a confiança', () => {
    const snapshot = run(...IDENTIFY);

    expect(snapshot.state).toBe('face_recognized');
    expect(snapshot.employee).toEqual(EMPLOYEE);
    expect(snapshot.faceConfidence).toBeCloseTo(0.94);
  });

  it('FACE_RECOGNIZED guarda identificationId/identificationExpiresAt do backend', () => {
    const snapshot = run(
      { type: 'FACE_SCANNING' },
      {
        type: 'FACE_RECOGNIZED',
        employee: EMPLOYEE,
        confidence: 0.94,
        identificationId: 'ident-abc-123',
        identificationExpiresAt: '2026-01-01T00:01:00Z',
      },
    );

    expect(snapshot.identificationId).toBe('ident-abc-123');
    expect(snapshot.identificationExpiresAt).toBe('2026-01-01T00:01:00Z');
  });

  it('FACE_RECOGNIZED sem identificationId/expiresAt mantém os campos null', () => {
    // Compatibilidade com uma origem que identifica sem token de servidor
    // (ex.: um caminho local/mock) — o campo é opcional no evento.
    const snapshot = run(...IDENTIFY);

    expect(snapshot.identificationId).toBeNull();
    expect(snapshot.identificationExpiresAt).toBeNull();
  });

  it('uma sessão reiniciada (RESET) não herda identificationId/expiresAt da tentativa anterior', () => {
    const primeira = run(
      { type: 'FACE_SCANNING' },
      {
        type: 'FACE_RECOGNIZED',
        employee: EMPLOYEE,
        confidence: 0.94,
        identificationId: 'ident-abc-123',
        identificationExpiresAt: '2026-01-01T00:01:00Z',
      },
    );

    const reiniciada = [{ type: 'RESET' } as const, { type: 'FACE_SCANNING' } as const].reduce(
      sessionReducer,
      primeira,
    );

    expect(reiniciada.identificationId).toBeNull();
    expect(reiniciada.identificationExpiresAt).toBeNull();
  });

  it('FACE_UNKNOWN mantém a sessão sem funcionário', () => {
    const snapshot = run({ type: 'FACE_SCANNING' }, { type: 'FACE_UNKNOWN', confidence: 0.3 });

    expect(snapshot.state).toBe('face_unknown');
    expect(snapshot.employee).toBeNull();
  });

  it('permite tentar novamente após não reconhecer', () => {
    const snapshot = run(
      { type: 'FACE_SCANNING' },
      { type: 'FACE_UNKNOWN', confidence: 0.3 },
      { type: 'FACE_SCANNING' },
    );

    expect(snapshot.state).toBe('face_scanning');
  });

  it('EPI_PREPARATION só é alcançada com funcionário identificado', () => {
    const snapshot = run(...IDENTIFY, { type: 'EPI_PREPARATION' });

    expect(snapshot.state).toBe('epi_preparation');
    expect(snapshot.employee).toEqual(EMPLOYEE);
  });

  it('EPI_STARTED prepara os equipamentos exigidos', () => {
    const snapshot = run(
      ...IDENTIFY,
      { type: 'EPI_PREPARATION' },
      {
        type: 'EPI_STARTED',
        requiredItems: REQUIRED,
      },
    );

    expect(snapshot.state).toBe('epi_detecting');
    expect(snapshot.items.map((item) => item.id)).toEqual(REQUIRED);
    expect(snapshot.items.every((item) => !item.detected)).toBe(true);
    expect(snapshot.currentItem).toBe('capacete');
  });

  it('EPI_PROGRESS atualiza progresso e equipamento corrente', () => {
    const snapshot = run(
      ...IDENTIFY,
      { type: 'EPI_PREPARATION' },
      { type: 'EPI_STARTED', requiredItems: REQUIRED },
      { type: 'EPI_PROGRESS', progress: 0.5, items: [], currentItem: 'colete' },
    );

    expect(snapshot.progress).toBeCloseTo(0.5);
    expect(snapshot.currentItem).toBe('colete');
  });

  it('EPI_COMPLETED aprova quando todos os equipamentos são detectados', () => {
    const detection = makeDetection(true);
    const snapshot = run(
      ...IDENTIFY,
      { type: 'EPI_PREPARATION' },
      { type: 'EPI_STARTED', requiredItems: REQUIRED },
      { type: 'EPI_COMPLETED', detection },
    );

    expect(snapshot.state).toBe('approved');
    expect(snapshot.progress).toBe(1);
    expect(snapshot.currentItem).toBeNull();
    expect(snapshot.detection).toEqual(detection);
    expect(snapshot.verifiedAt).not.toBeNull();
  });

  it('EPI_COMPLETED reprova quando falta equipamento', () => {
    expect(run(...REJECT).state).toBe('rejected');
  });

  it('o resultado cobre todos os equipamentos exigidos', () => {
    const snapshot = run(...REJECT);

    expect(snapshot.items).toHaveLength(REQUIRED.length);
  });

  it('FAILED registra o erro', () => {
    const error = new Error('falha');
    const snapshot = run({ type: 'FACE_SCANNING' }, { type: 'FAILED', error });

    expect(snapshot.state).toBe('error');
    expect(snapshot.error).toBe(error);
  });

  it('CANCELLED interrompe uma etapa em andamento', () => {
    expect(run({ type: 'FACE_SCANNING' }, { type: 'CANCELLED' }).state).toBe('cancelled');
  });

  it('RESET limpa funcionário, progresso e resultado', () => {
    const snapshot = run(...REJECT, { type: 'RESET' });

    expect(snapshot).toEqual(createInitialSnapshot());
    expect(snapshot.employee).toBeNull();
    expect(snapshot.detection).toBeNull();
  });
});

describe('sessionMachine — nova tentativa de EPI', () => {
  it('reprovado volta para a preparação preservando o funcionário', () => {
    const snapshot = run(...REJECT, { type: 'EPI_PREPARATION' });

    expect(snapshot.state).toBe('epi_preparation');
    expect(snapshot.employee).toEqual(EMPLOYEE);
    expect(snapshot.faceConfidence).toBeCloseTo(0.94);
  });

  it('a nova tentativa limpa a análise anterior de EPI', () => {
    const snapshot = run(...REJECT, { type: 'EPI_PREPARATION' });

    expect(snapshot.detection).toBeNull();
    expect(snapshot.items).toEqual([]);
    expect(snapshot.progress).toBe(0);
    expect(snapshot.currentItem).toBeNull();
    expect(snapshot.verifiedAt).toBeNull();
  });

  it('a nova tentativa não passa por reconhecimento facial', () => {
    const snapshot = run(
      ...REJECT,
      { type: 'EPI_PREPARATION' },
      { type: 'EPI_STARTED', requiredItems: REQUIRED },
    );

    expect(snapshot.state).toBe('epi_detecting');
    expect(snapshot.employee).toEqual(EMPLOYEE);
  });
});

describe('sessionMachine — transições inválidas', () => {
  it('não prepara EPI sem funcionário identificado', () => {
    expect(run({ type: 'EPI_PREPARATION' }).state).toBe('idle');
  });

  it('não prepara EPI quando o rosto não foi reconhecido', () => {
    const snapshot = run(
      { type: 'FACE_SCANNING' },
      { type: 'FACE_UNKNOWN', confidence: 0.3 },
      { type: 'EPI_PREPARATION' },
    );

    expect(snapshot.state).toBe('face_unknown');
  });

  it('não inicia EPI sem passar pela preparação', () => {
    const snapshot = run(...IDENTIFY, { type: 'EPI_STARTED', requiredItems: REQUIRED });

    expect(snapshot.state).toBe('face_recognized');
    expect(snapshot.items).toEqual([]);
  });

  it('não reconhece rosto no meio da detecção de EPI', () => {
    const snapshot = run(
      ...IDENTIFY,
      { type: 'EPI_PREPARATION' },
      { type: 'EPI_STARTED', requiredItems: REQUIRED },
      { type: 'FACE_SCANNING' },
    );

    expect(snapshot.state).toBe('epi_detecting');
    expect(snapshot.employee).toEqual(EMPLOYEE);
  });

  it('não aceita progresso de EPI fora da detecção', () => {
    const snapshot = run(...IDENTIFY, {
      type: 'EPI_PROGRESS',
      progress: 0.9,
      items: [],
      currentItem: null,
    });

    expect(snapshot.progress).toBe(0);
  });

  it('não conclui EPI sem ter iniciado', () => {
    const snapshot = run(...IDENTIFY, { type: 'EPI_COMPLETED', detection: makeDetection(true) });

    expect(snapshot.state).toBe('face_recognized');
    expect(snapshot.detection).toBeNull();
  });

  it('não altera um resultado já concluído com CANCELLED', () => {
    expect(run(...REJECT, { type: 'CANCELLED' }).state).toBe('rejected');
  });

  it('não identifica um novo rosto sobre uma sessão aprovada', () => {
    const snapshot = run(
      ...IDENTIFY,
      { type: 'EPI_PREPARATION' },
      { type: 'EPI_STARTED', requiredItems: REQUIRED },
      { type: 'EPI_COMPLETED', detection: makeDetection(true) },
      { type: 'FACE_SCANNING' },
    );

    expect(snapshot.state).toBe('approved');
  });
});

describe('sessionMachine — auxiliares', () => {
  it('isSessionRunning distingue etapas ativas de terminais', () => {
    expect(isSessionRunning('face_scanning')).toBe(true);
    expect(isSessionRunning('epi_detecting')).toBe(true);
    expect(isSessionRunning('epi_preparation')).toBe(false);
    expect(isSessionRunning('approved')).toBe(false);
    expect(isSessionRunning('rejected')).toBe(false);
    expect(isSessionRunning('idle')).toBe(false);
  });

  it('hasIdentifiedEmployee cobre todo o trecho pós-identificação', () => {
    expect(hasIdentifiedEmployee(createInitialSnapshot())).toBe(false);
    expect(hasIdentifiedEmployee(run(...IDENTIFY))).toBe(true);
    expect(hasIdentifiedEmployee(run(...IDENTIFY, { type: 'EPI_PREPARATION' }))).toBe(true);
    expect(hasIdentifiedEmployee(run(...REJECT))).toBe(true);
    expect(
      hasIdentifiedEmployee(
        run({ type: 'FACE_SCANNING' }, { type: 'FACE_UNKNOWN', confidence: 0.2 }),
      ),
    ).toBe(false);
  });
});
