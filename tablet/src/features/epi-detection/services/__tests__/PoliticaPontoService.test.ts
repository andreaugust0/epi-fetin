import { resolveFaceApiConfig } from '@/features/face-recognition/services/faceApiConfig';

import { buscarEpisExigidos } from '../PoliticaPontoService';

jest.mock('@/features/face-recognition/services/faceApiConfig', () => ({
  resolveFaceApiConfig: jest.fn(),
}));

const config = resolveFaceApiConfig as jest.MockedFunction<typeof resolveFaceApiConfig>;

const provisionado = (baseUrl = 'http://192.168.0.10:8000', pointId = 1) =>
  config.mockResolvedValue({
    baseUrl,
    baseUrlSource: 'override',
    pointId,
    pointIdSource: 'override',
  });

const responder = (corpo: unknown, status = 200) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  }) as unknown as typeof fetch;
};

const ponto = (id: number, epis: string[]) => ({
  id,
  codigo: `p${id}`,
  nome: `Ponto ${id}`,
  ativo: true,
  epis_exigidos: epis,
});

afterEach(() => {
  jest.restoreAllMocks();
  config.mockReset();
});

/**
 * A exigência de EPI é política do ponto de acesso, e mora no servidor.
 *
 * A tela inicial do tablet lia a lista do armazenamento local, resquício de
 * quando a configuração morava no aparelho — então trocar os EPIs no painel
 * não mudava nada no terminal, e a tela anunciava uma exigência diferente da
 * que a catraca cobrava.
 */
describe('exigência de EPI vinda do servidor', () => {
  it('devolve os EPIs do ponto deste tablet', async () => {
    provisionado('http://192.168.0.10:8000', 2);
    responder([ponto(1, ['botas']), ponto(2, ['capacete', 'colete'])]);

    await expect(buscarEpisExigidos()).resolves.toEqual(['capacete', 'colete']);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://192.168.0.10:8000/api/v1/pontos',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it('devolve lista vazia quando o ponto não exige nada', async () => {
    // Vazio é uma resposta, não ausência de resposta: quem transforma isso em
    // recusa é o servidor, na hora de abrir a verificação.
    provisionado('http://192.168.0.10:8000', 1);
    responder([ponto(1, [])]);

    await expect(buscarEpisExigidos()).resolves.toEqual([]);
  });

  it('devolve null sem provisionamento, para o local assumir', async () => {
    config.mockResolvedValue({
      baseUrl: null,
      baseUrlSource: null,
      pointId: null,
      pointIdSource: null,
    });

    // Instalado só para provar que NÃO é chamado: sem provisionamento não há
    // servidor a quem perguntar, e sair para a rede seria trabalho perdido.
    responder([]);

    await expect(buscarEpisExigidos()).resolves.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('descarta código que este aplicativo não conhece', async () => {
    // As duas pontas evoluem em ritmos diferentes. Um item sem ícone nem
    // rótulo na tela seria pior que omiti-lo — e quem decide aprovar é o
    // servidor, que conhece a lista inteira.
    provisionado('http://192.168.0.10:8000', 1);
    responder([ponto(1, ['capacete', 'exoesqueleto', 'colete'])]);

    await expect(buscarEpisExigidos()).resolves.toEqual(['capacete', 'colete']);
  });

  it('falha quando o servidor não conhece o ponto provisionado', async () => {
    provisionado('http://192.168.0.10:8000', 99);
    responder([ponto(1, ['capacete'])]);

    await expect(buscarEpisExigidos()).rejects.toThrow(/ponto de acesso 99/i);
  });

  it('falha quando o servidor responde com erro', async () => {
    provisionado();
    responder({}, 500);

    await expect(buscarEpisExigidos()).rejects.toThrow(/HTTP 500/);
  });
});
