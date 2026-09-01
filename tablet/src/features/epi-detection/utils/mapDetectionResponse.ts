import { AppError } from '@/services/errors';
import { normalizeConfidence } from '@/utils';

import type {
  AnalyzeImageInput,
  ApiDetectionResponseDto,
  BoundingBox,
  EpiDetectionResult,
} from '../types';
import { isEpiId } from '../types';

import { buildDetectionResult, type RawDetection } from './buildDetectionResult';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const toBoundingBox = (value: unknown): BoundingBox | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const candidate = value as Partial<BoundingBox>;
  const { x, y, width, height } = candidate;

  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height)
  ) {
    return undefined;
  }

  return { x, y, width, height };
};

const isResponseShape = (value: unknown): value is ApiDetectionResponseDto =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { items?: unknown }).items);

/**
 * Converte a resposta da API no modelo de domínio, descartando itens
 * desconhecidos e normalizando a confiança (aceita 0–1 ou 0–100).
 */
export const mapDetectionResponse = (
  payload: unknown,
  input: AnalyzeImageInput,
  fallbackProcessingTimeMs: number,
): EpiDetectionResult => {
  if (!isResponseShape(payload)) {
    throw new AppError('invalid_response', 'A resposta da análise está em formato inesperado.');
  }

  const detections: RawDetection[] = payload.items.flatMap((item) => {
    if (typeof item?.id !== 'string' || !isEpiId(item.id)) {
      return [];
    }

    return [
      {
        id: item.id,
        detected: Boolean(item.detected),
        confidence: normalizeConfidence(item.confidence),
        ...(toBoundingBox(item.boundingBox)
          ? { boundingBox: toBoundingBox(item.boundingBox) as BoundingBox }
          : {}),
      },
    ];
  });

  return buildDetectionResult({
    requiredItems: input.requiredItems,
    detections,
    engine: 'api',
    processingTimeMs: isFiniteNumber(payload.processingTimeMs)
      ? payload.processingTimeMs
      : fallbackProcessingTimeMs,
    ...(typeof payload.analyzedAt === 'string' ? { analyzedAt: payload.analyzedAt } : {}),
    ...(typeof payload.id === 'string' ? { id: payload.id } : {}),
  });
};
