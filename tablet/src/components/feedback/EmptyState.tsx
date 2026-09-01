import type { MaterialCommunityIconName } from '@/features/epi-detection/types';

import { StateView, type StateViewAction } from './StateView';

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: MaterialCommunityIconName;
  action?: StateViewAction;
  compact?: boolean;
}

export const EmptyState = ({
  title,
  description,
  icon = 'inbox-outline',
  action,
  compact = false,
}: EmptyStateProps) => (
  <StateView
    icon={icon}
    title={title}
    {...(description ? { description } : {})}
    tone="neutral"
    compact={compact}
    {...(action ? { actions: [action] } : {})}
  />
);
