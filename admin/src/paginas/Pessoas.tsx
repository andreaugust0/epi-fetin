import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ErroApi, type Pessoa } from '../api/cliente';
import { mdiAccountPlusOutline, mdiClose } from '@mdi/js';
import { Aviso, Campo, Icone, Pastilha } from '../componentes/basicos';

const POR_PAGINA = 25;
const VERSAO_TERMO = '1.0';

export function Pessoas() {
  const [itens, setItens] = useState<Pessoa[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [novaAberta, setNovaAberta] = useState(false);
  const [nova, setNova] = useState({ nome: '', funcao: '' });

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const p = await api.pessoas({
        busca: busca || undefined,
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
  }, [busca, pagina]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function agir(acao: () => Promise<unknown>, mensagem: string) {
    setErro(null);
    setOk(null);
    try {
      await acao();
      setOk(mensagem);
      await carregar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Falha na operação.');
    }
  }

  async function criar(e: FormEvent) {
    e.preventDefault();
    await agir(
      () =>
        api.criarPessoa({
          nome: nova.nome.trim(),
          funcao: nova.funcao.trim() || null,
          // O gerador trata campo com default como obrigatorio no corpo;
          // ser explicito aqui e mais claro que configurar o gerador.
          ativo: true,
        }),
      `${nova.nome} cadastrado.`,
    );
    setNova({ nome: '', funcao: '' });
    setNovaAberta(false);
  }

  function revogar(p: Pessoa) {
    const confirmado = window.confirm(
      `Revogar o consentimento de ${p.nome}?\n\n` +
        `Isso APAGA os ${p.biometrias} vetor(es) faciais dela, de forma ` +
        `permanente. A pessoa deixa de ser reconhecida no terminal até ser ` +
        `cadastrada de novo.\n\n` +
        `A eliminação do dado é o que a LGPD exige na revogação — não há ` +
        `como desfazer.`,
    );
    if (!confirmado) return;
    void agir(async () => {
      const r = await api.revogar(p.id);
      setOk(`Consentimento revogado. ${r.biometrias_eliminadas} vetor(es) eliminado(s).`);
    }, '');
  }

  const ultimaPagina = Math.max(0, Math.ceil(total / POR_PAGINA) - 1);

  return (
    <>
      <div className="cabecalho">
        <div>
          <p className="eyebrow">Cadastro</p>
          <h1>Pessoas</h1>
          <p className="subtitulo">
            {total} cadastrada{total === 1 ? '' : 's'} ·{' '}
            {itens.filter((p) => p.biometrias > 0).length} com rosto nesta página
          </p>
        </div>
        <button className="primario" onClick={() => setNovaAberta((v) => !v)}>
          <Icone caminho={novaAberta ? mdiClose : mdiAccountPlusOutline} />
          {novaAberta ? 'Cancelar' : 'Nova pessoa'}
        </button>
      </div>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {ok ? <Aviso tipo="ok">{ok}</Aviso> : null}

      {novaAberta ? (
        <form className="cartao" onSubmit={criar} style={{ marginBottom: 18 }}>
          <div className="filtros" style={{ marginBottom: 0 }}>
            <Campo rotulo="Nome">
              <input
                value={nova.nome}
                onChange={(e) => setNova({ ...nova, nome: e.target.value })}
                required
                autoFocus
                style={{ minWidth: 260 }}
              />
            </Campo>
            <Campo rotulo="Função">
              <input
                value={nova.funcao}
                onChange={(e) => setNova({ ...nova, funcao: e.target.value })}
              />
            </Campo>
            <button className="primario" type="submit">
              Cadastrar
            </button>
          </div>
        </form>
      ) : null}

      <div className="filtros">
        <Campo rotulo="Buscar">
          <input
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setPagina(0);
            }}
            placeholder="nome do funcionário"
          />
        </Campo>
      </div>

      <div className="rolagem">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Função</th>
              <th>Cadastro facial</th>
              <th>Situação</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {itens.length === 0 && !carregando ? (
              <tr>
                <td colSpan={5} className="vazio">
                  Nenhuma pessoa encontrada.
                </td>
              </tr>
            ) : (
              itens.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.nome}{' '}
                    {/* O id interno ajuda no suporte: e por ele que a pessoa
                        aparece no log do servidor. */}
                    <span className="mono" style={{ color: 'var(--slate-400)' }}>
                      #{p.id}
                    </span>
                  </td>
                  <td>{p.funcao ?? '—'}</td>
                  <td>
                    {p.biometrias === 0 ? (
                      <Pastilha estado="neutro">Sem rosto</Pastilha>
                    ) : (
                      <Pastilha estado={p.biometrias >= 3 ? 'ok' : 'aviso'}>
                        {p.biometrias} captura{p.biometrias === 1 ? '' : 's'}
                      </Pastilha>
                    )}
                  </td>
                  <td>
                    {!p.ativo ? (
                      <Pastilha estado="neutro">Inativa</Pastilha>
                    ) : p.consentimento_vigente ? (
                      <Pastilha estado="ok">Consentimento ativo</Pastilha>
                    ) : (
                      <Pastilha estado="aviso">Sem consentimento</Pastilha>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {p.consentimento_vigente ? (
                      <button className="pequeno perigo" onClick={() => revogar(p)}>
                        Revogar
                      </button>
                    ) : (
                      <button
                        className="pequeno"
                        onClick={() =>
                          void agir(
                            () => api.consentir(p.id, VERSAO_TERMO),
                            `Consentimento registrado para ${p.nome}.`,
                          )
                        }
                      >
                        Registrar consentimento
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Aviso>
        O <b>cadastro do rosto</b> não acontece aqui: o embedding é calculado no
        tablet, que tem a câmera e o modelo. Esta tela controla quem existe e
        quem consentiu — e o consentimento é pré-requisito, o servidor recusa
        cadastrar biometria sem ele.
      </Aviso>

      <div className="filtros">
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
