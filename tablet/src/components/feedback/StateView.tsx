import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Button, Text } from '@/components/ui';
import type { MaterialCommunityIconName } from '@/features/epi-detection/types';
import { colors, radii, spacing } from '@/theme';

export interface StateViewAction {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: MaterialCommunityIconName;
  loading?: boolean;
}

export interface StateViewProps {
  icon: MaterialCommunityIconName;
  title: string;
  description?: string;
  tone?: 'neutral' | 'info' | 'warning' | 'danger';
  /** Ajusta o contraste do texto quando o estado aparece sobre fundo escuro. */
  appearance?: 'light' | 'dark';
  actions?: StateViewAction[];
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

const TONES = {
  neutral: { icon: colors.slate[400], background: colors.slate[100] },
  info: { icon: colors.primary, background: colors.primarySoft },
  warning: { icon: colors.status.warningDark, background: colors.status.warningSoft },
  danger: { icon: colors.status.rejectedDark, background: colors.status.rejectedSoft },
} as const;

/**
 * Bloco visual único para estados vazios, de erro, de permissão e de
 * indisponibilidade — evita repetir a mesma composição em cada tela.
 */
export const StateView = ({
  icon,
  title,
  description,
  tone = 'neutral',
  appearance = 'light',
  actions = [],
  compact = false,
  style,
}: StateViewProps) => {
  const palette = TONES[tone];
  const isDark = appearance === 'dark';
  const titleColor = isDark ? colors.white : colors.slate[900];
  const descriptionColor = isDark ? colors.slate[400] : colors.slate[500];

  return (
    <View
      accessible
      accessibilityLabel={description ? `${title}. ${description}` : title}
      style={[styles.container, compact ? styles.compact : null, style]}
    >
      <View style={[styles.iconWrapper, { backgroundColor: palette.background }]}>
        <MaterialCommunityIcons name={icon} size={compact ? 28 : 36} color={palette.icon} />
      </View>

      <View style={styles.texts}>
        <Text variant={compact ? 'subheading' : 'heading'} color={titleColor} align="center">
          {title}
        </Text>
        {description ? (
          <Text variant="body" color={descriptionColor} align="center">
            {description}
          </Text>
        ) : null}
      </View>

      {actions.length > 0 ? (
        <View style={styles.actions}>
          {actions.map((action) => (
            <Button
              key={action.label}
              label={action.label}
              onPress={action.onPress}
              variant={action.variant ?? 'primary'}
              {...(action.icon ? { icon: action.icon } : {})}
              loading={action.loading ?? false}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xxxl,
  },
  compact: {
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  iconWrapper: {
    width: 72,
    height: 72,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: {
    gap: spacing.xs,
    maxWidth: 420,
  },
  actions: {
    alignSelf: 'stretch',
    gap: spacing.md,
    maxWidth: 420,
    width: '100%',
  },
});
