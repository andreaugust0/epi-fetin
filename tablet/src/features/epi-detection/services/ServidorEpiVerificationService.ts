import { getEpiById } from '@/constants/epiCatalog';
import { deviceTokenStore } from '@/features/face-recognition/services/deviceTokenStore';
import { getFaceApiConfig } from '@/features/face-recognition/services/faceApiConfig';
import { AppError } from '@/services/errors';
import { clampUnit } from '@/utils';

import type {
  DetectedEpi,
  DetectionStatus,
  EpiDetectionResult,
  EpiId,
} from '../types';
import { isEpiId } from '../types';

import type {
  EpiVerificationEventListener,
  EpiVerificationInput,
  EpiVerificationService,
} from './EpiVerificationService';

/**
 * Verificação de EPI conduzida pelo SERVIDOR.
 *
 * O tablet não analisa imagem nenhuma nesta etapa. Ele abre a verificação,
 * o servidor manda a Raspberry inferir, confronta o resultado com a política
 * do ponto de acesso e devolve o desfecho pelo WebSocket. Esta classe só
 * conduz a conversa e traduz a resposta para o formato das telas.
 *
 * Fluxo, na ordem exata (a ordem importa, veja `run`):
 *
 *   1. abre o WebSocket   /api/v1/ws/pontos/{ponto_id}?token=…
 *   2. POST               /api/v1/verificacoes  -> 202 + id
 *   3. espera o desfecho no canal
 *   4. GET                /api/v1/verificacoes/{id}  para o detalhe
 *
 * O que esta classe DELIBERADAMENTE não faz: decidir. Nem recalcular a
 * decisão. Veja `mapearStatus`.
 */

const TIMEOUT_PADRAO_MS = 25_000;

interface DeteccaoServidor {
  epi: string;
  rotulo: string;
  presente: boolean;
  confianca: number;
  frames_confirmados: number | null;
}

interface VerificacaoServidor {
  id: string;
  status: 'AGUARDANDO_ANALISE' | 'APROVADA' | 'REPROVADA' | 'EXPIRADA' | 'ERRO';
  pessoa_nome: string | null;
  latencia_ms: number | null;
  versao_modelo: string | null;
  motivo_falha: string | null;
  deteccoes: DeteccaoServidor[];
}

interface AvisoDesfecho {
  tipo: string;
  verificacao_id: string;
  status: string;
  pessoa: string | null;
  faltantes: string[];
  motivo: string | null;
}

export interface ServidorEpiVerificationServiceOptions {
  timeoutMs?: number;
}

/**
 * O servidor decide em dois estados; a UI tem três.
 *
 * `warning` NÃO é produzido aqui, e isso é uma decisão de segurança, não um
 * esquecimento. A catraca é binária: ou o servidor mandou liberar, ou não
 * mandou. Se esta classe traduzisse "faltou um EPI entre quatro exigidos"
 * para `warning` — como a regra local `resolveDetectionStatus` faz —, a tela
 * mostraria um aviso amarelo enquanto a catraca permanece trancada, e o
 * operador concluiria que é só seguir em frente.
 *
 * Pelo mesmo motivo esta classe não passa por `buildDetectionResult`: aquele
 * caminho reaplica limiares de confiança locais e pode discordar do servidor
 * — marcar como ausente um EPI que o servidor aceitou, com a catraca já
 * aberta. Um sistema com duas autoridades sobre a mesma decisão não tem
 * autoridade nenhuma.
 */
const mapearStatus = (status: VerificacaoServidor['status']): DetectionStatus => {
  switch (status) {
    case 'APROVADA':
      return 'approved';
    case 'REPROVADA':
      return 'rejected';
    default:
      // EXPIRADA e ERRO não são veredito, são falha de execução — quem
      // chama precisa distinguir "reprovado" de "não deu para verificar".
      throw new AppError(
        'invalid_response',
        status === 'EXPIRADA'
          ? 'A câmera não respondeu a tempo. Tente novamente.'
          : 'A verificação falhou no servidor. Chame o suporte.',
      );
  }
};

export class ServidorEpiVerificationService implements EpiVerificationService {
  private readonly timeoutMs: number;

  constructor({ timeoutMs }: ServidorEpiVerificationServiceOptions = {}) {
    this.timeoutMs = timeoutMs ?? TIMEOUT_PADRAO_MS;
  }

