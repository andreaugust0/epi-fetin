import * as SecureStore from 'expo-secure-store';

import { AppError } from '@/services/errors';

/**
 * SecureStore só aceita chaves alfanuméricas + "." "-" "_" (sem "@" nem "/") —
 * `ensureValidKey`/`isValidKey` em `expo-secure-store/src/SecureStore.ts`
 * (regex `/^[\w.-]+$/`, não exportada publicamente). Diferente de
 * AsyncStorage, que aceita qualquer string. Não copie o padrão `@escopo/nome`
 * usado em chaves de AsyncStorage (ex.: `faceApiOverrideStore`) para cá.
 */
export const DEVICE_TOKEN_KEY = 'epi-fetin.device-token';

export interface DeviceTokenStore {
  /** `null` quando nenhum token foi provisionado ainda. */
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  remove(): Promise<void>;
}

/** Detalhe técnico seguro para diagnóstico: nome/mensagem do erro, nunca o token. */
const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/**
 * Único módulo que fala com o SecureStore para o JWT do dispositivo (tablet).
 *
 * O JWT é uma credencial, não uma preferência: por isso SecureStore
 * (Keystore/Keychain), nunca AsyncStorage. Nenhuma função aqui loga o valor
 * do token — nem em sucesso, nem no `AppError` de falha. O detalhe técnico
 * embutido na mensagem do `AppError` (nome/mensagem do erro do SecureStore)
 * é seguro de exibir: descreve a chave/operação, nunca o valor gravado.
 */
export const deviceTokenStore: DeviceTokenStore = {
  async get() {
    try {
      return await SecureStore.getItemAsync(DEVICE_TOKEN_KEY);
    } catch (error) {
      throw new AppError(
        'storage',
        `Não foi possível ler o token do dispositivo (${describeError(error)}).`,
        error,
      );
    }
  },

  async set(token) {
    try {
      await SecureStore.setItemAsync(DEVICE_TOKEN_KEY, token);
    } catch (error) {
      throw new AppError(
        'storage',
        `Não foi possível salvar o token do dispositivo (${describeError(error)}).`,
        error,
      );
    }
  },

  async remove() {
    try {
      await SecureStore.deleteItemAsync(DEVICE_TOKEN_KEY);
    } catch (error) {
      throw new AppError(
        'storage',
        `Não foi possível remover o token do dispositivo (${describeError(error)}).`,
        error,
      );
    }
  },
};
