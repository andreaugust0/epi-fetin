import { storageClient } from '@/services/storage/storageClient';

const KEY = '@epi-fetin/face-api-override';

/**
 * Override local, não-secreto, de URL/ponto do backend de identificação.
 *
 * Existe para não depender de uma nova build sempre que o IP do backend de
 * desenvolvimento mudar (ex.: rede de hotspot com DHCP). Diferente do JWT do
 * dispositivo — que é credencial e vive só em `deviceTokenStore`/SecureStore
 * — URL e ponto_id não são segredo, então AsyncStorage (via `storageClient`,
 * o mesmo usado por `EpiSettingsRepository`) é suficiente.
 */
export interface FaceApiOverride {
  baseUrl?: string;
  pointId?: number;
}

export interface FaceApiOverrideStore {
  /** `null` quando nada foi configurado localmente ainda. */
  get(): Promise<FaceApiOverride | null>;
  set(override: FaceApiOverride): Promise<void>;
  remove(): Promise<void>;
}

export const faceApiOverrideStore: FaceApiOverrideStore = {
  async get() {
    return storageClient.readJson<FaceApiOverride>(KEY);
  },

  async set(override) {
    await storageClient.writeJson(KEY, override);
  },

  async remove() {
    await storageClient.remove(KEY);
  },
};
