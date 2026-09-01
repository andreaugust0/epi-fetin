import { AppError } from '@/services/errors';

import { MOCK_EMPLOYEES } from '../../mocks/employees';
import { MockFaceRecognitionService } from '../MockFaceRecognitionService';

const createService = (forcedOutcome: 'recognized' | 'unknown') =>
  new MockFaceRecognitionService({ random: () => 0.5, durationMs: 0, forcedOutcome });

describe('MockFaceRecognitionService', () => {
  it('reconhece uma pessoa do cadastro simulado', async () => {
    const result = await createService('recognized').recognize({});

    expect(result.status).toBe('recognized');
    if (result.status === 'recognized') {
      expect(MOCK_EMPLOYEES.some((item) => item.id === result.employee.id)).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.7);
    }
  });

  it('devolve os dados esperados da pessoa reconhecida', async () => {
    const result = await createService('recognized').recognize({});

    if (result.status === 'recognized') {
      expect(result.employee).toMatchObject({
        id: expect.any(String),
        nome: expect.any(String),
        email: expect.any(String),
        matricula: expect.any(String),
        setor: expect.any(String),
      });
    }
  });

  it('devolve desconhecido quando nenhum cadastro corresponde', async () => {
    const result = await createService('unknown').recognize({});

    expect(result.status).toBe('unknown');
    expect(result.confidence).toBeLessThan(0.7);
  });

  it('respeita a taxa de desconhecidos configurada', async () => {
    const sempreDesconhecido = new MockFaceRecognitionService({
      random: () => 0.01,
      durationMs: 0,
      unknownRate: 1,
    });

    await expect(sempreDesconhecido.recognize({})).resolves.toMatchObject({ status: 'unknown' });
  });

  it('aborta quando o sinal é cancelado', async () => {
    const controller = new AbortController();
    const service = new MockFaceRecognitionService({ durationMs: 50, forcedOutcome: 'recognized' });

    const promise = service.recognize({ signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(AppError);
  });
});
