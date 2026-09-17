import { useCallback, useEffect, useState } from 'react';
import { mdiChartBoxOutline, mdiTrayArrowDown } from '@mdi/js';
import {
  api,
  ErroApi,
  type AnalyticsConformidadePorPonto,
  type AnalyticsDesempenho,
  type AnalyticsEpisAusentes,
  type AnalyticsHorarios,
  type AnalyticsIndicadores,
  type AnalyticsOpcoes,
  type AnalyticsPaginaTabela,
  type AnalyticsSetores,
  type AnalyticsTendencia,
} from '../api/cliente';
import { BarrasRanking, type ItemBarra } from '../componentes/BarrasRanking';
import { BarrasStatusEmpilhadas } from '../componentes/BarrasStatusEmpilhadas';
import {
  FiltrosRelatorio,
  SITUACOES_ROTULO,
  filtrosIniciais,
  paraConsulta,
  type FiltrosEstado,
} from '../componentes/FiltrosRelatorio';
import { LinhaLatencia } from '../componentes/LinhaLatencia';
import { LinhaTendencia } from '../componentes/LinhaTendencia';
import { MapaHorarios } from '../componentes/MapaHorarios';
import { Aviso, Icone, Metrica, Pastilha, Secao, Variacao, formatarData } from '../componentes/basicos';

const POR_PAGINA_TABELA = 20;

