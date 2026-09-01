import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { StateView } from '@/components/feedback';
import { Screen } from '@/components/layout';
import { Button, Text } from '@/components/ui';
import { APP_MESSAGES } from '@/constants/messages';
import { EpiChecklistItem } from '@/features/epi-detection/components';
import { useVerificationSession } from '@/features/verification-session/hooks/VerificationSessionContext';
import { useHaptics } from '@/hooks/useHaptics';
import { colors, spacing } from '@/theme';

export default function ResultScreen() {
  const router = useRouter();
  const { snapshot, prepareEpiVerification, reset } = useVerificationSession();
  const { impact } = useHaptics();

  const { detection, employee, state } = snapshot;
  const isApproved = state === 'approved';

  /** Limpa a sessão inteira e devolve o terminal para o próximo funcionário. */
  const goHome = useCallback(() => {
    reset();
    router.replace('/');
  }, [reset, router]);

  /**
   * Repete apenas a análise de EPI. A preparação é aberta aqui, antes de
   * navegar: limpa o resultado anterior e preserva o funcionário identificado,
   * de modo que o reconhecimento facial não se repete.
   */
  const retryEpi = useCallback(() => {
    impact();
    prepareEpiVerification();
    router.replace('/preparacao');
  }, [impact, prepareEpiVerification, router]);

  if (!detection) {
    return (
      <Screen>
        <View style={styles.centered}>
          <StateView
            icon="alert-circle-outline"
            title={APP_MESSAGES.result.missingResultTitle}
            description={APP_MESSAGES.result.missingResultDescription}
            tone="warning"
            actions={[{ label: APP_MESSAGES.result.backHomeButton, onPress: goHome, icon: 'home' }]}
          />
        </View>
      </Screen>
    );
  }

  // Todos os equipamentos exigidos, na ordem do catálogo — não só os ausentes.
  const allItems = [...detection.detectedItems, ...detection.missingItems].sort(
    (first, second) =>
      detection.requiredItems.indexOf(first.id) - detection.requiredItems.indexOf(second.id),
  );

  const missingCount = detection.missingItems.length;
  const rejectionReason =
    missingCount > 0
      ? `${APP_MESSAGES.result.rejectedReasonPrefix} ${missingCount} ${
          missingCount === 1
            ? APP_MESSAGES.result.rejectedReasonSuffixSingular
            : APP_MESSAGES.result.rejectedReasonSuffix
        }`
      : APP_MESSAGES.result.rejectedLowConfidence;

  return (
    <Screen
      backgroundColor={colors.slate[50]}
      edges={['top', 'left', 'right']}
      style={styles.screen}
    >
      <View
        style={[
          styles.hero,
          { backgroundColor: isApproved ? colors.status.approvedDark : colors.status.rejectedDark },
        ]}
      >
        <MaterialCommunityIcons
          name={isApproved ? 'check-circle' : 'close-circle'}
          size={104}
          color={colors.white}
        />

        <Text variant="display" color={colors.white} align="center">
          {isApproved ? APP_MESSAGES.result.approvedTitle : APP_MESSAGES.result.rejectedTitle}
        </Text>

        {employee ? (
          <Text variant="heading" color={colors.white} align="center" numberOfLines={2}>
            {employee.nome}
          </Text>
        ) : null}

        {isApproved ? null : (
          <Text variant="body" color={colors.white} align="center" style={styles.reason}>
            {rejectionReason}
          </Text>
        )}
      </View>

      <View style={styles.panel}>
        <View style={styles.checklist}>
          {allItems.map((item) => (
            <View key={item.id} style={styles.checklistCell}>
              <EpiChecklistItem item={item} />
            </View>
          ))}
        </View>

        {isApproved ? (
          <Button
            label={APP_MESSAGES.result.backHomeButton}
            icon="home"
            size="terminal"
            onPress={goHome}
          />
        ) : (
          <View style={styles.actions}>
            <Text variant="bodyStrong" color={colors.slate[700]} align="center">
              {APP_MESSAGES.result.retryQuestion}
            </Text>
            <Button
              label={APP_MESSAGES.result.retryButton}
              icon="refresh"
              size="terminal"
              onPress={retryEpi}
            />
            <Button
              label={APP_MESSAGES.result.exitButton}
              icon="exit-to-app"
              variant="secondary"
              size="large"
              onPress={goHome}
            />
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    justifyContent: 'flex-start',
  },
  /**
   * Metade superior dedicada ao veredito: precisa ser legível a alguns metros,
   * então ícone e texto vêm grandes e o bloco inteiro é colorido.
   */
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  reason: {
    marginTop: spacing.xs,
    maxWidth: 460,
  },
  panel: {
    flex: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  /** Duas colunas: os sete equipamentos precisam caber sem rolagem. */
  checklist: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'center',
    gap: spacing.sm,
  },
  checklistCell: {
    width: '48.5%',
  },
  actions: {
    gap: spacing.sm,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
  },
});
