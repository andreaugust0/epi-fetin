import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { StateView } from '@/components/feedback';
import { Screen } from '@/components/layout';
import { Button, Text } from '@/components/ui';
import { APP_MESSAGES } from '@/constants/messages';
import { EpiChecklistGrid, EpiFigure } from '@/features/epi-detection/components';
import { useVerificationSession } from '@/features/verification-session/hooks/VerificationSessionContext';
import { hasFreshIdentification } from '@/features/verification-session/machine/sessionMachine';
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
   * Repete apenas a análise de EPI — quando ainda dá.
   *
   * A identificação vale três minutos no servidor. Dentro dessa janela,
   * que cobre o caso real (a pessoa põe o capacete e tenta de novo), a
   * preparação é reaberta preservando quem já foi reconhecido e o rosto
   * não é pedido outra vez.
   *
   * Passado o prazo, o caminho é refazer o reconhecimento — de forma
   * explícita e com o motivo na tela, nunca em silêncio. Antes isto caía
   * na preparação com uma identificação vencida, e a tela dizia "nenhum
   * funcionário identificado" para alguém que tinha acabado de ser
   * identificado na tela anterior.
   */
  const retryEpi = useCallback(() => {
    impact();
    if (!hasFreshIdentification(snapshot)) {
      reset();
      // O motivo viaja junto: a tela de identificação diz por que a pessoa
      // está de volta ali, em vez de simplesmente aparecer.
      router.replace({ pathname: '/identificacao', params: { motivo: 'expirou' } });
      return;
    }
    prepareEpiVerification();
    router.replace('/preparacao');
  }, [impact, prepareEpiVerification, reset, router, snapshot]);

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
  /**
   * O motivo do servidor vence a contagem local, quando existe.
   *
   * "Faltaram 2 equipamentos" é verdade e é pouco: não diz se o
   * equipamento não estava lá ou se o modelo o viu sem certeza
   * suficiente. O servidor sabe a diferença e a escreve — "EPI ausente:
   * Capacete · não consegui confirmar: Luvas". Recontar itens aqui
   * jogaria fora justamente a informação que a pessoa precisa para saber
   * se ajusta o capacete ou se chama o suporte.
   */
  const rejectionReason =
    detection.reason ||
    (missingCount > 0
      ? `${APP_MESSAGES.result.rejectedReasonPrefix} ${missingCount} ${
          missingCount === 1
            ? APP_MESSAGES.result.rejectedReasonSuffixSingular
            : APP_MESSAGES.result.rejectedReasonSuffix
        }`
      : APP_MESSAGES.result.rejectedLowConfidence);

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
          size={56}
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
        {/*
          O boneco primeiro, a lista depois. Quem chega na catraca lê a
          figura de longe e sabe na hora o que faltou; a lista existe para
          quem se aproxima e quer o nome do equipamento e a confiança.
        */}
        <EpiFigure items={allItems} backgroundColor={colors.slate[50]} style={styles.figura} />

        <EpiChecklistGrid items={allItems} style={styles.checklist} />

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
   * Faixa do veredito: legível a alguns metros, então o bloco inteiro é
   * colorido e o texto vem grande.
   *
   * Deixou de ocupar metade da tela (`flex: 1`) quando o boneco entrou. O
   * espaço tinha que sair de algum lugar, e um ícone gigante de ✓/✗ era o
   * candidato óbvio: ele repete, em abstrato, o que a faixa colorida e o
   * título já dizem — enquanto o boneco diz o que nenhum dos dois diz, que
   * é QUAL equipamento faltou.
   */
  hero: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
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
  /** O boneco fica com a folga vertical; a lista pede só o que precisa. */
  figura: {
    flex: 1,
    marginBottom: spacing.xs,
  },
  /** Duas colunas: os sete equipamentos precisam caber sem rolagem. */
  checklist: {
    justifyContent: 'center',
  },
  actions: {
    gap: spacing.sm,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
  },
});
