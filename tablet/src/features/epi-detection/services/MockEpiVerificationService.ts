import { AppError } from '@/services/errors';
import { delay } from '@/utils';

import { buildScenarioDetection, pickScenario } from '../mocks/detectionScenarios';
import type { DetectedEpi, EpiDetectionResult, EpiId } from '../types';
import {
  buildDetectionResult,
  toDetectedEpi,
  type RawDetection,
} from '../utils/buildDetectionResult';

import type {
  EpiVerificationEventListener,
  EpiVerificationInput,
  EpiVerificationService,
} from './EpiVerificationService';

export interface MockEpiVerificationServiceOptions {
  /** Fonte de aleatoriedade injetável — os testes passam um valor fixo. */
  random?: () => number;
  /** Tempo gasto avaliando cada equipamento. */
  stepMs?: number;
  /** Força um cenário de EPI específico, para demonstração e testes. */
  forcedScenario?: string;
}

const DEFAULT_STEP_MS = 550;

/**
 * Verificação de EPIs simulada, um equipamento por vez.
 *
 * Extraída do antigo serviço combinado de sessão: agora cuida só da parte de
 * EPI, já que o reconhecimento facial passou a ser uma etapa própria,
 * conduzida antes desta e em outra tela.
 */
export class MockEpiVerificationService implements EpiVerificationService {
  private readonly random: () => number;
  private readonly stepMs: number;
  private readonly forcedScenario: string | undefined;

  constructor(options: MockEpiVerificationServiceOptions = {}) {
    this.random = options.random ?? Math.random;
    this.stepMs = options.stepMs ?? DEFAULT_STEP_MS;
    this.forcedScenario = options.forcedScenario;
  }

  async run(
    input: EpiVerificationInput,
    onEvent: EpiVerificationEventListener,
  ): Promise<EpiDetectionResult> {
    const { requiredItems, signal } = input;

    if (requiredItems.length === 0) {
      throw new AppError(
        'invalid_response',
        'Nenhum equipamento está ativo para verificação. Ajuste a configuração no painel administrativo.',
      );
    }

    const startedAt = Date.now();
    const scenario = pickScenario(this.random, this.forcedScenario);

    const detections: RawDetection[] = [];
    const items: DetectedEpi[] = requiredItems.map((id) =>
      toDetectedEpi({ id, detected: false, confidence: 0 }),
    );

    onEvent({
      type: 'EPI_PROGRESS',
      progress: 0,
      items: [...items],
      currentItem: requiredItems[0] ?? null,
    });

    for (const [index, epiId] of requiredItems.entries()) {
      await delay(this.stepMs, signal);

      const detection = buildScenarioDetection(epiId as EpiId, scenario, this.random);
      detections.push(detection);
      items[index] = toDetectedEpi(detection);

      onEvent({
        type: 'EPI_PROGRESS',
        progress: (index + 1) / requiredItems.length,
        items: [...items],
        currentItem: requiredItems[index + 1] ?? null,
      });
    }

    return buildDetectionResult({
      requiredItems,
      detections,
      engine: 'mock',
      processingTimeMs: Date.now() - startedAt,
    });
  }
}
