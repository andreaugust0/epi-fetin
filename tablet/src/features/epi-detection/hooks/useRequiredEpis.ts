import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { DEFAULT_REQUIRED_EPI_IDS } from '@/constants/epiCatalog';

import { epiSettingsRepository } from '../services/EpiSettingsRepository';
import { buscarEpisExigidos } from '../services/PoliticaPontoService';
import type { EpiId } from '../types';

export interface UseRequiredEpisResult {
  requiredEpis: EpiId[];
  loading: boolean;
  /** A lista veio do aparelho porque o servidor não respondeu. */
  semConfirmacao: boolean;
  setRequiredEpis: (ids: EpiId[]) => Promise<void>;
  reload: () => Promise<void>;
}

/**
 * Quais equipamentos este ponto de acesso exige.
 *
 * A ORDEM importa: primeiro o servidor, e o armazenamento local só quando não
 * há servidor a quem perguntar, ou quando ele não responde.
 *
 * A exigência é política do ponto de acesso. Quem a define é o painel
 * administrativo, e a catraca já cobrava a lista de lá — mas a tela inicial
 * lia a lista guardada no aparelho, resquício de quando a configuração morava
 * no tablet. O resultado era o pior tipo de divergência: a tela anunciava três
 * equipamentos, a verificação cobrava outros dois, e nada na interface
 * denunciava o desencontro. O funcionário chegava na portaria vestido para a
 * tela que leu.
 *
 * Recarrega a cada foco. Um terminal de portaria fica ligado o dia inteiro, e
 * quem troca a exigência no painel às dez da manhã não vai até lá reiniciar o
 * aplicativo.
 *
 * FALHA DE REDE NÃO INTERROMPE A TELA, e esta decisão já foi tomada do jeito
 * errado uma vez. A primeira versão deixava o erro subir, e a tela inicial
 * virava um estado de erro em tela cheia — sem grade, sem título, sem nada. E
 * é no título que mora o toque longo que abre o provisionamento: o único
 * caminho para corrigir o endereço do servidor no aparelho. Um tablet que não
 * alcança o servidor ficava, por isso, impossível de consertar sem reinstalar
 * o aplicativo. A tela que existia para denunciar o problema era a que
 * impedia de resolvê-lo.
 *
 * Então a lista local entra como último recurso, `semConfirmacao` vira
 * verdadeiro, e a tela avisa em vez de bloquear. O aviso é honesto sem ser
 * fatal — e a verificação não aconteceria mesmo com o servidor fora, então a
 * lista possivelmente desatualizada não leva ninguém a passar indevidamente.
 */
export const useRequiredEpis = (): UseRequiredEpisResult => {
  const [requiredEpis, setEpis] = useState<EpiId[]>([...DEFAULT_REQUIRED_EPI_IDS]);
  const [loading, setLoading] = useState(true);
  const [semConfirmacao, setSemConfirmacao] = useState(false);

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
   * na prática a resposta é a mesma de segundos atrás.
   */
  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) {
      setLoading(true);
    }

    let lista: EpiId[] | null = null;
    let falhou = false;

    try {
      lista = await buscarEpisExigidos();
    } catch {
      falhou = true;
    }

    if (lista === null) {
      try {
        lista = await epiSettingsRepository.getRequiredEpis();
      } catch {
        lista = [...DEFAULT_REQUIRED_EPI_IDS];
      }
    }

    if (!vivoRef.current) return;
    setEpis(lista);
    /*
     * Só a FALHA conta como "sem confirmação".
     *
     * Sem provisionamento, `buscarEpisExigidos` devolve `null` sem sair para
     * a rede: o aparelho ainda não sabe com quem falar, e a lista local é a
     * configuração de verdade, não um plano B. Avisar ali seria ruído em cima
     * do aviso de modo simulado, que já está na tela dizendo a mesma coisa
     * melhor — e dois avisos simultâneos ensinam a ignorar os dois.
     */
    setSemConfirmacao(falhou);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void carregar(true);
    }, [carregar]),
  );

  const reload = useCallback(() => carregar(false), [carregar]);

  const setRequiredEpis = useCallback(async (ids: EpiId[]) => {
    setEpis(ids);
    try {
      await epiSettingsRepository.setRequiredEpis(ids);
    } catch {
      // Gravação local que falha não derruba a tela: o valor já está em
      // memória e a próxima consulta ao servidor corrige de todo jeito.
    }
  }, []);

  return { requiredEpis, loading, semConfirmacao, setRequiredEpis, reload };
};
