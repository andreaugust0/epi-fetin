/**
 * Sem isso o React alerta que o ambiente não suporta `act(...)` sempre que uma
 * atualização assíncrona chega. Reaplicado a cada teste porque o ambiente é
 * restaurado entre eles.
 */
const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('expo-crypto', () => ({
  randomUUID: () => `test-uuid-${Math.random().toString(36).slice(2, 10)}`,
}));

/**
 * As animações do visor dependem de worklets nativos, indisponíveis no Jest.
 * O mock oficial da biblioteca importa o módulo real e falha do mesmo jeito,
 * então declaramos aqui apenas a superfície que o `ScanFrame` consome.
 */
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  const identity = (value: unknown) => value;

  return {
    __esModule: true,
    default: { View },
    Easing: { inOut: identity, ease: identity },
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useAnimatedStyle: (factory: () => unknown) => factory(),
    withRepeat: identity,
    withTiming: identity,
  };
});

// A câmera real não existe no ambiente de teste; o visor vira um placeholder.
jest.mock('expo-camera', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');

  const CameraView = (props: Record<string, unknown>) => React.createElement(View, props);
  CameraView.isAvailableAsync = jest.fn(async () => false);

  return {
    CameraView,
    useCameraPermissions: () => [{ granted: false, canAskAgain: false }, jest.fn()],
  };
});
