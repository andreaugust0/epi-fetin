import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { DEFAULT_REQUIRED_EPI_IDS } from '@/constants/epiCatalog';
import { normalizeError } from '@/services/errors';

import { epiSettingsRepository } from '../services/EpiSettingsRepository';
import { buscarEpisExigidos } from '../services/PoliticaPontoService';
import type { EpiId } from '../types';

export interface UseRequiredEpisResult {
  requiredEpis: EpiId[];
  loading: boolean;
  error: unknown;
  setRequiredEpis: (ids: EpiId[]) => Promise<void>;
  reload: () => Promise<void>;
}

/**
 * Quais equipamentos este ponto de acesso exige.
 *
 * A ORDEM importa, e é a correção de um defeito que só aparece em operação:
 * primeiro o servidor, e o armazenamento local só quando não há servidor a
 * quem perguntar.
 *
 * A exigência é política do ponto de acesso. Quem a define é o painel
 * administrativo, e a catraca já cobrava a lista de lá — mas a tela inicial
 * lia a lista guardada no aparelho, resquício de quando a configuração morava
 * no tablet. O resultado era o pior tipo de divergência: a tela anunciava três
 * equipamentos, a verificação cobrava outros dois, e nada na interface
 * denunciava o desencontro. O funcionário chegava na portaria vestido para a
 * tela que leu.
 *
 * Recarrega a cada foco da tela. Um terminal de portaria fica ligado o dia
 * inteiro, e quem troca a exigência no painel às dez da manhã não vai até lá
 * reiniciar o aplicativo. Sem isso, a lista do servidor seria lida uma vez na
 * montagem e congelaria até alguém desligar o tablet da tomada.
 *
 * Falha de rede NÃO cai em silêncio para a lista local. Mostrar uma exigência
 * possivelmente desatualizada, com cara de informação boa, é pior do que
 * dizer que não deu para consultar: a tela informa o que a catraca vai
 * cobrar, e informar errado manda a pessoa de volta ao vestiário à toa. O erro
 * sobe, a tela inicial mostra a opção de tentar de novo, e ninguém age sobre
 * informação que o sistema não conseguiu confirmar.
 */
export const useRequiredEpis = (): UseRequiredEpisResult => {
  const [requiredEpis, setEpis] = useState<EpiId[]>([...DEFAULT_REQUIRED_EPI_IDS]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const vivoRef = useRef(true);
  useEffect(() => {
    vivoRef.current = true;
    return () => {
      vivoRef.current = false;
    };
  }, []);

  /**
   * `silencioso` existe para a recarga de foco não piscar a tela.
   *
   * Voltar ao início depois de uma verificação recarrega a lista, e passar por
   * um estado de carregamento a cada retorno faria a tela tremer sem motivo —
   * na prática a resposta é a mesma de segundos atrás. Só a primeira leitura,
   * e o toque explícito em "tentar de novo", mostram carregamento.
   */
  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) {
      setLoading(true);
    }
    try {
      const doServidor = await buscarEpisExigidos();
      const lista = doServidor ?? (await epiSettingsRepository.getRequiredEpis());
      if (!vivoRef.current) return;
      setEpis(lista);
      setError(null);
    } catch (caught) {
      if (!vivoRef.current) return;
      setError(normalizeError(caught, 'network'));
    } finally {
      if (vivoRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void carregar(true);
    }, [carregar]),
  );

  const reload = useCallback(() => carregar(false), [carregar]);

  const setRequiredEpis = useCallback(
    async (ids: EpiId[]) => {
      setEpis(ids);
      try {
        await epiSettingsRepository.setRequiredEpis(ids);
      } catch (caught) {
        setError(normalizeError(caught, 'storage'));
      }
    },
    [],
  );

  return { requiredEpis, loading, error, setRequiredEpis, reload };
};
