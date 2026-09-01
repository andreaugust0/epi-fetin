import AsyncStorage from '@react-native-async-storage/async-storage';

import { STORAGE_KEYS } from '@/constants/detection';
import { DEFAULT_REQUIRED_EPI_IDS } from '@/constants/epiCatalog';

import { epiSettingsRepository } from '../EpiSettingsRepository';

describe('epiSettingsRepository', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('devolve todos os equipamentos por padrão', async () => {
    await expect(epiSettingsRepository.getRequiredEpis()).resolves.toEqual([
      ...DEFAULT_REQUIRED_EPI_IDS,
    ]);
  });

  it('persiste e recupera a seleção', async () => {
    await epiSettingsRepository.setRequiredEpis(['capacete', 'botas']);

    await expect(epiSettingsRepository.getRequiredEpis()).resolves.toEqual(['capacete', 'botas']);
  });

  it('descarta identificadores desconhecidos', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEYS.requiredEpis,
      JSON.stringify(['capacete', 'paraquedas']),
    );

    await expect(epiSettingsRepository.getRequiredEpis()).resolves.toEqual(['capacete']);
  });

  it('volta ao padrão quando a lista salva fica vazia', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.requiredEpis, JSON.stringify([]));

    await expect(epiSettingsRepository.getRequiredEpis()).resolves.toEqual([
      ...DEFAULT_REQUIRED_EPI_IDS,
    ]);
  });
});
