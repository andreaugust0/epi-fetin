import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { VerificationSessionProvider } from '@/features/verification-session/hooks/VerificationSessionContext';
import { colors } from '@/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <VerificationSessionProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.slate[50] },
            animation: 'fade',
            gestureEnabled: false,
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="identificacao" />
          <Stack.Screen name="preparacao" />
          <Stack.Screen name="verificacao" />
          <Stack.Screen name="resultado" />
          {/* Ferramenta de desenvolvimento, fora do fluxo do terminal. */}
          <Stack.Screen name="diagnostico-onnx" />
          <Stack.Screen name="diagnostico-face" />
          <Stack.Screen name="+not-found" />
        </Stack>
      </VerificationSessionProvider>
    </SafeAreaProvider>
  );
}
