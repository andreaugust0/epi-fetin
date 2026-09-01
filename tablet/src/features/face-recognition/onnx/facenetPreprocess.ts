import { FACENET_INPUT_LENGTH } from './facenetProbeCore';

/** Lado da imagem que o FaceNet espera. */
export const FACENET_IMAGE_SIZE = 160;

/**
 * Padronização do `facenet-pytorch`.
 *
 * `fixed_image_standardization`, aplicada pelo MTCNN quando `post_process` é
 * verdadeiro — o padrão, e o que o enrollment usou:
 *
 *     (pixel - 127.5) / 128.0
 *
 * Não é `pixel / 255`, não é média/desvio do ImageNet. O grafo ONNX não traz
 * nenhum nó de normalização antes da primeira convolução, então este passo
 * precisa acontecer aqui.
 */
export const standardizePixel = (pixel: number): number => (pixel - 127.5) / 128;

export class PreprocessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreprocessError';
  }
}

/**
 * Converte pixels RGBA em um tensor CHW pronto para o FaceNet.
 *
 * Entrada: `Uint8ClampedArray`/`Uint8Array` com `size * size * 4` valores, na
 * ordem R, G, B, A — o que o decodificador de PNG devolve.
 *
 * Saída: `Float32Array` com 3 * size * size valores, agrupados por canal
 * (todos os R, depois todos os G, depois todos os B). O alpha é descartado.
 *
 * Falha alto: tamanho inesperado vira erro, nunca um tensor truncado em
 * silêncio, porque um tensor errado produziria um embedding plausível e
 * completamente sem sentido.
 */
export const rgbaToChwTensor = (
  rgba: Uint8Array | Uint8ClampedArray,
  size: number = FACENET_IMAGE_SIZE,
): Float32Array => {
  const esperado = size * size * 4;
  if (rgba.length !== esperado) {
    throw new PreprocessError(
      `Buffer RGBA com ${rgba.length} valores, esperado ${esperado} para ${size}x${size}.`,
    );
  }

  const pixels = size * size;
  const tensor = new Float32Array(pixels * 3);

  for (let i = 0; i < pixels; i += 1) {
    const origem = i * 4;
    // Layout CHW: canal inteiro de cada vez, não pixel a pixel.
    tensor[i] = standardizePixel(rgba[origem] as number);
    tensor[pixels + i] = standardizePixel(rgba[origem + 1] as number);
    tensor[pixels * 2 + i] = standardizePixel(rgba[origem + 2] as number);
  }

  if (size === FACENET_IMAGE_SIZE && tensor.length !== FACENET_INPUT_LENGTH) {
    throw new PreprocessError(
      `Tensor com ${tensor.length} valores, esperado ${FACENET_INPUT_LENGTH}.`,
    );
  }

  return tensor;
};

/** Norma L2 de um vetor — usada para conferir a saída do modelo. */
export const l2Norm = (values: ArrayLike<number>): number => {
  let soma = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] as number;
    soma += v * v;
  }
  return Math.sqrt(soma);
};
