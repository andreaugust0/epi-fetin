import AsyncStorage from '@react-native-async-storage/async-storage';

import { AppError } from '@/services/errors';

/**
 * Único módulo que fala com o AsyncStorage. Telas e componentes usam sempre um
 * repositório, nunca esta camada diretamente.
 */
export const storageClient = {
  async readJson<TValue>(key: string): Promise<TValue | null> {
    try {
      const raw = await AsyncStorage.getItem(key);
      return raw ? (JSON.parse(raw) as TValue) : null;
    } catch (error) {
      throw new AppError('storage', `Não foi possível ler "${key}".`, error);
    }
  },

  async writeJson<TValue>(key: string, value: TValue): Promise<void> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      throw new AppError('storage', `Não foi possível salvar "${key}".`, error);
    }
  },

  async remove(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      throw new AppError('storage', `Não foi possível apagar "${key}".`, error);
    }
  },
};
