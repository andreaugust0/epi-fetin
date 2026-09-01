import { Asset } from 'expo-asset';
import { Platform } from 'react-native';

import {
  FACENET_INPUT_DIMS,
  checkProbeOutput,
  createProbeInput,
  formatDims,
} from './facenetProbeCore';

/**
 * O modelo é um asset binário: `metro.config.js` registra `.onnx` em
 * `assetExts` para que este `require` devolva um identificador de asset em
 * vez de o empacotador tentar interpretá-lo como código.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const FACENET_MODEL_MODULE = require('../../../../assets/models/facenet_vggface2.onnx');

export interface FaceNetProbeResult {
  success: boolean;
  modelLoaded: boolean;
  /** Caminho de onde o runtime carregou o modelo, útil para diagnóstico. */
  modelUri: string | null;
  inputName: string | null;
  outputName: string | null;
  /** Dimensões declaradas pelo próprio modelo, lidas em tempo de execução. */
  inputDims: string;
  outputDims: string;
  outputLength: number | null;
  loadMs: number | null;
  inferenceMs: number | null;
  error: string | null;
}

const emptyResult = (): FaceNetProbeResult => ({
  success: false,
  modelLoaded: false,
  modelUri: null,
  inputName: null,
  outputName: null,
  inputDims: '—',
  outputDims: '—',
  outputLength: null,
  loadMs: null,
  inferenceMs: null,
  error: null,
});

/** Dimensões declaradas por um metadado, quando ele descreve um tensor. */
const metadataDims = (
  metadata: { isTensor: boolean; shape?: readonly (number | string)[] } | undefined,
): string => (metadata?.isTensor ? formatDims(metadata.shape) : '—');

/**
 * Materializa o modelo num arquivo de verdade e devolve seu caminho.
 *
 * Só o identificador do `require` não serve: no Android o asset fica dentro
 * do APK, e o ONNX Runtime abre o modelo com E/S de arquivo comum — ele
 * remove o esquema `file://` e entrega o caminho ao `Ort::Session`. É o
 * `downloadAsync` que copia o asset para o diretório de cache e produz esse
 * caminho utilizável.
 */
const resolveModelUri = async (): Promise<string> => {
  const asset = Asset.fromModule(FACENET_MODEL_MODULE);
  await asset.downloadAsync();

  const uri = asset.localUri ?? asset.uri;
  if (!uri) {
    throw new Error('O asset do modelo foi resolvido sem URI utilizável.');
  }

  return uri;
};

/**
 * Prova de conceito isolada: carrega o FaceNet ONNX, executa uma vez com um
 * tensor artificial e confere o formato da saída.
 *
 * Não faz reconhecimento facial nem toca no fluxo do aplicativo — serve
 * apenas para demonstrar que o runtime executa o grafo no dispositivo.
 */
export const runFaceNetOnnxProbe = async (): Promise<FaceNetProbeResult> => {
  const result = emptyResult();

  if (Platform.OS === 'web') {
    result.error = 'O ONNX Runtime nativo não existe na Web. Execute no tablet Android.';
    return result;
  }

  let session: { release: () => Promise<void> } | null = null;

  try {
    // Importado sob demanda: manter o módulo nativo fora do escopo do arquivo
    // evita quebrar o empacotamento Web e a suíte de testes.
    const { InferenceSession, Tensor } = await import('onnxruntime-react-native');

    result.modelUri = await resolveModelUri();

    const loadStartedAt = Date.now();
    const inferenceSession = await InferenceSession.create(result.modelUri);
    result.loadMs = Date.now() - loadStartedAt;
    result.modelLoaded = true;
    session = inferenceSession;

    // Os nomes vêm do modelo, não de uma suposição nossa.
    const inputName = inferenceSession.inputNames[0];
    const outputName = inferenceSession.outputNames[0];

    if (!inputName || !outputName) {
      throw new Error('O modelo não declarou nomes de entrada e saída.');
    }

    result.inputName = inputName;
    result.outputName = outputName;
    result.inputDims = metadataDims(inferenceSession.inputMetadata[0]);
    result.outputDims = metadataDims(inferenceSession.outputMetadata[0]);

    const input = new Tensor('float32', createProbeInput(), [...FACENET_INPUT_DIMS]);

    const inferenceStartedAt = Date.now();
    const outputs = await inferenceSession.run({ [inputName]: input });
    result.inferenceMs = Date.now() - inferenceStartedAt;

    const output = outputs[outputName];
    result.outputLength = output?.data.length ?? null;
    if (output) {
      result.outputDims = formatDims(output.dims);
    }

    const check = checkProbeOutput(output?.dims, result.outputLength ?? undefined);
    result.success = check.ok;
    result.error = check.reason;
  } catch (caught) {
    result.error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    // A sessão segura o modelo inteiro em memória; soltar evita acumular
    // quase 100 MB a cada execução da prova.
    await session?.release().catch(() => undefined);
  }

  return result;
};
