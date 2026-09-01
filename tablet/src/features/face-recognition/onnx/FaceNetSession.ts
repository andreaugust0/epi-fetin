import { Asset } from 'expo-asset';
import { Platform } from 'react-native';

import { FACENET_INPUT_DIMS } from './facenetProbeCore';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const FACENET_MODEL_MODULE = require('../../../../assets/models/facenet_vggface2.onnx');

interface OrtTensor {
  data: Float32Array;
  dims: readonly number[];
}

interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
  release(): Promise<void>;
}

export class FaceNetSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaceNetSessionError';
  }
}

/**
 * Sessão do FaceNet mantida viva enquanto a tela de diagnóstico existir.
 *
 * Carregar o modelo custa entre 0,7 e 0,9 s no tablet, contra 368 ms de
 * inferência — recriar a sessão a cada foto dobraria o tempo de cada
 * tentativa sem motivo. Uma instância carrega uma vez e serve todas as
 * capturas até a tela ser fechada.
 */
export class FaceNetSession {
  private session: OrtSession | null = null;
  private TensorCtor: (new (type: string, data: Float32Array, dims: number[]) => unknown) | null =
    null;

  /** Milissegundos gastos carregando o modelo, medidos uma única vez. */
  loadMs: number | null = null;

  get ready(): boolean {
    return this.session !== null;
  }

  get inputName(): string | null {
    return this.session?.inputNames[0] ?? null;
  }

  get outputName(): string | null {
    return this.session?.outputNames[0] ?? null;
  }

  async load(): Promise<void> {
    if (this.session) {
      return;
    }
    if (Platform.OS === 'web') {
      throw new FaceNetSessionError('O ONNX Runtime nativo não existe na Web.');
    }

    const { InferenceSession, Tensor } = await import('onnxruntime-react-native');
    this.TensorCtor = Tensor as unknown as typeof this.TensorCtor;

    const asset = Asset.fromModule(FACENET_MODEL_MODULE);
    await asset.downloadAsync();
    const uri = asset.localUri ?? asset.uri;
    if (!uri) {
      throw new FaceNetSessionError('O modelo foi resolvido sem URI utilizável.');
    }

    const iniciou = Date.now();
    this.session = (await InferenceSession.create(uri)) as unknown as OrtSession;
    this.loadMs = Date.now() - iniciou;
  }

  /**
   * Executa uma inferência e devolve o embedding cru.
   *
   * A saída **não** é normalizada aqui: o grafo termina em `ReduceL2` + `Div`,
   * então já sai com norma 1. Normalizar de novo mascararia um defeito no
   * modelo em vez de revelá-lo.
   */
  async embed(tensorData: Float32Array): Promise<{ embedding: Float32Array; inferenceMs: number }> {
    const session = this.session;
    const Tensor = this.TensorCtor;
    if (!session || !Tensor) {
      throw new FaceNetSessionError('A sessão do FaceNet não foi carregada.');
    }

    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    if (!inputName || !outputName) {
      throw new FaceNetSessionError('O modelo não declarou nomes de entrada e saída.');
    }

    const input = new Tensor('float32', tensorData, [...FACENET_INPUT_DIMS]);

    const iniciou = Date.now();
    const outputs = await session.run({ [inputName]: input });
    const inferenceMs = Date.now() - iniciou;

    const output = outputs[outputName];
    if (!output) {
      throw new FaceNetSessionError('A execução não devolveu tensor de saída.');
    }

    return { embedding: output.data, inferenceMs };
  }

  async release(): Promise<void> {
    const session = this.session;
    this.session = null;
    this.TensorCtor = null;
    // A sessão segura o modelo inteiro em memória; soltar evita acumular
    // quase 100 MB ao navegar entre telas.
    await session?.release().catch(() => undefined);
  }
}
