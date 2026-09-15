import { act, render } from '@testing-library/react-native';

import { Text } from '@/components/ui';
import { VerificationSessionProvider } from '@/features/verification-session/hooks/VerificationSessionContext';

import { GuardaDeInatividade } from '../GuardaDeInatividade';

const mockReplace = jest.fn();
let mockPathname = '/identificacao';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  usePathname: () => mockPathname,
}));

const renderizar = () =>
  render(
    <VerificationSessionProvider>
      <GuardaDeInatividade>
        <Text>conteúdo</Text>
      </GuardaDeInatividade>
    </VerificationSessionProvider>,
  );

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
  it('volta ao início depois do tempo parado, numa tela do fluxo', () => {
    renderizar();

    act(() => {
      jest.advanceTimersByTime(45_000);
    });

    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('não volta antes do tempo', () => {
    renderizar();

    act(() => {
      jest.advanceTimersByTime(44_000);
    });

    expect(mockReplace).not.toHaveBeenCalled();
  });

  /**
   * A tela inicial não tem sessão a abandonar, e expulsar alguém dela seria
   * um piscar sem motivo — a tela seria substituída por ela mesma.
   */
  it('ignora a tela inicial', () => {
    mockPathname = '/';
    renderizar();

    act(() => {
      jest.advanceTimersByTime(60_000);
    });

    expect(mockReplace).not.toHaveBeenCalled();
  });

  /**
   * Quem chegou ao provisionamento passou por um toque longo de três segundos
   * e está lendo endereços e token na tela. Ser expulso no meio disso seria
   * hostil, e não protege ninguém: não há identificação aberta ali.
   */
  it('ignora as telas de manutenção', () => {
    mockPathname = '/provisionamento-tablet';
    renderizar();

    act(() => {
      jest.advanceTimersByTime(60_000);
    });

    expect(mockReplace).not.toHaveBeenCalled();
  });
});
