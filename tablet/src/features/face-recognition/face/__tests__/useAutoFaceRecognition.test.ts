import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { CameraView } from 'expo-camera';
import type { RefObject } from 'react';

import { ApiFaceRecognitionService } from '../../services/ApiFaceRecognitionService';
import { deviceTokenStore } from '../../services/deviceTokenStore';
import { FaceApiConfigError, getFaceApiConfig } from '../../services/faceApiConfig';
import type { FaceIdentificationResponse } from '../../types/identification';
import type { FaceEmbeddingExtraction } from '../facePipeline';
import { extractFaceEmbedding } from '../facePipeline';
import { useAutoFaceRecognition } from '../useAutoFaceRecognition';

jest.mock('../faceDetector', () => ({
  FaceDetector: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../../onnx/FaceNetSession', () => ({
  FaceNetSession: jest.fn().mockImplementation(() => ({
    load: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../facePipeline', () => ({
  extractFaceEmbedding: jest.fn(),
}));

jest.mock('../../services/faceApiConfig', () => {
  class FaceApiConfigErrorMock extends Error {}
  return {
    FaceApiConfigError: FaceApiConfigErrorMock,
    getFaceApiConfig: jest.fn(),
  };
});

jest.mock('../../services/deviceTokenStore', () => ({
  deviceTokenStore: { get: jest.fn(), set: jest.fn(), remove: jest.fn() },
}));

jest.mock('../../services/ApiFaceRecognitionService', () => ({
  ApiFaceRecognitionService: jest.fn(),
}));

const mockedExtractFaceEmbedding = extractFaceEmbedding as jest.MockedFunction<
  typeof extractFaceEmbedding
>;
const mockedGetFaceApiConfig = getFaceApiConfig as jest.MockedFunction<typeof getFaceApiConfig>;
const mockedGetToken = deviceTokenStore.get as jest.MockedFunction<typeof deviceTokenStore.get>;
const MockedApiFaceRecognitionService = ApiFaceRecognitionService as jest.MockedClass<
  typeof ApiFaceRecognitionService
>;

/** Vetor sintético de 512 posições — nunca biometria real. */
const FAKE_EMBEDDING = new Float32Array(512).fill(0.01);
const FAKE_TOKEN = 'fake-device-token';
const FAKE_CONFIG = { baseUrl: 'https://api.example.test', pointId: 1 };

const emptyExtraction = (): FaceEmbeddingExtraction => ({
  facesDetected: 0,
  imageWidth: 100,
  imageHeight: 100,
  rawBox: null,
  cropBox: null,
  headEulerAngleX: null,
  headEulerAngleY: null,
  headEulerAngleZ: null,
  trackingId: null,
  embedding: null,
  embeddingDim: null,
  embeddingNorm: null,
  cropPreviewUri: null,
  timings: null,
  error: null,
});

const extractionWithFace = (overrides: Partial<FaceEmbeddingExtraction> = {}): FaceEmbeddingExtraction => ({
  ...emptyExtraction(),
  facesDetected: 1,
  embedding: FAKE_EMBEDDING,
  embeddingDim: 512,
  embeddingNorm: 1,
  timings: { detectMs: 1, cropMs: 1, decodeMs: 1, tensorMs: 1, inferenceMs: 1 },
  ...overrides,
});

const serverResponse = (
  overrides: Partial<FaceIdentificationResponse> = {},
): FaceIdentificationResponse => ({
  identificacao_id: null,
  resultado: 'NAO_IDENTIFICADO',
  pessoa_id: null,
  nome: null,
  distancia: null,
  expira_em: null,
  ...overrides,
});

/** Câmera falsa: só o método que o hook realmente chama. */
const fakeCameraRef = (takePictureAsync: jest.Mock) =>
  ({ current: { takePictureAsync } }) as unknown as RefObject<CameraView>;

let mockedIdentify: jest.Mock;

beforeEach(() => {
  mockedExtractFaceEmbedding.mockReset();
  mockedGetFaceApiConfig.mockReset();
  mockedGetToken.mockReset();
  MockedApiFaceRecognitionService.mockReset();

  mockedGetFaceApiConfig.mockResolvedValue(FAKE_CONFIG);
  mockedGetToken.mockResolvedValue(FAKE_TOKEN);
  mockedIdentify = jest.fn().mockResolvedValue(serverResponse());
  MockedApiFaceRecognitionService.mockImplementation(
    () => ({ identify: mockedIdentify }) as unknown as ApiFaceRecognitionService,
  );
});

describe('useAutoFaceRecognition — carregamento', () => {
  it('carrega detector/modelo e chega a "pronto"', async () => {
    const takePictureAsync = jest.fn();
    const { result } = await renderHook(() =>
      useAutoFaceRecognition({ cameraRef: fakeCameraRef(takePictureAsync) }),
    );

    // `await renderHook` já flusha o efeito de setup (mocks resolvem
    // instantaneamente); checar "preparando" no meio seria correr contra
    // essa flush, não contra o hook. O que importa é que ele CHEGA a pronto.
    await waitFor(() => expect(result.current.status).toBe('pronto'));
  });
});

describe('useAutoFaceRecognition — extração e chamada ao servidor', () => {
  it('rosto detectado: extrai o embedding e chama a API com ponto_id/token corretos', async () => {
    mockedExtractFaceEmbedding.mockResolvedValueOnce(extractionWithFace());
    const takePictureAsync = jest
      .fn()
      .mockResolvedValue({ uri: 'file://foto.jpg', width: 100, height: 100 });
    const { result, unmount } = await renderHook(() =>
      useAutoFaceRecognition({ cameraRef: fakeCameraRef(takePictureAsync) }),
    );
    await waitFor(() => expect(result.current.status).toBe('pronto'));

    await act(async () => {
      result.current.recognize();
      await waitFor(() => expect(result.current.status).toBe('pronto'));
    });

    expect(mockedIdentify).toHaveBeenCalledTimes(1);
    const call = mockedIdentify.mock.calls[0]![0];
    expect(call.pontoId).toBe(FAKE_CONFIG.pointId);
    expect(call.deviceToken).toBe(FAKE_TOKEN);
    expect(call.embedding).toBe(FAKE_EMBEDDING);
    expect(call.embedding).toHaveLength(512);
    await unmount();
  });

  it('extractFaceEmbedding/FaceNet é chamado exatamente uma vez por tentativa', async () => {
    mockedExtractFaceEmbedding.mockResolvedValueOnce(extractionWithFace());
    const takePictureAsync = jest
      .fn()
      .mockResolvedValue({ uri: 'file://foto.jpg', width: 100, height: 100 });
    const { result } = await renderHook(() =>
      useAutoFaceRecognition({ cameraRef: fakeCameraRef(takePictureAsync) }),
    );
    await waitFor(() => expect(result.current.status).toBe('pronto'));

    await act(async () => {
      result.current.recognize();
      await waitFor(() => expect(result.current.status).toBe('pronto'));
    });

    expect(mockedExtractFaceEmbedding).toHaveBeenCalledTimes(1);
  });

  it('a galeria mock local não participa: matchAgainstGallery/loadMockGallery não são importados aqui', async () => {
    // Confirmação estática: este módulo de teste nunca importa
    // '../gallery/matchEmbedding' nem '../gallery/mockGallery' — se o hook
    // operacional voltasse a usar `analyzePhoto` (que os usa), o mock de
    // `../facePipeline` acima (só `extractFaceEmbedding`) faria o teste
    // anterior falhar por função ausente.
    mockedExtractFaceEmbedding.mockResolvedValueOnce(extractionWithFace());
    const takePictureAsync = jest
      .fn()
      .mockResolvedValue({ uri: 'file://foto.jpg', width: 100, height: 100 });
    const { result } = await renderHook(() =>
      useAutoFaceRecognition({ cameraRef: fakeCameraRef(takePictureAsync) }),
    );
    await waitFor(() => expect(result.current.status).toBe('pronto'));

    await act(async () => {
      result.current.recognize();
    });
    await waitFor(() => expect(result.current.result).not.toBeNull());
  });

  it('nenhum rosto: não chama getFaceApiConfig/token/API', async () => {
    mockedExtractFaceEmbedding.mockResolvedValueOnce(emptyExtraction());
    const takePictureAsync = jest
      .fn()
      .mockResolvedValue({ uri: 'file://foto.jpg', width: 100, height: 100 });
    const { result } = await renderHook(() =>
      useAutoFaceRecognition({ cameraRef: fakeCameraRef(takePictureAsync) }),
    );
    await waitFor(() => expect(result.current.status).toBe('pronto'));

    await act(async () => {
      result.current.recognize();
    });
    await waitFor(() => expect(result.current.result).toEqual({ kind: 'no_face' }));

    expect(mockedGetFaceApiConfig).not.toHaveBeenCalled();
    expect(mockedGetToken).not.toHaveBeenCalled();
    expect(mockedIdentify).not.toHaveBeenCalled();
  });

  it('erro técnico da extração (câmera/ML Kit/FaceNet) não vira NAO_IDENTIFICADO', async () => {
    mockedExtractFaceEmbedding.mockResolvedValueOnce({
      ...emptyExtraction(),
      error: 'Falha ao decodificar o recorte.',
    });
    const takePictureAsync = jest
      .fn()
      .mockResolvedValue({ uri: 'file://foto.jpg', width: 100, height: 100 });
    const { result } = await renderHook(() =>
      useAutoFaceRecognition({ cameraRef: fakeCameraRef(takePictureAsync) }),
    );
    await waitFor(() => expect(result.current.status).toBe('pronto'));

    await act(async () => {
      result.current.recognize();
    });
    await waitFor(() =>
      expect(result.current.result).toEqual({
        kind: 'technical_error',
        message: 'Falha ao decodificar o recorte.',
      }),
    );
    expect(mockedIdentify).not.toHaveBeenCalled();
  });
});

describe('useAutoFaceRecognition — configuração e token ausentes', () => {
  it('config ausente: não chama o token nem a API', async () => {
    mockedExtractFaceEmbedding.mockResolvedValueOnce(extractionWithFace());
    mockedGetFaceApiConfig.mockRejectedValueOnce(new FaceApiConfigError('sem config'));
    const takePictureAsync = jest
      .fn()
      .mockResolvedValue({ uri: 'file://foto.jpg', width: 100, height: 100 });
    const { result } = await renderHook(() =>
      useAutoFaceRecognition({ cameraRef: fakeCameraRef(takePictureAsync) }),
    );
    await waitFor(() => expect(result.current.status).toBe('pronto'));

    await act(async () => {
      result.current.recognize();
    });
    await waitFor(() => expect(result.current.result).toEqual({ kind: 'config_missing' }));
    expect(mockedGetToken).not.toHaveBeenCalled();
    expect(mockedIdentify).not.toHaveBeenCalled();
  });

  it('token ausente: NÃO chama a API', async () => {
    mockedExtractFaceEmbedding.mockResolvedValueOnce(extractionWithFace());
    mockedGetToken.mockResolvedValueOnce(null);
    const takePictureAsync = jest
      .fn()
      .mockResolvedValue({ uri: 'file://foto.jpg', width: 100, height: 100 });
    const { result } = await renderHook(() =>
      useAutoFaceRecognition({ cameraRef: fakeCameraRef(takePictureAsync) }),
    );
    await waitFor(() => expect(result.current.status).toBe('pronto'));

    await act(async () => {
      result.current.recognize();
    });
    await waitFor(() => expect(result.current.result).toEqual({ kind: 'token_missing' }));
    expect(mockedIdentify).not.toHaveBeenCalled();
  });
});

describe('useAutoFaceRecognition — resultados de domínio do servidor', () => {
  const attemptWith = async (response: FaceIdentificationResponse) => {
    mockedExtractFaceEmbedding.mockResolvedValueOnce(extractionWithFace());
    mockedIdentify.mockResolvedValueOnce(response);
    const takePictureAsync = jest
      .fn()
      .mockResolvedValue({ uri: 'file://foto.jpg', width: 100, height: 100 });
    const { result } = await renderHook(() =>
      useAutoFaceRecognition({ cameraRef: fakeCameraRef(takePictureAsync) }),
    );
    await waitFor(() => expect(result.current.status).toBe('pronto'));

    await act(async () => {
      result.current.recognize();
    });
    await waitFor(() => expect(result.current.result).not.toBeNull());

    return result;
  };

  it('IDENTIFICADO: mapeia pessoa_id/nome/identificacao_id/expira_em', async () => {
    const result = await attemptWith(
      serverResponse({
        resultado: 'IDENTIFICADO',
        pessoa_id: 1,
        nome: 'Caio',
        identificacao_id: 'ident-123',
        expira_em: '2026-01-01T00:01:00Z',
      }),
    );

    expect(result.current.result).toEqual({
      kind: 'identified',
      pessoaId: 1,
      nome: 'Caio',
      identificacaoId: 'ident-123',
      expiraEm: '2026-01-01T00:01:00Z',
    });
  });

  it('IDENTIFICADO com campo obrigatório faltando vira technical_error, não "identified"', async () => {
    const result = await attemptWith(
      serverResponse({ resultado: 'IDENTIFICADO', pessoa_id: 1, nome: 'Caio' }),
    );

    expect(result.current.result?.kind).toBe('technical_error');
  });

  it('NAO_IDENTIFICADO', async () => {
    const result = await attemptWith(serverResponse({ resultado: 'NAO_IDENTIFICADO' }));
    expect(result.current.result).toEqual({ kind: 'nao_identificado' });
  });

  it('AMBIGUO', async () => {
    const result = await attemptWith(serverResponse({ resultado: 'AMBIGUO' }));
    expect(result.current.result).toEqual({ kind: 'ambiguo' });
  });

  it('SEM_CONSENTIMENTO', async () => {
    const result = await attemptWith(serverResponse({ resultado: 'SEM_CONSENTIMENTO' }));
    expect(result.current.result).toEqual({ kind: 'sem_consentimento' });
  });
});

describe('useAutoFaceRecognition — falha de rede/HTTP', () => {
  it('erro de rede/HTTP vira technical_error, nunca NAO_IDENTIFICADO', async () => {
    mockedExtractFaceEmbedding.mockResolvedValueOnce(extractionWithFace());
    mockedIdentify.mockRejectedValueOnce(new Error('A análise falhou com o status 500.'));
    const takePictureAsync = jest
      .fn()
      .mockResolvedValue({ uri: 'file://foto.jpg', width: 100, height: 100 });
    const { result } = await renderHook(() =>
      useAutoFaceRecognition({ cameraRef: fakeCameraRef(takePictureAsync) }),
    );
    await waitFor(() => expect(result.current.status).toBe('pronto'));

    await act(async () => {
      result.current.recognize();
    });
    await waitFor(() =>
      expect(result.current.result).toEqual({
        kind: 'technical_error',
        message: 'A análise falhou com o status 500.',
      }),
    );
  });
});
