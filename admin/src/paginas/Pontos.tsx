import { useCallback, useEffect, useState } from 'react';
import { mdiContentSaveOutline } from '@mdi/js';
import { api, ErroApi, type Ponto, type TipoEpi } from '../api/cliente';
import { Aviso, Icone, Pastilha } from '../componentes/basicos';
import { epiDoCatalogo } from '../tema';

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

  // Códigos que o servidor conhece mas o catálogo do app não. Mostrar isso
  // é o antídoto para o descasamento silencioso: o item aparece com ícone
  // genérico em vez de sumir da tela do totem sem ninguém notar.
  const foraDoCatalogo = tipos.filter(
    (t) => epiDoCatalogo(t.codigo).descricao === 'Não está no catálogo do app',
  );

  return (
    <>
      <div className="cabecalho">
        <div>
          <p className="eyebrow">Configuração</p>
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

      {foraDoCatalogo.length > 0 ? (
        <Aviso tipo="atencao">
          <b>
            {foraDoCatalogo.map((t) => t.codigo).join(', ')}
          </b>{' '}
          {foraDoCatalogo.length === 1 ? 'existe' : 'existem'} no servidor mas não
          no catálogo do app do totem. O app descarta em silêncio código que não
          reconhece — alinhe os dois antes de exigir {foraDoCatalogo.length === 1 ? 'este item' : 'estes itens'}.
        </Aviso>
      ) : null}

      {pontos.length === 0 ? (
        <div className="cartao">
          <div className="vazio">Nenhum ponto de acesso cadastrado.</div>
        </div>
      ) : (
        pontos.map((p) => {
          const selecionados = rascunho[p.id] ?? [];
          const mudou = alterado(p);
          return (
            <div className="cartao" key={p.id} style={{ marginBottom: 16 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 16,
                  flexWrap: 'wrap',
                  marginBottom: 18,
                }}
              >
                <div>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
                  >
                    <b style={{ fontSize: 17, fontWeight: 700 }}>{p.nome}</b>
                    <Pastilha estado={p.ativo ? 'ok' : 'neutro'}>
                      {p.ativo ? 'Ativo' : 'Inativo'}
                    </Pastilha>
                  </div>
                  <span className="mono">
                    {p.site_codigo}/{p.codigo}
                  </span>
                </div>
                <button
                  className="primario"
                  onClick={() => void salvar(p)}
                  disabled={!mudou || salvando === p.id}
                >
                  <Icone caminho={mdiContentSaveOutline} />
                  {salvando === p.id ? 'Salvando…' : mudou ? 'Salvar' : 'Salvo'}
                </button>
              </div>

              <p className="overline">
                {selecionados.length} de {tipos.length} equipamentos exigidos neste ponto
              </p>

              <div className="grade-epi">
                {tipos.map((t) => {
                  const marcado = selecionados.includes(t.codigo);
                  const cat = epiDoCatalogo(t.codigo);
                  return (
                    <label
                      key={t.id}
                      className={`item-epi${marcado ? ' marcado' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={marcado}
                        onChange={() => alternar(p.id, t.codigo)}
                      />
                      <span className="icone">
                        <Icone caminho={cat.icone} />
                      </span>
                      <span className="texto">
                        <span className="nome">{cat.rotulo}</span>
                        <span className="desc">{cat.descricao}</span>
                        <span className="codigo">{t.codigo}</span>
                      </span>
                    </label>
                  );
                })}
              </div>

              {selecionados.length === 0 ? (
                <p
                  style={{
                    color: 'var(--alerta-text)',
                    fontSize: 13,
                    marginBottom: 0,
                    marginTop: 14,
                  }}
                >
                  Sem nenhum EPI exigido, o servidor recusa abrir verificações neste ponto.
                </p>
              ) : null}
            </div>
          );
        })
      )}
    </>
  );
}
