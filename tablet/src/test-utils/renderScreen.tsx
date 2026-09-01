import { act, fireEvent, render } from '@testing-library/react-native';
import { useEffect, type ReactElement, type ReactNode } from 'react';
import type { TestInstance } from 'test-renderer';

import {
  useVerificationSession,
  VerificationSessionProvider,
} from '@/features/verification-session/hooks/VerificationSessionContext';

/**
 * Renderiza telas dentro do provider da sessão, que é o que mantém o
 * funcionário identificado vivo entre as telas do fluxo.
 *
 * `showScreen` troca a tela visível preservando a sessão — equivalente a
 * navegar no aplicativo, onde a tela anterior é desmontada mas o provider
 * continua de pé no layout raiz.
 */
export const renderScreen = async (ui: ReactNode) => {
  const view = await render(<VerificationSessionProvider>{ui}</VerificationSessionProvider>);

  const showScreen = async (next: ReactElement) =>
    view.rerender(<VerificationSessionProvider>{next}</VerificationSessionProvider>);

  return { ...view, showScreen };
};

/**
 * Toca em um elemento e deixa assentar o trabalho assíncrono que ele dispara.
 *
 * As ações do terminal chamam serviços que resolvem depois; sem o `act` as
 * atualizações resultantes chegam fora do ciclo de renderização e o React
 * reclama, escondendo erros reais no meio dos avisos.
 */
export const pressAndSettle = async (element: TestInstance) => {
  await act(async () => {
    fireEvent.press(element);
  });
};

/**
 * Fixture: identifica alguém direto pelo contexto da sessão, sem passar pela
 * UI da tela de identificação.
 *
 * A tela real virou um laço contínuo (câmera aberta, análises automáticas),
 * então telas que só precisam de "um funcionário já identificado" para testar
 * outra coisa não devem mais depender do botão dela. Configure o resultado
 * com `setFaceRecognitionService` antes de renderizar, como antes.
 */
export const IdentifyAs = () => {
  const { startFaceRecognition } = useVerificationSession();

  useEffect(() => {
    void startFaceRecognition();
  }, [startFaceRecognition]);

  return null;
};
