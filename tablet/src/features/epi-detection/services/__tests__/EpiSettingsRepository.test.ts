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

  /**
   * Este teste já afirmou o contrário, e fixava um defeito.
   *
   * Voltar ao padrão diante de uma lista vazia GRAVADA invertia a intenção de
   * quem a gravou: tirar todas as exigências no painel fazia o terminal passar
   * a exigir os sete equipamentos. Quem quis liberar a passagem obteve o
   * oposto, e nada na tela explicava por quê.
   *
   * Vazio é uma resposta. Ausência de resposta é o caso do teste acima, em que
   * não há nada gravado — e aí exigir tudo é o lado seguro de errar.
   */
  it('respeita a lista vazia salva', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.requiredEpis, JSON.stringify([]));

    await expect(epiSettingsRepository.getRequiredEpis()).resolves.toEqual([]);
  });
});
