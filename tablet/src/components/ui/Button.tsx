import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import type { MaterialCommunityIconName } from '@/features/epi-detection/types';
import { useTerminalMetrics } from '@/hooks/useTerminalMetrics';
import { colors, radii, shadows, spacing, MIN_TOUCH_TARGET, TERMINAL_TOUCH_TARGET } from '@/theme';

import { Text } from './Text';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'success'
  | 'danger'
  | 'dark';
/** `terminal` é a ação principal do tablet: alta, larga e com texto grande. */
export type ButtonSize = 'medium' | 'large' | 'terminal';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: MaterialCommunityIconName;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

interface VariantStyle {
  background: string;
  pressedBackground: string;
  foreground: string;
  border?: string;
  shadow?: ViewStyle;
}

const VARIANTS: Record<ButtonVariant, VariantStyle> = {
  primary: {
    background: colors.primary,
    pressedBackground: colors.primaryDark,
    foreground: colors.white,
    shadow: shadows.primary,
  },
  secondary: {
    background: colors.white,
    pressedBackground: colors.slate[100],
    foreground: colors.slate[800],
    border: colors.slate[200],
  },
  /** Ação secundária que ainda precisa de presença: contorno na cor primária. */
  outline: {
    background: colors.white,
    pressedBackground: colors.primarySoft,
    foreground: colors.primary,
    border: colors.primary,
  },
  ghost: {
    background: colors.transparent,
    pressedBackground: colors.slate[100],
    foreground: colors.primary,
  },
  success: {
    background: colors.status.approved,
    pressedBackground: colors.status.approvedDark,
    foreground: colors.white,
    shadow: shadows.approved,
  },
  danger: {
    background: colors.status.rejected,
    pressedBackground: colors.status.rejectedDark,
    foreground: colors.white,
  },
  dark: {
    background: colors.slate[900],
    pressedBackground: colors.slate[800],
    foreground: colors.white,
  },
};

export const Button = ({
  label,
  variant = 'primary',
  size = 'medium',
  icon,
  iconPosition = 'left',
  loading = false,
  fullWidth = true,
  disabled,
  style,
  accessibilityLabel,
  ...rest
}: ButtonProps) => {
  const metrics = useTerminalMetrics();
  const palette = VARIANTS[variant];
  const isInteractionBlocked = Boolean(disabled) || loading;
  const isTerminal = size === 'terminal';
  const iconElement = icon ? (
    <MaterialCommunityIcons
      name={icon}
      size={isTerminal ? metrics.buttonIconSize : size === 'large' ? 22 : 20}
      color={palette.foreground}
    />
  ) : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isInteractionBlocked, busy: loading }}
      disabled={isInteractionBlocked}
      style={({ pressed }) => [
        styles.base,
        isTerminal ? styles.terminal : size === 'large' ? styles.large : styles.medium,
        isTerminal ? { minHeight: metrics.buttonHeight } : null,
        fullWidth ? styles.fullWidth : null,
        {
          backgroundColor: pressed ? palette.pressedBackground : palette.background,
          borderColor: palette.border ?? colors.transparent,
          borderWidth: palette.border ? (variant === 'outline' ? 2 : 1) : 0,
        },
        palette.shadow,
        pressed ? styles.pressed : null,
        isInteractionBlocked ? styles.disabled : null,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={palette.foreground} />
      ) : (
        <View style={styles.content}>
          {iconPosition === 'left' ? iconElement : null}
          <Text
            variant={
              isTerminal ? metrics.buttonLabel : size === 'large' ? 'subheading' : 'bodyStrong'
            }
            color={palette.foreground}
            numberOfLines={2}
            align="center"
            style={isTerminal ? styles.terminalLabel : null}
          >
            {label}
          </Text>
          {iconPosition === 'right' ? iconElement : null}
        </View>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.xl,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.xl,
  },
  medium: {
    paddingVertical: spacing.md,
  },
  large: {
    paddingVertical: spacing.lg,
  },
  terminal: {
    minHeight: TERMINAL_TOUCH_TARGET,
    paddingVertical: spacing.xl,
    borderRadius: radii.xxl,
  },
  /** Caixa alta: o rótulo é lido de relance, a alguns metros do terminal. */
  terminalLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  pressed: {
    transform: [{ scale: 0.985 }],
  },
  disabled: {
    opacity: 0.55,
  },
});
