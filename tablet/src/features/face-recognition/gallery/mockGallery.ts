import { assertValidEmbedding, type GalleryEntry } from './matchEmbedding';

/**
 * Galeria simulada de enrollment.
 *
 * Os embeddings foram gerados no PC com o mesmo FaceNet (facenet-pytorch,
 * MTCNN, `image_size=160`, `margin=0`) e já vêm L2-normalizados. São dados
 * biométricos: existem aqui apenas para esta prova de conceito e não devem
 * ser copiados para logs, rede ou armazenamento.
 */

const RAW_GALLERY = require('../../../../assets/mock_embeddings.json') as unknown;

interface RawEntry {
  id: number;
  nome: string;
  modelo: string;
  embedding: number[];
}

export class GalleryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GalleryError';
  }
}

/**
 * Valida a galeria na carga, em vez de descobrir um vetor corrompido no meio
 * de uma comparação.
 */
export const loadMockGallery = (): GalleryEntry[] => {
  if (!Array.isArray(RAW_GALLERY)) {
    throw new GalleryError('A galeria simulada não é uma lista.');
  }

  return (RAW_GALLERY as RawEntry[]).map((entry, index) => {
    if (typeof entry?.nome !== 'string' || !Array.isArray(entry?.embedding)) {
      throw new GalleryError(`Entrada ${index} da galeria está incompleta.`);
    }

    assertValidEmbedding(entry.embedding, `Galeria (${entry.nome})`);

    return { id: entry.id, nome: entry.nome, embedding: entry.embedding };
  });
};
