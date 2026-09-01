import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colors } from '@/theme';

export interface ScreenProps {
  children?: ReactNode;
  backgroundColor?: string;
  edges?: readonly Edge[];
  style?: StyleProp<ViewStyle>;
}

/** Casca de tela que respeita as áreas seguras do aparelho. */
export const Screen = ({
  children,
  backgroundColor = colors.slate[50],
  edges = ['top', 'bottom', 'left', 'right'],
  style,
}: ScreenProps) => (
  <SafeAreaView style={[styles.safeArea, { backgroundColor }]} edges={edges}>
    <View style={[styles.content, style]}>{children}</View>
  </SafeAreaView>
);

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});
