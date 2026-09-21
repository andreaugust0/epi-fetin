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
 * Teto da espera na preparação, quando não há prazo do servidor a seguir.
 *
 * Mesmo valor do `IDENTIFICACAO_TTL_S`, para o modo simulado se comportar
 * como o real em vez de ser mais generoso que ele.
 */
const PREPARACAO_MAX_MS = 180_000;

/** Piso, para uma identificação já vencida não deixar a tela pendurada. */
const PREPARACAO_MIN_MS = 5_000;

/**
 * Quanto esperar nesta rota — e por que a preparação é diferente de todas.
 *
 * Os 45 s valem para telas em que ficar parado significa desistência. A
 * preparação não é uma delas: ali a pessoa está DE COSTAS PARA O TABLET
 * vestindo capacete, máscara e óculos, e não tocar na tela é exatamente o
 * comportamento esperado. Tratar isso como abandono derrubava a sessão no
 * meio, e quem estava se equipando voltava para a tela inicial tendo de
 * mostrar o rosto de novo — foi o que aconteceu na portaria.
 *
 * O conserto não é aumentar o número. É PARAR DE INVENTAR UM NÚMERO: quem
 * já decide até quando aquela identidade vale é o servidor, com
 * `IDENTIFICACAO_TTL_S`, e ele carimba o prazo dentro da própria
 * identificação. Depois desse instante não há mais nada a proteger — o
 * servidor recusaria a verificação de qualquer jeito —, então é exatamente
 * ali que a tela deve voltar ao início.
 *
 * O efeito colateral é bom: o prazo passa a ter um dono só. Se três minutos
 * não bastarem para vestir tudo, mexe-se no servidor e o tablet obedece,
 * sem duas constantes para manter em acordo.
 */
export const esperaDaRota = (
  pathname: string,
  expiraEm: string | null,
  agora: number = Date.now(),
): number => {
  if (pathname !== '/preparacao') {
    return INATIVIDADE_MS;
  }
  if (!expiraEm) {
    // Sem prazo declarado é o caminho sem servidor (modo simulado).
    return PREPARACAO_MAX_MS;
  }
  const resta = Date.parse(expiraEm) - agora;
  if (!Number.isFinite(resta)) {
    return PREPARACAO_MAX_MS;
  }
  return Math.min(PREPARACAO_MAX_MS, Math.max(PREPARACAO_MIN_MS, resta));
};

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
  const { reset, snapshot } = useVerificationSession();
  const expiraEm = snapshot.identificationExpiresAt ?? null;

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
    // Recalculado a cada toque, e não guardado: na preparação a espera é o
    // que SOBRA do prazo da identificação, então tocar na tela não estica
    // nada além dele. Um toque aos dois minutos concede um minuto, não mais
    // três — que é o que um valor fixo faria, e seria justamente o furo que
    // este guarda existe para fechar.
    relogioRef.current = setTimeout(() => {
      reset();
      router.replace('/');
    }, esperaDaRota(pathname, expiraEm));
  }, [expiraEm, limpar, pathname, reset, router]);

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
