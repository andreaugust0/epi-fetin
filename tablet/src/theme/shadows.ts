import { Platform, type ViewStyle } from 'react-native';

type ShadowInput = {
  color: string;
  opacity: number;
  radius: number;
  offsetY: number;
  elevation: number;
};

const createShadow = ({ color, opacity, radius, offsetY, elevation }: ShadowInput): ViewStyle =>
  Platform.select<ViewStyle>({
    android: { elevation },
    default: {
      shadowColor: color,
      shadowOpacity: opacity,
      shadowRadius: radius,
      shadowOffset: { width: 0, height: offsetY },
    },
  });

export const shadows = {
  none: {} as ViewStyle,
  sm: createShadow({ color: '#0F172A', opacity: 0.06, radius: 6, offsetY: 2, elevation: 2 }),
  md: createShadow({ color: '#0F172A', opacity: 0.1, radius: 14, offsetY: 6, elevation: 5 }),
  lg: createShadow({ color: '#0F172A', opacity: 0.14, radius: 22, offsetY: 10, elevation: 9 }),
  primary: createShadow({ color: '#2563EB', opacity: 0.32, radius: 16, offsetY: 8, elevation: 8 }),
  approved: createShadow({ color: '#16A34A', opacity: 0.32, radius: 16, offsetY: 8, elevation: 8 }),
} as const;

export type ShadowToken = keyof typeof shadows;
