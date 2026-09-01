import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';

import { getEpiVerificationService } from '@/features/epi-detection/services/epiVerificationServiceFactory';
import type { EpiDetectionResult, EpiId } from '@/features/epi-detection/types';
import { getFaceRecognitionService } from '@/features/face-recognition/services/faceRecognitionServiceFactory';
import type { RecognizedEmployee } from '@/features/face-recognition/types';
import { isCancellation, normalizeError } from '@/services/errors';

import { createInitialSnapshot, sessionReducer } from '../machine/sessionMachine';
import type { SessionSnapshot } from '../types';

interface VerificationSessionContextValue {
  snapshot: SessionSnapshot;
  /** Identifica o funcionário. Devolve `true` quando alguém é reconhecido. */
  startFaceRecognition: () => Promise<boolean>;
  /**
   * Registra alguém já identificado por um pipeline externo — hoje o
   * backend/pgvector (`POST /api/v1/identificacao`), antes o reconhecimento
   * local — sem passar pelo `FaceRecognitionService` mock. O pipeline decide
   * sozinho que a pessoa é quem diz ser; esta função só leva esse fato para
   * a sessão. `identification` carrega o token de uso único do backend, para
   * a futura etapa de verificação — omitido quando a origem não tem um
   * (ex.: identificação sem servidor).
   */
  identifyEmployee: (
    employee: RecognizedEmployee,
    confidence: number,
    identification?: { id: string; expiresAt: string },
  ) => void;
  /** Entra na preparação para EPI, preservando o funcionário identificado. */
  prepareEpiVerification: () => void;
  /** Verifica os equipamentos. Devolve o resultado, ou `null` se falhar. */
  startEpiVerification: (requiredItems: EpiId[]) => Promise<EpiDetectionResult | null>;
  cancel: () => void;
  /** Limpa a sessão inteira e devolve o terminal para o próximo funcionário. */
  reset: () => void;
}

const VerificationSessionContext = createContext<VerificationSessionContextValue | null>(null);

/**
 * Mantém a sessão viva entre as telas do terminal, sem depender de persistência
 * nem de parâmetros de rota. É o que permite reprovar a verificação de EPI e
 * tentar de novo sem repetir o reconhecimento facial.
 */
export const VerificationSessionProvider = ({ children }: { children: ReactNode }) => {
  const [snapshot, dispatch] = useReducer(sessionReducer, undefined, createInitialSnapshot);
  const controllerRef = useRef<AbortController | null>(null);

  /** Assume o lugar de qualquer operação anterior ainda em curso. */
  const takeOver = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    return controller;
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    dispatch({ type: 'CANCELLED' });
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    dispatch({ type: 'RESET' });
  }, []);

  const prepareEpiVerification = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    dispatch({ type: 'EPI_PREPARATION' });
  }, []);

  const startFaceRecognition = useCallback(async (): Promise<boolean> => {
    const controller = takeOver();
    const isCurrent = () => controllerRef.current === controller && !controller.signal.aborted;

    dispatch({ type: 'FACE_SCANNING' });

    try {
      const result = await getFaceRecognitionService().recognize({ signal: controller.signal });

      if (!isCurrent()) {
        return false;
      }

      if (result.status === 'recognized') {
        dispatch({
          type: 'FACE_RECOGNIZED',
          employee: result.employee,
          confidence: result.confidence,
        });
        return true;
      }

      dispatch({ type: 'FACE_UNKNOWN', confidence: result.confidence });
      return false;
    } catch (caught) {
      if (controllerRef.current !== controller) {
        return false;
      }
      if (isCancellation(caught)) {
        dispatch({ type: 'CANCELLED' });
        return false;
      }
      dispatch({ type: 'FAILED', error: normalizeError(caught) });
      return false;
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }, [takeOver]);

  /**
   * Reaproveita as mesmas transições que `startFaceRecognition` usaria em caso
   * de sucesso (`FACE_SCANNING` → `FACE_RECOGNIZED`), sem depender do serviço
   * mock nem de nenhuma chamada assíncrona: quem chama já tem o resultado.
   */
  const identifyEmployee = useCallback(
    (
      employee: RecognizedEmployee,
      confidence: number,
      identification?: { id: string; expiresAt: string },
    ) => {
      dispatch({ type: 'FACE_SCANNING' });
      dispatch({
        type: 'FACE_RECOGNIZED',
        employee,
        confidence,
        identificationId: identification?.id ?? null,
        identificationExpiresAt: identification?.expiresAt ?? null,
      });
    },
    [],
  );

  const startEpiVerification = useCallback(
    async (requiredItems: EpiId[]): Promise<EpiDetectionResult | null> => {
      const controller = takeOver();
      const isCurrent = () => controllerRef.current === controller && !controller.signal.aborted;

      dispatch({ type: 'EPI_STARTED', requiredItems });

      try {
        const detection = await getEpiVerificationService().run(
          { requiredItems, signal: controller.signal },
          (event) => {
            if (isCurrent()) {
              dispatch(event);
            }
          },
        );

        if (!isCurrent()) {
          return null;
        }

        dispatch({ type: 'EPI_COMPLETED', detection });
        return detection;
      } catch (caught) {
        if (controllerRef.current !== controller) {
          return null;
        }
        if (isCancellation(caught)) {
          dispatch({ type: 'CANCELLED' });
          return null;
        }
        dispatch({ type: 'FAILED', error: normalizeError(caught) });
        return null;
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
      }
    },
    [takeOver],
  );

  const value = useMemo<VerificationSessionContextValue>(
    () => ({
      snapshot,
      startFaceRecognition,
      identifyEmployee,
      prepareEpiVerification,
      startEpiVerification,
      cancel,
      reset,
    }),
    [
      snapshot,
      startFaceRecognition,
      identifyEmployee,
      prepareEpiVerification,
      startEpiVerification,
      cancel,
      reset,
    ],
  );

  return (
    <VerificationSessionContext.Provider value={value}>
      {children}
    </VerificationSessionContext.Provider>
  );
};

export const useVerificationSession = (): VerificationSessionContextValue => {
  const context = useContext(VerificationSessionContext);
  if (!context) {
    throw new Error('useVerificationSession precisa estar dentro de VerificationSessionProvider.');
  }
  return context;
};
