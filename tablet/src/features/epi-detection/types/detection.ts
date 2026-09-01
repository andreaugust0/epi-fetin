import type { EpiId } from './epi';

export type DetectionStatus = 'approved' | 'warning' | 'rejected';

/** Implementação que produziu o resultado — útil para depuração e para a UI. */
export type DetectionEngine = 'mock' | 'api';

/**
 * Coordenadas normalizadas (0 a 1) em relação às dimensões da imagem, para que
 * o desenho independa da resolução original.
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedEpi {
  id: EpiId;
  label: string;
  description: string;
  /** Confiança normalizada entre 0 e 1. */
  confidence: number;
  detected: boolean;
  boundingBox?: BoundingBox;
}

export interface EpiDetectionResult {
  id: string;
  status: DetectionStatus;
  detectedItems: DetectedEpi[];
  missingItems: DetectedEpi[];
  /** Equipamentos exigidos no momento da análise (configuráveis no admin). */
  requiredItems: EpiId[];
  /** Média das confianças dos itens detectados, entre 0 e 1. */
  overallConfidence: number;
  /** Data/hora em ISO 8601. */
  analyzedAt: string;
  processingTimeMs: number;
  engine: DetectionEngine;
}

export interface AnalyzeImageInput {
  requiredItems: EpiId[];
}

export interface EpiDetectionService {
  analyzeImage(input: AnalyzeImageInput): Promise<EpiDetectionResult>;
}
