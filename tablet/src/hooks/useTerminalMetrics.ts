import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import { TERMINAL_TOUCH_TARGET, type TypographyToken } from '@/theme';

/**
 * Medidas mínimas para a tela ser considerada um terminal de verdade.
 * Um tablet em pé de 800x1280 passa com folga; 600x960 também. Janelas de
 * navegador estreitas e telefones caem no formato compacto.
 */
const ROOMY_MIN_HEIGHT = 880;
const ROOMY_MIN_WIDTH = 560;

export interface TerminalMetrics {
  /** Verdadeiro no tablet em pé — o formato para o qual o app foi desenhado. */
  isRoomy: boolean;

  // Tipografia
  screenTitle: TypographyToken;
  screenSubtitle: TypographyToken;
  sectionLabel: TypographyToken;
  employeeName: TypographyToken;
  employeeMeta: TypographyToken;
  instruction: TypographyToken;
  instructionDetail: TypographyToken;
  epiLabel: TypographyToken;
  epiDescription: TypographyToken;
  buttonLabel: TypographyToken;
  stepLabel: TypographyToken;

  // Dimensões
  emblemSize: number;
  emblemIconSize: number;
  epiIconSize: number;
  epiIconBoxSize: number;
  /** Duas colunas dão ícones grandes; três só quando falta largura. */
  epiColumns: 2 | 3;
  confirmationIconSize: number;
  figureIconSize: number;
  buttonHeight: number;
  buttonIconSize: number;
  stepCircleSize: number;
}

const ROOMY: Omit<TerminalMetrics, 'isRoomy'> = {
  screenTitle: 'displayLarge',
  screenSubtitle: 'bodyLarge',
  sectionLabel: 'overlineLarge',
  employeeName: 'hero',
  employeeMeta: 'subheadingLarge',
  instruction: 'headingLarge',
  instructionDetail: 'bodyLarge',
  epiLabel: 'subheadingLarge',
  epiDescription: 'captionLarge',
  buttonLabel: 'headingLarge',
  stepLabel: 'caption',

  emblemSize: 132,
  emblemIconSize: 72,
  epiIconSize: 40,
  epiIconBoxSize: 72,
  epiColumns: 2,
  confirmationIconSize: 76,
  figureIconSize: 136,
  buttonHeight: 96,
  buttonIconSize: 34,
  stepCircleSize: 26,
};

const COMPACT: Omit<TerminalMetrics, 'isRoomy'> = {
  screenTitle: 'display',
  screenSubtitle: 'body',
  sectionLabel: 'overline',
  employeeName: 'display',
  employeeMeta: 'bodyStrong',
  instruction: 'heading',
  instructionDetail: 'body',
  epiLabel: 'captionStrong',
  epiDescription: 'micro',
  buttonLabel: 'title',
  stepLabel: 'micro',

  emblemSize: 96,
  emblemIconSize: 52,
  epiIconSize: 24,
  epiIconBoxSize: 44,
  epiColumns: 3,
  confirmationIconSize: 44,
  figureIconSize: 92,
  buttonHeight: TERMINAL_TOUCH_TARGET,
  buttonIconSize: 26,
  stepCircleSize: 20,
};

/**
 * Escalas da interface conforme o espaço disponível.
 *
 * Existe para que nenhuma tela precise consultar largura ou altura por conta
 * própria: os dois formatos ficam declarados aqui, e os componentes apenas
 * leem os valores. Não é um `scale` global — cada medida foi escolhida para o
 * seu papel, e a grade de EPIs chega a mudar de número de colunas.
 */
export const useTerminalMetrics = (): TerminalMetrics => {
  const { width, height } = useWindowDimensions();

  return useMemo(() => {
    const isRoomy = height >= ROOMY_MIN_HEIGHT && width >= ROOMY_MIN_WIDTH;
    return { isRoomy, ...(isRoomy ? ROOMY : COMPACT) };
  }, [height, width]);
};
