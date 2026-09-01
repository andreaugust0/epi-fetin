import type { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

export type MaterialCommunityIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** Identificadores dos sete equipamentos previstos no protótipo original. */
export const EPI_IDS = [
  'capacete',
  'colete',
  'oculos',
  'botas',
  'auricular',
  'mascara',
  'luvas',
] as const;

export type EpiId = (typeof EPI_IDS)[number];

export interface EpiCatalogItem {
  id: EpiId;
  label: string;
  /** Texto curto de apoio, ex.: "Proteção da cabeça". */
  description: string;
  icon: MaterialCommunityIconName;
  /**
   * Confiança média histórica do modelo para este equipamento (0 a 1).
   * Usada apenas pelo serviço mock para gerar resultados plausíveis.
   */
  baselineConfidence: number;
}

export const isEpiId = (value: string): value is EpiId =>
  (EPI_IDS as readonly string[]).includes(value);
