import { Platform } from 'react-native';

export interface MlkitProbeResult {
  /** O binding JS ↔ Expo Module ↔ Android existe. */
  moduleAvailable: boolean;
  /** Estado reportado pelo próprio detector após inicializar. */
  status: string | null;
  initMs: number | null;
  success: boolean;
  error: string | null;
}

/**
 * Prova mínima de que o ML Kit está disponível em tempo de execução.
 *
 * Não detecta rosto nenhum e não recebe imagem: apenas resolve o módulo
 * nativo e chama `initialize`, que é uma função legítima da API e existe
 * justamente para preparar o detector antes do primeiro uso.
 *
 * `requireNativeModule` lança quando o módulo não está registrado, então o
 * simples sucesso do import já prova metade do caminho; o `initialize`
 * prova a outra metade, que é a travessia até o Android.
 */
export const runMlkitProbe = async (): Promise<MlkitProbeResult> => {
  const result: MlkitProbeResult = {
    moduleAvailable: false,
    status: null,
    initMs: null,
    success: false,
    error: null,
  };

  if (Platform.OS === 'web') {
    result.error = 'O ML Kit não existe na Web. Execute no tablet Android.';
    return result;
  }

  try {
    // Importado sob demanda: o módulo lança ao ser resolvido se não estiver
    // registrado, e isso não pode derrubar a tela inteira.
    const { RNMLKitFaceDetector } = await import(
      '@infinitered/react-native-mlkit-face-detection'
    );
    result.moduleAvailable = true;

    // `true` adia a inicialização, para medi-la explicitamente aqui.
    const detector = new RNMLKitFaceDetector({ performanceMode: 'fast' }, true);

    const startedAt = Date.now();
    await detector.initialize({ performanceMode: 'fast' });
    result.initMs = Date.now() - startedAt;

    result.status = detector.status;
    // `initialize` engole exceções e sinaliza pelo status, então é ele que
    // decide o veredito — não a ausência de throw.
    result.success = detector.status === 'ready';

    if (!result.success) {
      result.error = detector.error ?? `Detector terminou em "${detector.status}".`;
    }
  } catch (caught) {
    result.error = caught instanceof Error ? caught.message : String(caught);
  }

  return result;
};
