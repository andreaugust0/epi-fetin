import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTerminalMetrics } from '@/hooks/useTerminalMetrics';
import { colors, radii, spacing } from '@/theme';

import type { EpiCatalogItem } from '../types';

export interface EpiGridItemProps {
  item: EpiCatalogItem;
  /** Itens inativos aparecem esmaecidos, como na pré-visualização do admin. */
  active?: boolean;
}

/** Cartão de equipamento exibido na grade da tela inicial. */
export const EpiGridItem = ({ item, active = true }: EpiGridItemProps) => {
  const metrics = useTerminalMetrics();

  return (
    <View
      accessible
      accessibilityLabel={`${item.label}. ${item.description}. ${active ? 'Ativo' : 'Inativo'}`}
      style={[styles.container, active ? null : styles.inactive]}
    >
      <View
        style={[
          styles.iconWrapper,
          { width: metrics.epiIconBoxSize, height: metrics.epiIconBoxSize },
          active ? styles.iconActive : styles.iconInactive,
        ]}
      >
        <MaterialCommunityIcons
          name={item.icon}
          size={metrics.epiIconSize}
          color={active ? colors.primary : colors.slate[400]}
        />
      </View>

      <Text
        variant={metrics.epiLabel}
        color={active ? colors.slate[800] : colors.slate[400]}
        align="center"
        style={styles.label}
      >
        {item.label}
      </Text>
      <Text
        variant={metrics.epiDescription}
        color={colors.slate[500]}
        align="center"
        style={styles.description}
      >
        {item.description}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  /**
   * Sem `flex` aqui de propósito.
   *
   * O item vive dentro de uma célula em coluna, então `flex: 1` significava
   * `flexBasis: 0` no eixo vertical: o Yoga zerava a altura do item no
   * Android e as linhas colapsavam umas sobre as outras, escondendo os
   * textos. A altura tem que vir do conteúdo — ícone, nome e descrição.
   */
  container: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  inactive: {
    opacity: 0.55,
  },
  /** Margens em vez de `gap`: espaçamento idêntico em Android e Web. */
  label: {
    marginTop: spacing.sm,
  },
  description: {
    marginTop: spacing.xxs,
  },
  iconWrapper: {
    borderRadius: radii.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconActive: {
    backgroundColor: colors.white,
  },
  iconInactive: {
    backgroundColor: colors.slate[100],
  },
});
