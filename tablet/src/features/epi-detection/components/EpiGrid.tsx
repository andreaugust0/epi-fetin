import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { EPI_CATALOG } from '@/constants/epiCatalog';
import { APP_MESSAGES } from '@/constants/messages';
import { useTerminalMetrics } from '@/hooks/useTerminalMetrics';
import { colors, radii, spacing } from '@/theme';

import type { EpiCatalogItem, EpiId } from '../types';

import { EpiGridItem } from './EpiGridItem';

export interface EpiGridProps {
  activeIds: readonly EpiId[];
  /** Quando falso, os equipamentos inativos são ocultados em vez de esmaecidos. */
  showInactive?: boolean;
}

/** Divide a lista em linhas fixas de N colunas. */
const toRows = (items: readonly EpiCatalogItem[], columns: number): EpiCatalogItem[][] => {
  const rows: EpiCatalogItem[][] = [];
  for (let index = 0; index < items.length; index += columns) {
    rows.push(items.slice(index, index + columns));
  }
  return rows;
};

/** Grade "N equipamentos exigidos" da tela inicial. */
export const EpiGrid = ({ activeIds, showInactive = true }: EpiGridProps) => {
  const metrics = useTerminalMetrics();

  const items = showInactive
    ? EPI_CATALOG
    : EPI_CATALOG.filter((item) => activeIds.includes(item.id));

  const activeCount = activeIds.length;
  const countLabel =
    activeCount === 1
      ? APP_MESSAGES.home.equipmentCountSuffixSingular
      : APP_MESSAGES.home.equipmentCountSuffix;

  const rows = toRows(items, metrics.epiColumns);

  return (
    <View style={styles.container}>
      <Text
        variant={metrics.sectionLabel}
        color={colors.primaryDark}
        align="center"
        style={styles.label}
      >
        {`${activeCount} ${countLabel}`}
      </Text>

      {/*
        Linhas explícitas em vez de `flexWrap` com largura percentual.
        A quebra automática dependia de o Yoga e o CSS resolverem a mesma
        coisa, e não resolviam: no Android as linhas colapsavam umas sobre as
        outras. Aqui cada linha é um contêiner horizontal próprio e cada
        célula divide a largura por `flex`, cujo eixo principal é o
        horizontal — previsível nas duas plataformas.
      */}
      {rows.map((row, rowIndex) => (
        <View
          key={row[0]?.id ?? `row-${rowIndex}`}
          style={[styles.row, rowIndex > 0 ? styles.rowSpacing : null]}
        >
          {row.map((item) => (
            <View key={item.id} style={styles.cell}>
              <EpiGridItem item={item} active={activeIds.includes(item.id)} />
            </View>
          ))}

          {/*
            Células vazias completam a última linha. Não representam
            equipamento nenhum: existem só para as colunas continuarem
            alinhadas quando a divisão não é exata.
          */}
          {Array.from({ length: metrics.epiColumns - row.length }, (_, index) => (
            <View key={`vazia-${index}`} style={styles.cell} />
          ))}
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  /**
   * Azul bem claro: marca a região como "os equipamentos exigidos" sem
   * competir com o botão de ação, que é o azul forte da tela.
   */
  container: {
    padding: spacing.lg,
    backgroundColor: colors.primarySoft,
    borderRadius: radii.xxl,
    borderWidth: 1,
    borderColor: colors.primaryOn,
  },
  label: {
    marginBottom: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  rowSpacing: {
    marginTop: spacing.lg,
  },
  cell: {
    flex: 1,
    paddingHorizontal: spacing.xs,
  },
});
