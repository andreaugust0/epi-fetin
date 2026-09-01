/**
 * Acesso único às variáveis de ambiente públicas do Expo.
 * Nenhuma URL, chave ou token é escrito diretamente no código.
 */
const readString = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const readNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(readString(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const env = {
  epiApiUrl: readString(process.env.EXPO_PUBLIC_EPI_API_URL),
  epiApiTimeoutMs: readNumber(process.env.EXPO_PUBLIC_EPI_API_TIMEOUT_MS, 20000),
  /** URL do backend de identificação facial. Não é segredo. */
  faceApiUrl: readString(process.env.EXPO_PUBLIC_FACE_API_URL),
  /** Ponto de acesso do tablet. String bruta — validação fica em `getFaceApiConfig`. */
  facePointIdRaw: readString(process.env.EXPO_PUBLIC_FACE_POINT_ID),
} as const;

/** Enquanto a URL não for configurada, o app opera em modo simulado. */
export const isApiConfigured = (): boolean => Boolean(env.epiApiUrl);
