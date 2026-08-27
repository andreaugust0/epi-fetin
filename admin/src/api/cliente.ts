/**
 * Cliente HTTP do painel.
 *
 * Os tipos vêm de `servidor.d.ts`, que é GERADO a partir do OpenAPI do
 * FastAPI (`npm run tipos`). Nada aqui é escrito à mão duas vezes: se um
 * campo mudar no servidor, o `tsc` acusa aqui — em vez de o painel exibir
 * `undefined` em silêncio.
 */
import type { components } from './servidor';

type S = components['schemas'];

export type Pessoa = S['PessoaOut'];
export type PessoaDetalhe = S['PessoaDetalhe'];
export type PaginaPessoas = S['PaginaPessoas'];
export type Verificacao = S['VerificacaoOut'];
export type PaginaVerificacoes = S['PaginaVerificacoes'];
export type Ponto = S['PontoOut'];
export type TipoEpi = S['TipoEpiOut'];
export type Dispositivo = S['DispositivoOut'];
export type Token = S['TokenOut'];

export interface Conformidade {
  periodo_dias: number;
  pontos: {
    ponto_id: number;
    nome: string;
    total: number;
    aprovadas: number;
    taxa_conformidade: number | null;
  }[];
}

export interface EpisFaltantes {
  periodo_dias: number;
  itens: {
    ponto: string;
    epi: string;
    total: number;
    faltas: number;
    pct_falta: number | null;
  }[];
}

const CHAVE_TOKEN = 'epi-admin:token';

export const guardarToken = (t: string) => localStorage.setItem(CHAVE_TOKEN, t);
export const lerToken = () => localStorage.getItem(CHAVE_TOKEN);
export const limparToken = () => localStorage.removeItem(CHAVE_TOKEN);

export class ErroApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    readonly detalhe?: unknown,
  ) {
    super(mensagem);
    this.name = 'ErroApi';
  }
}

/** Disparado quando o token expira, para o app voltar ao login. */
export const SESSAO_EXPIRADA = 'epi-admin:sessao-expirada';

function mensagemDeErro(status: number, corpo: unknown): string {
  // O FastAPI devolve `detail` como string OU como lista de erros de
  // validação. Tratar os dois evita mostrar "[object Object]" ao operador.
  const detail = (corpo as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e) => {
        const campo = Array.isArray(e?.loc) ? e.loc.slice(1).join('.') : '';
        return campo ? `${campo}: ${e.msg}` : e.msg;
      })
      .join('; ');
  }
  if (status === 401) return 'Sessão expirada. Entre novamente.';
  if (status === 403) return 'Você não tem permissão para esta ação.';
  if (status >= 500) return 'O servidor falhou. Veja os logs da API.';
  return `Erro ${status}`;
}

interface Opcoes {
  metodo?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  corpo?: unknown;
  params?: Record<string, string | number | boolean | undefined | null>;
  semAuth?: boolean;
}

export async function chamar<T>(rota: string, opcoes: Opcoes = {}): Promise<T> {
  const { metodo = 'GET', corpo, params, semAuth } = opcoes;

  const url = new URL(`/api/v1${rota}`, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';
  if (!semAuth) {
    const token = lerToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    // Falha de rede é diferente de erro do servidor, e a mensagem precisa
    // dizer isso: quase sempre é a API que não subiu.
    throw new ErroApi(0, 'Não foi possível falar com o servidor. Ele está no ar?');
  }

  if (resposta.status === 204) return undefined as T;

  const texto = await resposta.text();
  const dados = texto ? JSON.parse(texto) : null;

  if (!resposta.ok) {
    if (resposta.status === 401) {
      limparToken();
      window.dispatchEvent(new Event(SESSAO_EXPIRADA));
    }
    throw new ErroApi(resposta.status, mensagemDeErro(resposta.status, dados), dados);
  }
  return dados as T;
}

// ------------------------------------------------------------------ rotas
export const api = {
  login: (email: string, senha: string) =>
    chamar<Token>('/auth/login', {
      metodo: 'POST',
      corpo: { email, senha },
      semAuth: true,
    }),

  pessoas: (params: Record<string, string | number | boolean | undefined>) =>
    chamar<PaginaPessoas>('/pessoas', { params }),
  pessoa: (id: number) => chamar<PessoaDetalhe>(`/pessoas/${id}`),
  criarPessoa: (corpo: { matricula: string; nome: string; funcao?: string }) =>
    chamar<Pessoa>('/pessoas', { metodo: 'POST', corpo }),
  editarPessoa: (id: number, corpo: Record<string, unknown>) =>
    chamar<Pessoa>(`/pessoas/${id}`, { metodo: 'PATCH', corpo }),
  consentir: (id: number, versao_termo: string) =>
    chamar<{ ok: boolean }>(`/pessoas/${id}/consentimento`, {
      metodo: 'POST',
      corpo: { versao_termo },
    }),
  revogar: (id: number) =>
    chamar<{ ok: boolean; biometrias_eliminadas: number }>(
      `/pessoas/${id}/consentimento`,
      { metodo: 'DELETE' },
    ),

  verificacoes: (params: Record<string, string | number | undefined>) =>
    chamar<PaginaVerificacoes>('/verificacoes', { params }),

  pontos: () => chamar<Ponto[]>('/pontos'),
  tiposEpi: () => chamar<TipoEpi[]>('/tipos-epi'),
  definirEpis: (pontoId: number, codigos: string[]) =>
    chamar<Ponto>(`/pontos/${pontoId}/epis`, { metodo: 'PUT', corpo: { codigos } }),

  dispositivos: () => chamar<Dispositivo[]>('/dispositivos'),

  conformidade: (dias: number) =>
    chamar<Conformidade>('/relatorios/conformidade', { params: { dias } }),
  episFaltantes: (dias: number) =>
    chamar<EpisFaltantes>('/relatorios/epis-faltantes', { params: { dias } }),
};
