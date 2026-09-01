import { toByteArray } from 'base64-js';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as UPNG from 'upng-js';

import { matchAgainstGallery, type MatchResult } from '../gallery/matchEmbedding';
import { loadMockGallery } from '../gallery/mockGallery';
import { FACENET_IMAGE_SIZE, l2Norm, rgbaToChwTensor } from '../onnx/facenetPreprocess';
import type { FaceNetSession } from '../onnx/FaceNetSession';

import type { FaceDetector, DetectedFace } from './faceDetector';
import { pickLargestBox, toSquareBox, type Box } from './faceGeometry';

export interface ExtractionTimings {
  detectMs: number;
  cropMs: number;
  decodeMs: number;
  tensorMs: number;
  inferenceMs: number;
}

export interface PipelineTimings extends ExtractionTimings {
  matchMs: number;
  totalMs: number;
}

export interface PipelineResult {
  facesDetected: number;
  imageWidth: number;
  imageHeight: number;
  rawBox: Box | null;
  cropBox: Box | null;
  headEulerAngleX: number | null;
  headEulerAngleY: number | null;
  headEulerAngleZ: number | null;
  trackingId: number | null;
  embeddingDim: number | null;
  embeddingNorm: number | null;
  match: MatchResult | null;
  timings: PipelineTimings | null;
  /** Recorte 160x160 em data URI, só para conferência visual na tela. */
  cropPreviewUri: string | null;
  error: string | null;
}

export class PipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PipelineError';
  }
}

/**
 * Dados biométricos transitórios de uma extração: o embedding em si, mais os
 * metadados de detecção/recorte que o levaram até ali.
 *
 * Não inclui `match` nem decisão alguma — é o resultado puro de rodar ML Kit
 * + FaceNet sobre uma foto. `analyzePhoto` usa isso para decidir localmente
 * (comparação com a galeria); um fluxo operacional futuro poderia usar o
 * mesmo `embedding` para consultar o servidor, sem rodar ML Kit/FaceNet de
 * novo para a mesma captura.
 *
 * `embedding` é transitório: existe só durante esta chamada, nunca é
 * persistido nem deve ser logado por extenso (só `embeddingDim`/`embeddingNorm`).
 */
export interface FaceEmbeddingExtraction {
  facesDetected: number;
  imageWidth: number;
  imageHeight: number;
  rawBox: Box | null;
  cropBox: Box | null;
  headEulerAngleX: number | null;
  headEulerAngleY: number | null;
  headEulerAngleZ: number | null;
  trackingId: number | null;
  /** Float32Array(512), já L2-normalizado pelo grafo ONNX. `null` se nenhum rosto foi extraído. */
  embedding: Float32Array | null;
  embeddingDim: number | null;
  embeddingNorm: number | null;
  cropPreviewUri: string | null;
  timings: ExtractionTimings | null;
  error: string | null;
}

