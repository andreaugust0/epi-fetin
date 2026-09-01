import { requestJson } from '@/services/http/httpClient';

import {
  FACE_MODEL_ID,
  type FaceIdentificationRequest,
  type FaceIdentificationResponse,
} from '../types/identification';

export interface ApiFaceRecognitionServiceOptions {
  baseUrl: string;
  timeoutMs?: number;
  /** Caminho do endpoint de identificação dentro da API. */
  identifyPath?: string;
}

export interface IdentifyFaceInput {
  /** Embedding L2-normalizado de 512 posições, já pronto pelo FaceNet local. */
  embedding: Float32Array | readonly number[];
  /** Ponto de acesso onde esta tentativa está ocorrendo. */
  pontoId: number;
  /** JWT de dispositivo (`aud=dispositivo`) emitido pelo backend para este tablet. */
  deviceToken: string;
}

const DEFAULT_IDENTIFY_PATH = '/api/v1/identificacao';

/**
 * Cliente HTTP do endpoint de identificação facial do servidor
 * (`POST /api/v1/identificacao`).
 *
 * Não decide nada por conta própria: envia o embedding que o FaceNet local já
 * calculou e devolve exatamente o que o backend respondeu — inclusive os
 * resultados de domínio (`NAO_IDENTIFICADO`, `AMBIGUO`, `SEM_CONSENTIMENTO`),
 * que chegam como HTTP 200 e não são tratados como erro.
 */
export class ApiFaceRecognitionService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number | undefined;
  private readonly identifyPath: string;

  constructor({ baseUrl, timeoutMs, identifyPath }: ApiFaceRecognitionServiceOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.identifyPath = identifyPath ?? DEFAULT_IDENTIFY_PATH;
  }

  async identify({
    embedding,
    pontoId,
    deviceToken,
  }: IdentifyFaceInput): Promise<FaceIdentificationResponse> {
    const payload: FaceIdentificationRequest = {
      ponto_id: pontoId,
      modelo: FACE_MODEL_ID,
      embedding: Array.from(embedding),
    };

    return requestJson<FaceIdentificationResponse>(`${this.baseUrl}${this.identifyPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deviceToken}`,
      },
      body: JSON.stringify(payload),
      ...(this.timeoutMs ? { timeoutMs: this.timeoutMs } : {}),
    });
  }
}
