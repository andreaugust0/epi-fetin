import { Fragment, useCallback, useEffect, useState } from 'react';
import { api, ErroApi, type Politica, type Ponto, type Verificacao } from '../api/cliente';
import {
  Aviso,
  Campo,
  ESTADO_VERIFICACAO,
  Pastilha,
  formatarData,
} from '../componentes/basicos';

const POR_PAGINA = 25;

/**
 * Como cada detecção aparece na lista de detalhes.
 *
 * São três estados, não dois, e essa é a correção que este arquivo
 * carrega. Antes a pastilha era verde sempre que `presente` fosse
 * verdadeiro — então um capacete reconhecido a 30% aparecia verde numa
 * verificação REPROVADA. Quem abria os detalhes lia "capacete OK" e ficava
 * sem entender por que a catraca não abriu; o painel contradizia a porta.
 *
 * `aceito` é o campo que corresponde ao que a catraca considerou. A
 * diferença entre ele e `presente` é exatamente o terceiro estado: visto,
 * mas sem certeza suficiente.
 */
function estadoDaDeteccao(d: { presente: boolean; aceito: boolean }) {
  if (d.aceito) return { estado: 'ok' as const, nota: '' };
  if (d.presente) return { estado: 'aviso' as const, nota: ' · sem certeza' };
  return { estado: 'alerta' as const, nota: ' · não visto' };
}

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
  const [politica, setPolitica] = useState<Politica | null>(null);

  useEffect(() => {
    api.pontos().then(setPontos).catch(() => {});
    // A régua que decidiu. Sem ela a tela mostra o amarelo e não sabe
    // dizer a partir de quanto uma confiança passa a valer — e o admin
    // fica sem o número que ele precisa para julgar se ajusta o limiar ou
    // se treina o modelo. Falhar aqui não quebra a lista.
    api.politica().then(setPolitica).catch(() => {});
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
                              <>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                  {v.deteccoes.map((d) => {
                                    const { estado, nota } = estadoDaDeteccao(d);
                                    return (
                                      <Pastilha key={d.epi} estado={estado}>
                                        {d.rotulo} · {Math.round(d.confianca * 100)}%
                                        {nota}
                                      </Pastilha>
                                    );
                                  })}
                                </div>
                                {politica && v.deteccoes.some((d) => d.presente && !d.aceito) ? (
                                  <p
                                    style={{
                                      color: 'var(--slate-500)',
                                      fontSize: 12,
                                      margin: '10px 0 0',
                                    }}
                                  >
                                    Em amarelo, o equipamento foi visto mas abaixo do
                                    limiar de{' '}
                                    <b>{Math.round(politica.epi_confianca_min * 100)}%</b>{' '}
                                    exigido por este servidor — a catraca não abre, e a
                                    pessoa não está registrada como sem EPI.
                                  </p>
                                ) : null}
                              </>
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
