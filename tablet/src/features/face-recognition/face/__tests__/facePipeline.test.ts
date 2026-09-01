import type { GalleryEntry } from '../../gallery/matchEmbedding';
import type { FaceDetector, DetectedFace } from '../faceDetector';
import { analyzePhoto, extractFaceEmbedding } from '../facePipeline';

import type { FaceNetSession } from '../../onnx/FaceNetSession';

interface FakeRenderResult {
  saveAsync: () => Promise<{ width: number; height: number; base64: string }>;
}

/** Só os 3 métodos do contexto de manipulação que `facePipeline.ts` usa. */
interface FakeManipulationContext {
  crop: (options: { originX: number; originY: number; width: number; height: number }) => FakeManipulationContext;
  resize: (options: { width: number; height: number }) => FakeManipulationContext;
  renderAsync: () => Promise<FakeRenderResult>;
}

jest.mock('expo-image-manipulator', () => {
  const renderResult = {
    saveAsync: jest.fn(async () => ({ width: 160, height: 160, base64: 'AAAA' })),
  };
  const context: FakeManipulationContext = {
    crop: jest.fn(() => context),
    resize: jest.fn(() => context),
    renderAsync: jest.fn(async () => renderResult),
  };
  return {
    ImageManipulator: { manipulate: jest.fn(() => context) },
    SaveFormat: { PNG: 'png' },
  };
});

jest.mock('upng-js', () => ({
  decode: jest.fn(() => ({ width: 160, height: 160 })),
  toRGBA8: jest.fn(() => [new ArrayBuffer(160 * 160 * 4)]),
}));

