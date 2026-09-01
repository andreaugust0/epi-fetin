import * as Crypto from 'expo-crypto';

/** Identificador único para resultados de análise e registros locais. */
export const createId = (): string => Crypto.randomUUID();
