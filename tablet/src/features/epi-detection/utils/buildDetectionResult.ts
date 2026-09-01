import { DETECTION_THRESHOLDS } from '@/constants/detection';
import { getEpiById } from '@/constants/epiCatalog';
import { clampUnit, createId } from '@/utils';

import type {
  BoundingBox,
  DetectedEpi,
  DetectionEngine,
  EpiDetectionResult,
  EpiId,
} from '../types';

import { resolveDetectionStatus } from './resolveDetectionStatus';

/** Detecção crua, antes de ser enriquecida com os dados do catálogo. */
export interface RawDetection {
  id: EpiId;
  detected: boolean;
  confidence: number;
  boundingBox?: BoundingBox;
}

export interface BuildDetectionResultInput {
  requiredItems: EpiId[];
  detections: RawDetection[];
  engine: DetectionEngine;
  processingTimeMs: number;
  analyzedAt?: string;
  id?: string;
}

/** Enriquece uma detecção crua com rótulo e descrição do catálogo. */
export const toDetectedEpi = (detection: RawDetection): DetectedEpi => {
  const catalogItem = getEpiById(detection.id);

  return {
    id: detection.id,
    label: catalogItem?.label ?? detection.id,
    description: catalogItem?.description ?? '',
    confidence: clampUnit(detection.confidence),
    detected: detection.detected,
    ...(detection.boundingBox ? { boundingBox: detection.boundingBox } : {}),
  };
};

const average = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

/**
 * Ponto único onde uma lista de detecções vira um `EpiDetectionResult`.
 * Tanto o serviço mock quanto o serviço HTTP passam por aqui, garantindo que
 * a regra de status e o formato do resultado sejam sempre os mesmos.
 */
export const buildDetectionResult = ({
  requiredItems,
  detections,
  engine,
  processingTimeMs,
  analyzedAt,
  id,
}: BuildDetectionResultInput): EpiDetectionResult => {
  const detectionById = new Map(detections.map((detection) => [detection.id, detection]));

  const detectedItems: DetectedEpi[] = [];
  const missingItems: DetectedEpi[] = [];

  requiredItems.forEach((requiredId) => {
    const detection = detectionById.get(requiredId);
    const isConfirmed = Boolean(
      detection?.detected &&
      clampUnit(detection.confidence) >= DETECTION_THRESHOLDS.acceptedConfidence,
    );

    const item = toDetectedEpi(detection ?? { id: requiredId, detected: false, confidence: 0 });

    if (isConfirmed) {
      detectedItems.push({ ...item, detected: true });
    } else {
      missingItems.push({ ...item, detected: false });
    }
  });

  const overallConfidence = average(detectedItems.map((item) => item.confidence));

  return {
    id: id ?? createId(),
    status: resolveDetectionStatus({
      detectedItems,
      missingItems,
      requiredCount: requiredItems.length,
      overallConfidence,
    }),
    detectedItems,
    missingItems,
    requiredItems: [...requiredItems],
    overallConfidence,
    analyzedAt: analyzedAt ?? new Date().toISOString(),
    processingTimeMs: Math.max(0, Math.round(processingTimeMs)),
    engine,
  };
};
