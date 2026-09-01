import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import type { MaterialCommunityIconName } from '@/features/epi-detection/types';
import { colors, radii, MIN_TOUCH_TARGET } from '@/theme';

export interface IconButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  icon: MaterialCommunityIconName;
  accessibilityLabel: string;
  size?: number;
  color?: string;
  backgroundColor?: string;
  style?: StyleProp<ViewStyle>;
}

export const IconButton = ({
  icon,
  accessibilityLabel,
  size = 22,
  color = colors.slate[700],
  backgroundColor = colors.transparent,
  disabled,
  style,
  ...rest
}: IconButtonProps) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel}
    accessibilityState={{ disabled: Boolean(disabled) }}
    disabled={disabled}
    hitSlop={8}
    style={({ pressed }) => [
      styles.base,
      { backgroundColor },
      pressed ? styles.pressed : null,
      disabled ? styles.disabled : null,
      style,
    ]}
    {...rest}
  >
    <MaterialCommunityIcons name={icon} size={size} color={color} />
  </Pressable>
);

const styles = StyleSheet.create({
  base: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
  },
  pressed: {
    opacity: 0.6,
  },
  disabled: {
    opacity: 0.4,
  },
});
