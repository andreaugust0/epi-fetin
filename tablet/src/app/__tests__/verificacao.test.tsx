import { waitFor } from '@testing-library/react-native';

import { APP_MESSAGES } from '@/constants/messages';
import { setEpiVerificationService } from '@/features/epi-detection/services/epiVerificationServiceFactory';
import { MockEpiVerificationService } from '@/features/epi-detection/services/MockEpiVerificationService';
import { setFaceRecognitionService } from '@/features/face-recognition/services/faceRecognitionServiceFactory';
import { MockFaceRecognitionService } from '@/features/face-recognition/services/MockFaceRecognitionService';
import { IdentifyAs, pressAndSettle, renderScreen } from '@/test-utils/renderScreen';

import PreparationScreen from '../preparacao';
import VerificationScreen from '../verificacao';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
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
