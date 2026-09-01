/**
 * Paleta extraída do protótipo original (tape-crab-67490107.figma.site).
 * Os tons `scanner` reproduzem o terminal escuro da tela de verificação e os
 * tons `status` cobrem os três resultados possíveis da análise.
 */
export const colors = {
  primary: '#2563EB',
  primaryDark: '#1D4ED8',
  primaryDeep: '#1E3A8A',
  primarySoft: '#EFF6FF',
  primaryOn: '#BFDBFE',
  accent: '#00D4FF',

  scanner: {
    background: '#060C14',
    viewport: '#0A1520',
    panel: '#0D1117',
    surface: '#131B24',
    gradientTop: '#0D2035',
    gradientMiddle: '#071624',
    gradientBottom: '#0A1520',
  },

  status: {
    approved: '#22C55E',
    approvedDark: '#16A34A',
    approvedDeep: '#14532D',
    approvedSoft: '#DCFCE7',
    approvedText: '#15803D',

    warning: '#F59E0B',
    warningDark: '#B45309',
    warningDeep: '#78350F',
    warningSoft: '#FEF3C7',
    warningText: '#B45309',

    rejected: '#EF4444',
    rejectedDark: '#DC2626',
    rejectedDeep: '#7F1D1D',
    rejectedSoft: '#FEE2E2',
    rejectedText: '#B91C1C',
  },

  slate: {
    900: '#0F172A',
    800: '#1E293B',
    700: '#334155',
    600: '#475569',
    500: '#64748B',
    400: '#94A3B8',
    300: '#CBD5E1',
    200: '#E2E8F0',
    100: '#F1F5F9',
    50: '#F8FAFC',
  },

  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',

  overlay: 'rgba(0, 0, 0, 0.6)',
  overlayLight: 'rgba(255, 255, 255, 0.08)',
  overlayBorder: 'rgba(255, 255, 255, 0.1)',
} as const;

export type AppColors = typeof colors;
