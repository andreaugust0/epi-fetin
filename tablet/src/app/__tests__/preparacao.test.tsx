import { waitFor } from '@testing-library/react-native';

import { APP_MESSAGES } from '@/constants/messages';
import { setFaceRecognitionService } from '@/features/face-recognition/services/faceRecognitionServiceFactory';
import { MockFaceRecognitionService } from '@/features/face-recognition/services/MockFaceRecognitionService';
import { setEsperaPosicionamentoMs } from '@/features/verification-session/posicionamento';
import { IdentifyAs, pressAndSettle, renderScreen } from '@/test-utils/renderScreen';

import PreparationScreen from '../preparacao';

/*
 * A espera de posicionamento vale cinco segundos em campo — o tempo de a
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
  // `random: 0` seleciona sempre o primeiro funcionário da lista simulada.
  setFaceRecognitionService(
    new MockFaceRecognitionService({
      random: () => 0,
      durationMs: 0,
      forcedOutcome: 'recognized',
    }),
  );
});

afterEach(() => {
  setFaceRecognitionService(null);
});

/**
 * Identifica alguém e depois mostra a preparação, dentro do mesmo provider —
 * é assim que o funcionário sobrevive à troca de tela no aplicativo real.
 */
const renderAfterIdentification = async () => {
  const view = await renderScreen(
    <>
      <IdentifyAs />
      <PreparationScreen />
    </>,
  );

  await waitFor(() => expect(view.queryByText('Caio de Castro Yarouhas')).toBeTruthy());

  return view;
};

describe('tela de preparação para EPI', () => {
  it('exige identificação antes de permitir a verificação', async () => {
    const { getByText, queryByText } = await renderScreen(<PreparationScreen />);

    expect(getByText(APP_MESSAGES.preparation.missingEmployeeTitle)).toBeTruthy();
    expect(queryByText(APP_MESSAGES.preparation.startButton)).toBeNull();
  });

  it('apresenta o funcionário identificado', async () => {
    const { getByText } = await renderAfterIdentification();

    expect(getByText(APP_MESSAGES.preparation.title)).toBeTruthy();
    expect(getByText('Caio de Castro Yarouhas')).toBeTruthy();
    expect(getByText(`${APP_MESSAGES.face.registrationLabel}: 001`)).toBeTruthy();
    expect(getByText(`${APP_MESSAGES.face.sectorLabel}: Segurança`)).toBeTruthy();
  });

  it('funciona com um funcionário que só tem id e nome, sem inventar dados', async () => {
    // O reconhecimento facial real (galeria de embeddings) só conhece id e
    // nome — matrícula/setor não existem nesse pipeline ainda.
    setFaceRecognitionService({
      recognize: async () => ({
        status: 'recognized',
        employee: { id: 'gallery-caio', nome: 'Caio' },
        confidence: 0.9,
      }),
    });
    const view = await renderScreen(
      <>
        <IdentifyAs />
        <PreparationScreen />
      </>,
    );
    await waitFor(() => expect(view.queryByText('Caio')).toBeTruthy());

    expect(
      view.queryByText(new RegExp(`^${APP_MESSAGES.face.registrationLabel}:`)),
    ).toBeNull();
    expect(view.queryByText(new RegExp(`^${APP_MESSAGES.face.sectorLabel}:`))).toBeNull();
  });

  it('instrui o funcionário a se posicionar na marcação do chão', async () => {
    const { getByText } = await renderAfterIdentification();

    expect(getByText(APP_MESSAGES.preparation.positionInstruction)).toBeTruthy();
    expect(getByText(APP_MESSAGES.preparation.positionDetail)).toBeTruthy();
  });

  it('não inicia a verificação de EPI sozinha', async () => {
    await renderAfterIdentification();

    expect(mockReplace).not.toHaveBeenCalledWith('/verificacao');
  });

  it('só avança para a verificação após o toque no botão', async () => {
    const { getByText } = await renderAfterIdentification();

    await pressAndSettle(getByText(APP_MESSAGES.preparation.startButton));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/verificacao'));
  });
});

describe('tela de preparação — sair', () => {
  it('oferece a saída ao lado da ação principal', async () => {
    const { getByText } = await renderAfterIdentification();

    expect(getByText(APP_MESSAGES.preparation.startButton)).toBeTruthy();
    expect(getByText(APP_MESSAGES.preparation.exitButton)).toBeTruthy();
  });

  it('retorna para a tela inicial', async () => {
    const { getByText } = await renderAfterIdentification();

    await pressAndSettle(getByText(APP_MESSAGES.preparation.exitButton));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  });

  it('não inicia a verificação de EPI ao sair', async () => {
    const { getByText } = await renderAfterIdentification();

    await pressAndSettle(getByText(APP_MESSAGES.preparation.exitButton));

    expect(mockReplace).not.toHaveBeenCalledWith('/verificacao');
  });

  it('limpa a sessão: o funcionário anterior não permanece', async () => {
    const { getByText, queryByText } = await renderAfterIdentification();

    await pressAndSettle(getByText(APP_MESSAGES.preparation.exitButton));

    // Sem funcionário na sessão, a tela volta a exigir identificação.
    await waitFor(() =>
      expect(queryByText(APP_MESSAGES.preparation.missingEmployeeTitle)).toBeTruthy(),
    );
    expect(queryByText('Caio de Castro Yarouhas')).toBeNull();
    expect(queryByText(APP_MESSAGES.preparation.startButton)).toBeNull();
  });
});
