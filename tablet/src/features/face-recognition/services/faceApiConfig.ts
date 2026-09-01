import { env } from '@/services/env';

import { faceApiOverrideStore } from './faceApiOverrideStore';

export type ConfigSource = 'override' | 'env';

export interface FaceApiConfig {
  baseUrl: string;
  /** Ponto de acesso (`ponto_id`) onde este tablet está instalado. */
  pointId: number;
}

/** Estado completo, incluindo de onde cada valor veio — para telas administrativas. */
export interface FaceApiConfigStatus {
  baseUrl: string | null;
  baseUrlSource: ConfigSource | null;
  pointId: number | null;
  pointIdSource: ConfigSource | null;
}

export class FaceApiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaceApiConfigError';
  }
}

/** `http(s)://host[:porta][/caminho]` — exige esquema e host, porta é opcional. */
const BASE_URL_PATTERN = /^https?:\/\/[^\s/:]+(:\d+)?(\/.*)?$/i;

export const isValidBaseUrl = (value: string): boolean => BASE_URL_PATTERN.test(value.trim());

const parsePointIdString = (raw: string | undefined): number | null => {
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

/** Aceita só um `pointId` de override que já seja um inteiro positivo de verdade. */
const sanitizeOverridePointId = (value: number | undefined): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;

/**
 * Resolve o estado atual de configuração, priorizando o override local
 * (`faceApiOverrideStore`, gravado pela tela de provisionamento) sobre as
 * variáveis de ambiente (`EXPO_PUBLIC_FACE_API_URL`/`_FACE_POINT_ID`).
 *
 * O override é lido de AsyncStorage e tratado como não confiável: um valor
 * malformado nele (storage corrompido, edição manual) é ignorado e cai para
 * o próximo nível — nunca propaga um valor inválido.
 */
export const resolveFaceApiConfig = async (): Promise<FaceApiConfigStatus> => {
  const override = await faceApiOverrideStore.get();

  const overrideUrl =
    typeof override?.baseUrl === 'string' && isValidBaseUrl(override.baseUrl)
      ? override.baseUrl
      : null;
  const baseUrl = overrideUrl ?? env.faceApiUrl ?? null;
  const baseUrlSource: ConfigSource | null = overrideUrl ? 'override' : baseUrl ? 'env' : null;

  const overridePointId = sanitizeOverridePointId(override?.pointId);
  const pointId = overridePointId ?? parsePointIdString(env.facePointIdRaw);
  const pointIdSource: ConfigSource | null = overridePointId
    ? 'override'
    : pointId
      ? 'env'
      : null;

  return { baseUrl, baseUrlSource, pointId, pointIdSource };
};

/**
 * Configuração pública (não-segredo) necessária para chamar o endpoint de
 * identificação facial: URL base e ponto de acesso.
 *
 * O JWT do dispositivo NÃO faz parte disso de propósito — é uma credencial,
 * não configuração pública, e vem de `deviceTokenStore` (SecureStore).
 */
export const getFaceApiConfig = async (): Promise<FaceApiConfig> => {
  const status = await resolveFaceApiConfig();
  if (!status.baseUrl) {
    throw new FaceApiConfigError(
      'Nenhuma URL de API configurada (nem localmente, nem em EXPO_PUBLIC_FACE_API_URL).',
    );
  }
  if (!status.pointId) {
    throw new FaceApiConfigError(
      'Nenhum ponto de acesso configurado (nem localmente, nem em EXPO_PUBLIC_FACE_POINT_ID).',
    );
  }
  return { baseUrl: status.baseUrl, pointId: status.pointId };
};

export const isFaceApiConfigured = async (): Promise<boolean> => {
  const status = await resolveFaceApiConfig();
  return status.baseUrl !== null && status.pointId !== null;
};

export const isFaceApiUrlConfigured = async (): Promise<boolean> =>
  (await resolveFaceApiConfig()).baseUrl !== null;

export const isFacePointIdConfigured = async (): Promise<boolean> =>
  (await resolveFaceApiConfig()).pointId !== null;
