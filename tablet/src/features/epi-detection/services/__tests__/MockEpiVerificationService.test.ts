import { DEFAULT_REQUIRED_EPI_IDS } from '@/constants/epiCatalog';
import { AppError } from '@/services/errors';

import type { EpiId } from '../../types';
import type { EpiVerificationEvent } from '../EpiVerificationService';
import { MockEpiVerificationService } from '../MockEpiVerificationService';

const REQUIRED: EpiId[] = [...DEFAULT_REQUIRED_EPI_IDS];

const createService = (forcedScenario: string) =>
  new MockEpiVerificationService({ random: () => 0.5, stepMs: 0, forcedScenario });

/** Executa a verificação coletando todos os eventos emitidos. */
const runVerification = async (
  service: MockEpiVerificationService,
  requiredItems: EpiId[] = REQUIRED,
) => {
  const events: EpiVerificationEvent[] = [];
  const detection = await service.run({ requiredItems }, (event) => events.push(event));
  return { events, detection };
};

describe('MockEpiVerificationService', () => {
  it('avalia os equipamentos um a um, com progresso crescente até 100%', async () => {
    const { events } = await runVerification(createService('conformidade-total'), [
      'capacete',
      'colete',
      'oculos',
    ]);

    const progresses = events.map((event) => event.progress);

    // Um evento inicial em zero e um por equipamento avaliado.
    expect(progresses).toHaveLength(4);
    expect(progresses[0]).toBe(0);
    expect(progresses.at(-1)).toBe(1);
  });

  it('indica qual equipamento está sendo avaliado', async () => {
    const { events } = await runVerification(createService('conformidade-total'), [
      'capacete',
      'colete',
    ]);

    expect(events.map((event) => event.currentItem)).toEqual(['capacete', 'colete', null]);
  });

  it('conclui aprovado quando todos os equipamentos são detectados', async () => {
    const { detection } = await runVerification(createService('conformidade-total'));

    expect(detection.status).toBe('approved');
    expect(detection.missingItems).toHaveLength(0);
    expect(detection.detectedItems).toHaveLength(REQUIRED.length);
  });

  it('conclui reprovado quando vários equipamentos faltam', async () => {
    const { detection } = await runVerification(createService('falta-luvas-e-mascara'));

    expect(detection.status).toBe('rejected');
    expect(detection.missingItems.map((item) => item.id).sort()).toEqual(['luvas', 'mascara']);
  });

  it('conclui reprovado quando nada é reconhecido', async () => {
    const { detection } = await runVerification(createService('nada-reconhecido'));

    expect(detection.status).toBe('rejected');
    expect(detection.detectedItems).toHaveLength(0);
  });

  it('o resultado cobre todos os equipamentos exigidos', async () => {
    const { detection } = await runVerification(createService('falta-oculos'));
    const total = detection.detectedItems.length + detection.missingItems.length;

    expect(total).toBe(REQUIRED.length);
  });

  it('rejeita a verificação sem equipamentos exigidos', async () => {
    await expect(
      createService('conformidade-total').run({ requiredItems: [] }, () => {}),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('aborta quando o sinal é cancelado', async () => {
    const controller = new AbortController();
    const service = new MockEpiVerificationService({
      random: () => 0.5,
      stepMs: 20,
      forcedScenario: 'conformidade-total',
    });

    const promise = service.run({ requiredItems: REQUIRED, signal: controller.signal }, () => {});
    controller.abort();

    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
  });
});