  async run(
    input: EpiVerificationInput,
    onEvent: EpiVerificationEventListener,
  ): Promise<EpiDetectionResult> {
    const { requiredItems, signal, identificacaoId } = input;
    const inicio = Date.now();

    const { baseUrl, pointId } = await getFaceApiConfig();
    const token = await deviceTokenStore.get();
    if (!token) {
      throw new AppError(
        'storage',
        'Este tablet não está provisionado. Registre-o na tela de provisionamento antes de verificar EPIs.',
      );
    }

    // Progresso inicial: o servidor não emite etapa por EPI, então não há o
    // que fingir. Mostramos os exigidos ainda em aberto e o resultado chega
    // de uma vez. Inventar progresso intermediário só faria a tela mentir
    // sobre o que está acontecendo.
    onEvent({
      type: 'EPI_PROGRESS',
      progress: 0,
      items: requiredItems.map((id) => this.item(id, false, 0)),
      currentItem: requiredItems[0] ?? null,
    });

    // O WebSocket ABRE ANTES do POST, e isso não é estilo: a inferência na
    // Raspberry leva centenas de milissegundos. Conectando depois, o
    // desfecho pode já ter sido publicado — o canal não guarda histórico, e
    // o tablet ficaria esperando para sempre por uma mensagem que passou.
    const canal = this.abrirCanal(baseUrl, pointId, token);

    try {
      const verificacaoId = await this.abrirVerificacao(
        baseUrl, token, pointId, identificacaoId ?? null, signal,
      );

      const aviso = await canal.esperar(verificacaoId, this.timeoutMs, signal);

      // O canal carrega só o desfecho. O detalhe — confiança por EPI e em
      // quantos frames cada um foi confirmado — vem por HTTP, e é o que a
      // tela de resultado mostra.
      //
      // Quando o aviso não chegou (canal caiu, rede instável), consultamos
      // até o servidor concluir em vez de perguntar uma vez só. Sem isto, um
      // WebSocket com problema faria toda verificação parecer erro de
      // servidor, quando na verdade a decisão foi tomada e gravada.
      const verificacao = aviso
        ? await this.buscarDetalhe(baseUrl, verificacaoId, signal)
        : await this.consultarAteConcluir(baseUrl, verificacaoId, signal);

      return this.montarResultado(verificacao, requiredItems, Date.now() - inicio);
    } finally {
      canal.fechar();
    }
  }

