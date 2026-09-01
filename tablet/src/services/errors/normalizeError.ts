import { APP_MESSAGES } from '@/constants/messages';

import { AppError, isAppError, type AppErrorCode } from './AppError';

const FALLBACK_MESSAGE = APP_MESSAGES.states.genericErrorDescription;

/** Converte qualquer valor lançado em um `AppError` com código conhecido. */
export const normalizeError = (
  error: unknown,
  fallbackCode: AppErrorCode = 'unknown',
): AppError => {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return new AppError('timeout', error.message || FALLBACK_MESSAGE, error);
    }
    if (/network request failed|failed to fetch/i.test(error.message)) {
      return new AppError('network', error.message, error);
    }
    return new AppError(fallbackCode, error.message || FALLBACK_MESSAGE, error);
  }

  return new AppError(fallbackCode, FALLBACK_MESSAGE, error);
};

interface ErrorPresentation {
  title: string;
  description: string;
}

/** Título e descrição prontos para exibição, derivados do código do erro. */
export const describeError = (error: unknown): ErrorPresentation => {
  const appError = normalizeError(error);

  switch (appError.code) {
    case 'network':
    case 'timeout':
      return {
        title: APP_MESSAGES.states.offlineTitle,
        description: APP_MESSAGES.states.offlineDescription,
      };
    case 'invalid_image':
      return {
        title: APP_MESSAGES.camera.captureErrorTitle,
        description: APP_MESSAGES.camera.captureErrorDescription,
      };
    case 'device_unsupported':
      return {
        title: APP_MESSAGES.camera.unavailableTitle,
        description: APP_MESSAGES.camera.unavailableDescription,
      };
    case 'permission_denied':
      return {
        title: APP_MESSAGES.camera.permissionDeniedTitle,
        description: APP_MESSAGES.camera.permissionDeniedDescription,
      };
    default:
      return {
        title: APP_MESSAGES.states.genericErrorTitle,
        description: APP_MESSAGES.states.genericErrorDescription,
      };
  }
};
