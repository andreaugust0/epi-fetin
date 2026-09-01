/**
 * Contrato esperado da futura API de visão computacional.
 * Mantido separado do domínio para que uma mudança no formato da resposta
 * afete apenas o mapeador (`utils/mapDetectionResponse.ts`).
 */
export interface ApiBoundingBoxDto {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ApiDetectionItemDto {
  /** Identificador do equipamento, ex.: "capacete". */
  id: string;
  detected: boolean;
  /** Aceita 0–1 ou 0–100; o mapeador normaliza. */
  confidence: number;
  label?: string;
  boundingBox?: ApiBoundingBoxDto;
}

export interface ApiDetectionResponseDto {
  id?: string;
  items: ApiDetectionItemDto[];
  processingTimeMs?: number;
  analyzedAt?: string;
}
