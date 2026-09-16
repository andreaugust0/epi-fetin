import { waitFor } from '@testing-library/react-native';

import { APP_MESSAGES } from '@/constants/messages';
import {
  isFaceApiConfigured,
  resolveFaceApiConfig,
} from '@/features/face-recognition/services/faceApiConfig';
import { renderScreen } from '@/test-utils/renderScreen';

import HomeScreen from '../index';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  // O `useFocusEffect` do expo-router roda o efeito quando a tela ganha foco.
  // No teste não há navegador, então ele se comporta como um efeito comum —
  // que é exatamente o caso "a tela acabou de abrir".
  useFocusEffect: (efeito: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(efeito, [efeito]);
  },
}));

jest.mock('@/features/face-recognition/services/faceApiConfig', () => ({
  isFaceApiConfigured: jest.fn(),
  /*
   * `resolveFaceApiConfig` precisa existir aqui, e a razão merece registro:
   * a lista de EPIs exigidos passou a perguntar ao servidor, e é por esta
   * função que ela descobre se há servidor a quem perguntar. Mockar o módulo
   * só com `isFaceApiConfigured` a deixava `undefined`, a consulta falhava, e
   * a tela inicial trocava a grade pelo estado de erro — levando junto o
   * aviso de modo simulado, que é o que estes testes observam.
   *
   * Sem provisionamento, como aqui: a consulta ao servidor nem sai, e a lista
   * vem do armazenamento local.
   */
  resolveFaceApiConfig: jest.fn().mockResolvedValue({
    baseUrl: null,
    baseUrlSource: null,
    pointId: null,
    pointIdSource: null,
  }),
}));

const configurado = isFaceApiConfigured as jest.MockedFunction<typeof isFaceApiConfigured>;
const resolverConfig = resolveFaceApiConfig as jest.MockedFunction<typeof resolveFaceApiConfig>;

const SEM_PROVISIONAMENTO = {
  baseUrl: null,
  baseUrlSource: null,
  pointId: null,
  pointIdSource: null,
} as const;

const fetchOriginal = global.fetch;

beforeEach(() => {
  configurado.mockReset();
  // Volta ao padrão sem provisionamento: um teste que provisiona não pode
  // deixar o seguinte falando com um servidor imaginário.
  resolverConfig.mockReset();
  resolverConfig.mockResolvedValue({ ...SEM_PROVISIONAMENTO });
});

afterEach(() => {
  global.fetch = fetchOriginal;
});

/**
 * O aviso de modo simulado.
 *
 * Sem provisionamento o aplicativo cai no `MockEpiVerificationService` e
 * continua funcionando: mostra aprovado ou reprovado, gerado no próprio
 * aparelho, sem falar com o servidor. A mensagem existia em `messages.ts`
 * desde sempre, mas nenhuma tela a renderizava — e uma verificação simulada
 * era indistinguível de uma real até alguém procurar o registro no painel e
 * achar a lista vazia.
 *
 * Estes testes existem para que ela não volte a se soltar da interface.
 */
describe('tela inicial · aviso de modo simulado', () => {
  it('avisa quando o tablet não está provisionado', async () => {
    configurado.mockResolvedValue(false);

    const view = await renderScreen(<HomeScreen />);

    await waitFor(() =>
      expect(view.queryByText(APP_MESSAGES.home.simulationNotice)).toBeTruthy(),
    );
  });

  /**
   * O tablet NÃO pode ficar sem saída quando o servidor não responde.
   *
   * A primeira versão desta tela devolvia um estado de erro em tela cheia
   * quando a consulta de exigência falhava. Junto com a grade, ia embora o
   * título — e é no título que mora o toque longo que abre o provisionamento,
   * o único caminho para corrigir o endereço do servidor no aparelho. Um
   * tablet que não alcançava o servidor ficava impossível de consertar sem
   * reinstalar o aplicativo: a tela que denunciava o problema era a que
   * impedia de resolvê-lo.
   *
   * O teste observa o título, não o aviso, porque é o título que é a saída.
   */
  it('continua utilizável quando o servidor não responde', async () => {
    configurado.mockResolvedValue(true);
    resolverConfig.mockResolvedValue({
      baseUrl: 'http://192.168.0.10:8000',
      baseUrlSource: 'override',
      pointId: 1,
      pointIdSource: 'override',
    });
    global.fetch = jest.fn().mockRejectedValue(new Error('rede fora')) as unknown as typeof fetch;

    const view = await renderScreen(<HomeScreen />);

    await waitFor(() => expect(view.queryByText(APP_MESSAGES.home.staleNotice)).toBeTruthy());
    expect(view.queryByText(APP_MESSAGES.home.title)).toBeTruthy();
  });

  it('não avisa quando o tablet está provisionado', async () => {
    configurado.mockResolvedValue(true);

    const view = await renderScreen(<HomeScreen />);

    await waitFor(() => expect(configurado).toHaveBeenCalled());
    expect(view.queryByText(APP_MESSAGES.home.simulationNotice)).toBeNull();
  });

  it('não acusa modo simulado quando a leitura do armazenamento falha', async () => {
    // Sem saber, calar: um aviso que aparece por engano é um aviso que se
    // aprende a ignorar, e aí ele não serve para nada no dia em que importa.
    configurado.mockRejectedValue(new Error('armazenamento indisponível'));

    const view = await renderScreen(<HomeScreen />);

    await waitFor(() => expect(configurado).toHaveBeenCalled());
    expect(view.queryByText(APP_MESSAGES.home.simulationNotice)).toBeNull();
  });

  it('a mensagem diz que nada é registrado no servidor', () => {
    // O texto é o produto aqui: "modo simulado" sozinho não diz a alguém de
    // fora do projeto que a passagem não vai existir em lugar nenhum.
    expect(APP_MESSAGES.home.simulationNotice).toMatch(/não está provisionado/i);
    expect(APP_MESSAGES.home.simulationNotice).toMatch(/nada é registrado no servidor/i);
  });
});
