import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { APP_MESSAGES } from '@/constants/messages';
import type { RecognizedEmployee } from '@/features/face-recognition/types';
import { colors, radii, spacing } from '@/theme';
import { formatConfidence } from '@/utils';

export interface RecognizedPersonCardProps {
  employee: RecognizedEmployee | null;
  confidence: number | null;
  /** Alterna o contraste para uso sobre o fundo escuro do visor. */
  onDark?: boolean;
}

/**
 * Identificação da pessoa reconhecida. Quando ninguém é reconhecido, comunica
 * isso explicitamente em vez de simplesmente ficar vazio.
 */
export const RecognizedPersonCard = ({
  employee,
  confidence,
  onDark = false,
}: RecognizedPersonCardProps) => {
  const isUnknown = employee === null;

  const backgroundColor = onDark
    ? colors.overlayLight
    : isUnknown
      ? colors.status.warningSoft
      : colors.primarySoft;
  const accentColor = isUnknown ? colors.status.warningDark : colors.primary;
  const titleColor = onDark ? colors.white : colors.slate[900];
  const detailColor = onDark ? colors.slate[300] : colors.slate[500];

  return (
    <View
      accessible
      accessibilityLabel={
        isUnknown
          ? APP_MESSAGES.face.unknownTitle
          : `${employee.nome}. ${APP_MESSAGES.face.registrationLabel} ${employee.matricula}. ${employee.setor}.`
      }
      style={[styles.container, { backgroundColor }]}
    >
      <View style={[styles.avatar, { backgroundColor: `${accentColor}22` }]}>
        <MaterialCommunityIcons
          name={isUnknown ? 'account-question' : 'account-check'}
          size={26}
          color={accentColor}
        />
      </View>

      <View style={styles.details}>
        <Text variant="subheading" color={titleColor} numberOfLines={1}>
          {isUnknown ? APP_MESSAGES.face.unknownTitle : employee.nome}
        </Text>

        {isUnknown ? (
          <Text variant="caption" color={detailColor}>
            {APP_MESSAGES.face.unknownDescription}
          </Text>
        ) : (
          <>
            <Text variant="caption" color={detailColor}>
              {`${APP_MESSAGES.face.registrationLabel} ${employee.matricula} · ${employee.setor}`}
            </Text>
            {confidence !== null ? (
              <Text variant="micro" color={detailColor}>
                {`${APP_MESSAGES.face.confidenceLabel}: ${formatConfidence(confidence)}`}
              </Text>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.xl,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  details: {
    flex: 1,
    gap: spacing.xxs,
  },
});
