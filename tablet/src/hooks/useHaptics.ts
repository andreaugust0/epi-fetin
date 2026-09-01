import * as Haptics from 'expo-haptics';
import { useCallback } from 'react';
import { Platform } from 'react-native';

import type { DetectionStatus } from '@/features/epi-detection/types';

const FEEDBACK_BY_STATUS: Record<DetectionStatus, Haptics.NotificationFeedbackType> = {
  approved: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  rejected: Haptics.NotificationFeedbackType.Error,
};

/** Retorno tátil discreto. Web não possui a API e é ignorado silenciosamente. */
export const useHaptics = () => {
  const isSupported = Platform.OS === 'ios' || Platform.OS === 'android';

  const impact = useCallback(() => {
    if (!isSupported) {
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [isSupported]);

  const notifyResult = useCallback(
    (status: DetectionStatus) => {
      if (!isSupported) {
        return;
      }
      void Haptics.notificationAsync(FEEDBACK_BY_STATUS[status]);
    },
    [isSupported],
  );

  return { impact, notifyResult };
};
