import { useCallback, useEffect, useState } from 'react';
import {
  api,
  ErroApi,
  type Conformidade,
  type Dispositivo,
  type EpisFaltantes,
  type Horarios,
  type LiberacoesManuais,
  type Panorama,
  type Reincidencia,
  type Tendencia,
} from '../api/cliente';
import { mdiShieldCheck } from '@mdi/js';
import { BarrasRanking, type ItemBarra } from '../componentes/BarrasRanking';
import { LinhaTendencia } from '../componentes/LinhaTendencia';
import { MapaHorarios } from '../componentes/MapaHorarios';
import {
  Aviso,
  Icone,
  Metrica,
  Pastilha,
  Secao,
  Variacao,
  formatarData,
} from '../componentes/basicos';

const PERIODOS = [7, 30, 90];

/**
 * Abaixo disto a taxa individual não é exibida — só a contagem.
 *
 * É o mesmo corte do mapa de horários, pela mesma razão. Alguém que passou
 * oito vezes na semana e foi barrado três aparece com 37,5%, mais que o
 * dobro do pior reincidente do mês; some a diferença entre "tem um problema
 * recorrente" e "teve uma semana ruim". A lista continua ordenada por
 * bloqueios absolutos, que é o que ela sabe medir com poucos dados, e a
 * coluna de passagens ao lado mostra por que a taxa está vazia.
 */
const MINIMO_PARA_TAXA = 10;

