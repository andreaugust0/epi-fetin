jest.mock('@/services/env', () => ({
  env: {
    faceApiUrl: undefined as string | undefined,
    facePointIdRaw: undefined as string | undefined,
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

import { env } from '@/services/env';

import {
  FaceApiConfigError,
  getFaceApiConfig,
  isFaceApiConfigured,
  isFaceApiUrlConfigured,
  isFacePointIdConfigured,
  isValidBaseUrl,
  resolveFaceApiConfig,
} from '../faceApiConfig';
import { faceApiOverrideStore } from '../faceApiOverrideStore';

interface MutableFaceEnv {
  faceApiUrl: string | undefined;
  facePointIdRaw: string | undefined;
}

const mutableEnv = env as unknown as MutableFaceEnv;

describe('isValidBaseUrl', () => {
  it.each([
    'http://192.168.0.10:8000',
    'https://api.example.com',
    'http://localhost:8000',
    'https://api.example.com/v1',
  ])('aceita %s', (value) => {
    expect(isValidBaseUrl(value)).toBe(true);
  });

  it.each(['', '   ', 'ftp://api.example.com', 'api.example.com', 'http://', 'not a url'])(
    'rejeita %s',
    (value) => {
      expect(isValidBaseUrl(value)).toBe(false);
    },
  );
});

describe('getFaceApiConfig / resolveFaceApiConfig', () => {
  beforeEach(async () => {
    mutableEnv.faceApiUrl = undefined;
    mutableEnv.facePointIdRaw = undefined;
    await AsyncStorage.clear();
  });

  it('usa EXPO_PUBLIC_* quando não há override local (fallback)', async () => {
    mutableEnv.faceApiUrl = 'https://api.example.test';
    mutableEnv.facePointIdRaw = '1';

    await expect(getFaceApiConfig()).resolves.toEqual({
      baseUrl: 'https://api.example.test',
      pointId: 1,
    });

    const status = await resolveFaceApiConfig();
    expect(status.baseUrlSource).toBe('env');
    expect(status.pointIdSource).toBe('env');
  });

  it('override local tem prioridade sobre EXPO_PUBLIC_*', async () => {
    mutableEnv.faceApiUrl = 'https://env.example.test';
    mutableEnv.facePointIdRaw = '1';
    await faceApiOverrideStore.set({ baseUrl: 'http://192.168.0.10:8000', pointId: 2 });

    const config = await getFaceApiConfig();
    expect(config).toEqual({ baseUrl: 'http://192.168.0.10:8000', pointId: 2 });

    const status = await resolveFaceApiConfig();
    expect(status.baseUrlSource).toBe('override');
    expect(status.pointIdSource).toBe('override');
  });

  it('override parcial: usa override de URL e env de pointId, cada um independente', async () => {
    mutableEnv.faceApiUrl = 'https://env.example.test';
    mutableEnv.facePointIdRaw = '5';
    await faceApiOverrideStore.set({ baseUrl: 'http://192.168.0.10:8000' });

    const status = await resolveFaceApiConfig();
    expect(status.baseUrl).toBe('http://192.168.0.10:8000');
    expect(status.baseUrlSource).toBe('override');
    expect(status.pointId).toBe(5);
    expect(status.pointIdSource).toBe('env');
  });

  it('ignora override de URL malformado e cai para o env', async () => {
    mutableEnv.faceApiUrl = 'https://env.example.test';
    await faceApiOverrideStore.set({ baseUrl: 'nao-e-uma-url' });

    const status = await resolveFaceApiConfig();
    expect(status.baseUrl).toBe('https://env.example.test');
    expect(status.baseUrlSource).toBe('env');
  });

  it('lança FaceApiConfigError quando a URL está ausente (sem override, sem env)', async () => {
    mutableEnv.facePointIdRaw = '1';

    await expect(getFaceApiConfig()).rejects.toThrow(FaceApiConfigError);
  });

  it('lança FaceApiConfigError quando o ponto_id está ausente', async () => {
    mutableEnv.faceApiUrl = 'https://api.example.test';

    await expect(getFaceApiConfig()).rejects.toThrow(FaceApiConfigError);
  });

  it.each(['0', '-3', 'abc', '1.5'])(
    'lança FaceApiConfigError quando o ponto_id do env é inválido (%s)',
    async (invalid) => {
      mutableEnv.faceApiUrl = 'https://api.example.test';
      mutableEnv.facePointIdRaw = invalid;

      await expect(getFaceApiConfig()).rejects.toThrow(FaceApiConfigError);
    },
  );

  it('override e reset: remover o override volta a usar o env', async () => {
    mutableEnv.faceApiUrl = 'https://env.example.test';
    mutableEnv.facePointIdRaw = '1';
    await faceApiOverrideStore.set({ baseUrl: 'http://192.168.0.10:8000', pointId: 2 });

    expect((await resolveFaceApiConfig()).baseUrlSource).toBe('override');

    await faceApiOverrideStore.remove();

    const status = await resolveFaceApiConfig();
    expect(status.baseUrl).toBe('https://env.example.test');
    expect(status.baseUrlSource).toBe('env');
    expect(status.pointId).toBe(1);
    expect(status.pointIdSource).toBe('env');
  });

  it('isFaceApiConfigured / isFaceApiUrlConfigured / isFacePointIdConfigured refletem o estado', async () => {
    await expect(isFaceApiConfigured()).resolves.toBe(false);
    await expect(isFaceApiUrlConfigured()).resolves.toBe(false);
    await expect(isFacePointIdConfigured()).resolves.toBe(false);

    await faceApiOverrideStore.set({ baseUrl: 'http://192.168.0.10:8000', pointId: 1 });

    await expect(isFaceApiConfigured()).resolves.toBe(true);
    await expect(isFaceApiUrlConfigured()).resolves.toBe(true);
    await expect(isFacePointIdConfigured()).resolves.toBe(true);
  });
});
