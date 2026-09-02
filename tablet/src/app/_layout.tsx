import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { resolveEpiVerificationService } from '@/features/epi-detection/services/epiVerificationServiceFactory';
import { VerificationSessionProvider } from '@/features/verification-session/hooks/VerificationSessionContext';
import { colors } from '@/theme';

export default function RootLayout() {
  // Escolhe, uma vez na subida, entre verificar no servidor ou no mock.
  // A leitura é assíncrona (AsyncStorage e SecureStore), então não dá para
  // decidir na própria fábrica sem tornar `getEpiVerificationService`
  // assíncrona e mexer em todas as telas.
  //
  // Enquanto isto não resolve, a fábrica devolve o mock. Na prática a
  // resolução termina muito antes de alguém encostar o rosto na câmera; se
  // um dia isso deixar de ser verdade, a tela de verificação é que precisa
  // esperar, não este efeito.
  useEffect(() => {
    void resolveEpiVerificationService();
  }, []);

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
