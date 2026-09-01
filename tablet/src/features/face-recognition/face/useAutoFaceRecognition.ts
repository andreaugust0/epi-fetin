import type { CameraView } from 'expo-camera';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { ApiFaceRecognitionService } from '../services/ApiFaceRecognitionService';
import { deviceTokenStore } from '../services/deviceTokenStore';
import { FaceApiConfigError, getFaceApiConfig } from '../services/faceApiConfig';
import type { FaceIdentificationResponse } from '../types/identification';

import { FaceNetSession } from '../onnx/FaceNetSession';

import { FaceDetector } from './faceDetector';
import { extractFaceEmbedding } from './facePipeline';

export type AutoFaceRecognitionStatus = 'preparando' | 'pronto' | 'analisando' | 'erro';

/** Identificação bem-sucedida — os quatro campos vêm juntos, sempre. */
export interface IdentifiedOutcome {
  kind: 'identified';
  pessoaId: number;
  nome: string;
  /** Token de uso único do backend, para a futura etapa de verificação. */
  identificacaoId: string;
  /** ISO 8601 — validade de `identificacaoId`. */
  expiraEm: string;
}

/**
 * Desfecho de uma tentativa de identificação real.
 *
 * Os quatro primeiros são resultados de DOMÍNIO — o backend respondeu
 * normalmente (HTTP 200), só que não reconheceu ninguém, ou reconheceu com
 * ambiguidade, ou a pessoa não tem consentimento vigente. Os três últimos são
 * falhas OPERACIONAIS/TÉCNICAS — nada disso deve ser confundido com "rosto
 * não corresponde a ninguém".
 */
export type FaceIdentificationOutcome =
  | { kind: 'no_face' }
  | IdentifiedOutcome
  | { kind: 'nao_identificado' }
  | { kind: 'ambiguo' }
  | { kind: 'sem_consentimento' }
  /** `getFaceApiConfig()` falhou: URL/ponto_id não configurados (nem override, nem env). */
  | { kind: 'config_missing' }
  /** `deviceTokenStore.get()` devolveu `null`: tablet não provisionado. A API nem é chamada. */
  | { kind: 'token_missing' }
  /** Câmera, ML Kit, FaceNet ou rede/HTTP — mensagem só para log técnico, nunca exibida crua ao funcionário. */
  | { kind: 'technical_error'; message: string };

export interface UseAutoFaceRecognitionOptions {
  cameraRef: RefObject<CameraView | null>;
}

export interface UseAutoFaceRecognitionResult {
  status: AutoFaceRecognitionStatus;
  setupError: string | null;
  result: FaceIdentificationOutcome | null;
  /**
   * Dispara uma única tentativa de identificação: uma captura, um embedding,
   * uma chamada ao servidor, um resultado. Não faz nada se o detector/modelo
   * ainda não carregaram ou se já existe uma tentativa em andamento.
   */
  recognize: () => void;
}

const mapServerResponse = (response: FaceIdentificationResponse): FaceIdentificationOutcome => {
  switch (response.resultado) {
    case 'IDENTIFICADO':
      if (
        response.pessoa_id === null ||
        response.nome === null ||
        response.identificacao_id === null ||
        response.expira_em === null
      ) {
        // Contrato do backend garante esses quatro campos quando
        // resultado=IDENTIFICADO; se algum vier nulo é o servidor divergindo
        // do próprio contrato, não uma resposta de domínio válida.
        return {
          kind: 'technical_error',
          message: 'Resposta de identificação incompleta do servidor.',
        };
      }
      return {
        kind: 'identified',
        pessoaId: response.pessoa_id,
        nome: response.nome,
        identificacaoId: response.identificacao_id,
        expiraEm: response.expira_em,
      };
    case 'NAO_IDENTIFICADO':
      return { kind: 'nao_identificado' };
    case 'AMBIGUO':
      return { kind: 'ambiguo' };
    case 'SEM_CONSENTIMENTO':
      return { kind: 'sem_consentimento' };
  }
};

