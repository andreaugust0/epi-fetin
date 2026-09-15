import { usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useVerificationSession } from '@/features/verification-session/hooks/VerificationSessionContext';

/**
 * Tempo parado até o terminal voltar ao início sozinho.
 *
 * Curto o bastante para a sessão não sobreviver a alguém que desistiu e foi
 * embora; longo o bastante para caber a verificação inteira (que leva menos
 * de dez segundos) e a leitura do resultado sem ninguém tocar na tela.
 */
const INATIVIDADE_MS = 45_000;

/**
 * Rotas em que a sessão de alguém está aberta.
 *
 * A tela inicial fica de fora por não ter nada a abandonar. As de diagnóstico
 * e provisionamento também: quem chegou lá passou por um toque longo de
 * segundos, está lendo números na tela, e ser expulso no meio seria hostil.
 */
const ROTAS_DO_FLUXO = new Set(['/identificacao', '/preparacao', '/verificacao', '/resultado']);

/**
 * Volta ao início quando o terminal fica parado com uma sessão aberta.
 *
 * Isto não é conforto, é controle de acesso. O fluxo guarda quem foi
 * reconhecido até a verificação terminar, e uma pessoa que se identifica e
 * desiste — atende o telefone, esquece, vai buscar o capacete e não volta —
 * deixa a própria identidade pendurada na tela. A próxima pessoa que chega
 * encontra o nome de outra pessoa já aceito e toca em "Iniciar Verificação de
 * EPI". Quem passa pela catraca é ela; quem fica no registro é a primeira.
 *
 * Numa portaria de verdade esse é o caminho mais fácil de burlar o sistema
 * inteiro, e não exige nenhuma má intenção para acontecer por acidente.
 *
 * O toque é observado na fase de CAPTURA, antes de qualquer filho tratá-lo, e
 * o retorno `false` deixa o evento seguir normalmente. É o que permite vigiar
 * a tela inteira sem interceptar um único botão.
 */
export const GuardaDeInatividade = ({ children }: { children: ReactNode }) => {
  const router = useRouter();
  const pathname = usePathname();
  const { reset } = useVerificationSession();

  const relogioRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monitorada = ROTAS_DO_FLUXO.has(pathname);

  const limpar = useCallback(() => {
    if (relogioRef.current) {
      clearTimeout(relogioRef.current);
      relogioRef.current = null;
    }
  }, []);

  const reiniciar = useCallback(() => {
    limpar();
    relogioRef.current = setTimeout(() => {
      reset();
      router.replace('/');
    }, INATIVIDADE_MS);
  }, [limpar, reset, router]);

  useEffect(() => {
    if (!monitorada) {
      limpar();
      return;
    }
    reiniciar();
    return limpar;
    // `pathname` entra de propósito: cada troca de tela reinicia a contagem,
    // porque navegar é atividade mesmo quando o toque aconteceu na tela
    // anterior.
  }, [limpar, monitorada, pathname, reiniciar]);

  return (
    <View
      style={styles.preenche}
      onStartShouldSetResponderCapture={() => {
        if (monitorada) {
          reiniciar();
        }
        return false;
      }}
    >
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  preenche: { flex: 1 },
});
