/**
 * Parte testável da prova de conceito do FaceNet ONNX.
 *
 * Nada aqui toca o runtime nativo: são só as constantes do modelo, a entrada
 * artificial e a verificação da saída. É o que permite cobrir a lógica no
 * Jest sem tentar carregar o ONNX Runtime, que só existe no dispositivo.
 */

/** Formato de entrada do modelo convertido: lote, canais, altura, largura. */
export const FACENET_INPUT_DIMS = [1, 3, 160, 160] as const;

/** Embedding produzido pelo InceptionResnetV1 treinado com VGGFace2. */
export const FACENET_OUTPUT_DIMS = [1, 512] as const;

export const FACENET_INPUT_LENGTH = 1 * 3 * 160 * 160;

export const FACENET_EMBEDDING_LENGTH = 512;

/**
 * Entrada artificial com os 76800 valores esperados.
 *
 * O embedding resultante não tem significado nenhum nesta etapa — a intenção
 * é apenas alimentar o grafo com um tensor válido. A rampa é determinística,
 * então duas execuções seguidas produzem exatamente a mesma saída, o que
 * ajuda a distinguir "o modelo rodou" de "veio lixo de memória".
 */
export const createProbeInput = (): Float32Array => {
  const data = new Float32Array(FACENET_INPUT_LENGTH);

  for (let index = 0; index < data.length; index += 1) {
    // Mantém os valores em [-1, 1), a faixa que o FaceNet espera após a
    // normalização usual das imagens.
    data[index] = ((index % 256) - 128) / 128;
  }

  return data;
};

export interface OutputCheck {
  ok: boolean;
  /** Nulo quando a saída está correta. */
  reason: string | null;
}

/** Confere se a saída tem exatamente o formato e a contagem esperados. */
export const checkProbeOutput = (
  dims: readonly number[] | undefined,
  length: number | undefined,
): OutputCheck => {
  if (!dims || length === undefined) {
    return { ok: false, reason: 'A execução não devolveu nenhum tensor de saída.' };
  }

  const expected = [...FACENET_OUTPUT_DIMS];
  const sameShape = dims.length === expected.length && dims.every((dim, i) => dim === expected[i]);

  if (!sameShape) {
    return {
      ok: false,
      reason: `Formato inesperado: ${formatDims(dims)}, esperado ${formatDims(expected)}.`,
    };
  }

  if (length !== FACENET_EMBEDDING_LENGTH) {
    return {
      ok: false,
      reason: `Quantidade inesperada: ${length} valores, esperado ${FACENET_EMBEDDING_LENGTH}.`,
    };
  }

  return { ok: true, reason: null };
};

/** Formata dimensões para leitura na tela de diagnóstico: `[1, 3, 160, 160]`. */
export const formatDims = (dims: readonly (number | string)[] | undefined): string =>
  dims && dims.length > 0 ? `[${dims.join(', ')}]` : '—';
