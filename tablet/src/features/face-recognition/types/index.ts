/**
 * Pessoa identificada.
 *
 * `matricula`/`setor`/`email` são opcionais porque o reconhecimento facial
 * local (ML Kit + FaceNet + galeria de embeddings) só conhece `id` e `nome`
 * hoje — são os únicos dados que a galeria de enrollment carrega. Quando o
 * backend/pgvector assumir a identificação, a mesma sessão poderá receber o
 * registro completo sem que este tipo precise mudar de formato.
 */
export interface RecognizedEmployee {
  id: string;
  nome: string;
  email?: string;
  matricula?: string;
  setor?: string;
}

/** Reconhecimento bem-sucedido: pessoa identificada acima do limiar. */
export interface FaceRecognized {
  status: 'recognized';
  employee: RecognizedEmployee;
  /** Similaridade normalizada entre 0 e 1. */
  confidence: number;
}

/**
 * Nenhuma pessoa correspondeu com confiança suficiente. Também cobre o caso
 * ambíguo, em que dois cadastros ficam próximos demais para decidir.
 */
export interface FaceUnknown {
  status: 'unknown';
  confidence: number;
}

export type FaceRecognitionResult = FaceRecognized | FaceUnknown;

export interface FaceRecognitionInput {
  /** Permite abortar quando a pessoa sai do terminal. */
  signal?: AbortSignal;
}

/**
 * Contrato do reconhecimento facial.
 *
 * Hoje é satisfeito por um mock; amanhã, pelo cliente do dispositivo
 * embarcado, sem que nenhuma tela precise mudar.
 */
export interface FaceRecognitionService {
  recognize(input: FaceRecognitionInput): Promise<FaceRecognitionResult>;
}