const emptyExtraction = (): FaceEmbeddingExtraction => ({
  facesDetected: 0,
  imageWidth: 0,
  imageHeight: 0,
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

const zeroExtractionTimings = (parcial: Partial<ExtractionTimings>): ExtractionTimings => ({
  detectMs: 0,
  cropMs: 0,
  decodeMs: 0,
  tensorMs: 0,
  inferenceMs: 0,
  ...parcial,
});

/**
 * Percorre foto → rosto → recorte → tensor → embedding.
 *
 * Extração pura: não decide nada sobre a identidade da pessoa, não compara
 * com galeria nenhuma. Cada etapa é cronometrada separadamente porque o
 * objetivo desta fase é medir, não otimizar.
 */
export const extractFaceEmbedding = async (input: {
  photoUri: string;
  photoWidth: number;
  photoHeight: number;
  detector: FaceDetector;
  session: FaceNetSession;
}): Promise<FaceEmbeddingExtraction> => {
  const { photoUri, photoWidth, photoHeight, detector, session } = input;
  const result = emptyExtraction();
  result.imageWidth = photoWidth;
  result.imageHeight = photoHeight;

  try {
    // 1. Detecção — sobre o arquivo salvo, o mesmo que será recortado.
    const t0 = Date.now();
    const faces: DetectedFace[] = await detector.detect(photoUri);
    const detectMs = Date.now() - t0;

    result.facesDetected = faces.length;

    // Nenhum rosto não é falha técnica: o detector rodou e respondeu. Fica
    // registrado em `facesDetected`, sem virar erro, para o diagnóstico
    // distinguir "não achou ninguém" de "quebrou".
    if (faces.length === 0) {
      result.timings = zeroExtractionTimings({ detectMs });
      return result;
    }

    const escolhido = pickLargestBox(faces);
    if (!escolhido) {
      throw new PipelineError('Nenhum rosto pôde ser escolhido.');
    }

    result.rawBox = escolhido.box;
    result.headEulerAngleX = escolhido.headEulerAngleX;
    result.headEulerAngleY = escolhido.headEulerAngleY;
    result.headEulerAngleZ = escolhido.headEulerAngleZ;
    result.trackingId = escolhido.trackingId;

    // 2. Quadratura e recorte. Sem margem, como no enrollment.
    const cropBox = toSquareBox(escolhido.box, photoWidth, photoHeight);
    result.cropBox = cropBox;

    const t1 = Date.now();
    const rendered = await ImageManipulator.manipulate(photoUri)
      .crop({
        originX: cropBox.x,
        originY: cropBox.y,
        width: cropBox.width,
        height: cropBox.height,
      })
      .resize({ width: FACENET_IMAGE_SIZE, height: FACENET_IMAGE_SIZE })
      .renderAsync();

    // PNG por ser sem perdas: artefato de JPEG perturbaria o embedding, e
    // esta etapa existe justamente para medir fidelidade.
    const saved = await rendered.saveAsync({ base64: true, format: SaveFormat.PNG });
    const cropMs = Date.now() - t1;

    if (saved.width !== FACENET_IMAGE_SIZE || saved.height !== FACENET_IMAGE_SIZE) {
      throw new PipelineError(
        `Recorte saiu ${saved.width}x${saved.height}, esperado ${FACENET_IMAGE_SIZE}x${FACENET_IMAGE_SIZE}.`,
      );
    }
    if (!saved.base64) {
      throw new PipelineError('O recorte não devolveu dados em base64.');
    }

    result.cropPreviewUri = `data:image/png;base64,${saved.base64}`;

    // 3. Decodificação até pixels RGBA reais.
    const t2 = Date.now();
    const png = UPNG.decode(toByteArray(saved.base64).buffer as ArrayBuffer);
    const frames = UPNG.toRGBA8(png);
    const primeiro = frames[0];
    if (!primeiro) {
      throw new PipelineError('O PNG decodificado não trouxe nenhum quadro.');
    }
    const rgba = new Uint8Array(primeiro);
    const decodeMs = Date.now() - t2;

    if (png.width !== FACENET_IMAGE_SIZE || png.height !== FACENET_IMAGE_SIZE) {
      throw new PipelineError(`PNG decodificado em ${png.width}x${png.height}.`);
    }

    // 4. Tensor CHW padronizado.
    const t3 = Date.now();
    const tensor = rgbaToChwTensor(rgba, FACENET_IMAGE_SIZE);
    const tensorMs = Date.now() - t3;

    // 5. Inferência.
    const { embedding, inferenceMs } = await session.embed(tensor);
    result.embedding = embedding;
    result.embeddingDim = embedding.length;
    result.embeddingNorm = l2Norm(embedding);

    result.timings = { detectMs, cropMs, decodeMs, tensorMs, inferenceMs };
  } catch (caught) {
    result.error = caught instanceof Error ? caught.message : String(caught);
  }

  return result;
};

/**
 * Wrapper compatível com o comportamento atual: extração → embedding →
 * comparação com a galeria local → `PipelineResult`.
 *
 * Continua sendo o que `useAutoFaceRecognition` e o diagnóstico chamam;
 * nada muda para eles. Nenhum limiar é ajustado aqui: a regra é aplicada
 * tal como está e o resultado bruto vai inteiro para a tela.
 */
export const analyzePhoto = async (input: {
  photoUri: string;
  photoWidth: number;
  photoHeight: number;
  detector: FaceDetector;
  session: FaceNetSession;
}): Promise<PipelineResult> => {
  const inicioTotal = Date.now();
  const extraction = await extractFaceEmbedding(input);

  const result: PipelineResult = {
    facesDetected: extraction.facesDetected,
    imageWidth: extraction.imageWidth,
    imageHeight: extraction.imageHeight,
    rawBox: extraction.rawBox,
    cropBox: extraction.cropBox,
    headEulerAngleX: extraction.headEulerAngleX,
    headEulerAngleY: extraction.headEulerAngleY,
    headEulerAngleZ: extraction.headEulerAngleZ,
    trackingId: extraction.trackingId,
    embeddingDim: extraction.embeddingDim,
    embeddingNorm: extraction.embeddingNorm,
    match: null,
    timings: null,
    cropPreviewUri: extraction.cropPreviewUri,
    error: extraction.error,
  };

  const { embedding, timings: extractionTimings } = extraction;
  if (extraction.error || !embedding || !extractionTimings) {
    result.timings = extractionTimings
      ? { ...extractionTimings, matchMs: 0, totalMs: Date.now() - inicioTotal }
      : null;
    return result;
  }

  try {
    // 6. Comparação com a galeria.
    const t5 = Date.now();
    result.match = matchAgainstGallery(embedding, loadMockGallery());
    const matchMs = Date.now() - t5;

    result.timings = { ...extractionTimings, matchMs, totalMs: Date.now() - inicioTotal };
  } catch (caught) {
    result.error = caught instanceof Error ? caught.message : String(caught);
  }

  return result;
};
