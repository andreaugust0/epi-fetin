import { AppError } from '@/services/errors';

import type { AnalyzeImageInput } from '../../types';
import { mapDetectionResponse } from '../mapDetectionResponse';

const input: AnalyzeImageInput = {
  requiredItems: ['capacete', 'oculos'],
};

describe('mapDetectionResponse', () => {
  it('normaliza confiança recebida em escala 0–100', () => {
    const result = mapDetectionResponse(
      {
        items: [
          { id: 'capacete', detected: true, confidence: 97 },
          { id: 'oculos', detected: true, confidence: 93 },
        ],
      },
      input,
      500,
    );

    expect(result.detectedItems[0]?.confidence).toBeCloseTo(0.97);
    expect(result.detectedItems[1]?.confidence).toBeCloseTo(0.93);
  });

  it('aceita confiança já normalizada entre 0 e 1', () => {
    const result = mapDetectionResponse(
      { items: [{ id: 'capacete', detected: true, confidence: 0.88 }] },
      input,
      500,
    );

    expect(result.detectedItems[0]?.confidence).toBeCloseTo(0.88);
  });

  it('descarta itens com identificador desconhecido', () => {
    const result = mapDetectionResponse(
      {
        items: [
          { id: 'capacete', detected: true, confidence: 0.95 },
          { id: 'capacete-invisivel', detected: true, confidence: 0.99 },
        ],
      },
      input,
      500,
    );

    expect(result.detectedItems.map((item) => item.id)).toEqual(['capacete']);
    expect(result.missingItems.map((item) => item.id)).toEqual(['oculos']);
  });

  it('mantém a caixa delimitadora quando ela é válida', () => {
    const boundingBox = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    const result = mapDetectionResponse(
      { items: [{ id: 'capacete', detected: true, confidence: 0.95, boundingBox }] },
      input,
      500,
    );

    expect(result.detectedItems[0]?.boundingBox).toEqual(boundingBox);
  });

  it('ignora caixas delimitadoras incompletas', () => {
    const result = mapDetectionResponse(
      {
        items: [
          {
            id: 'capacete',
            detected: true,
            confidence: 0.95,
            boundingBox: { x: 0.1, y: 0.2 } as never,
          },
        ],
      },
      input,
      500,
    );

    expect(result.detectedItems[0]?.boundingBox).toBeUndefined();
  });

  it('usa o tempo de processamento local quando a API não informa', () => {
    const result = mapDetectionResponse(
      { items: [{ id: 'capacete', detected: true, confidence: 0.95 }] },
      input,
      742,
    );

    expect(result.processingTimeMs).toBe(742);
    expect(result.engine).toBe('api');
  });

  it('lança AppError quando a resposta não tem o formato esperado', () => {
    expect(() => mapDetectionResponse({ resultado: 'ok' }, input, 100)).toThrow(AppError);
    expect(() => mapDetectionResponse(null, input, 100)).toThrow(AppError);
  });
});
