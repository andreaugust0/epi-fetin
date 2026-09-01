/**
 * Limiares de decisão da verificação. Centralizados para que o ajuste do
 * critério não exija alterar telas nem serviços.
 */
export const DETECTION_THRESHOLDS = {
  /** Abaixo disso, uma detecção é considerada pouco confiável. */
  lowConfidence: 0.7,
  /** Confiança mínima para que um item detectado conte como conforme. */
  acceptedConfidence: 0.6,
} as const;

/** Chaves de armazenamento local. Prefixadas para evitar colisões. */
export const STORAGE_KEYS = {
  requiredEpis: '@epi-fetin/required-epis',
} as const;
