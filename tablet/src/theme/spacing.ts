export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  giant: 56,
} as const;

export type SpacingToken = keyof typeof spacing;

/** Alvo mínimo de toque recomendado pelas diretrizes de acessibilidade. */
export const MIN_TOUCH_TARGET = 48;

/**
 * Altura das ações principais do terminal. Bem acima do mínimo de
 * acessibilidade: o tablet é operado em pé, de relance, às vezes com luvas.
 */
export const TERMINAL_TOUCH_TARGET = 76;
