import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { colors, typography, type TypographyToken } from '@/theme';

export interface TextProps extends RNTextProps {
  variant?: TypographyToken;
  color?: string;
  align?: 'left' | 'center' | 'right';
}

/** Texto padronizado do app: sempre passa pelos tokens de tipografia. */
export const Text = ({
  variant = 'body',
  color = colors.slate[900],
  align,
  style,
  ...rest
}: TextProps) => (
  <RNText
    style={[typography[variant], { color }, align ? { textAlign: align } : null, style]}
    {...rest}
  />
);
