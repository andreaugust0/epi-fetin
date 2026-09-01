import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import { normalizeError, type AppErrorCode } from '@/services/errors';

export interface UseAsyncResourceResult<TData> {
  data: TData;
  setData: Dispatch<SetStateAction<TData>>;
  loading: boolean;
  error: unknown;
  setError: Dispatch<SetStateAction<unknown>>;
  reload: () => Promise<void>;
}

/**
 * Carrega um recurso assíncrono e expõe os estados de carregamento e erro.
 *
 * O carregamento inicial acontece apenas dentro das continuações da promessa —
 * nenhum `setState` síncrono no corpo do efeito — evitando renderizações em
 * cascata. `load` deve ser estável (`useCallback`).
 */
export const useAsyncResource = <TData>(
  load: () => Promise<TData>,
  initialData: TData,
  errorCode: AppErrorCode = 'storage',
): UseAsyncResourceResult<TData> => {
  const [data, setData] = useState<TData>(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;

    load()
      .then((value) => {
        if (active) {
          setData(value);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(normalizeError(caught, errorCode));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [errorCode, load]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await load());
    } catch (caught) {
      setError(normalizeError(caught, errorCode));
    } finally {
      setLoading(false);
    }
  }, [errorCode, load]);

  return { data, setData, loading, error, setError, reload };
};
