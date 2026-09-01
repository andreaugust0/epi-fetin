import { AppError } from '@/services/errors';
import { requestJson } from '@/services/http/httpClient';

import type { AnalyzeImageInput, EpiDetectionResult, EpiDetectionService } from '../types';
import { mapDetectionResponse } from '../utils/mapDetectionResponse';

export interface ApiEpiDetectionServiceOptions {
  baseUrl: string;
  timeoutMs?: number;
  /** Caminho do endpoint de análise dentro da API. */
  analyzePath?: string;
}

const DEFAULT_ANALYZE_PATH = '/analyze';

/**
 * Integração com a API real de visão computacional.
 *
 * Ainda não há um endpoint publicado: a URL vem de `EXPO_PUBLIC_EPI_API_URL` e,
 * enquanto ela estiver vazia, a fábrica de serviços devolve o mock. O envio usa
 * `multipart/form-data`, formato aceito pela maioria dos serviços de inferência.
 * Se o backend definir outro contrato, basta ajustar este arquivo e o mapeador
 * — nenhuma tela precisa mudar.
 */
export class ApiEpiDetectionService implements EpiDetectionService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number | undefined;
  private readonly analyzePath: string;

  constructor({ baseUrl, timeoutMs, analyzePath }: ApiEpiDetectionServiceOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.analyzePath = analyzePath ?? DEFAULT_ANALYZE_PATH;
  }

  async analyzeImage(input: AnalyzeImageInput): Promise<EpiDetectionResult> {
    if (input.requiredItems.length === 0) {
      throw new AppError('invalid_response', 'Nenhum equipamento está ativo para verificação.');
    }

    const startedAt = Date.now();

    const payload = await requestJson<unknown>(`${this.baseUrl}${this.analyzePath}`, {
      method: 'POST',
      body: JSON.stringify({ requiredItems: input.requiredItems }),
      headers: { 'Content-Type': 'application/json' },
      ...(this.timeoutMs ? { timeoutMs: this.timeoutMs } : {}),
    });

    return mapDetectionResponse(payload, input, Date.now() - startedAt);
  }
}