/**
 * Controlador de uma tentativa de identificação facial REAL.
 *
 * Uma captura → um embedding (FaceNet local, via `extractFaceEmbedding`) →
 * uma decisão do backend (`POST /api/v1/identificacao`). Nunca a galeria
 * mock local (`matchAgainstGallery`/`analyzePhoto`) — essa fica reservada ao
 * diagnóstico (`diagnostico-face.tsx`, que chama `analyzePhoto` direto).
 *
 * Detector e modelo ficam vivos entre tentativas (recriá-los a cada vez
 * pagaria de novo o quase 1 s de carga do FaceNet). Cada chamada a
 * `recognize()` é uma tentativa isolada — quem decide se e quando tentar de
 * novo é o chamador, não este hook.
 */
export const useAutoFaceRecognition = ({
  cameraRef,
}: UseAutoFaceRecognitionOptions): UseAutoFaceRecognitionResult => {
  const [setupState, setSetupState] = useState<'preparando' | 'pronto' | 'erro'>('preparando');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [result, setResult] = useState<FaceIdentificationOutcome | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const detectorRef = useRef<FaceDetector | null>(null);
  const sessionRef = useRef<FaceNetSession | null>(null);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);

  /**
   * Detector e modelo carregam uma única vez e ficam vivos enquanto este
   * hook existir.
   */
  useEffect(() => {
    mountedRef.current = true;
    const detector = new FaceDetector();
    const session = new FaceNetSession();
    detectorRef.current = detector;
    sessionRef.current = session;

    void (async () => {
      try {
        await detector.initialize();
        await session.load();
        if (!mountedRef.current) return;
        setSetupState('pronto');
      } catch (caught) {
        if (!mountedRef.current) return;
        setSetupError(caught instanceof Error ? caught.message : String(caught));
        setSetupState('erro');
      }
    })();

    return () => {
      mountedRef.current = false;
      void session.release();
    };
  }, []);

  const recognize = useCallback(() => {
    if (runningRef.current || setupState !== 'pronto') {
      return;
    }
    const camera = cameraRef.current;
    const detector = detectorRef.current;
    const session = sessionRef.current;
    if (!camera || !detector || !session) {
      return;
    }

    runningRef.current = true;
    setIsRunning(true);

    void (async () => {
      try {
        const foto = await camera.takePictureAsync({ skipProcessing: true, quality: 1 });
        if (!mountedRef.current) return;
        if (!foto?.uri) {
          throw new Error('A câmera não devolveu imagem.');
        }

        // Extração pura: um embedding por captura. Nunca a galeria local.
        const extraction = await extractFaceEmbedding({
          photoUri: foto.uri,
          photoWidth: foto.width,
          photoHeight: foto.height,
          detector,
          session,
        });
        if (!mountedRef.current) return;

        if (extraction.error) {
          setResult({ kind: 'technical_error', message: extraction.error });
          return;
        }
        if (extraction.facesDetected === 0 || !extraction.embedding) {
          setResult({ kind: 'no_face' });
          return;
        }

        let config;
        try {
          config = await getFaceApiConfig();
        } catch (caught) {
          if (caught instanceof FaceApiConfigError) {
            setResult({ kind: 'config_missing' });
            return;
          }
          throw caught;
        }

        const token = await deviceTokenStore.get();
        if (!mountedRef.current) return;
        if (!token) {
          // Sem token, a API nem é chamada — não faz sentido gastar uma
          // requisição que o servidor recusaria com 401/403.
          setResult({ kind: 'token_missing' });
          return;
        }

        const service = new ApiFaceRecognitionService({ baseUrl: config.baseUrl });
        const response = await service.identify({
          embedding: extraction.embedding,
          pontoId: config.pointId,
          deviceToken: token,
        });
        if (!mountedRef.current) return;

        setResult(mapServerResponse(response));
      } catch (caught) {
        if (mountedRef.current) {
          setResult({
            kind: 'technical_error',
            message: caught instanceof Error ? caught.message : String(caught),
          });
        }
      } finally {
        runningRef.current = false;
        if (mountedRef.current) {
          setIsRunning(false);
        }
      }
    })();
  }, [cameraRef, setupState]);

  const status: AutoFaceRecognitionStatus =
    setupState === 'erro'
      ? 'erro'
      : setupState === 'preparando'
        ? 'preparando'
        : isRunning
          ? 'analisando'
          : 'pronto';

  return { status, setupError, result, recognize };
};
