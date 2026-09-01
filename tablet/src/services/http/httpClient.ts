import { AppError, normalizeError } from '@/services/errors';

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: BodyInit;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20000;

/**
 * Cliente HTTP mínimo com timeout e erros normalizados.
 * Não guarda credenciais: chaves e URLs vêm de variáveis de ambiente.
 */
export const requestJson = async <TResponse>(
  url: string,
  { method = 'GET', body, headers, timeoutMs = DEFAULT_TIMEOUT_MS }: HttpRequestOptions = {},
): Promise<TResponse> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...headers },
      ...(body ? { body } : {}),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new AppError('invalid_response', `A análise falhou com o status ${response.status}.`);
    }

    return (await response.json()) as TResponse;
  } catch (error) {
    throw normalizeError(error, 'network');
  } finally {
    clearTimeout(timeoutId);
  }
};
