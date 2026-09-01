import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { CameraView } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { CameraViewport } from '@/components/camera';
import { Screen, ScreenHeader, StepIndicator } from '@/components/layout';
import { Button, Text } from '@/components/ui';
import { APP_MESSAGES } from '@/constants/messages';
import { useAutoFaceRecognition } from '@/features/face-recognition/face/useAutoFaceRecognition';
import { useVerificationSession } from '@/features/verification-session/hooks/VerificationSessionContext';
import { useHaptics } from '@/hooks/useHaptics';
import { useTerminalMetrics } from '@/hooks/useTerminalMetrics';
import { colors, radii, spacing } from '@/theme';

/**
 * Desfecho visual de uma tentativa.
 *
 * Cada tentativa é uma captura só: o resultado fica na tela até o funcionário
 * pedir uma nova, sair, ou — só no caso de sucesso — até o avanço automático.
 * `not-identified`/`ambiguous`/`no-consent` são os três resultados de domínio
 * do servidor que não avançam; `error` cobre tanto falha técnica (câmera,
 * FaceNet, rede) quanto falta de configuração/provisionamento do tablet —
 * nenhum dos dois é "rosto não corresponde a ninguém".
 */
type FaceOutcome =
  | 'idle'
  | 'waiting'
  | 'no-face'
  | 'identified'
  | 'not-identified'
  | 'ambiguous'
  | 'no-consent'
  | 'error';

/**
 * Tempo que o cartão de sucesso fica visível antes de avançar sozinho.
 *
 * Só existe para o caminho de identificado — as outras saídas (desconhecido,
 * sem rosto, erro) exigem uma ação explícita, sem temporizador nenhum.
 */
const IDENTIFICATION_SUCCESS_DELAY_MS = 5000;

/** Título/dica dos três desfechos "vermelhos" que compartilham o mesmo cartão. */
const RED_CARD_COPY: Record<'not-identified' | 'ambiguous' | 'no-consent', { title: string; hint: string; checks?: readonly string[] }> = {
  'not-identified': {
    title: APP_MESSAGES.face.unknownTitle,
    hint: APP_MESSAGES.face.unknownShortHint,
    checks: APP_MESSAGES.face.unknownShortChecks,
  },
  ambiguous: {
    title: APP_MESSAGES.face.ambiguousTitle,
    hint: APP_MESSAGES.face.ambiguousHint,
  },
  'no-consent': {
    title: APP_MESSAGES.face.noConsentTitle,
    hint: APP_MESSAGES.face.noConsentHint,
  },
};

