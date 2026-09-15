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

    /*
     * Lista vazia GRAVADA é uma resposta, não ausência de resposta.
     *
     * Antes, uma lista vazia caía no padrão de sete equipamentos, e o efeito
     * era absurdo: tirar todas as exigências no painel fazia o tablet passar a
     * exigir tudo. Quem quis liberar a passagem obteve o oposto.
     *
     * O padrão continua valendo quando NÃO HÁ nada gravado (`stored` não é
     * array) — aí sim é ausência de configuração, e exigir tudo é o lado
     * seguro de errar.
     */
    return stored.filter((item): item is EpiId => typeof item === 'string' && isEpiId(item));
  },

  async setRequiredEpis(ids) {
    await storageClient.writeJson(STORAGE_KEYS.requiredEpis, ids);
  },
};
