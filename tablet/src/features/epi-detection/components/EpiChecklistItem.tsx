import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { ConfidenceBar, Text } from '@/components/ui';
import { getEpiById } from '@/constants/epiCatalog';
import { APP_MESSAGES } from '@/constants/messages';
import { colors, radii, spacing } from '@/theme';
import { formatConfidence } from '@/utils';

import type { DetectedEpi } from '../types';

export interface EpiChecklistItemProps {
  item: DetectedEpi;
  tone?: 'light' | 'dark';
  /** Ainda não avaliado: nem detectado, nem ausente. */
  pending?: boolean;
  /** Sendo avaliado neste instante. */
  scanning?: boolean;
}

/**
 * Linha da lista de EPIs verificados. O estado é comunicado por ícone, texto e
 * cor ao mesmo tempo — nunca apenas por cor.
 */
export const EpiChecklistItem = ({
  item,
  tone = 'light',
  pending = false,
  scanning = false,
}: EpiChecklistItemProps) => {
  const isDark = tone === 'dark';
  const catalogItem = getEpiById(item.id);

  const accentColor = scanning
    ? colors.accent
    : pending
      ? colors.slate[400]
      : item.detected
        ? colors.status.approved
        : colors.status.rejected;

  const stateLabel = scanning
    ? APP_MESSAGES.scan.analyzing
    : pending
      ? APP_MESSAGES.scan.waiting
      : item.detected
        ? APP_MESSAGES.scan.detected
        : APP_MESSAGES.scan.notDetected;

  const stateIcon = scanning
    ? 'timer-sand'
    : pending
      ? 'circle-outline'
      : item.detected
        ? 'check-circle'
        : 'close-circle';

  return (
    <View
      accessible
      accessibilityLabel={`${item.label}. ${stateLabel}. Confiança ${formatConfidence(item.confidence)}.`}
      style={[
        styles.container,
        {
          backgroundColor: isDark ? colors.overlayLight : colors.white,
          borderColor: isDark ? colors.overlayBorder : colors.slate[200],
        },
      ]}
    >
      <View style={[styles.iconWrapper, { backgroundColor: `${accentColor}22` }]}>
        <MaterialCommunityIcons
          name={catalogItem?.icon ?? 'shield-check'}
          size={20}
          color={accentColor}
        />
      </View>

      <View style={styles.details}>
        <View style={styles.titleRow}>
          <Text variant="bodyStrong" color={isDark ? colors.white : colors.slate[800]}>
            {item.label}
          </Text>
          <MaterialCommunityIcons name={stateIcon} size={18} color={accentColor} />
        </View>

        <Text variant="micro" color={isDark ? colors.slate[400] : colors.slate[500]}>
          {`${stateLabel} · ${item.description}`}
        </Text>

        <View style={styles.confidenceRow}>
          <View style={styles.barWrapper}>
            <ConfidenceBar
              value={item.confidence}
              color={accentColor}
              trackColor={isDark ? colors.overlayBorder : colors.slate[200]}
              height={5}
            />
          </View>
          <Text variant="micro" color={isDark ? colors.slate[300] : colors.slate[600]}>
            {formatConfidence(item.confidence)}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
  },
  iconWrapper: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  details: {
    flex: 1,
    gap: spacing.xxs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xxs,
  },
  barWrapper: {
    flex: 1,
  },
});
