const LOCALE = 'pt-BR';

/** Converte uma confiança normalizada (0–1) em texto percentual, ex.: "94%". */
export const formatConfidence = (confidence: number): string =>
  `${Math.round(clampUnit(confidence) * 100)}%`;

export const clampUnit = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
};

/**
 * Aceita confiança em 0–1 ou 0–100 (APIs variam) e devolve sempre 0–1.
 */
export const normalizeConfidence = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return clampUnit(value > 1 ? value / 100 : value);
};

export const formatTime = (isoDate: string): string =>
  new Date(isoDate).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });

export const formatDate = (isoDate: string): string =>
  new Date(isoDate).toLocaleDateString(LOCALE, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

export const formatShortDate = (isoDate: string): string =>
  new Date(isoDate).toLocaleDateString(LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });

export const formatDateTime = (isoDate: string): string =>
  `${formatShortDate(isoDate)} · ${formatTime(isoDate)}`;

export const formatAccessMoment = (isoDate: string): string =>
  `${formatTime(isoDate)} — ${formatDate(isoDate)}`;

export const formatDuration = (milliseconds: number): string => {
  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)} ms`;
  }
  return `${(milliseconds / 1000).toFixed(1).replace('.', ',')} s`;
};

/** "7 equipamentos" / "1 equipamento". */
export const pluralize = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;
