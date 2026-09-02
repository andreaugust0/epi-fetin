import { ServidorEpiVerificationService } from '../ServidorEpiVerificationService';

jest.mock('@/features/face-recognition/services/faceApiConfig', () => ({
  getFaceApiConfig: jest.fn(async () => ({
    baseUrl: 'http://192.168.0.103:8000',
    pointId: 1,
  })),
}));

jest.mock('@/features/face-recognition/services/deviceTokenStore', () => ({
  deviceTokenStore: { get: jest.fn(async () => 'token-de-teste') },
}));

const { deviceTokenStore } = jest.requireMock(
  '@/features/face-recognition/services/deviceTokenStore',
) as { deviceTokenStore: { get: jest.Mock } };

/** WebSocket falso: guarda a última instância para o teste empurrar mensagens. */
class WebSocketFalso {
  static ultima: WebSocketFalso | null = null;
  /** Registra a ordem dos eventos, para provar quem acontece antes. */
  static ordem: string[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  fechado = false;

  constructor(public url: string) {
    WebSocketFalso.ultima = this;
    WebSocketFalso.ordem.push('ws');
  }
  close() {
    this.fechado = true;
  }
  emitir(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

const verificacao = (status: string, deteccoes: unknown[]) => ({
  id: 'v-1',
  status,
  pessoa_nome: 'Caio',
  latencia_ms: 64,
  versao_modelo: 'epi-hailo-int8-v1',
  motivo_falha: status === 'REPROVADA' ? 'EPI ausente: Capacete' : null,
  deteccoes,
});

const det = (epi: string, presente: boolean, confianca: number) => ({
  epi,
  rotulo: epi,
  presente,
  confianca,
  frames_confirmados: presente ? 5 : 0,
});

/** Responde ao POST com 202 e ao GET com a verificação dada. */
const mockarFetch = (resultado: ReturnType<typeof verificacao>, statusPost = 202) => {
  const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return {
        status: statusPost,
        ok: statusPost < 400,
        json: async () => ({ id: 'v-1' }),
      } as Response;
    }
    return { status: 200, ok: true, json: async () => resultado } as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

beforeEach(() => {
  WebSocketFalso.ultima = null;
  WebSocketFalso.ordem = [];
  (global as { WebSocket: unknown }).WebSocket = WebSocketFalso;
  deviceTokenStore.get.mockResolvedValue('token-de-teste');
});

/** Dispara o desfecho no canal assim que ele existir. */
const responderPeloCanal = (status: string) => {
  const timer = setInterval(() => {
    if (WebSocketFalso.ultima) {
      clearInterval(timer);
      WebSocketFalso.ultima.emitir({
        tipo: 'resultado',
        verificacao_id: 'v-1',
        status,
        pessoa: 'Caio',
        faltantes: status === 'REPROVADA' ? ['Capacete'] : [],
        motivo: null,
      });
    }
  }, 5);
  return () => clearInterval(timer);
};

describe('ServidorEpiVerificationService', () => {
  it('aprova quando o servidor aprova', async () => {
    mockarFetch(
      verificacao('APROVADA', [
        det('capacete', true, 0.9),
        det('colete', true, 0.88),
        det('oculos', true, 0.85),
      ]),
    );
    const parar = responderPeloCanal('APROVADA');

    const r = await new ServidorEpiVerificationService().run(
      { requiredItems: ['capacete', 'colete', 'oculos'], identificacaoId: 'i-1' },
      () => {},
    );
    parar();

    expect(r.status).toBe('approved');
    expect(r.detectedItems).toHaveLength(3);
    expect(r.missingItems).toHaveLength(0);
    expect(r.engine).toBe('api');
    expect(r.processingTimeMs).toBe(64);
  });

  /**
   * A checagem mais importante do arquivo.
   *
   * A regra local `resolveDetectionStatus` devolveria `warning` para um
   * ausente entre quatro exigidos. Aqui tem que sair `rejected`: a catraca
   * NÃO abriu, e um amarelo na tela faria o operador achar que é só seguir.
   */
  it('reprova, sem virar aviso, quando falta um EPI entre quatro', async () => {
    mockarFetch(
      verificacao('REPROVADA', [
        det('capacete', false, 0),
        det('colete', true, 0.9),
        det('oculos', true, 0.9),
        det('luvas', true, 0.9),
      ]),
    );
    const parar = responderPeloCanal('REPROVADA');

    const r = await new ServidorEpiVerificationService().run(
      {
        requiredItems: ['capacete', 'colete', 'oculos', 'luvas'],
        identificacaoId: 'i-1',
      },
      () => {},
    );
    parar();

    expect(r.status).toBe('rejected');
    expect(r.status).not.toBe('warning');
    expect(r.missingItems.map((i) => i.id)).toEqual(['capacete']);
  });

  /** Confiança baixa não pode rebaixar uma aprovação do servidor. */
  it('mantem aprovado mesmo com confianca abaixo do limiar local', async () => {
    mockarFetch(
      verificacao('APROVADA', [
        det('capacete', true, 0.42),
        det('colete', true, 0.4),
      ]),
    );
    const parar = responderPeloCanal('APROVADA');

    const r = await new ServidorEpiVerificationService().run(
      { requiredItems: ['capacete', 'colete'], identificacaoId: 'i-1' },
      () => {},
    );
    parar();

    expect(r.status).toBe('approved');
    expect(r.detectedItems).toHaveLength(2);
  });

  it('usa a lista de EPIs que o SERVIDOR avaliou, nao a configuracao local', async () => {
    mockarFetch(
      verificacao('APROVADA', [
        det('capacete', true, 0.9),
        det('luvas', true, 0.9),
      ]),
    );
    const parar = responderPeloCanal('APROVADA');

    const r = await new ServidorEpiVerificationService().run(
      { requiredItems: ['capacete'], identificacaoId: 'i-1' },
      () => {},
    );
    parar();

    expect(r.requiredItems).toEqual(['capacete', 'luvas']);
  });

  it('avisa que a camera esta fora do ar quando o servidor devolve 503', async () => {
    mockarFetch(verificacao('ERRO', []), 503);

    await expect(
      new ServidorEpiVerificationService().run(
        { requiredItems: ['capacete'], identificacaoId: 'i-1' },
        () => {},
      ),
    ).rejects.toThrow(/câmera deste ponto está fora do ar/i);
  });

  it('pede o rosto de novo quando a identificacao expirou (409)', async () => {
    mockarFetch(verificacao('ERRO', []), 409);

    await expect(
      new ServidorEpiVerificationService().run(
        { requiredItems: ['capacete'], identificacaoId: 'i-velho' },
        () => {},
      ),
    ).rejects.toThrow(/identificação expirou/i);
  });

  it('trata EXPIRADA como falha de execucao, nao como reprovacao', async () => {
    mockarFetch(verificacao('EXPIRADA', []));
    const parar = responderPeloCanal('EXPIRADA');

    await expect(
      new ServidorEpiVerificationService().run(
        { requiredItems: ['capacete'], identificacaoId: 'i-1' },
        () => {},
      ),
    ).rejects.toThrow(/câmera não respondeu a tempo/i);
    parar();
  });

  it('recusa verificar sem token de dispositivo', async () => {
    deviceTokenStore.get.mockResolvedValue(null);
    mockarFetch(verificacao('APROVADA', []));

    await expect(
      new ServidorEpiVerificationService().run(
        { requiredItems: ['capacete'] },
        () => {},
      ),
    ).rejects.toThrow(/não está provisionado/i);
  });

  /**
   * Ordem, não estilo. A inferência na Raspberry leva centenas de
   * milissegundos: quem conecta depois do POST arrisca perder um desfecho
   * já publicado, porque o canal não guarda histórico.
   */
  it('abre o canal ANTES de postar a verificacao', async () => {
    const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        WebSocketFalso.ordem.push('post');
        WebSocketFalso.ultima?.emitir({
          tipo: 'resultado', verificacao_id: 'v-1', status: 'APROVADA',
          pessoa: null, faltantes: [], motivo: null,
        });
        return { status: 202, ok: true, json: async () => ({ id: 'v-1' }) } as Response;
      }
      return {
        status: 200,
        ok: true,
        json: async () => verificacao('APROVADA', [det('capacete', true, 0.9)]),
      } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await new ServidorEpiVerificationService().run(
      { requiredItems: ['capacete'], identificacaoId: 'i-1' },
      () => {},
    );

    expect(WebSocketFalso.ordem).toEqual(['ws', 'post']);
  });

  /**
   * O desfecho pode chegar ANTES de o POST devolver o id. A fila interna
   * cobre essa corrida — sem ela, a mensagem passaria e o tablet esperaria
   * o timeout inteiro por algo que já aconteceu.
   */
  it('aproveita o desfecho que chegou antes do id ser conhecido', async () => {
    const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        WebSocketFalso.ultima?.emitir({
          tipo: 'resultado', verificacao_id: 'v-1', status: 'APROVADA',
          pessoa: null, faltantes: [], motivo: null,
        });
        return { status: 202, ok: true, json: async () => ({ id: 'v-1' }) } as Response;
      }
      return {
        status: 200,
        ok: true,
        json: async () => verificacao('APROVADA', [det('capacete', true, 0.9)]),
      } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await new ServidorEpiVerificationService().run(
      { requiredItems: ['capacete'], identificacaoId: 'i-1' },
      () => {},
    );

    expect(r.status).toBe('approved');
  });

  it('envia identificacao_id e ponto_id no corpo', async () => {
    const fetchMock = mockarFetch(
      verificacao('APROVADA', [det('capacete', true, 0.9)]),
    );
    const parar = responderPeloCanal('APROVADA');

    await new ServidorEpiVerificationService().run(
      { requiredItems: ['capacete'], identificacaoId: 'i-42' },
      () => {},
    );
    parar();

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      ponto_id: 1,
      identificacao_id: 'i-42',
    });
    expect(String(post?.[0])).toContain('/api/v1/verificacoes');
  });

  it('emite progresso inicial com os EPIs exigidos em aberto', async () => {
    mockarFetch(verificacao('APROVADA', [det('capacete', true, 0.9)]));
    const parar = responderPeloCanal('APROVADA');
    const eventos: unknown[] = [];

    await new ServidorEpiVerificationService().run(
      { requiredItems: ['capacete', 'colete'], identificacaoId: 'i-1' },
      (e) => eventos.push(e),
    );
    parar();

    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      type: 'EPI_PROGRESS',
      progress: 0,
      currentItem: 'capacete',
    });
  });
});