export default function IdentificationScreen() {
  const router = useRouter();
  const { cancel, reset, identifyEmployee } = useVerificationSession();
  const { impact } = useHaptics();
  const metrics = useTerminalMetrics();

  const cameraRef = useRef<CameraView>(null);

  const { status, result, recognize } = useAutoFaceRecognition({ cameraRef });

  const isPreparing = status === 'preparando';
  const isRunning = status === 'analisando';
  const setupFailed = status === 'erro';

  const outcome: FaceOutcome = setupFailed
    ? 'error'
    : isRunning
      ? 'waiting'
      : result === null
        ? 'idle'
        : result.kind === 'no_face'
          ? 'no-face'
          : result.kind === 'identified'
            ? 'identified'
            : result.kind === 'nao_identificado'
              ? 'not-identified'
              : result.kind === 'ambiguo'
                ? 'ambiguous'
                : result.kind === 'sem_consentimento'
                  ? 'no-consent'
                  : 'error'; // config_missing | token_missing | technical_error

  const isIdentified = outcome === 'identified';
  const isRedCard =
    outcome === 'not-identified' || outcome === 'ambiguous' || outcome === 'no-consent';
  // As quatro só param à espera de uma nova tentativa explícita.
  const needsRetry = outcome === 'no-face' || isRedCard || outcome === 'error';
  const showsHeroCard = isIdentified || isRedCard;
  const showsGuidanceCard = outcome === 'error';

  const errorDescription =
    result?.kind === 'config_missing'
      ? APP_MESSAGES.face.configMissingDescription
      : result?.kind === 'token_missing'
        ? APP_MESSAGES.face.tokenMissingDescription
        : APP_MESSAGES.face.errorDescription;

  const attempt = useCallback(() => {
    impact();
    recognize();
  }, [impact, recognize]);

  const goHome = useCallback(() => {
    cancel();
    reset();
    router.replace('/');
  }, [cancel, reset, router]);

  /**
   * Ponte entre o pipeline real e a sessão: assim que o servidor identifica
   * alguém, registra a pessoa — com o `identificacao_id`/`expira_em` que a
   * futura etapa de verificação vai precisar — e agenda o avanço. O cleanup
   * cobre tanto o desmonte quanto o "Voltar ao Início" — os dois desmontam
   * esta tela, então o mesmo `clearTimeout` resolve ambos.
   */
  useEffect(() => {
    if (!isIdentified || result?.kind !== 'identified') {
      return;
    }
    const identified = result;

    identifyEmployee(
      { id: String(identified.pessoaId), nome: identified.nome },
      1,
      { id: identified.identificacaoId, expiresAt: identified.expiraEm },
    );

    const timer = setTimeout(() => {
      router.replace('/preparacao');
    }, IDENTIFICATION_SUCCESS_DELAY_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isIdentified, result]);

  return (
    <Screen backgroundColor={colors.scanner.background}>
      <ScreenHeader title={APP_MESSAGES.face.title} onBack={goHome} tone="dark" />

      <View style={styles.body}>
        {/*
          O visor nunca desmonta, nem quando ninguém é identificado: é olhando
          para ele que a pessoa corrige posição, distância e enquadramento. Sem
          moldura sobreposta — a orientação é dada por texto, abaixo.
        */}
        <CameraViewport
          ref={cameraRef}
          style={showsHeroCard || showsGuidanceCard ? styles.viewportCompact : styles.viewport}
        />

        {isIdentified && result?.kind === 'identified' ? (
          <View style={styles.identifiedCard}>
            <View style={[styles.badge, { backgroundColor: colors.white }]}>
              <MaterialCommunityIcons
                name="check"
                size={metrics.confirmationIconSize}
                color={colors.status.approvedDark}
              />
            </View>
            <Text variant={metrics.employeeMeta} color={colors.white} align="center">
              {APP_MESSAGES.face.identifiedTitle}
            </Text>
            <Text variant={metrics.employeeName} color={colors.white} align="center">
              {result.nome}
            </Text>
            <Text variant={metrics.instructionDetail} color={colors.slate[100]} align="center">
              {APP_MESSAGES.face.identifiedAdvancing}
            </Text>
          </View>
        ) : isRedCard ? (
          <View style={styles.notIdentifiedCard}>
            <View style={[styles.badge, { backgroundColor: colors.white }]}>
              <MaterialCommunityIcons
                name="account-alert"
                size={metrics.confirmationIconSize}
                color={colors.status.rejectedDark}
              />
            </View>
            <Text variant={metrics.employeeMeta} color={colors.white} align="center">
              {RED_CARD_COPY[outcome as 'not-identified' | 'ambiguous' | 'no-consent'].title}
            </Text>
            <Text variant={metrics.instructionDetail} color={colors.slate[100]} align="center">
              {RED_CARD_COPY[outcome as 'not-identified' | 'ambiguous' | 'no-consent'].hint}
            </Text>
            {RED_CARD_COPY[outcome as 'not-identified' | 'ambiguous' | 'no-consent'].checks ? (
              <View style={styles.checks}>
                {RED_CARD_COPY[
                  outcome as 'not-identified' | 'ambiguous' | 'no-consent'
                ].checks?.map((check) => (
                  <View key={check} style={styles.checkRow}>
                    <MaterialCommunityIcons name="circle-medium" size={20} color={colors.white} />
                    <Text variant="body" color={colors.slate[100]} style={styles.checkText}>
                      {check}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : showsGuidanceCard ? (
          <View style={styles.guidance}>
            <MaterialCommunityIcons
              name="alert-circle-outline"
              size={metrics.confirmationIconSize * 0.6}
              color={colors.status.warning}
            />
            <Text variant={metrics.instruction} color={colors.white} align="center">
              {APP_MESSAGES.face.errorTitle}
            </Text>
            <Text variant={metrics.instructionDetail} color={colors.slate[300]} align="center">
              {errorDescription}
            </Text>
          </View>
        ) : (
          <View style={styles.statusBlock}>
            <Text variant={metrics.instruction} color={colors.white} align="center">
              {outcome === 'no-face'
                ? APP_MESSAGES.face.noFaceTitle
                : outcome === 'waiting'
                  ? APP_MESSAGES.face.scanning
                  : APP_MESSAGES.face.instruction}
            </Text>
            <Text variant={metrics.instructionDetail} color={colors.slate[400]} align="center">
              {outcome === 'waiting'
                ? APP_MESSAGES.face.scanningHint
                : APP_MESSAGES.face.instructionDetail}
            </Text>
          </View>
        )}

        <View style={styles.actions}>
          {/* Enquanto a tentativa está em andamento não há ação alguma: nada
              a tocar duas vezes. Falha de carregamento também não oferece
              "Iniciar" — não há o que tentar sem detector/modelo. */}
          {setupFailed ? (
            <Button
              label={APP_MESSAGES.face.backHomeButton}
              variant="secondary"
              size="large"
              onPress={goHome}
            />
          ) : isRunning ? null : isIdentified ? (
            <Button
              label={APP_MESSAGES.face.backHomeButton}
              variant="secondary"
              size="large"
              onPress={goHome}
            />
          ) : needsRetry ? (
            <>
              <Button
                label={APP_MESSAGES.face.retryButton}
                icon="refresh"
                size="terminal"
                onPress={attempt}
              />
              <Button
                label={APP_MESSAGES.face.backHomeButton}
                variant="secondary"
                size="large"
                onPress={goHome}
              />
            </>
          ) : (
            <Button
              label={APP_MESSAGES.face.startButton}
              icon="face-recognition"
              size="terminal"
              disabled={isPreparing}
              loading={isPreparing}
              onPress={attempt}
            />
          )}
        </View>
      </View>

      <StepIndicator currentStep="identification" tone="dark" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
  viewport: {
    flex: 1,
  },
  /** Com o cartão de resultado em tela o visor cede altura, mas continua utilizável. */
  viewportCompact: {
    flex: 1,
    minHeight: 160,
  },
  statusBlock: {
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  /** Bloco cheio e sólido: a mesma linguagem visual de preparacao/resultado
   * para o desfecho da identidade — precisa ser lido à distância. */
  identifiedCard: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.xl,
    backgroundColor: colors.status.approvedDark,
  },
  notIdentifiedCard: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.xl,
    backgroundColor: colors.status.rejectedDark,
  },
  badge: {
    width: 76,
    height: 76,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  guidance: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.status.warning,
    backgroundColor: colors.status.warningDeep,
  },
  checks: {
    gap: spacing.xxs,
    marginTop: spacing.xs,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xxs,
  },
  checkText: {
    flex: 1,
  },
  actions: {
    gap: spacing.md,
  },
});
