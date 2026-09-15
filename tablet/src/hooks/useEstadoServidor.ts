import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { resolveFaceApiConfig } from '@/features/face-recognition/services/faceApiConfig';

export type EstadoServidor = 'verificando' | 'online' | 'offline' | 'sem-provisionamento';

const INTERVALO_MS = 15_000;
const TEMPO_LIMITE_MS = 4000;

/**
 * O servidor responde?
 *
 * Existe para o problema da portaria: o terminal parece perfeito com o
 * servidor desligado. A tela abre, o botão funciona, a câmera liga — e a
 * falha só aparece depois que a primeira pessoa do dia já encostou o rosto,
 * com fila atrás. Saber disso antes é diferença entre um ajuste de dois
 * minutos e uma manhã perdida.
 *
 * `/health` e não um endpoint de dados: é a rota mais barata que existe, não
 * exige autenticação e não mexe em nada. Quinze segundos entre consultas é
 * frequente o suficiente para o operador perceber, e raro o suficiente para
 * não pesar numa rede de hotspot.
 */
export const useEstadoServidor = (): EstadoServidor => {
  const [estado, setEstado] = useState<EstadoServidor>('verificando');
  const vivoRef = useRef(true);

  useEffect(() => {
    vivoRef.current = true;
    return () => {
      vivoRef.current = false;
    };
  }, []);

  const consultar = useCallback(async () => {
    const { baseUrl } = await resolveFaceApiConfig();
    if (!vivoRef.current) return;

    if (!baseUrl) {
      setEstado('sem-provisionamento');
      return;
    }

    const relogio = new AbortController();
    const expirar = setTimeout(() => relogio.abort(), TEMPO_LIMITE_MS);
    try {
      const resposta = await fetch(`${baseUrl}/health`, { signal: relogio.signal });
      if (vivoRef.current) {
        setEstado(resposta.ok ? 'online' : 'offline');
      }
    } catch {
      // Qualquer falha aqui é a mesma notícia para quem opera o terminal: o
      // servidor não respondeu. Distinguir DNS de recusa de conexão não muda
      // o que essa pessoa pode fazer a respeito.
      if (vivoRef.current) {
        setEstado('offline');
      }
    } finally {
      clearTimeout(expirar);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void consultar();
      const repetir = setInterval(() => void consultar(), INTERVALO_MS);
      return () => clearInterval(repetir);
    }, [consultar]),
  );

  return estado;
};
