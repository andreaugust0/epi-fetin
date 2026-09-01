import { STORAGE_KEYS } from '@/constants/detection';
import { DEFAULT_REQUIRED_EPI_IDS } from '@/constants/epiCatalog';
import { storageClient } from '@/services/storage/storageClient';

import { isEpiId, type EpiId } from '../types';

export interface EpiSettingsRepository {
  getRequiredEpis(): Promise<EpiId[]>;
  setRequiredEpis(ids: EpiId[]): Promise<void>;
}

/**
 * Configuração de quais equipamentos são exigidos na verificação — equivale à
 * tela "EPIs Ativos" do painel administrativo do protótipo.
 */
export const epiSettingsRepository: EpiSettingsRepository = {
  async getRequiredEpis() {
    const stored = await storageClient.readJson<unknown>(STORAGE_KEYS.requiredEpis);
    if (!Array.isArray(stored)) {
      return [...DEFAULT_REQUIRED_EPI_IDS];
    }

    const valid = stored.filter((item): item is EpiId => typeof item === 'string' && isEpiId(item));
    return valid.length > 0 ? valid : [...DEFAULT_REQUIRED_EPI_IDS];
  },

  async setRequiredEpis(ids) {
    await storageClient.writeJson(STORAGE_KEYS.requiredEpis, ids);
  },
};
