import { colors } from './colors';
import { radii } from './radii';
import { shadows } from './shadows';
import { MIN_TOUCH_TARGET, TERMINAL_TOUCH_TARGET, spacing } from './spacing';
import { typography } from './typography';

export const theme = {
  colors,
  spacing,
  typography,
  radii,
  shadows,
  minTouchTarget: MIN_TOUCH_TARGET,
  terminalTouchTarget: TERMINAL_TOUCH_TARGET,
} as const;

export type Theme = typeof theme;

export { colors, radii, shadows, spacing, typography, MIN_TOUCH_TARGET, TERMINAL_TOUCH_TARGET };

export type { AppColors } from './colors';
export type { RadiusToken } from './radii';
export type { ShadowToken } from './shadows';
export type { SpacingToken } from './spacing';
export type { TypographyToken } from './typography';
