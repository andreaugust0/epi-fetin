import { buildDetectionResult } from '../buildDetectionResult';

describe('buildDetectionResult', () => {
  const baseInput = {
    engine: 'mock' as const,
    processingTimeMs: 1200,
  };

  it('enriquece as detecções com os dados do catálogo', () => {
    const result = buildDetectionResult({
      ...baseInput,
      requiredItems: ['capacete'],
      detections: [{ id: 'capacete', detected: true, confidence: 0.97 }],
    });

    expect(result.detectedItems).toHaveLength(1);
    expect(result.detectedItems[0]).toMatchObject({
      id: 'capacete',
      label: 'Capacete',
      description: 'Proteção da cabeça',
      detected: true,
    });
  });

  it('separa detectados de ausentes conforme os itens exigidos', () => {
    const result = buildDetectionResult({
      ...baseInput,
      requiredItems: ['capacete', 'oculos', 'luvas'],
      detections: [
        { id: 'capacete', detected: true, confidence: 0.95 },
        { id: 'oculos', detected: false, confidence: 0.3 },
      ],
    });

    expect(result.detectedItems.map((item) => item.id)).toEqual(['capacete']);
    expect(result.missingItems.map((item) => item.id)).toEqual(['oculos', 'luvas']);
  });

  it('trata como ausente uma detecção abaixo da confiança mínima', () => {
    const result = buildDetectionResult({
      ...baseInput,
      requiredItems: ['capacete'],
      detections: [{ id: 'capacete', detected: true, confidence: 0.4 }],
    });

    expect(result.detectedItems).toHaveLength(0);
    expect(result.missingItems.map((item) => item.id)).toEqual(['capacete']);
  });

  it('ignora detecções de itens que não são exigidos', () => {
    const result = buildDetectionResult({
      ...baseInput,
      requiredItems: ['capacete'],
      detections: [
        { id: 'capacete', detected: true, confidence: 0.95 },
        { id: 'botas', detected: true, confidence: 0.9 },
      ],
    });

    expect(result.detectedItems).toHaveLength(1);
    expect(result.missingItems).toHaveLength(0);
  });

  it('calcula a confiança geral como média dos itens detectados', () => {
    const result = buildDetectionResult({
      ...baseInput,
      requiredItems: ['capacete', 'colete'],
      detections: [
        { id: 'capacete', detected: true, confidence: 1 },
        { id: 'colete', detected: true, confidence: 0.8 },
      ],
    });

    expect(result.overallConfidence).toBeCloseTo(0.9);
  });

  it('preserva o identificador e a data quando informados', () => {
    const analyzedAt = '2026-08-03T12:00:00.000Z';
    const result = buildDetectionResult({
      ...baseInput,
      id: 'analise-1',
      analyzedAt,
      requiredItems: ['capacete'],
      detections: [{ id: 'capacete', detected: true, confidence: 0.95 }],
    });

    expect(result.id).toBe('analise-1');
    expect(result.analyzedAt).toBe(analyzedAt);
    expect(result.requiredItems).toEqual(['capacete']);
    expect(result.engine).toBe('mock');
    expect(result.engine).toBe('mock');
  });
});