  // ------------------------------------------------------------------ HTTP
  private async abrirVerificacao(
    baseUrl: string,
    token: string,
    pontoId: number,
    identificacaoId: string | null,
    signal?: AbortSignal,
  ): Promise<string> {
    const resposta = await fetch(`${baseUrl}/api/v1/verificacoes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ponto_id: pontoId,
        ...(identificacaoId ? { identificacao_id: identificacaoId } : {}),
      }),
      ...(signal ? { signal } : {}),
    });

    if (resposta.status === 503) {
      // O servidor sabe que a câmera está fora do ar antes de tentar, pelo
      // testamento MQTT. Recusar na hora é melhor do que deixar a pessoa
      // dez segundos parada esperando um timeout previsível.
      throw new AppError(
        'network',
        'A câmera deste ponto está fora do ar. Avise a manutenção.',
      );
    }
    if (resposta.status === 409) {
      throw new AppError(
        'invalid_response',
        'A identificação expirou. Posicione o rosto novamente.',
      );
    }
    if (resposta.status !== 202) {
      throw new AppError(
        'invalid_response',
        `Não consegui abrir a verificação (HTTP ${resposta.status}).`,
      );
    }

    const corpo = (await resposta.json()) as { id: string };
    return corpo.id;
  }

  private async buscarDetalhe(
    baseUrl: string,
    id: string,
    signal?: AbortSignal,
  ): Promise<VerificacaoServidor> {
    const resposta = await fetch(`${baseUrl}/api/v1/verificacoes/${id}`, {
      headers: { Accept: 'application/json' },
      ...(signal ? { signal } : {}),
    });
    if (!resposta.ok) {
      throw new AppError(
        'invalid_response',
        `Não consegui ler o resultado (HTTP ${resposta.status}).`,
      );
    }
    return (await resposta.json()) as VerificacaoServidor;
  }

  // ------------------------------------------------------------- WebSocket
  private abrirCanal(baseUrl: string, pontoId: number, token: string) {
    const url =
      `${baseUrl.replace(/^http/, 'ws')}/api/v1/ws/pontos/${pontoId}` +
      `?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(url);
    const recebidos: AvisoDesfecho[] = [];
    let aguardando: ((aviso: AvisoDesfecho) => void) | null = null;
    let idAlvo: string | null = null;

    ws.onmessage = (evento) => {
      let aviso: AvisoDesfecho;
      try {
        aviso = JSON.parse(String(evento.data)) as AvisoDesfecho;
      } catch {
        return;
      }
      if (aviso.tipo !== 'resultado') {
        return;
      }
      // Guardamos mesmo sem ninguém esperando ainda: o desfecho pode chegar
      // antes de o POST devolver o id, e nesse caso quem espera depois
      // encontra a mensagem já na fila.
      if (idAlvo && aviso.verificacao_id === idAlvo && aguardando) {
        aguardando(aviso);
        aguardando = null;
      } else {
        recebidos.push(aviso);
      }
    };

    return {
      esperar: (id: string, timeoutMs: number, signal?: AbortSignal) =>
        new Promise<AvisoDesfecho | null>((resolver, rejeitar) => {
          idAlvo = id;

          const jaChegou = recebidos.find((a) => a.verificacao_id === id);
          if (jaChegou) {
            resolver(jaChegou);
            return;
          }

          const relogio = setTimeout(() => {
            aguardando = null;
            // Sem exceção: o desfecho pode ter sido gravado mesmo com o
            // canal falhando. Quem chama consulta por HTTP em seguida e
            // descobre a verdade. Falhar aqui transformaria um problema de
            // aviso num problema de verificação.
            resolver(null);
          }, timeoutMs);

          const encerrar = () => {
            clearTimeout(relogio);
            aguardando = null;
          };

          aguardando = (aviso) => {
            encerrar();
            resolver(aviso);
          };

          signal?.addEventListener('abort', () => {
            encerrar();
            rejeitar(new AppError('cancelled', 'Verificação cancelada.'));
          });
        }),
      fechar: () => {
        try {
          ws.close();
        } catch {
          /* fechar um socket já morto não é problema de ninguém */
        }
      },
    };
  }

  // ------------------------------------------------------------- resultado
  private item(id: EpiId, detected: boolean, confidence: number): DetectedEpi {
    const doCatalogo = getEpiById(id);
    return {
      id,
      label: doCatalogo?.label ?? id,
      description: doCatalogo?.description ?? '',
      confidence: clampUnit(confidence),
      detected,
    };
  }

  private async consultarAteConcluir(
    baseUrl: string,
    id: string,
    signal?: AbortSignal,
  ): Promise<VerificacaoServidor> {
    const limite = Date.now() + this.timeoutMs;
    let ultima = await this.buscarDetalhe(baseUrl, id, signal);

    while (ultima.status === 'AGUARDANDO_ANALISE' && Date.now() < limite) {
      await new Promise((r) => setTimeout(r, 400));
      if (signal?.aborted) {
        throw new AppError('cancelled', 'Verificação cancelada.');
      }
      ultima = await this.buscarDetalhe(baseUrl, id, signal);
    }
    return ultima;
  }

  private montarResultado(
    verificacao: VerificacaoServidor,
    exigidosLocais: EpiId[],
    processingTimeMs: number,
  ): EpiDetectionResult {
    const status = mapearStatus(verificacao.status);

    const detectedItems: DetectedEpi[] = [];
    const missingItems: DetectedEpi[] = [];
    const avaliados: EpiId[] = [];

    for (const d of verificacao.deteccoes) {
      if (!isEpiId(d.epi)) {
        // Código que o servidor conhece e o app não. Não dá para desenhar,
        // e esconder seria pior: o item entra na conta como ausente e
        // aparece na tela com o próprio código.
        continue;
      }
      avaliados.push(d.epi);
      const item = this.item(d.epi, d.presente, d.confianca);
      (d.presente ? detectedItems : missingItems).push(item);
    }

    // A política de EPIs é do SERVIDOR, não do tablet. Se o admin acrescentou
    // um EPI ao ponto, o servidor exigiu e avaliou — mesmo que a configuração
    // local do app ainda não saiba dele. Por isso a lista avaliada vem da
    // resposta, e a local só serve de reserva quando não veio detecção nenhuma.
    const requiredItems = avaliados.length > 0 ? avaliados : [...exigidosLocais];

    const overallConfidence =
      detectedItems.length === 0
        ? 0
        : detectedItems.reduce((soma, i) => soma + i.confidence, 0) /
          detectedItems.length;

    return {
      id: verificacao.id,
      status,
      detectedItems,
      missingItems,
      requiredItems,
      overallConfidence,
      analyzedAt: new Date().toISOString(),
      // A latência do servidor mede da abertura ao desfecho. A nossa inclui
      // rede e o GET do detalhe; é a que o usuário sentiu.
      processingTimeMs: verificacao.latencia_ms ?? processingTimeMs,
      engine: 'api',
    };
  }
}
