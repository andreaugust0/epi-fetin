import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/ui';
import type { MaterialCommunityIconName } from '@/features/epi-detection/types';
import { colors, radii, spacing } from '@/theme';

export type InlineNoticeTone = 'neutral' | 'info' | 'warning';

export interface InlineNoticeProps {
  message: string;
  icon: MaterialCommunityIconName;
  tone?: InlineNoticeTone;
  style?: StyleProp<ViewStyle>;
}

const TONES = {
  neutral: { background: colors.slate[100], icon: colors.slate[500], text: colors.slate[500] },
  info: { background: colors.primarySoft, icon: colors.primary, text: colors.primaryDark },
  warning: {
    background: colors.status.warningSoft,
    icon: colors.status.warningDark,
    text: colors.status.warningText,
  },
} as const;

/** Aviso discreto em linha, para ressalvas e observações permanentes. */
export const InlineNotice = ({ message, icon, tone = 'neutral', style }: InlineNoticeProps) => {
  const palette = TONES[tone];

  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLabel={message}
      style={[styles.container, { backgroundColor: palette.background }, style]}
    >
      <MaterialCommunityIcons name={icon} size={18} color={palette.icon} />
      <Text variant="caption" color={palette.text} style={styles.message}>
        {message}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.lg,
  },
  message: {
    flex: 1,
  },
});