jest.mock('../../gallery/mockGallery', () => ({
  loadMockGallery: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { loadMockGallery } = require('../../gallery/mockGallery') as {
  loadMockGallery: jest.MockedFunction<() => GalleryEntry[]>;
};

/**
 * Vetor sintético de 512 posições, L2-normalizado (norma 1) — nunca
 * biometria real. `cosineDistance` assume vetores já unitários, como o
 * grafo ONNX real garante, então o teste precisa fazer o mesmo.
 */
const buildFakeEmbedding = (): Float32Array => {
  const raw = Array.from({ length: 512 }, (_, i) => (i % 5) + 1);
  const norma = Math.sqrt(raw.reduce((soma, v) => soma + v * v, 0));
  return new Float32Array(raw.map((v) => v / norma));
};

const FAKE_EMBEDDING = buildFakeEmbedding();

const FAKE_BOX = { x: 10, y: 10, width: 80, height: 80 };

const detectedFace = (overrides: Partial<DetectedFace> = {}): DetectedFace => ({
  box: FAKE_BOX,
  headEulerAngleX: 0,
  headEulerAngleY: 0,
  headEulerAngleZ: 0,
  trackingId: 1,
  ...overrides,
});

const createDetector = (faces: DetectedFace[] | (() => Promise<DetectedFace[]>)) =>
  ({
    detect: jest.fn(async () => (typeof faces === 'function' ? faces() : faces)),
  }) as unknown as FaceDetector;

const createSession = (
  embedding: Float32Array | (() => Promise<{ embedding: Float32Array; inferenceMs: number }>),
) =>
  ({
    embed: jest.fn(async () =>
      typeof embedding === 'function' ? embedding() : { embedding, inferenceMs: 5 },
    ),
  }) as unknown as FaceNetSession;

const baseInput = {
  photoUri: 'file://fake.jpg',
  photoWidth: 200,
  photoHeight: 200,
};

describe('extractFaceEmbedding', () => {
  it('produz um embedding Float32Array com 512 dimensões quando há rosto', async () => {
    const detector = createDetector([detectedFace()]);
    const session = createSession(FAKE_EMBEDDING);

    const result = await extractFaceEmbedding({ ...baseInput, detector, session });

    expect(result.error).toBeNull();
    expect(result.embedding).not.toBeNull();
    expect(result.embedding).toBeInstanceOf(Float32Array);
    expect(result.embedding).toHaveLength(512);
    expect(result.embeddingDim).toBe(512);
    expect(result.facesDetected).toBe(1);
  });

  it('chama o FaceNet exatamente uma vez por extração', async () => {
    const detector = createDetector([detectedFace()]);
    const session = createSession(FAKE_EMBEDDING);

    await extractFaceEmbedding({ ...baseInput, detector, session });

    expect(session.embed).toHaveBeenCalledTimes(1);
  });

  it('nenhum rosto: não chama FaceNet, devolve embedding null sem erro', async () => {
    const detector = createDetector([]);
    const session = createSession(FAKE_EMBEDDING);

    const result = await extractFaceEmbedding({ ...baseInput, detector, session });

    expect(result.facesDetected).toBe(0);
    expect(result.embedding).toBeNull();
    expect(result.error).toBeNull();
    expect(session.embed).not.toHaveBeenCalled();
  });

  it('erro técnico do detector vira `error`, sem embedding', async () => {
    const detector = {
      detect: jest.fn(async () => {
        throw new Error('câmera falhou');
      }),
    } as unknown as FaceDetector;
    const session = createSession(FAKE_EMBEDDING);

    const result = await extractFaceEmbedding({ ...baseInput, detector, session });

    expect(result.error).toBe('câmera falhou');
    expect(result.embedding).toBeNull();
  });
});

describe('analyzePhoto', () => {
  beforeEach(() => {
    loadMockGallery.mockReset();
  });

  it('reutiliza o mesmo embedding da extração para o match — não recalcula nada', async () => {
    const detector = createDetector([detectedFace()]);
    const session = createSession(FAKE_EMBEDDING);
    const gallery: GalleryEntry[] = [
      { id: 1, nome: 'Teste', embedding: Array.from(FAKE_EMBEDDING) },
    ];
    loadMockGallery.mockReturnValue(gallery);

    const result = await analyzePhoto({ ...baseInput, detector, session });

    // Mesmo vetor na galeria: distância cosseno deve ser ~0.
    expect(result.match?.best?.id).toBe(1);
    expect(result.match?.best?.distance).toBeCloseTo(0, 6);
    expect(result.embeddingDim).toBe(512);
  });

  it('executa o FaceNet uma única vez por análise completa', async () => {
    const detector = createDetector([detectedFace()]);
    const session = createSession(FAKE_EMBEDDING);
    loadMockGallery.mockReturnValue([{ id: 1, nome: 'Teste', embedding: Array.from(FAKE_EMBEDDING) }]);

    await analyzePhoto({ ...baseInput, detector, session });

    expect(session.embed).toHaveBeenCalledTimes(1);
  });

  it('nenhum rosto: facesDetected=0, match null, sem erro (compatível com hoje)', async () => {
    const detector = createDetector([]);
    const session = createSession(FAKE_EMBEDDING);

    const result = await analyzePhoto({ ...baseInput, detector, session });

    expect(result.facesDetected).toBe(0);
    expect(result.match).toBeNull();
    expect(result.error).toBeNull();
    expect(result.timings).toMatchObject({ matchMs: 0 });
    expect(session.embed).not.toHaveBeenCalled();
    expect(loadMockGallery).not.toHaveBeenCalled();
  });

  it('erro técnico: error preenchido, match null, embedding não exposto', async () => {
    const detector = createDetector([detectedFace()]);
    const session = {
      embed: jest.fn(async () => {
        throw new Error('ONNX falhou');
      }),
    } as unknown as FaceNetSession;

    const result = await analyzePhoto({ ...baseInput, detector, session });

    expect(result.error).toBe('ONNX falhou');
    expect(result.match).toBeNull();
    expect(result.embeddingDim).toBeNull();
  });

  it('mantém o formato de PipelineResult usado pelas telas (identificacao/diagnóstico)', async () => {
    const detector = createDetector([detectedFace()]);
    const session = createSession(FAKE_EMBEDDING);
    loadMockGallery.mockReturnValue([{ id: 1, nome: 'Teste', embedding: Array.from(FAKE_EMBEDDING) }]);

    const result = await analyzePhoto({ ...baseInput, detector, session });

    expect(Object.keys(result).sort()).toEqual(
      [
        'facesDetected',
        'imageWidth',
        'imageHeight',
        'rawBox',
        'cropBox',
        'headEulerAngleX',
        'headEulerAngleY',
        'headEulerAngleZ',
        'trackingId',
        'embeddingDim',
        'embeddingNorm',
        'match',
        'timings',
        'cropPreviewUri',
        'error',
      ].sort(),
    );
    // O vetor bruto nunca é exposto no resultado usado pelas telas.
    expect(result).not.toHaveProperty('embedding');
  });
});
