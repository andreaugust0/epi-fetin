import { useCallback, useEffect, useState } from 'react';
import { mdiAccountPlusOutline, mdiPencilOutline } from '@mdi/js';
import { api, ErroApi, type Pessoa } from '../api/cliente';
import { FichaPessoa } from '../componentes/FichaPessoa';
import { Aviso, Campo, Icone, Pastilha, type Estado } from '../componentes/basicos';

const POR_PAGINA = 25;

type Filtro = 'ativos' | 'inativos' | 'todos';

const FILTROS: { chave: Filtro; rotulo: string }[] = [
  { chave: 'ativos', rotulo: 'Ativos' },
  { chave: 'inativos', rotulo: 'Inativos' },
  { chave: 'todos', rotulo: 'Todos' },
];

/**
 * O que a coluna "Cadastro facial" mostra.
 *
 * O consentimento vive AQUI, e não numa coluna própria de "situação".
 *
 * Ele não é um atributo da pessoa — é a autorização para guardar a biometria
 * dela (LGPD, art. 11), e só significa alguma coisa em relação ao rosto. Numa
 * coluna separada, "Sem consentimento" aparecia em vinte linhas seguidas de
 * gente recém-cadastrada, com cara de pendência do cadastro: a tela gritava
 * sobre algo que ninguém tinha deixado de fazer, e a palavra "situação"
 * passava a significar duas coisas ao mesmo tempo (vínculo e autorização).
 *
 * Aqui ele é o que de fato é: o primeiro dos dois passos que faltam para a
 * pessoa ser reconhecida na portaria.
 */
function estadoFacial(p: Pessoa): { estado: Estado; texto: string; nota: string } {
  if (p.biometrias === 0 && !p.consentimento_vigente) {
    return {
      estado: 'neutro',
      texto: 'Termo pendente',
      nota: 'Falta o consentimento antes de cadastrar o rosto.',
    };
  }
  if (p.biometrias === 0) {
    return {
      estado: 'aviso',
      texto: 'Sem rosto',
      nota: 'Termo registrado; faltam as fotos.',
    };
  }
  if (p.biometrias < 3) {
    return {
      estado: 'aviso',
      texto: `${p.biometrias} captura${p.biometrias === 1 ? '' : 's'}`,
      nota: 'O recomendado são 3, em ângulos e iluminações diferentes.',
    };
  }
  return {
    estado: 'ok',
    texto: `${p.biometrias} capturas`,
    nota: 'Pronta para ser reconhecida na portaria.',
  };
}

const formatarDia = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR') : '—';

export function Pessoas() {
  const [itens, setItens] = useState<Pessoa[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('ativos');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  /**
   * Ficha aberta: `undefined` = nenhuma, `null` = cadastro novo, objeto =
   * edição daquela pessoa. Três estados num campo só porque são de fato
   * exclusivos — dois booleanos permitiriam "cadastrando e editando".
   */
  const [ficha, setFicha] = useState<Pessoa | null | undefined>(undefined);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const p = await api.pessoas({
        busca: busca || undefined,
        ativo: filtro === 'todos' ? undefined : filtro === 'ativos',
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
  }, [busca, filtro, pagina]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const ultimaPagina = Math.max(0, Math.ceil(total / POR_PAGINA) - 1);
  const pendentes = itens.filter((p) => p.ativo && p.biometrias === 0).length;

  return (
    <>
      <div className="cabecalho">
        <div>
          <p className="eyebrow">Cadastro</p>
          <h1>Pessoas</h1>
          <p className="subtitulo">
            {total} {filtro === 'inativos' ? 'inativo' : 'cadastrado'}
            {total === 1 ? '' : 's'}
            {pendentes > 0 ? (
              <>
                {' · '}
                <b>{pendentes}</b> nesta página ainda não {pendentes === 1 ? 'passa' : 'passam'}{' '}
                na portaria
              </>
            ) : null}
          </p>
        </div>
        {/*
          Um botão, uma ação. Ele alternava entre "Novo funcionário" e
          "Fechar ficha", e a ficha já tem o próprio "Fechar" — eram dois
          botões de fechar lado a lado dizendo a mesma coisa.
        */}
        <button className="primario" onClick={() => setFicha(null)}>
          <Icone caminho={mdiAccountPlusOutline} />
          Novo funcionário
        </button>
      </div>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      {ficha !== undefined ? (
        <FichaPessoa
          // Trocar de pessoa precisa REMONTAR o componente: sem a key, o
          // React reaproveita a instância e os campos continuariam com os
          // dados de quem estava aberto antes.
          key={ficha?.id ?? 'nova'}
          pessoa={ficha}
          aoFechar={() => setFicha(undefined)}
          aoMudar={() => void carregar()}
        />
      ) : null}

      <div className="filtros">
        <Campo rotulo="Buscar">
          <input
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setPagina(0);
            }}
            placeholder="nome, registro ou setor"
            style={{ minWidth: 240 }}
          />
        </Campo>
        <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-end' }}>
          {FILTROS.map((f) => (
            <button
              key={f.chave}
              className={f.chave === filtro ? 'primario pequeno' : 'pequeno'}
              onClick={() => {
                setFiltro(f.chave);
                setPagina(0);
              }}
            >
              {f.rotulo}
            </button>
          ))}
        </div>
      </div>

      <div className="rolagem">
        <table>
          <thead>
            <tr>
              <th>Funcionário</th>
              <th>Função</th>
              <th>Setor</th>
              <th>Admissão</th>
              <th>Cadastro facial</th>
              <th>Situação</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {itens.length === 0 && !carregando ? (
              <tr>
                <td colSpan={7} className="vazio">
                  Nenhuma pessoa encontrada.
                </td>
              </tr>
            ) : (
              itens.map((p) => {
                const facial = estadoFacial(p);
                return (
                  <tr key={p.id}>
                    <td>
                      <div>{p.nome}</div>
                      <span className="mono" style={{ color: 'var(--slate-400)', fontSize: 12 }}>
                        {/* O registro é o identificador do RH; o id
                            interno é por onde a pessoa aparece no log do
                            servidor, e é o que o suporte pede. */}
                        {p.matricula ? `${p.matricula} · ` : ''}#{p.id}
                      </span>
                    </td>
                    <td>{p.funcao ?? '—'}</td>
                    <td>{p.setor ?? '—'}</td>
                    <td>{formatarDia(p.admitido_em)}</td>
                    <td>
                      <span title={facial.nota}>
                        <Pastilha estado={facial.estado}>{facial.texto}</Pastilha>
                      </span>
                    </td>
                    <td>
                      <Pastilha estado={p.ativo ? 'ok' : 'neutro'}>
                        {p.ativo ? 'Ativo' : 'Inativo'}
                      </Pastilha>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="pequeno" onClick={() => setFicha(p)}>
                        <Icone caminho={mdiPencilOutline} />
                        Abrir ficha
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Aviso>
        A <b>ficha</b> reúne os três passos do cadastro: dados, termo de
        consentimento e fotos. A foto enviada vira vetor no servidor e é
        descartada na hora — nenhuma imagem fica guardada, nem em disco, nem no
        banco, nem no bucket. Desativar alguém preserva todo o histórico de
        passagens; para eliminar a biometria, o caminho é revogar o termo.
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
