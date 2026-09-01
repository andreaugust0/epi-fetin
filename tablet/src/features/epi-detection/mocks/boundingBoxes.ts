import type { BoundingBox, EpiId } from '../types';

/**
 * Regiões aproximadas do corpo em coordenadas normalizadas (0–1).
 * Servem para demonstrar a sobreposição de caixas enquanto não há um modelo
 * real; a API futura devolverá as coordenadas verdadeiras.
 */
export const MOCK_BOUNDING_BOXES: Record<EpiId, BoundingBox> = {
  capacete: { x: 0.38, y: 0.06, width: 0.24, height: 0.12 },
  oculos: { x: 0.4, y: 0.16, width: 0.2, height: 0.06 },
  mascara: { x: 0.41, y: 0.21, width: 0.18, height: 0.08 },
  auricular: { x: 0.35, y: 0.14, width: 0.3, height: 0.08 },
  colete: { x: 0.31, y: 0.3, width: 0.38, height: 0.26 },
  luvas: { x: 0.22, y: 0.52, width: 0.56, height: 0.1 },
  botas: { x: 0.34, y: 0.84, width: 0.32, height: 0.12 },
};