export function Painel() {
  const [dias, setDias] = useState(30);
  const [panorama, setPanorama] = useState<Panorama | null>(null);
  const [tendencia, setTendencia] = useState<Tendencia | null>(null);
  const [horarios, setHorarios] = useState<Horarios | null>(null);
  const [reincidencia, setReincidencia] = useState<Reincidencia | null>(null);
  const [manuais, setManuais] = useState<LiberacoesManuais | null>(null);
  const [conf, setConf] = useState<Conformidade | null>(null);
  const [faltantes, setFaltantes] = useState<EpisFaltantes | null>(null);
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setErro(null);
    setCarregando(true);
    try {
      const [pan, ten, hor, rei, man, c, f, d] = await Promise.all([
        api.panorama(dias),
        api.tendencia(dias),
        api.horarios(dias),
        api.reincidencia(dias),
        api.liberacoesManuais(dias),
        api.conformidade(dias),
        api.episFaltantes(dias),
        api.dispositivos(),
      ]);
      setPanorama(pan);
      setTendencia(ten);
      setHorarios(hor);
      setReincidencia(rei);
      setManuais(man);
      setConf(c);
      setFaltantes(f);
      setDispositivos(d);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Falha ao carregar o painel.');
    } finally {
      setCarregando(false);
    }
  }, [dias]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // A presença vem do status retido no MQTT, então muda sozinha; uma
  // atualização periódica leve mantém o painel honesto sem esforço.
  useEffect(() => {
    const id = setInterval(() => {
      api.dispositivos().then(setDispositivos).catch(() => {});
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  const offline = dispositivos.filter((d) => !d.online);
  const a = panorama?.atual;
  const ant = panorama?.anterior;

  const barras: ItemBarra[] =
    faltantes?.itens
      ?.filter((i) => i.faltas > 0)
      .map((i) => ({
        rotulo: i.epi,
        valor: i.faltas,
        anotacao: `${i.faltas}${i.pct_falta !== null ? ` · ${i.pct_falta}%` : ''}`,
        detalhe: `${i.faltas} ausências em ${i.total} verificações no ponto ${i.ponto}`,
      })) ?? [];

  return (
    <>
      <section className="hero">
        <span className="medalha">
          <Icone caminho={mdiShieldCheck} />
        </span>
        <div>
          <p className="eyebrow">Área de acesso restrito</p>
          <h1>Painel de conformidade</h1>
          <p>
            Cada passagem por esta portaria é verificada antes de a catraca abrir.
            O que está abaixo é o que essa verificação revelou sobre a operação — não
            sobre o equipamento.
          </p>
        </div>
      </section>

      <div className="cabecalho">
        <div>
          <p className="overline" style={{ margin: 0 }}>
            Período analisado
          </p>
        </div>
        <div className="filtros" style={{ marginBottom: 0 }}>
          {PERIODOS.map((d) => (
            <button
              key={d}
              className={d === dias ? 'primario pequeno' : 'pequeno'}
              onClick={() => setDias(d)}
              disabled={carregando}
            >
              {d} dias
            </button>
          ))}
        </div>
      </div>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      {offline.length > 0 ? (
        <Aviso tipo="erro">
          {offline.length === 1
            ? `O dispositivo ${offline[0]!.client_id_mqtt} está offline.`
            : `${offline.length} dispositivos estão offline.`}{' '}
          Verificações no ponto afetado serão recusadas até ele voltar.
        </Aviso>
      ) : null}

      <div className="metricas">
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
          rotulo="Entradas bloqueadas"
          valor={a?.bloqueios ?? '—'}
          nota={
            a && a.pessoas_barradas > 0 ? (
              <span style={{ color: 'var(--slate-500)' }}>
                {a.pessoas_barradas} pessoa{a.pessoas_barradas === 1 ? '' : 's'} distinta
                {a.pessoas_barradas === 1 ? '' : 's'}
              </span>
            ) : (
              <span style={{ color: 'var(--slate-400)' }}>ninguém foi barrado</span>
            )
          }
        />
        <Metrica
          rotulo="Verificações"
          valor={a?.verificacoes ?? '—'}
          nota={<Variacao atual={a?.verificacoes} anterior={ant?.verificacoes} />}
        />
        <Metrica
          rotulo="Liberações manuais"
          valor={a?.liberacoes_manuais ?? '—'}
          nota={
            <span style={{ color: 'var(--slate-500)' }}>
              catraca aberta por fora do sistema
            </span>
          }
        />
      </div>

      <Secao
        titulo="A conformidade está mudando?"
        descricao="Percentual de passagens aprovadas por dia. É a única curva que responde se o sistema mudou o comportamento das pessoas ou apenas passou a registrar o que já acontecia. O volume de cada dia fica no tooltip e na tabela, deliberadamente fora do gráfico: um segundo eixo inventaria uma correlação que os dados não têm."
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
        titulo="Quando os bloqueios acontecem"
        descricao="Bloqueios por hora e dia da semana. Se eles se concentram na primeira meia hora do turno, o problema é onde os equipamentos ficam guardados, não quem os usa — e a resposta é mudar a rotina do vestiário, não advertir pessoas."
      >
        {carregando ? (
          <div className="vazio">Carregando…</div>
        ) : (
          <MapaHorarios celulas={horarios?.celulas ?? []} fuso={horarios?.fuso ?? 'UTC'} />
        )}
      </Secao>

      <Secao
        titulo="Qual equipamento falta mais"
        descricao="Ausências por tipo de EPI. Um item que domina esta lista quase nunca é desleixo generalizado: costuma ser estoque insuficiente, tamanho errado, ou um equipamento desconfortável que ninguém reportou."
      >
        {carregando ? (
          <div className="vazio">Carregando…</div>
        ) : (
          <BarrasRanking
            itens={barras}
            titulo={`Ausências de EPI por tipo nos últimos ${dias} dias`}
            unidade="ausências"
          />
        )}
      </Secao>

      <Secao
        titulo="Quem precisa de treinamento"
        descricao="Pessoas com mais bloqueios no período, e qual equipamento cada uma mais deixou de usar. Esta lista existe para direcionar treinamento e resolver causas: alguém barrado seis vezes pelo mesmo item raramente despreza a norma — quase sempre o equipamento não está onde deveria, não serve, ou ninguém explicou."
      >
        {carregando ? (
          <div className="vazio">Carregando…</div>
        ) : (reincidencia?.pessoas?.length ?? 0) === 0 ? (
          <div className="vazio">Ninguém foi bloqueado no período.</div>
        ) : (
          <div className="rolagem">
            <table>
              <thead>
                <tr>
                  <th>Pessoa</th>
                  <th className="num">Bloqueios</th>
                  <th className="num">Passagens</th>
                  <th className="num">Taxa</th>
                  <th>Equipamento mais ausente</th>
                  <th>Último</th>
                </tr>
              </thead>
              <tbody>
                {(reincidencia?.pessoas ?? []).map((p) => (
                  <tr key={p.pessoa_id}>
                    <td>{p.nome}</td>
                    <td className="num">{p.bloqueios}</td>
                    <td className="num">{p.verificacoes}</td>
                    <td className="num">
                      {p.taxa_bloqueio === null || p.verificacoes < MINIMO_PARA_TAXA ? (
                        <span
                          style={{ color: 'var(--slate-400)' }}
                          title={`menos de ${MINIMO_PARA_TAXA} passagens no período`}
                        >
                          —
                        </span>
                      ) : (
                        `${p.taxa_bloqueio}%`
                      )}
                    </td>
                    <td>
                      {p.epi_mais_ausente ? (
                        <Pastilha estado="aviso">{p.epi_mais_ausente}</Pastilha>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{formatarData(p.ultimo_em)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Secao>

      {(manuais?.itens?.length ?? 0) > 0 ? (
        <Secao
          titulo="Liberações manuais"
          descricao="Vezes em que a catraca foi aberta por fora da verificação. Toda barreira precisa de uma válvula de escape — sem ela, alguém escora a catraca com um extintor e não sobra registro de nada. O que importa é a frequência: uma por mês é operação normal; trinta por semana significam que o sistema está atrapalhando o trabalho e vai ser contornado de qualquer jeito."
        >
          <div className="rolagem">
            <table>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Ponto</th>
                  <th>Pessoa</th>
                  <th>Justificativa</th>
                </tr>
              </thead>
              <tbody>
                {(manuais?.itens ?? []).map((i) => (
                  <tr key={`${i.ocorrido_em}-${i.ponto}`}>
                    <td>{formatarData(i.ocorrido_em)}</td>
                    <td>{i.ponto}</td>
                    <td>{i.pessoa ?? '—'}</td>
                    <td>{i.justificativa ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Secao>
      ) : null}

      <h2>Conformidade por ponto</h2>
      <div className="rolagem" style={{ marginBottom: 24 }}>
        <table>
          <thead>
            <tr>
              <th>Ponto de acesso</th>
              <th className="num">Verificações</th>
              <th className="num">Aprovadas</th>
              <th className="num">Conformidade</th>
            </tr>
          </thead>
          <tbody>
            {(conf?.pontos?.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={4} className="vazio">
                  Nenhuma verificação no período.
                </td>
              </tr>
            ) : (
              (conf?.pontos ?? []).map((p) => (
                <tr key={p.ponto_id}>
                  <td>{p.nome}</td>
                  <td className="num">{p.total}</td>
                  <td className="num">{p.aprovadas}</td>
                  <td className="num">
                    {p.taxa_conformidade === null ? '—' : `${p.taxa_conformidade}%`}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2>Dispositivos</h2>
      <div className="rolagem">
        <table>
          <thead>
            <tr>
              <th>Identificador MQTT</th>
              <th>Tipo</th>
              <th>Estado</th>
              <th>Visto em</th>
              <th>Firmware</th>
            </tr>
          </thead>
          <tbody>
            {dispositivos.map((d) => (
              <tr key={d.id}>
                <td className="mono">{d.client_id_mqtt}</td>
                <td>{d.tipo}</td>
                <td>
                  <Pastilha estado={d.online ? 'ok' : 'alerta'}>
                    {d.online ? 'Online' : 'Offline'}
                  </Pastilha>
                </td>
                <td>{formatarData(d.visto_em)}</td>
                <td className="mono">{d.firmware ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
