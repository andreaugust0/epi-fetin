import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radii, shadows, spacing } from '@/theme';

export interface CardProps {
  children: ReactNode;
  variant?: 'elevated' | 'outlined' | 'muted' | 'dark';
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const Card = ({ children, variant = 'elevated', padded = true, style }: CardProps) => (
  <View style={[styles.base, VARIANT_STYLES[variant], padded ? styles.padded : null, style]}>
    {children}
  </View>
);

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.xxl,
  },
  padded: {
    padding: spacing.xl,
  },
  elevated: {
    backgroundColor: colors.white,
    ...shadows.md,
  },
  outlined: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.slate[200],
  },
  muted: {
    backgroundColor: colors.slate[50],
    borderWidth: 1,
    borderColor: colors.slate[100],
  },
  dark: {
    backgroundColor: colors.scanner.panel,
    borderWidth: 1,
    borderColor: colors.overlayBorder,
  },
});

const VARIANT_STYLES: Record<NonNullable<CardProps['variant']>, ViewStyle> = {
  elevated: styles.elevated,
  outlined: styles.outlined,
  muted: styles.muted,
  dark: styles.dark,
};
