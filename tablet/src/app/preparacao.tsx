import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { StateView } from '@/components/feedback';
import { Screen, StepIndicator } from '@/components/layout';
import { Button, Text } from '@/components/ui';
import { APP_MESSAGES } from '@/constants/messages';
import { useVerificationSession } from '@/features/verification-session/hooks/VerificationSessionContext';
import { hasIdentifiedEmployee } from '@/features/verification-session/machine/sessionMachine';
import { useHaptics } from '@/hooks/useHaptics';
import { useTerminalMetrics } from '@/hooks/useTerminalMetrics';
import { colors, radii, spacing } from '@/theme';

export default function PreparationScreen() {
  const router = useRouter();
  const { snapshot, prepareEpiVerification, reset } = useVerificationSession();
  const { impact } = useHaptics();
  const metrics = useTerminalMetrics();

  const { employee } = snapshot;
  const isIdentified = hasIdentifiedEmployee(snapshot);

  /**
   * Chegada logo após a identificação: abre a preparação.
   *
   * A vinda de uma reprovação não é tratada aqui — quem sai do resultado já
   * prepara a sessão antes de navegar. Reagir a outros estados faria esta tela
   * descartar um resultado recém-produzido ou abortar uma análise em curso.
   */
  useEffect(() => {
    if (snapshot.state === 'face_recognized') {
      prepareEpiVerification();
    }
  }, [prepareEpiVerification, snapshot.state]);

  const goHome = useCallback(() => {
    reset();
    router.replace('/');
  }, [reset, router]);

  const handleStart = useCallback(() => {
    impact();
    router.replace('/verificacao');
  }, [impact, router]);

  if (!isIdentified || !employee) {
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

  return (
    <Screen edges={['top', 'left', 'right']}>
      {/*
        Bloco verde sólido e generoso: é a confirmação de que o reconhecimento
        deu certo, e precisa ser lida à distância antes de qualquer outra coisa.
      */}
      <View style={styles.identityCard}>
        <View
          style={[
            styles.confirmationBadge,
            { width: metrics.confirmationIconSize * 1.5, height: metrics.confirmationIconSize * 1.5 },
          ]}
        >
          <MaterialCommunityIcons
            name="check"
            size={metrics.confirmationIconSize}
            color={colors.status.approvedDark}
          />
        </View>

        <Text variant={metrics.employeeMeta} color={colors.white} align="center">
          {APP_MESSAGES.preparation.title}
        </Text>

        <Text variant={metrics.employeeName} color={colors.white} align="center">
          {employee.nome}
        </Text>

        {employee.matricula || employee.setor ? (
          <View style={styles.identityMeta}>
            {employee.matricula ? (
              <Text variant={metrics.employeeMeta} color={colors.white} align="center">
                {`${APP_MESSAGES.face.registrationLabel}: ${employee.matricula}`}
              </Text>
            ) : null}
            {employee.setor ? (
              <Text variant={metrics.employeeMeta} color={colors.white} align="center">
                {`${APP_MESSAGES.face.sectorLabel}: ${employee.setor}`}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <View style={styles.positionBlock}>
          <View style={styles.positionFigure}>
            <MaterialCommunityIcons
              name="human-handsdown"
              size={metrics.figureIconSize}
              color={colors.primary}
            />
            <View style={styles.floorMark} />
          </View>

          <Text variant={metrics.instruction} color={colors.slate[900]} align="center">
            {APP_MESSAGES.preparation.positionInstruction}
          </Text>
          <Text variant={metrics.instructionDetail} color={colors.slate[500]} align="center">
            {APP_MESSAGES.preparation.positionDetail}
          </Text>
        </View>

        <View style={styles.actions}>
          <Button
            label={APP_MESSAGES.preparation.startButton}
            icon="shield-search"
            size="terminal"
            onPress={handleStart}
          />

          {/* Saída para quem desiste após ser identificado. */}
          <Button
            label={APP_MESSAGES.preparation.exitButton}
            icon="logout"
            variant="outline"
            size="terminal"
            onPress={goHome}
          />
        </View>
      </View>

      <StepIndicator currentStep="verification" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  identityCard: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxxl,
    backgroundColor: colors.status.approvedDark,
  },
  confirmationBadge: {
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    marginBottom: spacing.sm,
  },
  identityMeta: {
    alignItems: 'center',
    gap: spacing.xxs,
    marginTop: spacing.xs,
  },
  positionBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  positionFigure: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  actions: {
    gap: spacing.md,
  },
  /** Marcação do chão: a mesma referência física que o funcionário procura. */
  floorMark: {
    width: 120,
    height: 14,
    borderRadius: radii.pill,
    borderWidth: 3,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    marginTop: spacing.xs,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
  },
});
