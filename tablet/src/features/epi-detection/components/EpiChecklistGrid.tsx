import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { spacing } from '@/theme';

import type { DetectedEpi } from '../types';

import { EpiChecklistItem } from './EpiChecklistItem';

export interface EpiChecklistGridProps {
  items: readonly DetectedEpi[];
  /** Colunas por linha. Duas cabem em retrato sem espremer o rótulo. */
  columns?: number;
  tone?: 'light' | 'dark';
  /** Ainda não avaliado — decidido por quem chama, que conhece o estado. */
  isPending?: (item: DetectedEpi) => boolean;
  /** Sendo avaliado neste instante. */
  isScanning?: (item: DetectedEpi) => boolean;
  style?: StyleProp<ViewStyle>;
}

/** Divide a lista em linhas fixas de N colunas. */
const toRows = <T,>(items: readonly T[], columns: number): T[][] => {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += columns) {
    rows.push(items.slice(index, index + columns));
  }
  return rows;
};

/**
 * Grade da lista de EPIs verificados, usada na tela de análise e na de
 * resultado.
 *
 * Duas decisões aqui existem por causa de defeitos concretos no Android, não
 * por gosto:
 *
 * 1. **Linhas explícitas em vez de `flexWrap` com largura percentual.** É a
 *    mesma correção que o `EpiGrid` já carrega: a quebra automática dependia
 *    de o Yoga e o CSS resolverem a mesma conta, e não resolviam — as linhas
 *    colapsavam umas sobre as outras. Cada linha aqui é um contêiner
 *    horizontal próprio e cada célula divide a largura por `flex`, cujo eixo
 *    principal é o horizontal.
 *
 * 2. **`collapsable={false}`.** O Android achata views que só têm estilo de
 *    layout: o contêiner desaparece da árvore nativa e os filhos sobem para o
 *    avô. Quando o conteúdo muda depressa — e com o servidor decidindo em
 *    dezenas de milissegundos ele muda —, o achatamento e o desachatamento se
 *    atravessam e o Fabric aborta com `addViewAt: failed to insert view […]
 *    The specified child already has a parent`. Marcar os contêineres como
 *    não-achatáveis custa três views por linha e tira a reorganização da
 *    árvore do caminho. O mock nunca provocou isso porque levava 550 ms por
 *    equipamento; o servidor entrega tudo de uma vez.
 */
export const EpiChecklistGrid = ({
  items,
  columns = 2,
  tone = 'light',
  isPending,
  isScanning,
  style,
}: EpiChecklistGridProps) => {
  const rows = toRows(items, columns);

  return (
    <View collapsable={false} style={style}>
      {rows.map((row, rowIndex) => (
        <View
          collapsable={false}
          key={row[0]?.id ?? `linha-${rowIndex}`}
          style={[styles.row, rowIndex > 0 ? styles.rowSpacing : null]}
        >
          {row.map((item, cellIndex) => (
            <View
              collapsable={false}
              key={item.id}
              style={[styles.cell, cellIndex > 0 ? styles.cellSpacing : null]}
            >
              <EpiChecklistItem
                item={item}
                tone={tone}
                pending={isPending?.(item) ?? false}
                scanning={isScanning?.(item) ?? false}
              />
            </View>
          ))}

          {/*
            Células vazias completam a última linha. Não representam
            equipamento nenhum: mantêm as colunas alinhadas quando a divisão
            não é exata.
          */}
          {Array.from({ length: columns - row.length }, (_, index) => (
            <View
              collapsable={false}
              key={`vazia-${index}`}
              style={[styles.cell, styles.cellSpacing]}
            />
          ))}
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  rowSpacing: {
    marginTop: spacing.sm,
  },
  cell: {
    flex: 1,
  },
  cellSpacing: {
    marginLeft: spacing.sm,
  },
});
