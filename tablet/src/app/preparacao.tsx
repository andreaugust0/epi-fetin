import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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

/**
 * Segundos entre o toque e o início da captura.
 *
 * A marcação do chão fica a alguns passos do tablet, de propósito: a câmera da
 * Raspberry precisa do corpo inteiro no quadro, e ninguém cabe inteiro a meio
 * metro da tela. Sem esta pausa, a verificação começava com a pessoa ainda
 * debruçada sobre o tablet, e a Raspberry decidia sobre os frames de alguém
 * saindo de campo — reprovando quem estava com todos os equipamentos.
 *
 * Cinco segundos não é número redondo por acaso: a borda vota sobre os últimos
 * três segundos de imagem, então a pessoa precisa estar parada na marcação uns
 * dois segundos antes do fim da contagem. É o que estes cinco compram.
 */
const SEGUNDOS_ATE_CAPTURAR = 5;

export default function PreparationScreen() {
  const router = useRouter();
  const { snapshot, prepareEpiVerification, reset } = useVerificationSession();
  const { impact } = useHaptics();
  const metrics = useTerminalMetrics();
  const [restante, setRestante] = useState<number | null>(null);
  const relogioRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { employee } = snapshot;
  const isIdentified = hasIdentifiedEmployee(snapshot);
  const contando = restante !== null;

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

  const pararContagem = useCallback(() => {
    if (relogioRef.current) {
      clearInterval(relogioRef.current);
      relogioRef.current = null;
    }
  }, []);

  // Sair da tela com a contagem correndo deixaria um `setInterval` navegando
  // para a verificação de uma sessão que já foi encerrada.
  useEffect(() => pararContagem, [pararContagem]);

  const goHome = useCallback(() => {
    pararContagem();
    reset();
    router.replace('/');
  }, [pararContagem, reset, router]);

  const cancelarContagem = useCallback(() => {
    pararContagem();
    setRestante(null);
  }, [pararContagem]);

  const handleStart = useCallback(() => {
    impact();
    setRestante(SEGUNDOS_ATE_CAPTURAR);

    relogioRef.current = setInterval(() => {
      setRestante((atual) => {
        // O `null` cobre o cancelamento acontecendo entre dois tiques.
        if (atual === null) return null;
        if (atual > 1) return atual - 1;

        pararContagem();
        router.replace('/verificacao');
        return null;
      });
    }, 1000);
  }, [impact, pararContagem, router]);

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
          {/*
            Durante a contagem, o número ocupa o lugar do boneco. Quem está
            andando de costas para a marcação precisa enxergar quanto tempo
            resta de vários passos de distância, e um número grande é a única
            coisa legível nessa situação.
          */}
          {contando ? (
            <View style={styles.contagemCirculo}>
              <Text style={styles.contagemNumero} color={colors.white} align="center">
                {String(restante)}
              </Text>
            </View>
          ) : (
            <View style={styles.positionFigure}>
              <MaterialCommunityIcons
                name="human-handsdown"
                size={metrics.figureIconSize}
                color={colors.primary}
              />
              <View style={styles.floorMark} />
            </View>
          )}

          <Text variant={metrics.instruction} color={colors.slate[900]} align="center">
            {contando
              ? APP_MESSAGES.preparation.countdownTitle
              : APP_MESSAGES.preparation.positionInstruction}
          </Text>
          <Text variant={metrics.instructionDetail} color={colors.slate[500]} align="center">
            {contando
              ? APP_MESSAGES.preparation.countdownDetail
              : APP_MESSAGES.preparation.positionDetail}
          </Text>
        </View>

        <View style={styles.actions}>
          {contando ? (
            /*
              Um único botão durante a contagem, e ele desfaz em vez de
              adiantar. Quem tocou sem estar pronto precisa de saída; quem já
              está na marcação não precisa de nada — a contagem termina
              sozinha, e um botão de "pular" só existiria para ser tocado por
              engano, do lado errado da sala.
            */
            <Button
              label={APP_MESSAGES.preparation.countdownCancel}
              icon="close"
              variant="outline"
              size="terminal"
              onPress={cancelarContagem}
            />
          ) : (
            <>
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
            </>
          )}
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
  contagemCirculo: {
    width: 200,
    height: 200,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    marginBottom: spacing.md,
  },
  contagemNumero: {
    // Fora da escala de tipografia de propósito: nenhum token chega perto do
    // tamanho que um número precisa ter para ser lido a três metros, e criar
    // um token só para isto poluiria a escala inteira.
    fontSize: 104,
    lineHeight: 120,
    fontWeight: '700',
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
