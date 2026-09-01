import { Platform, type TextStyle } from 'react-native';

/**
 * O protótipo usa Inter. Para manter o app leve e evitar carregamento de fontes
 * remotas, usamos a fonte de sistema — que é geometricamente próxima em ambas
 * as plataformas — e preservamos os pesos e tamanhos originais.
 */
const fontFamily = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
});

const fontFamilyMedium = Platform.select({
  ios: 'System',
  android: 'sans-serif-medium',
  default: 'System',
});

export const typography = {
  /**
   * Os tokens `*Large` e `hero` existem para o tablet operado em pé, onde a
   * pessoa lê a tela a um ou dois metros de distância. Não substituem os
   * tamanhos originais: as duas escalas convivem, escolhidas por
   * `useTerminalMetrics`.
   */
  hero: {
    fontFamily,
    fontSize: 46,
    lineHeight: 54,
    fontWeight: '700',
  },
  displayLarge: {
    fontFamily,
    fontSize: 38,
    lineHeight: 46,
    fontWeight: '700',
  },
  headingLarge: {
    fontFamily,
    fontSize: 26,
    lineHeight: 34,
    fontWeight: '700',
  },
  subheadingLarge: {
    fontFamily: fontFamilyMedium,
    fontSize: 21,
    lineHeight: 28,
    fontWeight: '600',
  },
  bodyLarge: {
    fontFamily,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '400',
  },
  captionLarge: {
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '400',
  },
  overlineLarge: {
    fontFamily: fontFamilyMedium,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  display: {
    fontFamily,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
  },
  title: {
    fontFamily,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
  },
  heading: {
    fontFamily,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
  },
  subheading: {
    fontFamily: fontFamilyMedium,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '600',
  },
  body: {
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
  },
  bodyStrong: {
    fontFamily: fontFamilyMedium,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  caption: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
  },
  captionStrong: {
    fontFamily: fontFamilyMedium,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  overline: {
    fontFamily: fontFamilyMedium,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  micro: {
    fontFamily,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '400',
  },
} satisfies Record<string, TextStyle>;

export type TypographyToken = keyof typeof typography;
