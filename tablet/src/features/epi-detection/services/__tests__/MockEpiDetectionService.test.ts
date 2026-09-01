import { DEFAULT_REQUIRED_EPI_IDS } from '@/constants/epiCatalog';
import { AppError } from '@/services/errors';

import type { AnalyzeImageInput } from '../../types';
import { MockEpiDetectionService } from '../MockEpiDetectionService';

const baseInput: AnalyzeImageInput = {
  requiredItems: [...DEFAULT_REQUIRED_EPI_IDS],
};

const createService = (forcedScenario: string) =>
  new MockEpiDetectionService({
    random: () => 0.5,
    minDelayMs: 0,
    maxDelayMs: 0,
    forcedScenario,
  });

describe('MockEpiDetectionService', () => {
  it('produz resultado aprovado no cenário de conformidade total', async () => {
    const result = await createService('conformidade-total').analyzeImage(baseInput);

    expect(result.status).toBe('approved');
    expect(result.missingItems).toHaveLength(0);
    expect(result.detectedItems).toHaveLength(baseInput.requiredItems.length);
    expect(result.engine).toBe('mock');
  });

  it('produz resultado de atenção quando falta apenas um equipamento', async () => {
    const result = await createService('falta-oculos').analyzeImage(baseInput);

    expect(result.status).toBe('warning');
    expect(result.missingItems.map((item) => item.id)).toEqual(['oculos']);
  });

  it('produz resultado de atenção quando a confiança é baixa', async () => {
    const result = await createService('confianca-baixa').analyzeImage(baseInput);

    expect(result.status).toBe('warning');
    expect(result.missingItems).toHaveLength(0);
    expect(result.overallConfidence).toBeLessThan(0.7);
  });

  it('produz resultado reprovado quando vários equipamentos faltam', async () => {
    const result = await createService('falta-luvas-e-mascara').analyzeImage(baseInput);

    expect(result.status).toBe('rejected');
    expect(result.missingItems.map((item) => item.id).sort()).toEqual(['luvas', 'mascara']);
  });

  it('produz resultado reprovado quando nada é reconhecido', async () => {
    const result = await createService('nada-reconhecido').analyzeImage(baseInput);

    expect(result.status).toBe('rejected');
    expect(result.detectedItems).toHaveLength(0);
  });

  it('respeita a lista de equipamentos exigidos', async () => {
    const result = await createService('conformidade-total').analyzeImage({
      ...baseInput,
      requiredItems: ['capacete', 'colete'],
    });

    expect(result.requiredItems).toEqual(['capacete', 'colete']);
    expect(result.detectedItems).toHaveLength(2);
  });

  it('rejeita análise sem equipamentos exigidos', async () => {
    await expect(
      createService('conformidade-total').analyzeImage({ ...baseInput, requiredItems: [] }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('inclui caixas delimitadoras nos itens detectados', async () => {
    const result = await createService('conformidade-total').analyzeImage(baseInput);

    expect(result.detectedItems.every((item) => item.boundingBox !== undefined)).toBe(true);
  });
});
