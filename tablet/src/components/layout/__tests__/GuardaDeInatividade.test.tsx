import { act, render } from '@testing-library/react-native';

import { Text } from '@/components/ui';
import { VerificationSessionProvider } from '@/features/verification-session/hooks/VerificationSessionContext';

import { GuardaDeInatividade, esperaDaRota } from '../GuardaDeInatividade';

const mockReplace = jest.fn();
let mockPathname = '/identificacao';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  usePathname: () => mockPathname,
}));

/**
 * `await act` depois do render, e não só `render`.
 *
 * Sob React 19 o efeito que arma o relógio não roda antes de o act pendente
 * assentar. Sem esta espera, `advanceTimersByTime` adianta um relógio que
 * ainda não existe, e o teste falha anunciando que a guarda não funciona
 * quando o que não funcionou foi a montagem.
 */
const renderizar = async () => {
  const view = render(
    <VerificationSessionProvider>
      <GuardaDeInatividade>
        <Text>conteúdo</Text>
      </GuardaDeInatividade>
    </VerificationSessionProvider>,
  );
  await act(async () => {});
  return view;
};

const passar = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  mockReplace.mockClear();
  mockPathname = '/identificacao';
});

afterEach(() => {
  jest.useRealTimers();
});

/**
 * O retorno por inatividade é controle de acesso, não conforto.
 *
 * O fluxo guarda quem foi reconhecido até a verificação terminar. Uma pessoa
 * que se identifica e desiste deixa a própria identidade pendurada na tela, e
 * a próxima que chega encontra o nome de outra já aceito. Quem passa pela
 * catraca é ela; quem fica no registro é a primeira — sem nenhuma má intenção
 * envolvida.
 */
describe('retorno por inatividade', () => {
  it('volta ao início depois do tempo parado, numa tela do fluxo', async () => {
    await renderizar();
    await passar(45_000);

    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('não volta antes do tempo', async () => {
    await renderizar();
    await passar(44_000);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  /**
   * A tela inicial não tem sessão a abandonar, e expulsar alguém dela seria
   * um piscar sem motivo — a tela seria substituída por ela mesma.
   */
  it('ignora a tela inicial', async () => {
    mockPathname = '/';
    await renderizar();
    await passar(60_000);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  /**
   * Quem chegou ao provisionamento passou por um toque longo de três segundos
   * e está lendo endereços e token na tela. Ser expulso no meio disso seria
   * hostil, e não protege ninguém: não há identificação aberta ali.
   */
  it('ignora as telas de manutenção', async () => {
    mockPathname = '/provisionamento-tablet';
    await renderizar();
    await passar(60_000);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  /**
   * A regressão que levou o terminal para a portaria e voltou.
   *
   * Na preparação a pessoa está de costas para o tablet vestindo capacete,
   * máscara e óculos: não tocar na tela é o comportamento esperado, não
   * abandono. Com os 45 s valendo ali, a sessão morria no meio do
   * equipamento e quem estava se vestindo voltava à tela inicial tendo de
   * mostrar o rosto de novo.
   */
  it('não expulsa quem está se equipando na preparação', async () => {
    mockPathname = '/preparacao';
    await renderizar();
    await passar(45_000);

    expect(mockReplace).not.toHaveBeenCalled();
  });
});

/**
 * A política de prazo, testada sozinha.
 *
 * Separada do componente porque o que importa aqui é a REGRA — quem manda no
 * prazo da preparação é o carimbo do servidor, não uma constante do tablet —
 * e montar a árvore com uma identificação de validade controlada só para
 * medir um número tornaria o teste sobre React em vez de sobre a decisão.
 */
describe('esperaDaRota', () => {
  const AGORA = Date.parse('2026-09-21T18:00:00.000Z');
  const daquiA = (ms: number) => new Date(AGORA + ms).toISOString();

  it('usa os 45 s nas telas que não são a preparação', () => {
    expect(esperaDaRota('/identificacao', daquiA(180_000), AGORA)).toBe(45_000);
    expect(esperaDaRota('/resultado', null, AGORA)).toBe(45_000);
  });

  it('na preparação, segue o que sobra do prazo da identificação', () => {
    expect(esperaDaRota('/preparacao', daquiA(120_000), AGORA)).toBe(120_000);
  });

  /** Nunca além do prazo: seria conceder tempo que o servidor não deu. */
  it('não passa do teto nem com um prazo absurdo', () => {
    expect(esperaDaRota('/preparacao', daquiA(600_000), AGORA)).toBe(180_000);
  });

  /** Identificação já vencida não deixa a tela pendurada. */
  it('cai para o piso quando o prazo já passou', () => {
    expect(esperaDaRota('/preparacao', daquiA(-10_000), AGORA)).toBe(5_000);
  });

  /** Modo simulado: não há carimbo do servidor para seguir. */
  it('usa o teto quando não há prazo declarado', () => {
    expect(esperaDaRota('/preparacao', null, AGORA)).toBe(180_000);
    expect(esperaDaRota('/preparacao', 'nao-e-data', AGORA)).toBe(180_000);
  });
});
