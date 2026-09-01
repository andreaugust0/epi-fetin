import { clampUnit, delay } from '@/utils';

import { MOCK_EMPLOYEES } from '../mocks/employees';
import type { FaceRecognitionInput, FaceRecognitionResult, FaceRecognitionService } from '../types';

export interface MockFaceRecognitionServiceOptions {
  /** Fonte de aleatoriedade injetável — os testes passam um valor fixo. */
  random?: () => number;
  /** Tempo simulado de captura e comparação do rosto. */
  durationMs?: number;
  /** Probabilidade de a pessoa não ser reconhecida, entre 0 e 1. */
  unknownRate?: number;
  /** Força um resultado específico, para demonstração e testes. */
  forcedOutcome?: 'recognized' | 'unknown';
}

const DEFAULT_DURATION_MS = 1400;
const DEFAULT_UNKNOWN_RATE = 0.15;
const BASE_CONFIDENCE = 0.95;

/**
 * Reconhecimento facial simulado.
 *
 * Nenhum componente de interface inventa a pessoa reconhecida: ela nasce aqui,
 * no mesmo formato que o dispositivo embarcado devolverá.
 */
export class MockFaceRecognitionService implements FaceRecognitionService {
  private readonly random: () => number;
  private readonly durationMs: number;
  private readonly unknownRate: number;
  private readonly forcedOutcome: 'recognized' | 'unknown' | undefined;

  constructor(options: MockFaceRecognitionServiceOptions = {}) {
    this.random = options.random ?? Math.random;
    this.durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
    this.unknownRate = options.unknownRate ?? DEFAULT_UNKNOWN_RATE;
    this.forcedOutcome = options.forcedOutcome;
  }

  async recognize(input: FaceRecognitionInput): Promise<FaceRecognitionResult> {
    await delay(this.durationMs, input.signal);

    if (this.isUnknown()) {
      // Confiança baixa é justamente o motivo de não reconhecer.
      return { status: 'unknown', confidence: clampUnit(this.random() * 0.4) };
    }

    const index = Math.floor(this.random() * MOCK_EMPLOYEES.length);
    const employee = MOCK_EMPLOYEES[index] ?? MOCK_EMPLOYEES[0];

    if (!employee) {
      return { status: 'unknown', confidence: 0 };
    }

    const jitter = (this.random() - 0.5) * 0.06;

    return {
      status: 'recognized',
      employee,
      confidence: clampUnit(BASE_CONFIDENCE + jitter),
    };
  }

  private isUnknown(): boolean {
    if (this.forcedOutcome) {
      return this.forcedOutcome === 'unknown';
    }
    return this.random() < this.unknownRate;
  }
}
