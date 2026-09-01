import type { Box } from './faceGeometry';

export interface DetectedFace {
  box: Box;
  /** Ângulos de cabeça reportados pelo ML Kit; só exibidos, nunca aplicados. */
  headEulerAngleX: number | null;
  headEulerAngleY: number | null;
  headEulerAngleZ: number | null;
  trackingId: number | null;
}

export class FaceDetectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaceDetectorError';
  }
}

interface MlkitRect {
  origin: { x: number; y: number };
  size: { x: number; y: number };
}

/**
 * O que o ML Kit realmente devolve.
 *
 * A tipagem publicada pela biblioteca declara `success: boolean` e
 * `error: string | null`, mas **nenhuma das duas implementações nativas
 * produz esses campos** — o record do Android tem apenas `faces` e
 * `imagePath`, e o do iOS é idêntico. Confiar neles fazia todo retorno
 * válido ser rejeitado, porque `undefined` reprova qualquer teste de
 * verdade. Este tipo descreve o contrato observado, não o declarado.
 */
interface MlkitFace {
  frame: MlkitRect;
  headEulerAngleX?: number | null;
  headEulerAngleY?: number | null;
  headEulerAngleZ?: number | null;
  trackingID?: number | null;
}

interface MlkitDetectionResult {
  faces?: MlkitFace[];
  imagePath?: string;
}

/**
 * Envoltório do ML Kit.
 *
 * Existe para que o resto do código não conheça o formato do detector: o ML
 * Kit devolve `{ origin, size }`, e daqui para dentro tudo trabalha com
 * `{ x, y, width, height }`. Trocar de detector depois muda só este arquivo.
 */
export class FaceDetector {
  private detector: {
    status: string;
    initialize: (options?: { performanceMode: string }) => Promise<void>;
    detectFaces: (uri: string) => Promise<MlkitDetectionResult | undefined | null>;
  } | null = null;

  initMs: number | null = null;

  get ready(): boolean {
    return this.detector?.status === 'ready';
  }

  get status(): string {
    return this.detector?.status ?? 'não inicializado';
  }

  async initialize(): Promise<void> {
    const { RNMLKitFaceDetector } = await import('@infinitered/react-native-mlkit-face-detection');

    // `true` adia a inicialização para medi-la explicitamente.
    const detector = new RNMLKitFaceDetector({ performanceMode: 'accurate' }, true);
    this.detector = detector as unknown as typeof this.detector;

    const iniciou = Date.now();
    await detector.initialize({ performanceMode: 'accurate' });
    this.initMs = Date.now() - iniciou;

    // `initialize` engole exceções e sinaliza pelo status, então é ele que
    // decide se deu certo.
    if (detector.status !== 'ready') {
      throw new FaceDetectorError(`Detector terminou em "${detector.status}".`);
    }
  }

  async detect(imageUri: string): Promise<DetectedFace[]> {
    if (!this.detector) {
      throw new FaceDetectorError('O detector não foi inicializado.');
    }

    const resultado = await this.detector.detectFaces(imageUri);

    // A biblioteca devolve `undefined` quando a chamada nativa lança — é esse
    // o sinal de falha real, não um campo booleano.
    if (!resultado) {
      throw new FaceDetectorError('A detecção não devolveu resultado.');
    }
    if (!Array.isArray(resultado.faces)) {
      throw new FaceDetectorError('Resposta inválida do detector facial.');
    }

    // Lista vazia é resultado legítimo: o detector rodou e não achou ninguém.
    // Quem decide o que fazer com isso é o chamador, não este envoltório.
    return resultado.faces.map((face) => ({
      box: {
        x: face.frame.origin.x,
        y: face.frame.origin.y,
        width: face.frame.size.x,
        height: face.frame.size.y,
      },
      headEulerAngleX: face.headEulerAngleX ?? null,
      headEulerAngleY: face.headEulerAngleY ?? null,
      headEulerAngleZ: face.headEulerAngleZ ?? null,
      trackingId: face.trackingID ?? null,
    }));
  }
}
