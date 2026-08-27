import { useCallback, useEffect, useState } from 'react';
import { api, ErroApi, type Ponto, type TipoEpi } from '../api/cliente';
import { Aviso, Pastilha } from '../componentes/basicos';

export function Pontos() {
  const [pontos, setPontos] = useState<Ponto[]>([]);
  const [tipos, setTipos] = useState<TipoEpi[]>([]);
  const [rascunho, setRascunho] = useState<Record<number, string[]>>({});
  const [salvando, setSalvando] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [ps, ts] = await Promise.all([api.pontos(), api.tiposEpi()]);
      setPontos(ps);
      setTipos(ts);
      setRascunho(Object.fromEntries(ps.map((p) => [p.id, [...p.epis_exigidos]])));
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Falha ao carregar.');
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function alternar(pontoId: number, codigo: string) {
    setRascunho((r) => {
      const atual = r[pontoId] ?? [];
      return {
        ...r,
        [pontoId]: atual.includes(codigo)
          ? atual.filter((c) => c !== codigo)
          : [...atual, codigo],
      };
    });
  }

  function alterado(p: Ponto) {
    const a = [...p.epis_exigidos].sort().join(',');
    const b = [...(rascunho[p.id] ?? [])].sort().join(',');
    return a !== b;
  }

  async function salvar(p: Ponto) {
    setSalvando(p.id);
    setErro(null);
    setOk(null);
    try {
      const atualizado = await api.definirEpis(p.id, rascunho[p.id] ?? []);
      setPontos((ps) => ps.map((x) => (x.id === p.id ? atualizado : x)));
      setRascunho((r) => ({ ...r, [p.id]: [...atualizado.epis_exigidos] }));
      setOk(`Política de ${p.nome} atualizada. Vale a partir da próxima verificação.`);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Falha ao salvar.');
    } finally {
      setSalvando(null);
    }
  }

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Pontos de acesso</h1>
          <p className="subtitulo">Quais EPIs cada ponto exige</p>
        </div>
      </div>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {ok ? <Aviso tipo="ok">{ok}</Aviso> : null}

      <Aviso>
        Mudar esta lista <b>não exige tocar em código nem reprogramar
        dispositivo</b>. A Raspberry recebe os EPIs exigidos dentro do próximo
        comando de captura, e a decisão de aprovar continua sendo do servidor.
      </Aviso>

      {pontos.length === 0 ? (
        <div className="cartao">
          <div className="vazio">Nenhum ponto de acesso cadastrado.</div>
        </div>
      ) : (
        pontos.map((p) => {
          const selecionados = rascunho[p.id] ?? [];
          const mudou = alterado(p);
          return (
            <div className="cartao" key={p.id} style={{ marginBottom: 14 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: 16,
                  flexWrap: 'wrap',
                  marginBottom: 14,
                }}
              >
                <div>
                  <b style={{ fontSize: '1.02rem' }}>{p.nome}</b>{' '}
                  <span className="mono" style={{ color: 'var(--ink-3)' }}>
                    {p.site_codigo}/{p.codigo}
                  </span>
                  <div style={{ marginTop: 6 }}>
                    <Pastilha estado={p.ativo ? 'ok' : 'neutro'}>
                      {p.ativo ? 'Ativo' : 'Inativo'}
                    </Pastilha>
                  </div>
                </div>
                <button
                  className="primario"
                  onClick={() => void salvar(p)}
                  disabled={!mudou || salvando === p.id}
                >
                  {salvando === p.id ? 'Salvando…' : mudou ? 'Salvar' : 'Salvo'}
                </button>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {tipos.map((t) => {
                  const marcado = selecionados.includes(t.codigo);
                  return (
                    <label
                      key={t.id}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 7,
                        padding: '7px 12px',
                        border: `1px solid ${marcado ? 'var(--accent)' : 'var(--line)'}`,
                        background: marcado ? 'var(--accent-soft)' : 'var(--surface)',
                        borderRadius: 'var(--raio)',
                        cursor: 'pointer',
                        fontSize: '0.88rem',
                        fontWeight: marcado ? 600 : 400,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={marcado}
                        onChange={() => alternar(p.id, t.codigo)}
                        style={{ minWidth: 0, width: 14, height: 14 }}
                      />
                      {t.rotulo}
                      <span className="mono" style={{ color: 'var(--ink-3)', fontSize: '0.74rem' }}>
                        {t.codigo}
                      </span>
                    </label>
                  );
                })}
              </div>

              {selecionados.length === 0 ? (
                <p style={{ color: 'var(--alert)', fontSize: '0.86rem', marginBottom: 0 }}>
                  Sem nenhum EPI exigido, o servidor recusa abrir verificações neste ponto.
                </p>
              ) : null}
            </div>
          );
        })
      )}

      <Aviso>
        O <b>código</b> ao lado de cada EPI é o que trafega no MQTT. Ele precisa
        bater exatamente com o identificador que o app e a Raspberry usam —
        item com código desconhecido é descartado em silêncio do outro lado.
      </Aviso>
    </>
  );
}
