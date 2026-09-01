import AsyncStorage from '@react-native-async-storage/async-storage';

import { faceApiOverrideStore } from '../faceApiOverrideStore';

describe('faceApiOverrideStore', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('devolve null quando nada foi configurado ainda', async () => {
    await expect(faceApiOverrideStore.get()).resolves.toBeNull();
  });

  it('persiste e recupera URL e ponto', async () => {
    await faceApiOverrideStore.set({ baseUrl: 'http://192.168.0.10:8000', pointId: 3 });

    await expect(faceApiOverrideStore.get()).resolves.toEqual({
      baseUrl: 'http://192.168.0.10:8000',
      pointId: 3,
    });
  });

  it('sobrescreve o valor anterior ao salvar de novo', async () => {
    await faceApiOverrideStore.set({ baseUrl: 'http://192.168.0.10:8000', pointId: 3 });
    await faceApiOverrideStore.set({ baseUrl: 'http://192.168.0.20:8000', pointId: 1 });

    await expect(faceApiOverrideStore.get()).resolves.toEqual({
      baseUrl: 'http://192.168.0.20:8000',
      pointId: 1,
    });
  });

  it('remove o override', async () => {
    await faceApiOverrideStore.set({ baseUrl: 'http://192.168.0.10:8000', pointId: 3 });
    await faceApiOverrideStore.remove();

    await expect(faceApiOverrideStore.get()).resolves.toBeNull();
  });
});
