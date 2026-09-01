import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme';
import { clampUnit, formatConfidence } from '@/utils';

export interface ConfidenceBarProps {
  /** Valor normalizado entre 0 e 1. */
  value: number;
  color?: string;
  trackColor?: string;
  height?: number;
}

export const ConfidenceBar = ({
  value,
  color = colors.status.approved,
  trackColor = colors.slate[200],
  height = 6,
}: ConfidenceBarProps) => {
  const normalized = clampUnit(value);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Confiança de ${formatConfidence(normalized)}`}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(normalized * 100) }}
      style={[styles.track, { backgroundColor: trackColor, height, borderRadius: height }]}
    >
      <View
        style={[
          styles.fill,
          { backgroundColor: color, width: `${normalized * 100}%`, borderRadius: height },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
});
