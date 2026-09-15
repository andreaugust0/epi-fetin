import { useKeepAwake } from 'expo-keep-awake';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GuardaDeInatividade } from '@/components/layout';
import { resolveEpiVerificationService } from '@/features/epi-detection/services/epiVerificationServiceFactory';
import { VerificationSessionProvider } from '@/features/verification-session/hooks/VerificationSessionContext';
import { colors } from '@/theme';

export default function RootLayout() {
  /*
   * A tela não apaga enquanto o terminal estiver aberto.
   *
   * Um tablet de portaria com a tela apagada é indistinguível de um tablet
   * quebrado: a pessoa chega, encontra o preto, e ou vai embora ou fica
   * cutucando o aparelho até acertar o botão de ligar. Pior: o Android pede
   * desbloqueio ao acordar, e aí o terminal virou um cadeado.
   *
   * `expo-keep-awake` já vem dentro do pacote `expo` — não há dependência
   * nova nem plugin a declarar.
   */
  useKeepAwake();

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
        {/*
          Barra de status escondida. Nela moram o relógio, a bateria e a
          Wi-Fi — e também o caminho para as notificações e os ajustes
          rápidos do Android. Num terminal de portaria isso é superfície para
          sair do aplicativo, e nada ali é informação para quem vai passar
          pela catraca.

          A orientação já está travada em retrato no `app.json`, então o
          tablet no suporte não gira quando alguém encosta nele.
        */}
        <StatusBar style="dark" hidden />

        {/* Envolve o Stack inteiro para observar o toque em qualquer tela. */}
        <GuardaDeInatividade>
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
        </GuardaDeInatividade>
      </VerificationSessionProvider>
    </SafeAreaProvider>
  );
}
