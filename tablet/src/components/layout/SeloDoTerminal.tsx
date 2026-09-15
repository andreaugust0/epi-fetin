import Constants from 'expo-constants';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { APP_MESSAGES } from '@/constants/messages';
import { useEstadoServidor, type EstadoServidor } from '@/hooks/useEstadoServidor';
import { colors, spacing } from '@/theme';

const VERSAO = Constants.expoConfig?.version ?? '—';

const CORES: Record<EstadoServidor, string> = {
  verificando: colors.slate[400],
  online: colors.status.approved,
  offline: colors.status.rejected,
  'sem-provisionamento': colors.status.warning,
};

const ROTULOS: Record<EstadoServidor, string> = {
  verificando: APP_MESSAGES.terminal.checking,
  online: APP_MESSAGES.terminal.online,
  offline: APP_MESSAGES.terminal.offline,
  'sem-provisionamento': APP_MESSAGES.terminal.unprovisioned,
};

/**
 * Selo discreto com a versão instalada e o estado do servidor.
 *
 * Duas informações que ninguém olha até precisar muito, e que custam caro
 * quando não estão à mão.
 *
 * A versão: três tablets instalados em dias diferentes viram três aplicativos
 * diferentes, e a pergunta "qual build está neste aqui?" não tem resposta sem
 * abrir as configurações do Android. Na tela, ela resolve em um olhar.
 *
 * O estado: o terminal parece perfeito com o servidor desligado — a tela
 * abre, o botão funciona, a câmera liga. A falha só aparecia depois que
 * alguém já tinha encostado o rosto, com fila atrás.
 *
 * Deliberadamente pequeno e cinza. Quem usa a catraca não deve reparar nisto;
 * quem mantém o terminal sabe onde olhar.
 */
export const SeloDoTerminal = () => {
  const estado = useEstadoServidor();

  return (
    <View style={styles.linha}>
      <View style={[styles.ponto, { backgroundColor: CORES[estado] }]} />
      <Text variant="micro" color={colors.slate[400]}>
        {`${ROTULOS[estado]} · v${VERSAO}`}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingBottom: spacing.xs,
  },
  ponto: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
