import { AppError } from '@/services/errors';
import { requestJson } from '@/services/http/httpClient';

import type { FaceIdentificationResponse } from '../../types/identification';
import { FACE_MODEL_ID } from '../../types/identification';
import { ApiFaceRecognitionService } from '../ApiFaceRecognitionService';

jest.mock('@/services/http/httpClient');

const mockedRequestJson = requestJson as jest.MockedFunction<typeof requestJson>;

/** Vetor sintético de 512 posições — nunca biometria real. */
const FAKE_EMBEDDING_512 = Array.from({ length: 512 }, (_, i) => (i % 7) * 0.001);
const FAKE_TOKEN = 'fake-device-token-for-tests';

const createService = () =>
  new ApiFaceRecognitionService({ baseUrl: 'https://api.example.test' });

const respond = (response: FaceIdentificationResponse) => {
  mockedRequestJson.mockResolvedValueOnce(response);
};

describe('ApiFaceRecognitionService', () => {
  beforeEach(() => {
    mockedRequestJson.mockReset();
  });

  it('monta a request corretamente: endpoint, método, auth, ponto_id, modelo e embedding', async () => {
    respond({
      identificacao_id: 'id-1',
      resultado: 'IDENTIFICADO',
      pessoa_id: 1,
      nome: 'Caio',
      distancia: 0,
      expira_em: '2026-01-01T00:00:00Z',
    });

    await createService().identify({
      embedding: Float32Array.from(FAKE_EMBEDDING_512),
      pontoId: 1,
      deviceToken: FAKE_TOKEN,
    });

    expect(mockedRequestJson).toHaveBeenCalledTimes(1);
    const [url, options] = mockedRequestJson.mock.calls[0]!;

    expect(url).toBe('https://api.example.test/api/v1/identificacao');
    expect(options?.method).toBe('POST');
    expect(options?.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${FAKE_TOKEN}`,
    });

    const body = JSON.parse(options?.body as string);
    expect(body.ponto_id).toBe(1);
    expect(body.modelo).toBe(FACE_MODEL_ID);
    expect(Array.isArray(body.embedding)).toBe(true);
    expect(body.embedding).toHaveLength(512);
    expect(typeof body.embedding[0]).toBe('number');
  });

  it('aceita number[] além de Float32Array', async () => {
    respond({
      identificacao_id: null,
      resultado: 'NAO_IDENTIFICADO',
      pessoa_id: null,
      nome: null,
      distancia: null,
      expira_em: null,
    });

    await createService().identify({
      embedding: FAKE_EMBEDDING_512,
      pontoId: 1,
      deviceToken: FAKE_TOKEN,
    });

    const [, options] = mockedRequestJson.mock.calls[0]!;
    const body = JSON.parse(options?.body as string);
    expect(body.embedding).toHaveLength(512);
  });

  it('repassa uma resposta IDENTIFICADO sem alterar nenhum campo', async () => {
    const response: FaceIdentificationResponse = {
      identificacao_id: 'abc-123',
      resultado: 'IDENTIFICADO',
      pessoa_id: 1,
      nome: 'Caio',
      distancia: 0,
      expira_em: '2026-01-01T00:01:00Z',
    };
    respond(response);

    const result = await createService().identify({
      embedding: FAKE_EMBEDDING_512,
      pontoId: 1,
      deviceToken: FAKE_TOKEN,
    });

    expect(result).toEqual(response);
  });

  it('repassa uma resposta NAO_IDENTIFICADO como resultado de domínio, não como erro', async () => {
    const response: FaceIdentificationResponse = {
      identificacao_id: null,
      resultado: 'NAO_IDENTIFICADO',
      pessoa_id: null,
      nome: null,
      distancia: null,
      expira_em: null,
    };
    respond(response);

    const result = await createService().identify({
      embedding: FAKE_EMBEDDING_512,
      pontoId: 1,
      deviceToken: FAKE_TOKEN,
    });

    expect(result.resultado).toBe('NAO_IDENTIFICADO');
    expect(result).toEqual(response);
  });

  it('repassa uma resposta AMBIGUO como resultado de domínio', async () => {
    const response: FaceIdentificationResponse = {
      identificacao_id: null,
      resultado: 'AMBIGUO',
      pessoa_id: null,
      nome: null,
      distancia: 0.32,
      expira_em: null,
    };
    respond(response);

    const result = await createService().identify({
      embedding: FAKE_EMBEDDING_512,
      pontoId: 1,
      deviceToken: FAKE_TOKEN,
    });

    expect(result.resultado).toBe('AMBIGUO');
  });

  it('repassa uma resposta SEM_CONSENTIMENTO como resultado de domínio', async () => {
    const response: FaceIdentificationResponse = {
      identificacao_id: null,
      resultado: 'SEM_CONSENTIMENTO',
      pessoa_id: null,
      nome: null,
      distancia: 0.1,
      expira_em: null,
    };
    respond(response);

    const result = await createService().identify({
      embedding: FAKE_EMBEDDING_512,
      pontoId: 1,
      deviceToken: FAKE_TOKEN,
    });

    expect(result.resultado).toBe('SEM_CONSENTIMENTO');
  });

  it('propaga o AppError lançado pelo httpClient em falhas HTTP (401/403/422/500) sem mascarar', async () => {
    mockedRequestJson.mockRejectedValueOnce(
      new AppError('invalid_response', 'A análise falhou com o status 401.'),
    );

    await expect(
      createService().identify({ embedding: FAKE_EMBEDDING_512, pontoId: 1, deviceToken: FAKE_TOKEN }),
    ).rejects.toThrow(AppError);
  });

  it('propaga falha de rede/timeout normalizada pelo httpClient', async () => {
    mockedRequestJson.mockRejectedValueOnce(new AppError('network', 'sem conexão'));

    await expect(
      createService().identify({ embedding: FAKE_EMBEDDING_512, pontoId: 1, deviceToken: FAKE_TOKEN }),
    ).rejects.toMatchObject({ code: 'network' });
  });
});
