import { useCallback } from 'react';

import { DEFAULT_REQUIRED_EPI_IDS } from '@/constants/epiCatalog';
import { useAsyncResource } from '@/hooks/useAsyncResource';
import { normalizeError } from '@/services/errors';

import { epiSettingsRepository } from '../services/EpiSettingsRepository';
import type { EpiId } from '../types';

export interface UseRequiredEpisResult {
  requiredEpis: EpiId[];
  loading: boolean;
  error: unknown;
  setRequiredEpis: (ids: EpiId[]) => Promise<void>;
  reload: () => Promise<void>;
}

const loadRequiredEpis = () => epiSettingsRepository.getRequiredEpis();

/** Lê e grava a lista de equipamentos exigidos, via repositório. */
export const useRequiredEpis = (): UseRequiredEpisResult => {
  const {
    data: requiredEpis,
    setData,
    loading,
    error,
    setError,
    reload,
  } = useAsyncResource<EpiId[]>(loadRequiredEpis, [...DEFAULT_REQUIRED_EPI_IDS]);

  const setRequiredEpis = useCallback(
    async (ids: EpiId[]) => {
      setData(ids);
      try {
        await epiSettingsRepository.setRequiredEpis(ids);
      } catch (caught) {
        setError(normalizeError(caught, 'storage'));
      }
    },
    [setData, setError],
  );

  return { requiredEpis, loading, error, setRequiredEpis, reload };
};