export function Relatorios() {
  const [filtros, setFiltros] = useState<FiltrosEstado>(() => filtrosIniciais());
  const [opcoes, setOpcoes] = useState<AnalyticsOpcoes | null>(null);

  const [indicadores, setIndicadores] = useState<AnalyticsIndicadores | null>(null);
  const [tendencia, setTendencia] = useState<AnalyticsTendencia | null>(null);
  const [episAusentes, setEpisAusentes] = useState<AnalyticsEpisAusentes | null>(null);
  const [conformidadePorPonto, setConformidadePorPonto] =
    useState<AnalyticsConformidadePorPonto | null>(null);
  const [horarios, setHorarios] = useState<AnalyticsHorarios | null>(null);
  const [setores, setSetores] = useState<AnalyticsSetores | null>(null);
  const [desempenho, setDesempenho] = useState<AnalyticsDesempenho | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [tabela, setTabela] = useState<AnalyticsPaginaTabela | null>(null);
  const [paginaTabela, setPaginaTabela] = useState(0);
  const [carregandoTabela, setCarregandoTabela] = useState(true);
  const [erroTabela, setErroTabela] = useState<string | null>(null);

  const [exportando, setExportando] = useState(false);
  const [erroExportar, setErroExportar] = useState<string | null>(null);

  useEffect(() => {
    api.analyticsOpcoes().then(setOpcoes).catch(() => {});
  }, []);

  const carregar = useCallback(async () => {
    setErro(null);
    setCarregando(true);
    try {
      const consulta = paraConsulta(filtros);
      const [ind, ten, epis, pontos, hor, set, des] = await Promise.all([
        api.analyticsIndicadores(consulta),
        api.analyticsTendencia(consulta),
        api.analyticsEpisAusentes(consulta),
        api.analyticsConformidadePorPonto(consulta),
        api.analyticsHorarios(consulta),
        api.analyticsSetores(consulta),
        api.analyticsDesempenho(consulta),
      ]);
      setIndicadores(ind);
      setTendencia(ten);
      setEpisAusentes(epis);
      setConformidadePorPonto(pontos);
      setHorarios(hor);
      setSetores(set);
      setDesempenho(des);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Falha ao carregar os relatórios.');
    } finally {
      setCarregando(false);
    }
  }, [filtros]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const carregarTabela = useCallback(async () => {
    setErroTabela(null);
    setCarregandoTabela(true);
    try {
      const consulta = paraConsulta(filtros);
      const pagina = await api.analyticsTabela(
        consulta,
        POR_PAGINA_TABELA,
        paginaTabela * POR_PAGINA_TABELA,
      );
      setTabela(pagina);
    } catch (e) {
      setErroTabela(e instanceof ErroApi ? e.message : 'Falha ao carregar a tabela.');
    } finally {
      setCarregandoTabela(false);
    }
  }, [filtros, paginaTabela]);

  useEffect(() => {
    void carregarTabela();
  }, [carregarTabela]);

  // Trocar filtro sem voltar à primeira página deixaria a tabela vazia sem
  // explicação — o mesmo cuidado que a tela de Verificações já toma.
  useEffect(() => {
    setPaginaTabela(0);
  }, [filtros]);

  function aoMudarFiltros(patch: Partial<FiltrosEstado>) {
    setFiltros((f) => ({ ...f, ...patch }));
  }

  async function aoExportar() {
    setErroExportar(null);
    setExportando(true);
    try {
      await api.analyticsExportarCsv(paraConsulta(filtros));
    } catch (e) {
      setErroExportar(e instanceof ErroApi ? e.message : 'Falha ao gerar o CSV.');
    } finally {
      setExportando(false);
    }
  }

  const a = indicadores?.atual;
  const ant = indicadores?.anterior;

  const barrasEpis: ItemBarra[] =
    episAusentes?.itens.map((i) => ({
      rotulo: i.rotulo,
      valor: i.faltas,
      anotacao: `${i.faltas}${i.pct_falta !== null ? ` · ${i.pct_falta}%` : ''}`,
      detalhe: `${i.faltas} ausências em ${i.total} verificações`,
    })) ?? [];

  const barrasPontos: ItemBarra[] =
    conformidadePorPonto?.pontos.map((p) => ({
      rotulo: p.nome,
      valor: p.taxa_conformidade ?? 0,
      anotacao: p.taxa_conformidade === null ? 'sem dados' : `${p.taxa_conformidade}%`,
      detalhe: `${p.aprovadas}/${p.total} aprovadas`,
    })) ?? [];

  const barrasSetores: ItemBarra[] =
    setores?.itens
      .filter((s) => s.bloqueios > 0)
      .map((s) => ({
        rotulo: s.setor,
        valor: s.bloqueios,
        detalhe: `${s.bloqueios} bloqueios em ${s.total} verificações`,
      })) ?? [];

  const barrasVersao: ItemBarra[] =
    desempenho?.por_versao.map((v) => ({
      rotulo: v.versao_modelo,
      valor: v.taxa_conformidade ?? 0,
      anotacao: v.taxa_conformidade === null ? 'sem dados' : `${v.taxa_conformidade}%`,
      detalhe: `${v.total} verificações${
        v.latencia_media_ms !== null ? ` · ${v.latencia_media_ms} ms de latência média` : ''
      }`,
    })) ?? [];

  // A seção de desempenho técnico só aparece com dado que sustente uma
  // leitura: latência registrada, ou mais de uma versão de modelo para
  // comparar. Com nenhum dos dois, seria uma seção vazia fingindo conteúdo.
  const mostrarDesempenho =
    (desempenho?.latencia_media_ms ?? null) !== null || (desempenho?.por_versao.length ?? 0) >= 2;

  const totalPaginasTabela = Math.max(
    0,
    Math.ceil((tabela?.total ?? 0) / POR_PAGINA_TABELA) - 1,
  );

  return (
    <>
      <section className="hero">
        <span className="medalha">
          <Icone caminho={mdiChartBoxOutline} />
        </span>
        <div>
          <p className="eyebrow">Análise aprofundada</p>
          <h1>Relatórios e Analytics</h1>
          <p>
            Os mesmos dados do painel executivo, cortados do jeito que a pergunta pedir. Ajuste
            os filtros abaixo — indicadores, gráficos, tabela e exportação respondem todos ao
            mesmo recorte.
          </p>
        </div>
      </section>

      <FiltrosRelatorio
        filtros={filtros}
        opcoes={opcoes}
        aoMudar={aoMudarFiltros}
        aoLimpar={() => setFiltros(filtrosIniciais())}
      />

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      <div className="metricas" style={{ marginBottom: 24 }}>
        <Metrica
          rotulo="Conformidade"
          valor={a?.taxa_conformidade == null ? '—' : `${a.taxa_conformidade}%`}
          nota={
            <Variacao
              atual={a?.taxa_conformidade}
              anterior={ant?.taxa_conformidade}
              sufixo=" p.p."
              bomSubir
            />
          }
          destaque
        />
        <Metrica
          rotulo="Verificações"
          valor={a?.verificacoes ?? '—'}
          nota={<Variacao atual={a?.verificacoes} anterior={ant?.verificacoes} />}
        />
        <Metrica
          rotulo="Aprovações"
          valor={a?.aprovadas ?? '—'}
          nota={<Variacao atual={a?.aprovadas} anterior={ant?.aprovadas} />}
        />
        <Metrica
          rotulo="Bloqueios"
          valor={a?.bloqueios ?? '—'}
          nota={<Variacao atual={a?.bloqueios} anterior={ant?.bloqueios} />}
        />
        <Metrica
          rotulo="Pessoas bloqueadas"
          valor={a?.pessoas_barradas ?? '—'}
          nota={
            a && a.pessoas_barradas > 0 ? (
              <span style={{ color: 'var(--slate-500)' }}>distintas no período</span>
            ) : (
              <span style={{ color: 'var(--slate-400)' }}>ninguém foi barrado</span>
            )
          }
        />
        <Metrica
          rotulo="Liberações manuais"
          valor={a?.liberacoes_manuais ?? '—'}
          nota={<Variacao atual={a?.liberacoes_manuais} anterior={ant?.liberacoes_manuais} />}
        />
        <Metrica
          rotulo="Latência média"
          valor={a?.latencia_media_ms == null ? '—' : `${a.latencia_media_ms} ms`}
          nota={
            <Variacao atual={a?.latencia_media_ms} anterior={ant?.latencia_media_ms} sufixo=" ms" />
          }
        />
      </div>

      <Secao
        titulo="Conformidade ao longo do tempo"
        descricao="Percentual de passagens aprovadas por dia, dentro do recorte ativo. O volume de cada dia fica no tooltip e na tabela, não num segundo eixo — que inventaria uma correlação que os dados não têm."
      >
        {carregando ? (
          <div className="vazio">Carregando…</div>
        ) : (
          <LinhaTendencia
            pontos={(tendencia?.dias ?? []).map((d) => ({
              dia: d.dia,
              taxa: d.taxa_conformidade,
              total: d.total,
              bloqueios: d.bloqueios,
            }))}
            titulo="Conformidade por dia"
          />
        )}
      </Secao>

      <Secao
        titulo="Volume de verificações por status"
        descricao="As mesmas verificações do gráfico acima, separadas por status. Aprovada e reprovada são decisão do sistema; expirada e com erro são falha de infraestrutura — câmera fora do ar, tablet sem rede — e não deveriam ser lidas como comportamento de ninguém."
      >
        {carregando ? (
          <div className="vazio">Carregando…</div>
        ) : (
          <BarrasStatusEmpilhadas dias={tendencia?.dias ?? []} />
        )}
      </Secao>

      <Secao
        titulo="EPIs mais ausentes"
        descricao="Ranking de ausências por tipo de EPI, dentro do recorte ativo. Um item que domina esta lista quase nunca é desleixo generalizado: costuma ser estoque insuficiente, tamanho errado, ou um equipamento desconfortável que ninguém reportou."
      >
        {carregando ? <div className="vazio">Carregando…</div> : <BarrasRanking itens={barrasEpis} titulo="Ausências por tipo de EPI" unidade="ausências" />}
      </Secao>

      <Secao
        titulo="Conformidade por ponto de acesso"
        descricao="Compara a taxa de aprovação entre os pontos monitorados no recorte ativo — útil para separar um problema de operação de um problema de um ponto específico."
      >
        {carregando ? (
          <div className="vazio">Carregando…</div>
        ) : (
          <BarrasRanking itens={barrasPontos} titulo="Conformidade por ponto de acesso" />
        )}
      </Secao>

      <Secao
        titulo="Bloqueios por horário e dia da semana"
        descricao="Se os bloqueios se concentram na primeira meia hora do turno, o problema é onde os equipamentos ficam guardados, não quem os usa — e a resposta é mudar a rotina do vestiário, não advertir pessoas."
      >
        {carregando ? (
          <div className="vazio">Carregando…</div>
        ) : (
          <MapaHorarios celulas={horarios?.celulas ?? []} fuso={horarios?.fuso ?? 'UTC'} />
        )}
      </Secao>

      <Secao
        titulo="Análise por setor"
        descricao="Onde concentrar treinamento e prevenção — não um ranking de setores culpados. Quem não tem setor cadastrado aparece como 'Não informado': uma fatia grande ali é, em si, um problema de cadastro a resolver."
      >
        {carregando ? (
          <div className="vazio">Carregando…</div>
        ) : barrasSetores.length === 0 ? (
          <div className="vazio">Nenhum bloqueio no período, para nenhum setor.</div>
        ) : (
          <BarrasRanking itens={barrasSetores} titulo="Bloqueios por setor" unidade="bloqueios" />
        )}
        {!carregando && (setores?.itens.length ?? 0) > 0 ? (
          <div className="rolagem" style={{ marginTop: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>Setor</th>
                  <th className="num">Verificações</th>
                  <th className="num">Bloqueios</th>
                  <th className="num">Conformidade</th>
                </tr>
              </thead>
              <tbody>
                {(setores?.itens ?? []).map((s) => (
                  <tr key={s.setor}>
                    <td>{s.setor}</td>
                    <td className="num">{s.total}</td>
                    <td className="num">{s.bloqueios}</td>
                    <td className="num">
                      {s.taxa_conformidade === null ? '—' : `${s.taxa_conformidade}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Secao>

      {mostrarDesempenho ? (
        <Secao
          titulo="Desempenho técnico"
          descricao="Latência de inferência e resultado por versão do modelo — para calibrar limiares e avaliar se uma atualização do modelo melhorou ou piorou a operação, não para julgar pessoas."
        >
          {carregando ? (
            <div className="vazio">Carregando…</div>
          ) : (
            <>
              <LinhaLatencia pontos={desempenho?.latencia_dias ?? []} />
              {barrasVersao.length > 1 ? (
                <div style={{ marginTop: 20 }}>
                  <BarrasRanking
                    itens={barrasVersao}
                    titulo="Conformidade por versão do modelo"
                  />
                </div>
              ) : null}
            </>
          )}
        </Secao>
      ) : null}

      <div className="cabecalho">
        <div>
          <p className="overline" style={{ margin: 0 }}>
            Verificações no recorte ativo
          </p>
        </div>
        <div className="filtros" style={{ marginBottom: 0 }}>
          <button className="pequeno" onClick={() => void aoExportar()} disabled={exportando}>
            <Icone caminho={mdiTrayArrowDown} tamanho={16} />
            {exportando ? 'Gerando CSV…' : 'Exportar CSV'}
          </button>
        </div>
      </div>
      {erroExportar ? <Aviso tipo="erro">{erroExportar}</Aviso> : null}

      <div className="rolagem">
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Pessoa</th>
              <th>Registro</th>
              <th>Setor</th>
              <th>Ponto</th>
              <th>Status</th>
              <th>Motivo</th>
              <th>EPIs ausentes</th>
              <th className="num">Latência</th>
              <th>Modelo</th>
            </tr>
          </thead>
          <tbody>
            {erroTabela ? (
              <tr>
                <td colSpan={10}>
                  <Aviso tipo="erro">{erroTabela}</Aviso>
                </td>
              </tr>
            ) : carregandoTabela ? (
              <tr>
                <td colSpan={10} className="vazio">
                  Carregando…
                </td>
              </tr>
            ) : (tabela?.itens.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={10} className="vazio">
                  Nenhuma verificação com esses filtros.
                </td>
              </tr>
            ) : (
              (tabela?.itens ?? []).map((v) => (
                <tr key={v.id}>
                  <td>{formatarData(v.iniciada_em)}</td>
                  <td>
                    {v.pessoa_nome ?? (
                      <span style={{ color: 'var(--slate-400)' }}>não identificada</span>
                    )}
                  </td>
                  <td className="mono">{v.pessoa_matricula ?? '—'}</td>
                  <td>{v.setor ?? '—'}</td>
                  <td>{v.ponto}</td>
                  <td>
                    <Pastilha
                      estado={
                        v.status === 'APROVADA'
                          ? 'ok'
                          : v.status === 'REPROVADA' || v.status === 'ERRO'
                            ? 'alerta'
                            : 'neutro'
                      }
                    >
                      {SITUACOES_ROTULO[v.status] ?? v.status}
                    </Pastilha>
                  </td>
                  <td>{v.motivo_falha ?? '—'}</td>
                  <td>
                    {v.epis_ausentes.length === 0 ? (
                      '—'
                    ) : (
                      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {v.epis_ausentes.map((epi) => (
                          <Pastilha key={epi} estado="aviso">
                            {epi}
                          </Pastilha>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="num">{v.latencia_ms ? `${v.latencia_ms} ms` : '—'}</td>
                  <td className="mono">{v.versao_modelo ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="filtros" style={{ marginTop: 14 }}>
        <button
          onClick={() => setPaginaTabela((p) => Math.max(0, p - 1))}
          disabled={paginaTabela === 0}
        >
          Anterior
        </button>
        <span style={{ alignSelf: 'center', fontSize: 13, color: 'var(--slate-500)' }}>
          página {paginaTabela + 1} de {totalPaginasTabela + 1}
        </span>
        <button
          onClick={() => setPaginaTabela((p) => Math.min(totalPaginasTabela, p + 1))}
          disabled={paginaTabela >= totalPaginasTabela}
        >
          Próxima
        </button>
      </div>
    </>
  );
}
