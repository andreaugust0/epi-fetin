/**
 * Contrato HTTP de identificação facial via servidor.
 *
 * Espelha `IdentificacaoIn`/`IdentificacaoOut` do backend
 * (`POST /api/v1/identificacao`, `epi-fetin/servidor/app/schemas/api.py`).
 * Os nomes de campo em português (`ponto_id`, `resultado`, ...) são
 * mantidos de propósito: é literalmente o JSON que atravessa a rede.
 */

/** Identificador do modelo facial aceito pelo backend (`FACE_MODELO`). */
export const FACE_MODEL_ID = 'facenet512-v1';

/** Resultados possíveis devolvidos pelo backend para uma tentativa. */
export type FaceIdentificationResultado =
  | 'IDENTIFICADO'
  | 'NAO_IDENTIFICADO'
  | 'AMBIGUO'
  | 'SEM_CONSENTIMENTO';

export interface FaceIdentificationRequest {
  ponto_id: number;
  modelo: string;
  embedding: number[];
}

export interface FaceIdentificationResponse {
  identificacao_id: string | null;
  resultado: FaceIdentificationResultado;
  pessoa_id: number | null;
  nome: string | null;
  /** Só vem preenchida quando o backend está com `DEBUG=True`. */
  distancia: number | null;
  /** ISO 8601. Só preenchida quando `resultado === 'IDENTIFICADO'`. */
  expira_em: string | null;
}
