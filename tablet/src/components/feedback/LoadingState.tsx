import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { APP_MESSAGES } from '@/constants/messages';
import { colors, spacing } from '@/theme';

export interface LoadingStateProps {
  message?: string;
  hint?: string;
  tone?: 'light' | 'dark';
}

export const LoadingState = ({
  message = APP_MESSAGES.states.loading,
  hint,
  tone = 'light',
}: LoadingStateProps) => {
  const isDark = tone === 'dark';

  return (
    <View
      style={styles.container}
      accessible
      accessibilityLabel={message}
      accessibilityRole="alert"
    >
      <ActivityIndicator size="large" color={isDark ? colors.accent : colors.primary} />
      <Text variant="subheading" align="center" color={isDark ? colors.white : colors.slate[800]}>
        {message}
      </Text>
      {hint ? (
        <Text
          variant="caption"
          align="center"
          color={isDark ? colors.slate[400] : colors.slate[500]}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
  },
});
