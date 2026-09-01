import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { EmptyState, ErrorState, LoadingState } from '@/components/feedback';
import { Screen, StepIndicator } from '@/components/layout';
import { Button, Text } from '@/components/ui';
import { APP_MESSAGES } from '@/constants/messages';
import { EpiGrid } from '@/features/epi-detection/components';
import { useRequiredEpis } from '@/features/epi-detection/hooks/useRequiredEpis';
import { useHaptics } from '@/hooks/useHaptics';
import { useTerminalMetrics } from '@/hooks/useTerminalMetrics';
import { colors, radii, spacing } from '@/theme';

export default function HomeScreen() {
  const router = useRouter();
  const { requiredEpis, loading, error, reload } = useRequiredEpis();
  const { impact } = useHaptics();
  const metrics = useTerminalMetrics();

  /** Única ação do terminal: começar pela identificação do funcionário. */
  const handleStart = useCallback(() => {
    impact();
    router.push('/identificacao');
  }, [impact, router]);

  if (loading) {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ErrorState error={error} onRetry={() => void reload()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'left', 'right']}>
      <View style={styles.body}>
        <View style={styles.header}>
          {/*
            Toque longo no emblema abre o diagnóstico do ONNX. É a única
            forma de alcançá-lo no tablet, que não tem barra de endereços;
            fica invisível para quem opera o terminal e não altera o fluxo.
          */}
          <Pressable
            onLongPress={() => router.push('/diagnostico-onnx')}
            delayLongPress={1500}
            style={[styles.emblem, { width: metrics.emblemSize, height: metrics.emblemSize }]}
          >
            <MaterialCommunityIcons
              name="hard-hat"
              size={metrics.emblemIconSize}
              color={colors.primary}
            />
          </Pressable>

          <Text variant={metrics.screenTitle} color={colors.slate[900]} align="center">
            {APP_MESSAGES.home.title}
          </Text>
          <Text
            variant={metrics.screenSubtitle}
            color={colors.slate[500]}
            align="center"
            style={styles.subtitle}
          >
            {APP_MESSAGES.home.subtitle}
          </Text>
        </View>

        {requiredEpis.length === 0 ? (
          <EmptyState
            icon="shield-alert-outline"
            title={APP_MESSAGES.home.noEquipmentTitle}
            description={APP_MESSAGES.home.noEquipmentDescription}
          />
        ) : (
          <>
            <View style={styles.equipment}>
              <EpiGrid activeIds={requiredEpis} showInactive={false} />
            </View>

            <Button
              label={APP_MESSAGES.home.startButton}
              icon="arrow-right-circle"
              size="terminal"
              onPress={handleStart}
            />
          </>
        )}
      </View>

      <StepIndicator currentStep="start" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  header: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  emblem: {
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
    marginBottom: spacing.xs,
  },
  subtitle: {
    maxWidth: 520,
  },
  /**
   * A grade toma o espaço que sobra entre o cabeçalho e o botão, centrada.
   * É o que evita a faixa vazia no meio da tela em telas altas.
   */
  equipment: {
    flex: 1,
    justifyContent: 'center',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
  },
});
