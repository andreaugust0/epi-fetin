import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { esperaPosicionamentoMs } from '@/features/verification-session/posicionamento';
import { colors, radii, spacing } from '@/theme';

export default function VerificationScreen() {
  const router = useRouter();
  const { requiredEpis } = useRequiredEpis();
  const { snapshot, startEpiVerification, cancel, reset } = useVerificationSession();

  const { state, employee, progress, items } = snapshot;
  const isDetecting = state === 'epi_detecting';
  const isIdentified = hasIdentifiedEmployee(snapshot);

  /**
   * Verdadeiro durante a espera de posicionamento, antes de a captura sair.
   *
   * A tela não muda de aparência quando ele vira falso: a linha continua
   * varrendo, o boneco continua aceso, o texto continua o mesmo. Para quem
   * está na marcação, os dois momentos são um só — e é essa a intenção.
   */
  const [posicionando, setPosicionando] = useState(true);

  /** Impede que uma segunda execução comece por remontagem ou duplo toque. */
  const hasStartedRef = useRef(false);

  const runVerification = useCallback(async () => {
    const detection = await startEpiVerification(requiredEpis);
    if (detection) {
      router.replace('/resultado');
    }
  }, [requiredEpis, router, startEpiVerification]);

  /**
   * O relógio da espera vive numa ref, e não dentro do efeito — esta é a
   * correção de um travamento que só aparecia no aparelho.
   *
   * O efeito abaixo dependia de `runVerification`, que muda de identidade
   * sempre que `requiredEpis` muda de identidade. E a lista é recarregada a
   * cada foco de tela: entrar aqui dispara a consulta ao servidor, a resposta
   * chega durante os segundos de espera e troca o array. O efeito
   * reexecutava, a limpeza CANCELAVA o temporizador, e a nova execução caía no
   * `return` do `hasStartedRef` — que já estava marcado. A captura nunca saía,
   * e a tela varria para sempre.
   *
   * A suíte não pegava porque lá as telas convivem na mesma árvore e a lista
   * já está carregada antes do toque. No tablet, esta tela monta do zero.
   */
  const relogioRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** A versão mais recente de `runVerification`, fora das dependências. */
  const runRef = useRef(runVerification);
  useEffect(() => {
    runRef.current = runVerification;
  }, [runVerification]);

  // Limpeza só no desmonte. Sair da tela antes do disparo deixaria um
  // `setTimeout` chamando `startEpiVerification` numa sessão encerrada.
  useEffect(
    () => () => {
      if (relogioRef.current) {
        clearTimeout(relogioRef.current);
      }
    },
    [],
  );

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

    relogioRef.current = setTimeout(() => {
      setPosicionando(false);
      void runRef.current();
    }, esperaPosicionamentoMs());
    // Sem limpeza aqui de propósito: ver o comentário do `relogioRef`.
  }, [isIdentified, requiredEpis.length, router, state]);

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
    /*
     * Ponto sem nenhum EPI exigido: diga isso, não fique girando.
     *
     * O efeito antigo era o pior possível na portaria — remover todas as
     * exigências no painel deixava o terminal parado nesta tela para sempre,
     * porque o disparo automático é guardado por `requiredEpis.length > 0` e
     * nada mais acontecia. Nenhuma mensagem, nenhum caminho de volta.
     *
     * E liberar por padrão também não serve, por mais que pareça o oposto
     * simétrico: um ponto sem EPIs configurados quase nunca é "aqui não
     * precisa de equipamento", e quase sempre é configuração que faltou. O
     * servidor recusa pelo mesmo motivo. A saída é tornar o erro visível para
     * quem pode corrigi-lo, em vez de escondê-lo atrás de uma catraca aberta.
     */
    if (requiredEpis.length === 0) {
      return (
        <StateView
          icon="cog-off-outline"
          title={APP_MESSAGES.scan.noPolicyTitle}
          description={APP_MESSAGES.scan.noPolicyDescription}
          tone="warning"
          appearance="dark"
          actions={[{ label: APP_MESSAGES.face.backHomeButton, onPress: goHome, icon: 'home' }]}
        />
      );
    }

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
          {/*
            `posicionando || isDetecting` em vez de só `isDetecting`: a linha
            precisa varrer desde o instante em que a tela abre. Ligada apenas
            na detecção, ela ficaria parada durante a espera — segundos de
            tela morta bem quando a pessoa está andando de costas e quer saber
            se o sistema está vivo.
          */}
          <EpiFigure
            items={items}
            analyzing={posicionando || isDetecting}
            tone="dark"
            backgroundColor={colors.scanner.viewport}
            style={styles.figura}
          />
          <ScanFrame active={posicionando || isDetecting} />
        </View>

        <View style={styles.panel}>
          <Text variant="heading" color={colors.white} align="center">
            {APP_MESSAGES.scan.epiDetecting}
          </Text>
          {/*
            Durante a espera, a instrução vale mais que o nome: quem está
            andando para a marcação precisa saber que deve ficar parado lá. O
            nome volta quando a captura já saiu e não há mais nada a fazer
            além de esperar.
          */}
          <Text variant="caption" color={colors.slate[400]} align="center">
            {posicionando || !employee ? APP_MESSAGES.scan.epiDetectingHint : employee.nome}
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
