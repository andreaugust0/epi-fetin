import { getEpiById } from '@/constants/epiCatalog';
import { clampUnit } from '@/utils';

import type { EpiId } from '../types';
import type { RawDetection } from '../utils/buildDetectionResult';

import { MOCK_BOUNDING_BOXES } from './boundingBoxes';

/**
 * Cenários usados pelo serviço simulado. Cada um representa uma situação real
 * de inspeção e permite exercitar os três status possíveis sem uma API.
 */
export interface DetectionScenario {
  name: string;
  /** Peso relativo no sorteio (quanto maior, mais frequente). */
  weight: number;
  /** Equipamentos que o cenário deixa de reconhecer. */
  undetected: readonly EpiId[];
  /** Multiplicador aplicado à confiança-base do catálogo. */
  confidenceFactor: number;
}

/**
 * Os pesos refletem a realidade de um terminal de entrada: a maioria das
 * pessoas chega com todos os equipamentos. Com esta distribuição, cerca de
 * 60% das verificações liberam o acesso, 20% pedem atenção e 20% reprovam.
 */
export const DETECTION_SCENARIOS: readonly DetectionScenario[] = [
  {
    name: 'conformidade-total',
    weight: 12,
    undetected: [],
    confidenceFactor: 1,
  },
  {
    name: 'falta-oculos',
    weight: 3,
    undetected: ['oculos'],
    confidenceFactor: 0.96,
  },
  {
    name: 'falta-luvas-e-mascara',
    weight: 2,
    undetected: ['luvas', 'mascara'],
    confidenceFactor: 0.94,
  },
  {
    name: 'confianca-baixa',
    weight: 1,
    undetected: [],
    confidenceFactor: 0.7,
  },
  {
    name: 'sem-capacete-e-colete',
    weight: 1,
    undetected: ['capacete', 'colete'],
    confidenceFactor: 0.92,
  },
  {
    name: 'nada-reconhecido',
    weight: 1,
    undetected: ['capacete', 'colete', 'oculos', 'botas', 'auricular', 'mascara', 'luvas'],
    confidenceFactor: 0.4,
  },
] as const;

/** Sorteia um cenário respeitando os pesos. */
export const pickScenario = (random: () => number, forcedScenario?: string): DetectionScenario => {
  if (forcedScenario) {
    const forced = DETECTION_SCENARIOS.find((item) => item.name === forcedScenario);
    if (forced) {
      return forced;
    }
  }

  const totalWeight = DETECTION_SCENARIOS.reduce((total, item) => total + item.weight, 0);
  let cursor = random() * totalWeight;

  for (const scenario of DETECTION_SCENARIOS) {
    cursor -= scenario.weight;
    if (cursor <= 0) {
      return scenario;
    }
  }

  return DETECTION_SCENARIOS[0] as DetectionScenario;
};

/**
 * Produz a detecção simulada de um único equipamento dentro de um cenário.
 * Compartilhada entre o serviço de análise e a sessão progressiva, para que
 * ambos gerem números coerentes.
 */
export const buildScenarioDetection = (
  epiId: EpiId,
  scenario: DetectionScenario,
  random: () => number,
): RawDetection => {
  const baseline = getEpiById(epiId)?.baselineConfidence ?? 0.9;
  const jitter = (random() - 0.5) * 0.08;

  if (scenario.undetected.includes(epiId)) {
    return { id: epiId, detected: false, confidence: clampUnit(baseline * 0.35 + jitter) };
  }

  return {
    id: epiId,
    detected: true,
    confidence: clampUnit(baseline * scenario.confidenceFactor + jitter),
    boundingBox: MOCK_BOUNDING_BOXES[epiId],
  };
};
