import { AppError } from '@/services/errors';

/**
 * Espera um intervalo, respeitando um `AbortSignal`. Rejeita com
 * `AppError('cancelled')` se a operação for interrompida no meio.
 */
export const delay = (milliseconds: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AppError('cancelled', 'Operação cancelada.'));
      return;
    }

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);

    function onAbort() {
      clearTimeout(timeoutId);
      reject(new AppError('cancelled', 'Operação cancelada.'));
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
