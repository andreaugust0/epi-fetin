import { APP_MESSAGES } from '@/constants/messages';
import { describeError, normalizeError } from '@/services/errors';

import { StateView, type StateViewProps } from './StateView';

export interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  retryLabel?: string;
  compact?: boolean;
}

/** Traduz um erro em um estado visual coerente com o código do `AppError`. */
export const ErrorState = ({
  error,
  onRetry,
  retryLabel = APP_MESSAGES.states.retryButton,
  compact = false,
}: ErrorStateProps) => {
  const { title, description } = describeError(error);
  const { code } = normalizeError(error);
  const isConnectivity = code === 'network' || code === 'timeout';

  const props: StateViewProps = {
    icon: isConnectivity ? 'wifi-off' : 'alert-circle-outline',
    title,
    description,
    tone: isConnectivity ? 'warning' : 'danger',
    compact,
    ...(onRetry ? { actions: [{ label: retryLabel, onPress: onRetry, icon: 'refresh' }] } : {}),
  };

  return <StateView {...props} />;
};
