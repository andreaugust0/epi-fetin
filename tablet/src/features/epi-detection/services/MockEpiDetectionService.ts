import { getEpiById } from '@/constants/epiCatalog';
import { AppError } from '@/services/errors';
import { clampUnit, delay } from '@/utils';

import { MOCK_BOUNDING_BOXES } from '../mocks/boundingBoxes';
import { DETECTION_SCENARIOS, type DetectionScenario } from '../mocks/detectionScenarios';
import type { AnalyzeImageInput, EpiDetectionResult, EpiDetectionService } from '../types';
import { buildDetectionResult, type RawDetection } from '../utils/buildDetectionResult';

export interface MockEpiDetectionServiceOptions {
  /** Fonte de aleatoriedade injetável — os testes passam um valor fixo. */
  random?: () => number;
  minDelayMs?: number;
  maxDelayMs?: number;
  /** Força um cenário específico, útil para demonstrações e testes. */
  forcedScenario?: string;
}

const DEFAULT_MIN_DELAY_MS = 900;
const DEFAULT_MAX_DELAY_MS = 1800;

/**
 * Implementação simulada da detecção de EPIs.
 *
 * Nenhum componente de interface gera resultados por conta própria: todo
 * resultado simulado nasce aqui, com o mesmo formato que a API real usará.
 */
export class MockEpiDetectionService implements EpiDetectionService {
  private readonly random: () => number;
  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly forcedScenario: string | undefined;

  constructor(options: MockEpiDetectionServiceOptions = {}) {
    this.random = options.random ?? Math.random;
    this.minDelayMs = options.minDelayMs ?? DEFAULT_MIN_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.forcedScenario = options.forcedScenario;
  }

  async analyzeImage(input: AnalyzeImageInput): Promise<EpiDetectionResult> {
    if (input.requiredItems.length === 0) {
      throw new AppError(
        'invalid_response',
        'Nenhum equipamento está ativo para verificação. Ajuste a configuração no painel administrativo.',
      );
    }

    const startedAt = Date.now();
    await delay(this.pickDelay());

    const scenario = this.pickScenario();
    const detections = input.requiredItems.map((epiId) => this.buildDetection(epiId, scenario));

    return buildDetectionResult({
      requiredItems: input.requiredItems,
      detections,
      engine: 'mock',
      processingTimeMs: Date.now() - startedAt,
    });
  }

  private buildDetection(epiId: RawDetection['id'], scenario: DetectionScenario): RawDetection {
    const baseline = getEpiById(epiId)?.baselineConfidence ?? 0.9;
    const isUndetected = scenario.undetected.includes(epiId);
    const jitter = (this.random() - 0.5) * 0.08;

    if (isUndetected) {
      return {
        id: epiId,
        detected: false,
        confidence: clampUnit(baseline * 0.35 + jitter),
      };
    }

    return {
      id: epiId,
      detected: true,
      confidence: clampUnit(baseline * scenario.confidenceFactor + jitter),
      boundingBox: MOCK_BOUNDING_BOXES[epiId],
    };
  }

  private pickScenario(): DetectionScenario {
    if (this.forcedScenario) {
      const forced = DETECTION_SCENARIOS.find((item) => item.name === this.forcedScenario);
      if (forced) {
        return forced;
      }
    }

    const totalWeight = DETECTION_SCENARIOS.reduce((total, item) => total + item.weight, 0);
    let cursor = this.random() * totalWeight;

    for (const scenario of DETECTION_SCENARIOS) {
      cursor -= scenario.weight;
      if (cursor <= 0) {
        return scenario;
      }
    }

    return DETECTION_SCENARIOS[0] as DetectionScenario;
  }

  private pickDelay(): number {
    return this.minDelayMs + this.random() * Math.max(0, this.maxDelayMs - this.minDelayMs);
  }
}
