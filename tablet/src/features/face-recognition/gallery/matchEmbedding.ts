/**
 * Comparação de embeddings faciais. Aritmética pura, testável sem
 * dispositivo, modelo ou câmera.
 */

/** Limiares de referência, os mesmos do backend. Não ajustar sem dados. */
export const FACE_DISTANCIA_MAX = 0.4;
export const FACE_RAZAO_MIN = 1.15;

export const EMBEDDING_DIM = 512;

/** Abaixo disso a razão não tem significado e vira divisão instável. */
const DISTANCIA_MINIMA_PARA_RAZAO = 1e-6;

export interface GalleryEntry {
  id: number;
  nome: string;
  embedding: number[];
}

export interface Candidate {
  /** O mesmo `id` da `GalleryEntry` de origem — não um índice nem o nome. */
  id: number;
  nome: string;
  distance: number;
}

export interface MatchResult {
  candidates: Candidate[];
  best: Candidate | null;
  second: Candidate | null;
  /** Nulo quando não há segundo candidato ou a melhor distância é ~zero. */
  ratio: number | null;
  passesDistance: boolean;
  passesRatio: boolean;
  passes: boolean;
}

export class MatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MatchError';
  }
}

/** Rejeita vetores que produziriam distâncias sem significado. */
export const assertValidEmbedding = (values: ArrayLike<number>, rotulo: string): void => {
  if (values.length !== EMBEDDING_DIM) {
    throw new MatchError(`${rotulo}: dimensão ${values.length}, esperado ${EMBEDDING_DIM}.`);
  }
  for (let i = 0; i < values.length; i += 1) {
    if (!Number.isFinite(values[i] as number)) {
      throw new MatchError(`${rotulo}: valor não finito na posição ${i}.`);
    }
  }
};

/**
 * Distância de cosseno assumindo vetores de norma 1.
 *
 * Tanto a galeria quanto a saída do modelo já são L2-normalizadas — o grafo
 * ONNX termina em `ReduceL2` + `Div` —, então o produto escalar já é o
 * cosseno e nenhuma renormalização é feita aqui.
 */
export const cosineDistance = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let produto = 0;
  for (let i = 0; i < a.length; i += 1) {
    produto += (a[i] as number) * (b[i] as number);
  }
  return 1 - produto;
};

/**
 * Compara um embedding contra a galeria inteira e aplica a regra atual.
 *
 * Devolve todos os candidatos ordenados, não só o vencedor: nesta fase os
 * números brutos valem mais que o veredito.
 */
export const matchAgainstGallery = (
  probe: ArrayLike<number>,
  gallery: readonly GalleryEntry[],
): MatchResult => {
  assertValidEmbedding(probe, 'Embedding capturado');

  const candidates = gallery
    .map((entry) => {
      assertValidEmbedding(entry.embedding, `Galeria (${entry.nome})`);
      return { id: entry.id, nome: entry.nome, distance: cosineDistance(probe, entry.embedding) };
    })
    .sort((a, b) => a.distance - b.distance);

  const best = candidates[0] ?? null;
  const second = candidates[1] ?? null;

  // Distância ~zero significa embedding idêntico: a razão explodiria, então
  // é tratada como ausente em vez de virar Infinity.
  const ratio =
    best && second && best.distance > DISTANCIA_MINIMA_PARA_RAZAO
      ? second.distance / best.distance
      : null;

  const passesDistance = best !== null && best.distance <= FACE_DISTANCIA_MAX;
  // Sem segundo candidato não há ambiguidade a resolver: a distância decide.
  const passesRatio = second === null ? passesDistance : ratio !== null && ratio >= FACE_RAZAO_MIN;

  return {
    candidates,
    best,
    second,
    ratio,
    passesDistance,
    passesRatio,
    passes: passesDistance && passesRatio,
  };
};
