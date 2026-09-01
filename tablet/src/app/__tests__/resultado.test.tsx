import { waitFor } from '@testing-library/react-native';

import { APP_MESSAGES } from '@/constants/messages';
import { setEpiVerificationService } from '@/features/epi-detection/services/epiVerificationServiceFactory';
import { MockEpiVerificationService } from '@/features/epi-detection/services/MockEpiVerificationService';
import { setFaceRecognitionService } from '@/features/face-recognition/services/faceRecognitionServiceFactory';
import { MockFaceRecognitionService } from '@/features/face-recognition/services/MockFaceRecognitionService';
import { IdentifyAs, pressAndSettle, renderScreen } from '@/test-utils/renderScreen';

import PreparationScreen from '../preparacao';
import ResultScreen from '../resultado';
import VerificationScreen from '../verificacao';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
}));

const EMPLOYEE_NAME = 'Caio de Castro Yarouhas';

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
 * Percorre o fluxo inteiro e então mostra o resultado.
 *
 * A troca de tela ao final importa: no aplicativo a preparação é desmontada
 * ao navegar, e mantê-la montada aqui faria ela reagir à reprovação e
 * descartar o resultado que acabou de ser produzido.
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

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/resultado'));

  await view.showScreen(<ResultScreen />);

  return view;
};

describe('resultado aprovado', () => {
  it('anuncia o acesso liberado e o funcionário', async () => {
    const { getByText } = await renderThroughFlow('conformidade-total');

    expect(getByText(APP_MESSAGES.result.approvedTitle)).toBeTruthy();
    expect(getByText(EMPLOYEE_NAME)).toBeTruthy();
  });

  it('exibe todos os equipamentos analisados', async () => {
    const { queryAllByText } = await renderThroughFlow('conformidade-total');

    for (const label of ['Capacete', 'Colete', 'Óculos', 'Botas', 'Máscara', 'Luvas']) {
      expect(queryAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('oferece apenas a volta ao início', async () => {
    const { getByText, queryByText } = await renderThroughFlow('conformidade-total');

    expect(getByText(APP_MESSAGES.result.backHomeButton)).toBeTruthy();
    expect(queryByText(APP_MESSAGES.result.retryButton)).toBeNull();
    expect(queryByText(APP_MESSAGES.result.exitButton)).toBeNull();
  });

  it('voltar ao início limpa a sessão', async () => {
    const { getByText, queryByText } = await renderThroughFlow('conformidade-total');

    await pressAndSettle(getByText(APP_MESSAGES.result.backHomeButton));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    // Sem funcionário e sem resultado, a tela cai no estado de indisponível.
    expect(queryByText(EMPLOYEE_NAME)).toBeNull();
    expect(queryByText(APP_MESSAGES.result.missingResultTitle)).toBeTruthy();
  });
});

describe('resultado reprovado', () => {
  it('anuncia o acesso negado e o funcionário', async () => {
    const { getByText } = await renderThroughFlow('falta-luvas-e-mascara');

    expect(getByText(APP_MESSAGES.result.rejectedTitle)).toBeTruthy();
    expect(getByText(EMPLOYEE_NAME)).toBeTruthy();
  });

  it('informa quantos equipamentos faltaram', async () => {
    const { getByText } = await renderThroughFlow('falta-luvas-e-mascara');

    expect(
      getByText(
        `${APP_MESSAGES.result.rejectedReasonPrefix} 2 ${APP_MESSAGES.result.rejectedReasonSuffix}`,
      ),
    ).toBeTruthy();
  });

  it('usa o singular quando falta um só equipamento', async () => {
    const { getByText } = await renderThroughFlow('falta-oculos');

    expect(
      getByText(
        `${APP_MESSAGES.result.rejectedReasonPrefix} 1 ${APP_MESSAGES.result.rejectedReasonSuffixSingular}`,
      ),
    ).toBeTruthy();
  });

  it('continua mostrando todos os equipamentos, e não só os ausentes', async () => {
    const { queryAllByText } = await renderThroughFlow('falta-luvas-e-mascara');

    // Os ausentes.
    expect(queryAllByText('Luvas').length).toBeGreaterThan(0);
    expect(queryAllByText('Máscara').length).toBeGreaterThan(0);
    // E também os aprovados.
    expect(queryAllByText('Capacete').length).toBeGreaterThan(0);
    expect(queryAllByText('Colete').length).toBeGreaterThan(0);
  });

  it('distingue detectado de não detectado por texto, não só por cor', async () => {
    const { queryAllByText } = await renderThroughFlow('falta-luvas-e-mascara');

    expect(queryAllByText(/^Detectado · /).length).toBeGreaterThan(0);
    expect(queryAllByText(/^Não detectado · /).length).toBeGreaterThan(0);
  });

  it('pergunta se deseja verificar novamente e oferece as duas ações', async () => {
    const { getByText } = await renderThroughFlow('falta-luvas-e-mascara');

    expect(getByText(APP_MESSAGES.result.retryQuestion)).toBeTruthy();
    expect(getByText(APP_MESSAGES.result.retryButton)).toBeTruthy();
    expect(getByText(APP_MESSAGES.result.exitButton)).toBeTruthy();
  });
});

describe('reprovado — verificar novamente', () => {
  it('volta para a preparação de EPI', async () => {
    const { getByText } = await renderThroughFlow('falta-luvas-e-mascara');
    mockReplace.mockClear();

    await pressAndSettle(getByText(APP_MESSAGES.result.retryButton));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/preparacao'));
  });

  it('preserva o funcionário identificado na preparação', async () => {
    const { getByText, queryAllByText, showScreen } =
      await renderThroughFlow('falta-luvas-e-mascara');

    await pressAndSettle(getByText(APP_MESSAGES.result.retryButton));
    await showScreen(<PreparationScreen />);

    expect(queryAllByText(EMPLOYEE_NAME).length).toBeGreaterThan(0);
    expect(queryAllByText(APP_MESSAGES.preparation.startButton).length).toBeGreaterThan(0);
  });

  it('não repete o reconhecimento facial', async () => {
    const recognize = jest.fn();
    const { getByText } = await renderThroughFlow('falta-luvas-e-mascara');

    // Qualquer chamada a partir daqui significaria refazer a identificação.
    setFaceRecognitionService({ recognize });
    await pressAndSettle(getByText(APP_MESSAGES.result.retryButton));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/preparacao'));
    expect(recognize).not.toHaveBeenCalled();
  });

  it('limpa a análise anterior antes de reanalisar', async () => {
    const { getByText, queryByText } = await renderThroughFlow('falta-luvas-e-mascara');

    await pressAndSettle(getByText(APP_MESSAGES.result.retryButton));

    // O veredito anterior sai da tela junto com o resultado descartado.
    await waitFor(() => expect(queryByText(APP_MESSAGES.result.rejectedTitle)).toBeNull());
    expect(queryByText(APP_MESSAGES.result.missingResultTitle)).toBeTruthy();
  });
});

describe('reprovado — sair', () => {
  it('limpa a sessão inteira e volta ao início', async () => {
    const { getByText, queryByText } = await renderThroughFlow('falta-luvas-e-mascara');
    mockReplace.mockClear();

    await pressAndSettle(getByText(APP_MESSAGES.result.exitButton));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(queryByText(EMPLOYEE_NAME)).toBeNull();
    expect(queryByText(APP_MESSAGES.result.missingResultTitle)).toBeTruthy();
  });
});
