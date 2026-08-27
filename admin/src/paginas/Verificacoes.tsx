import { Fragment, useCallback, useEffect, useState } from 'react';
import { api, ErroApi, type Ponto, type Verificacao } from '../api/cliente';
import {
  Aviso,
  Campo,
  ESTADO_VERIFICACAO,
  Pastilha,
  formatarData,
} from '../componentes/basicos';

const POR_PAGINA = 25;

const SITUACOES = [
  ['', 'Todas'],
  ['APROVADA', 'Aprovadas'],
  ['REPROVADA', 'Reprovadas'],
  ['EXPIRADA', 'Expiradas'],
  ['AGUARDANDO_ANALISE', 'Analisando'],
  ['ERRO', 'Com erro'],
] as const;

export function Verificacoes() {
  const [itens, setItens] = useState<Verificacao[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [situacao, setSituacao] = useState('');
  const [pontoId, setPontoId] = useState('');
  const [pontos, setPontos] = useState<Ponto[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aberta, setAberta] = useState<string | null>(null);

  useEffect(() => {
    api.pontos().then(setPontos).catch(() => {});
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const p = await api.verificacoes({
        situacao: situacao || undefined,
        ponto_id: pontoId || undefined,
        limite: POR_PAGINA,
        offset: pagina * POR_PAGINA,
      });
      setItens(p.itens);
      setTotal(p.total);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Falha ao carregar.');
    } finally {
      setCarregando(false);
    }
  }, [situacao, pontoId, pagina]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Trocar de filtro sem voltar à primeira página deixaria a tela vazia
  // sem explicação — o usuário acharia que o filtro não achou nada.
  useEffect(() => {
    setPagina(0);
  }, [situacao, pontoId]);

  const ultimaPagina = Math.max(0, Math.ceil(total / POR_PAGINA) - 1);

  return (
    <>
      <div className="cabecalho">
        <div>
          <p className="eyebrow">Auditoria</p>
          <h1>Verificações</h1>
          <p className="subtitulo">
            Histórico completo — {total} registro{total === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      <div className="filtros">
        <Campo rotulo="Situação">
          <select value={situacao} onChange={(e) => setSituacao(e.target.value)}>
            {SITUACOES.map(([v, r]) => (
              <option key={v} value={v}>
                {r}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Ponto de acesso">
          <select value={pontoId} onChange={(e) => setPontoId(e.target.value)}>
            <option value="">Todos</option>
            {pontos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </Campo>
        <button onClick={() => void carregar()} disabled={carregando}>
          {carregando ? 'Carregando…' : 'Atualizar'}
        </button>
      </div>

      <div className="rolagem">
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Pessoa</th>
              <th>Situação</th>
              <th>Motivo</th>
              <th className="num">Latência</th>
              <th>Modelo</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {itens.length === 0 && !carregando ? (
              <tr>
                <td colSpan={7} className="vazio">
                  Nenhuma verificação com esses filtros.
                </td>
              </tr>
            ) : (
              itens.map((v) => {
                const est = ESTADO_VERIFICACAO[v.status] ?? {
                  estado: 'neutro' as const,
                  texto: v.status,
                };
                const expandida = aberta === v.id;
                return (
                  <Fragment key={v.id}>
                    <tr>
                      <td>{formatarData(v.iniciada_em)}</td>
                      <td>{v.pessoa_nome ?? <span style={{ color: 'var(--slate-400)' }}>não identificada</span>}</td>
                      <td>
                        <Pastilha estado={est.estado}>{est.texto}</Pastilha>
                      </td>
                      <td>{v.motivo_falha ?? '—'}</td>
                      <td className="num">{v.latencia_ms ? `${v.latencia_ms} ms` : '—'}</td>
                      <td className="mono">{v.versao_modelo ?? '—'}</td>
                      <td>
                        <button
                          className="pequeno"
                          onClick={() => setAberta(expandida ? null : v.id)}
                          aria-expanded={expandida}
                        >
                          {expandida ? 'Fechar' : 'Detalhes'}
                        </button>
                      </td>
                    </tr>
                    {expandida ? (
                      <tr>
                        <td colSpan={7} style={{ background: 'var(--slate-50)' }}>
                          <div style={{ padding: '4px 0 8px' }}>
                            <div
                              className="mono"
                              style={{ color: 'var(--slate-400)', marginBottom: 10 }}
                            >
                              {v.id}
                            </div>
                            {v.deteccoes.length === 0 ? (
                              <span style={{ color: 'var(--slate-400)' }}>
                                Nenhuma detecção registrada — a borda não respondeu.
                              </span>
                            ) : (
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                {v.deteccoes.map((d) => (
                                  <Pastilha
                                    key={d.epi}
                                    estado={d.presente ? 'ok' : 'alerta'}
                                  >
                                    {d.rotulo} · {Math.round(d.confianca * 100)}%
                                  </Pastilha>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="filtros" style={{ marginTop: 14 }}>
        <button onClick={() => setPagina((p) => Math.max(0, p - 1))} disabled={pagina === 0}>
          Anterior
        </button>
        <span style={{ alignSelf: 'center', fontSize: 13, color: 'var(--slate-500)' }}>
          página {pagina + 1} de {ultimaPagina + 1}
        </span>
        <button
          onClick={() => setPagina((p) => Math.min(ultimaPagina, p + 1))}
          disabled={pagina >= ultimaPagina}
        >
          Próxima
        </button>
      </div>
    </>
  );
}
