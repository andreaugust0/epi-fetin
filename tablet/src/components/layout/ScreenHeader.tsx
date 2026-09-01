import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { IconButton, Text } from '@/components/ui';
import { APP_MESSAGES } from '@/constants/messages';
import { colors, spacing } from '@/theme';

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  tone?: 'light' | 'dark';
  trailing?: ReactNode;
}

export const ScreenHeader = ({
  title,
  subtitle,
  onBack,
  tone = 'light',
  trailing,
}: ScreenHeaderProps) => {
  const isDark = tone === 'dark';
  const titleColor = isDark ? colors.white : colors.slate[900];
  const subtitleColor = isDark ? colors.slate[400] : colors.slate[500];

  return (
    <View style={styles.container}>
      {onBack ? (
        <IconButton
          icon="chevron-left"
          accessibilityLabel={APP_MESSAGES.common.back}
          onPress={onBack}
          color={isDark ? colors.white : colors.slate[700]}
          backgroundColor={isDark ? colors.overlayLight : colors.slate[100]}
        />
      ) : null}

      <View style={styles.texts}>
        <Text variant="heading" color={titleColor} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color={subtitleColor} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {trailing}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  texts: {
    flex: 1,
    gap: spacing.xxs,
  },
});
