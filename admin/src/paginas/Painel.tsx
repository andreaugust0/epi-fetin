import { useCallback, useEffect, useState } from 'react';
import {
  api,
  ErroApi,
  type Conformidade,
  type Dispositivo,
  type EpisFaltantes,
} from '../api/cliente';
import { mdiShieldCheck } from '@mdi/js';
import { BarrasRanking, type ItemBarra } from '../componentes/BarrasRanking';
import { Aviso, Icone, Metrica, Pastilha, formatarData } from '../componentes/basicos';

const PERIODOS = [7, 30, 90];

export function Painel() {
  const [dias, setDias] = useState(30);
  const [conf, setConf] = useState<Conformidade | null>(null);
  const [faltantes, setFaltantes] = useState<EpisFaltantes | null>(null);
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [c, f, d] = await Promise.all([
        api.conformidade(dias),
        api.episFaltantes(dias),
        api.dispositivos(),
      ]);
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

  const totalVerificacoes = conf?.pontos.reduce((s, p) => s + p.total, 0) ?? 0;
  const totalAprovadas = conf?.pontos.reduce((s, p) => s + p.aprovadas, 0) ?? 0;
  const taxaGeral =
    totalVerificacoes > 0 ? Math.round((1000 * totalAprovadas) / totalVerificacoes) / 10 : null;
  const offline = dispositivos.filter((d) => !d.online);

  const barras: ItemBarra[] =
    faltantes?.itens
      .filter((i) => i.faltas > 0)
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
            Verificação automatizada de equipamentos de proteção individual por
            câmera inteligente, com identificação facial no terminal.
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
            ? `O dispositivo ${offline[0].client_id_mqtt} está offline.`
            : `${offline.length} dispositivos estão offline.`}{' '}
          Verificações no ponto afetado serão recusadas até ele voltar.
        </Aviso>
      ) : null}

      <div className="metricas">
        <Metrica
          rotulo="Conformidade"
          valor={taxaGeral === null ? '—' : `${taxaGeral}%`}
          nota={`últimos ${dias} dias`}
          destaque
        />
        <Metrica
          rotulo="Verificações"
          valor={totalVerificacoes}
          nota={`${totalAprovadas} aprovadas`}
        />
        <Metrica
          rotulo="Reprovações"
          valor={totalVerificacoes - totalAprovadas}
          nota="não passaram na catraca"
        />
        <Metrica
          rotulo="Dispositivos"
          valor={`${dispositivos.length - offline.length}/${dispositivos.length}`}
          nota="online agora"
        />
      </div>

      <h2>EPIs mais esquecidos</h2>
      <div className="cartao">
        {carregando ? (
          <div className="vazio">Carregando…</div>
        ) : (
          <BarrasRanking
            itens={barras}
            titulo={`Ausências de EPI por tipo nos últimos ${dias} dias`}
            unidade="ausências"
          />
        )}
      </div>

      <h2>Conformidade por ponto</h2>
      <div className="rolagem">
        <table>
          <thead>
            <tr>
              <th>Ponto de acesso</th>
              <th className="num">Verificações</th>
              <th className="num">Aprovadas</th>
              <th className="num">Taxa</th>
            </tr>
          </thead>
          <tbody>
            {conf?.pontos.length ? (
              conf.pontos.map((p) => (
                <tr key={p.ponto_id}>
                  <td>{p.nome}</td>
                  <td className="num">{p.total}</td>
                  <td className="num">{p.aprovadas}</td>
                  <td className="num">
                    {p.taxa_conformidade === null ? '—' : `${p.taxa_conformidade}%`}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="vazio">
                  Nenhuma verificação no período.
                </td>
              </tr>
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
