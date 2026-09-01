import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { MaterialCommunityIconName } from '@/features/epi-detection/types';
import { colors, radii, spacing } from '@/theme';

import { Text } from './Text';

export interface BadgeProps {
  label: string;
  backgroundColor?: string;
  textColor?: string;
  icon?: MaterialCommunityIconName;
  /** Ponto colorido usado no protótipo antes do texto do selo. */
  dotColor?: string;
  uppercase?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const Badge = ({
  label,
  backgroundColor = colors.primarySoft,
  textColor = colors.primary,
  icon,
  dotColor,
  uppercase = false,
  style,
}: BadgeProps) => (
  <View style={[styles.container, { backgroundColor }, style]}>
    {dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
    {icon ? <MaterialCommunityIcons name={icon} size={14} color={textColor} /> : null}
    <Text variant={uppercase ? 'overline' : 'captionStrong'} color={textColor}>
      {label}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 1,
    borderRadius: radii.pill,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
  },
});
