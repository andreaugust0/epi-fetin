import { act, waitFor } from '@testing-library/react-native';

import { APP_MESSAGES } from '@/constants/messages';
import { setEpiVerificationService } from '@/features/epi-detection/services/epiVerificationServiceFactory';
import { MockEpiVerificationService } from '@/features/epi-detection/services/MockEpiVerificationService';
import { setFaceRecognitionService } from '@/features/face-recognition/services/faceRecognitionServiceFactory';
import { MockFaceRecognitionService } from '@/features/face-recognition/services/MockFaceRecognitionService';
import { setEsperaPosicionamentoMs } from '@/features/verification-session/posicionamento';
import { IdentifyAs, pressAndSettle, renderScreen } from '@/test-utils/renderScreen';

import PreparationScreen from '../preparacao';
import VerificationScreen from '../verificacao';

/*
 * A espera de posicionamento vale alguns segundos em campo — o tempo de a
 * pessoa chegar na marcação do chão. Aqui ela vai a zero: esperar de verdade
 * estouraria o limite do `waitFor` em todo teste do fluxo, e aumentar esse
 * limite deixaria a suíte lenta para medir uma pausa que não é o objeto de
 * nenhum destes testes.
 */
beforeEach(() => {
  setEsperaPosicionamentoMs(0);
});

afterEach(() => {
  setEsperaPosicionamentoMs(null);
});

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  // `useFocusEffect` roda o efeito quando a tela ganha foco. No teste não há
  // navegador, então ele se comporta como um efeito comum — que é exatamente
  // o caso "a tela acabou de abrir". Sem isto, a lista de EPIs exigidos, que
  // recarrega a cada foco, derruba qualquer tela que a use.
  useFocusEffect: (efeito: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(efeito, [efeito]);
  },
}));

beforeEach(() => {
  mockReplace.mockClear();
  setFaceRecognitionService(
    new MockFaceRecognitionService({ random: () => 0, durationMs: 0, forcedOutcome: 'recognized' }),
  );
});

afterEach(() => {
  setFaceRecognitionService(null);
  setEpiVerificationService(null);
});

/**
 * Percorre o fluxo real — identificação, preparação e verificação — dentro do
 * mesmo provider. A preparação é obrigatória: é ela que autoriza a análise.
 */
const renderThroughFlow = async (scenario: string) => {
  setEpiVerificationService(
    new MockEpiVerificationService({ random: () => 0.5, stepMs: 0, forcedScenario: scenario }),
  );

  const view = await renderScreen(
    <>
      <IdentifyAs />
      <PreparationScreen />
      <VerificationScreen />
    </>,
  );

  await waitFor(() => expect(view.queryByText(APP_MESSAGES.preparation.startButton)).toBeTruthy());
  await pressAndSettle(view.getByText(APP_MESSAGES.preparation.startButton));

  return view;
};

describe('tela de verificação de EPI', () => {
  it('exige funcionário identificado', async () => {
    const { getByText } = await renderScreen(<VerificationScreen />);

    expect(getByText(APP_MESSAGES.preparation.missingEmployeeTitle)).toBeTruthy();
  });

  /**
   * A espera de posicionamento, guardada como comportamento e não como número.
   *
   * Ela existe porque a marcação do chão fica a alguns passos do tablet: sem a
   * pausa, a captura saía com a pessoa ainda debruçada sobre a tela e a borda
   * reprovava quem estava com todos os equipamentos. O sintoma seria uma
   * reprovação injusta e intermitente — o tipo de defeito que se atribui ao
   * modelo, e não ao tempo.
   *
   * O que se observa de fora é a instrução no lugar do nome: enquanto a pessoa
   * está a caminho, a tela pede que ela fique parada na marcação.
   */
  it('espera a pessoa se posicionar antes de capturar', async () => {
    setEsperaPosicionamentoMs(200);
    const { getByText, queryByText } = await renderThroughFlow('conformidade-total');

    expect(getByText(APP_MESSAGES.scan.epiDetectingHint)).toBeTruthy();

    await waitFor(() => expect(queryByText(APP_MESSAGES.scan.epiDetectingHint)).toBeNull(), {
      timeout: 3000,
    });
  });

  /**
   * A captura não pode se perder se a tela re-renderizar durante a espera.
   *
   * Foi assim que ela se perdia: o efeito que agenda o disparo dependia de
   * `runVerification`, que muda de identidade quando `requiredEpis` muda de
   * identidade. Entrar nesta tela recarrega a lista do servidor, a resposta
   * chega no meio da espera, o efeito reexecutava, a limpeza
   * CANCELAVA o temporizador — e a nova execução caía no `return` do
   * `hasStartedRef`, que já estava marcado. A tela varria para sempre e nada
   * era capturado.
   *
   * Este teste força o re-render no meio da espera, que é o que a suíte antiga
   * nunca fazia: nela as telas convivem na mesma árvore e a lista já está
   * carregada antes do toque. No tablet, esta tela monta do zero.
   */
  it('nao perde a captura se a tela re-renderizar durante a espera', async () => {
    setEsperaPosicionamentoMs(300);
    const view = await renderThroughFlow('conformidade-total');

    await act(async () => {
      await view.showScreen(
        <>
          <IdentifyAs />
          <PreparationScreen />
          <VerificationScreen />
        </>,
      );
    });

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/resultado'), {
      timeout: 4000,
    });
  });

  it('inicia a análise automaticamente, sem exigir novo toque', async () => {
    const { getAllByText } = await renderThroughFlow('conformidade-total');

    await waitFor(() => expect(getAllByText(APP_MESSAGES.scan.epiDetecting).length).toBe(1));
  });

  /**
   * A lista de equipamentos NÃO aparece mais nesta tela, e o teste guarda
   * isso de propósito.
   *
   * Enquanto a Raspberry analisa, o servidor não devolve nada parcial: o
   * desfecho chega de uma vez, com os sete EPIs juntos. A lista aqui
   * mostrava sete linhas iguais dizendo "aguardando" — ruído com aparência
   * de informação. O boneco ocupou o lugar dela, e a lista com nome e
   * confiança por EPI vive na tela de resultado, onde há resultado.
   */
  it('nao lista equipamentos durante a analise', async () => {
    const { queryAllByText, getAllByText } = await renderThroughFlow('conformidade-total');

    await waitFor(() => expect(getAllByText(APP_MESSAGES.scan.epiDetecting).length).toBe(1));
    expect(queryAllByText('Capacete')).toHaveLength(0);
    expect(queryAllByText('Luvas')).toHaveLength(0);
  });

  it('reporta progresso até 100%', async () => {
    const { queryAllByText } = await renderThroughFlow('conformidade-total');

    await waitFor(() => expect(queryAllByText('100%').length).toBeGreaterThan(0));
  });

  it('navega para o resultado ao concluir', async () => {
    await renderThroughFlow('conformidade-total');

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/resultado'));
  });

  it('não oferece captura, galeria nem confirmação manual', async () => {
    const { queryByText } = await renderThroughFlow('conformidade-total');

    expect(queryByText(/Capturar/i)).toBeNull();
    expect(queryByText(/Galeria/i)).toBeNull();
    expect(queryByText(/Confirmar/i)).toBeNull();
  });
});
