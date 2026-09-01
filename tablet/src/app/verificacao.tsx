import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { CameraViewport, ScanFrame } from '@/components/camera';
import { StateView } from '@/components/feedback';
import { Screen, ScreenHeader, StepIndicator } from '@/components/layout';
import { ConfidenceBar, Text } from '@/components/ui';
import { APP_MESSAGES } from '@/constants/messages';
import { EpiChecklistItem } from '@/features/epi-detection/components';
import { useRequiredEpis } from '@/features/epi-detection/hooks/useRequiredEpis';
import { useVerificationSession } from '@/features/verification-session/hooks/VerificationSessionContext';
import { hasIdentifiedEmployee } from '@/features/verification-session/machine/sessionMachine';
import { colors, spacing } from '@/theme';

export default function VerificationScreen() {
  const router = useRouter();
  const { requiredEpis } = useRequiredEpis();
  const { snapshot, startEpiVerification, cancel, reset } = useVerificationSession();

  const { state, employee, progress, items, currentItem } = snapshot;
  const isDetecting = state === 'epi_detecting';
  const isIdentified = hasIdentifiedEmployee(snapshot);

  /** Impede que uma segunda execução comece por remontagem ou duplo toque. */
  const hasStartedRef = useRef(false);

  const runVerification = useCallback(async () => {
    const detection = await startEpiVerification(requiredEpis);
    if (detection) {
      router.replace('/resultado');
    }
  }, [requiredEpis, router, startEpiVerification]);

  /**
   * A análise começa sozinha ao entrar: o funcionário já tocou em "Iniciar
   * Verificação de EPI" na tela anterior e agora está na marcação do chão.
   *
   * Só `epi_preparation` é entrada válida. Chegar aqui logo após o
   * reconhecimento facial significa ter pulado a preparação — a máquina
   * recusaria os eventos de EPI e a tela terminaria num resultado vazio, então
   * o caminho é voltar para a preparação em vez de analisar.
   */
  useEffect(() => {
    if (!isIdentified) {
      return;
    }
    if (state === 'face_recognized') {
      router.replace('/preparacao');
      return;
    }
    if (state !== 'epi_preparation' || hasStartedRef.current || requiredEpis.length === 0) {
      return;
    }
    hasStartedRef.current = true;
    void runVerification();
  }, [isIdentified, requiredEpis.length, router, runVerification, state]);

  useEffect(() => cancel, [cancel]);

  const goHome = useCallback(() => {
    reset();
    router.replace('/');
  }, [reset, router]);

  const backToPreparation = useCallback(() => {
    hasStartedRef.current = false;
    router.replace('/preparacao');
  }, [router]);

  if (!isIdentified) {
    return (
      <Screen>
        <View style={styles.centered}>
          <StateView
            icon="account-question"
            title={APP_MESSAGES.preparation.missingEmployeeTitle}
            description={APP_MESSAGES.preparation.missingEmployeeDescription}
            tone="warning"
            actions={[{ label: APP_MESSAGES.face.backHomeButton, onPress: goHome, icon: 'home' }]}
          />
        </View>
      </Screen>
    );
  }

  const renderBody = () => {
    if (state === 'error' || state === 'cancelled') {
      const isError = state === 'error';
      return (
        <StateView
          icon={isError ? 'alert-circle-outline' : 'refresh'}
          title={isError ? APP_MESSAGES.scan.errorTitle : APP_MESSAGES.scan.cancelledTitle}
          description={
            isError ? APP_MESSAGES.scan.errorDescription : APP_MESSAGES.scan.cancelledDescription
          }
          tone={isError ? 'danger' : 'warning'}
          appearance="dark"
          actions={[
            { label: APP_MESSAGES.scan.retryButton, onPress: backToPreparation, icon: 'refresh' },
            { label: APP_MESSAGES.face.backHomeButton, onPress: goHome, variant: 'secondary' },
          ]}
        />
      );
    }

    return (
      <View style={styles.layout}>
        <CameraViewport style={styles.viewport}>
          <ScanFrame active={isDetecting} />
        </CameraViewport>

        <View style={styles.panel}>
          <Text variant="heading" color={colors.white} align="center">
            {APP_MESSAGES.scan.epiDetecting}
          </Text>
          <Text variant="caption" color={colors.slate[400]} align="center">
            {employee ? employee.nome : APP_MESSAGES.scan.epiDetectingHint}
          </Text>

          <View style={styles.progressBlock}>
            <View style={styles.progressHeader}>
              <Text variant="overline" color={colors.slate[400]}>
                {APP_MESSAGES.scan.checklistTitle}
              </Text>
              <Text variant="captionStrong" color={colors.accent}>
                {`${Math.round(progress * 100)}%`}
              </Text>
            </View>
            <ConfidenceBar
              value={progress}
              color={colors.accent}
              trackColor={colors.overlayBorder}
              height={8}
            />
          </View>

          <View style={styles.checklist}>
            {items.map((item) => (
              <View key={item.id} style={styles.checklistCell}>
                <EpiChecklistItem
                  item={item}
                  tone="dark"
                  pending={isDetecting && !item.detected}
                  scanning={item.id === currentItem && isDetecting}
                />
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  };

  return (
    <Screen backgroundColor={colors.scanner.background}>
      <ScreenHeader title={APP_MESSAGES.scan.title} tone="dark" />
      <View style={styles.body}>{renderBody()}</View>
      <StepIndicator currentStep="verification" tone="dark" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    justifyContent: 'center',
  },
  layout: {
    flex: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  viewport: {
    flex: 1,
    minHeight: 180,
  },
  panel: {
    gap: spacing.sm,
  },
  progressBlock: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  /** Duas colunas: em retrato os sete equipamentos empilhados não caberiam. */
  checklist: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  checklistCell: {
    width: '48.5%',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
  },
});
