import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { ScanFrame } from '@/components/camera';
import { StateView } from '@/components/feedback';
import { Screen, ScreenHeader, StepIndicator } from '@/components/layout';
import { ConfidenceBar, Text } from '@/components/ui';
import { APP_MESSAGES } from '@/constants/messages';
import { EpiFigure } from '@/features/epi-detection/components';
import { useRequiredEpis } from '@/features/epi-detection/hooks/useRequiredEpis';
import { useVerificationSession } from '@/features/verification-session/hooks/VerificationSessionContext';
import {
  hasFreshIdentification,
  hasIdentifiedEmployee,
} from '@/features/verification-session/machine/sessionMachine';
import { colors, radii, spacing } from '@/theme';

export default function VerificationScreen() {
  const router = useRouter();
  const { requiredEpis } = useRequiredEpis();
  const { snapshot, startEpiVerification, cancel, reset } = useVerificationSession();

  const { state, employee, progress, items } = snapshot;
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

  /**
   * "Tentar novamente" depois de uma falha. Volta para a preparação
   * enquanto a identificação ainda vale; passada a validade, pede o rosto
   * de novo em vez de mandar a pessoa para uma preparação que a recusaria.
   */
  const backToPreparation = useCallback(() => {
    hasStartedRef.current = false;
    if (!hasFreshIdentification(snapshot)) {
      reset();
      router.replace({ pathname: '/identificacao', params: { motivo: 'expirou' } });
      return;
    }
    router.replace('/preparacao');
  }, [reset, router, snapshot]);

  /**
   * Falha vem ANTES da checagem de identidade, e a ordem é o conserto.
   *
   * `error` não está entre os estados que contam como identificado, então
   * qualquer falha na verificação — servidor fora do ar, câmera muda,
   * identificação vencida — caía no early return abaixo e a tela anunciava
   * "nenhum funcionário identificado". A pessoa tinha acabado de ser
   * reconhecida; a mensagem escondia a causa real e sugeria a única coisa
   * que não era o problema.
   */
  const isFailure = state === 'error' || state === 'cancelled';

  if (!isIdentified && !isFailure) {
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
    if (isFailure) {
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
        {/*
          Sem câmera nenhuma aqui. Nesta etapa quem olha para a pessoa é a
          câmera da Raspberry; a do tablet nunca teve `ref` nem tirou foto —
          era enfeite, e um enfeite caro: mantê-la abria uma segunda sessão
          de câmera e trocava a view da posição 0 no meio de uma tela que
          dura menos de um segundo, que foi o que derrubava o app.

          No lugar dela, o boneco: mostra QUAIS equipamentos estão sendo
          conferidos, que é a informação que a pessoa na catraca precisa —
          e que um retrato dela mesma nunca deu.
        */}
        <View style={styles.viewport}>
          <EpiFigure
            items={items}
            analyzing={isDetecting}
            tone="dark"
            backgroundColor={colors.scanner.viewport}
            style={styles.figura}
          />
          <ScanFrame active={isDetecting} />
        </View>

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

          {/*
            A lista de sete itens saiu daqui. Durante a análise ela mostrava
            sete linhas idênticas dizendo "aguardando" — o servidor decide
            tudo de uma vez, então não há progresso por equipamento para
            listar. O boneco já diz o que está sendo conferido, e a lista
            com confiança por EPI aparece no resultado, quando existe
            resultado.
          */}
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
  /** Mesma moldura escura do antigo visor — só o conteúdo mudou. */
  viewport: {
    flex: 1,
    minHeight: 180,
    borderRadius: radii.xxl,
    overflow: 'hidden',
    backgroundColor: colors.scanner.viewport,
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  figura: {
    marginVertical: spacing.lg,
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
  centered: {
    flex: 1,
    justifyContent: 'center',
  },
});
