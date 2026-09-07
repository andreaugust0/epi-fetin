import { useState, type FormEvent } from 'react';
import {
  mdiAccountOutline,
  mdiCameraOutline,
  mdiCheck,
  mdiClose,
  mdiFileDocumentOutline,
} from '@mdi/js';
import { api, ErroApi, type Pessoa } from '../api/cliente';
import { CadastroRosto } from './CadastroRosto';
import { Aviso, Campo, Icone, Pastilha } from './basicos';

/** Versão do termo que o painel apresenta hoje. */
export const VERSAO_TERMO = '1.0';

/**
 * Finalidade declarada, que vai gravada junto do consentimento.
 *
 * A LGPD (art. 9º, I) exige finalidade *específica*: "para uso do sistema"
 * não é finalidade, é evasiva. Se amanhã a empresa quiser usar o mesmo rosto
 * para marcar ponto, isto aqui é o registro de que a pessoa não consentiu com
 * aquilo — e é preciso colher de novo.
 */
export const FINALIDADE =
  'Identificar o funcionário na portaria para verificar o uso de EPI antes ' +
  'de liberar a catraca.';

interface Dados {
  matricula: string;
  nome: string;
  funcao: string;
  setor: string;
  admitido_em: string;
  ativo: boolean;
}

const vazio: Dados = {
  matricula: '',
  nome: '',
  funcao: '',
  setor: '',
  admitido_em: '',
  ativo: true,
};

const dePessoa = (p: Pessoa): Dados => ({
  matricula: p.matricula ?? '',
  nome: p.nome,
  funcao: p.funcao ?? '',
  setor: p.setor ?? '',
  admitido_em: p.admitido_em ?? '',
  ativo: p.ativo,
});

/** Campo em branco vira `null`, não string vazia. */
const ou = (s: string): string | null => s.trim() || null;

type Passo = 1 | 2 | 3;

function Cabecalho({
  numero,
  atual,
  concluido,
  titulo,
  icone,
  onClick,
}: {
  numero: Passo;
  atual: Passo;
  concluido: boolean;
  titulo: string;
  icone: string;
  onClick?: () => void;
}) {
  const ativo = numero === atual;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        border: 'none',
        background: 'transparent',
        padding: '4px 0',
        cursor: onClick ? 'pointer' : 'default',
        color: ativo ? 'var(--slate-900)' : 'var(--slate-500)',
        fontWeight: ativo ? 700 : 500,
        fontSize: 14,
      }}
    >
      <span
        style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          background: concluido
            ? 'var(--ok-bg)'
            : ativo
              ? 'var(--primary)'
              : 'var(--slate-100)',
          color: concluido ? 'var(--ok-text)' : ativo ? '#fff' : 'var(--slate-500)',
        }}
      >
        {concluido ? <Icone caminho={mdiCheck} tamanho={15} /> : <Icone caminho={icone} tamanho={15} />}
      </span>
      {titulo}
    </button>
  );
}

/**
 * Ficha do funcionário: um fluxo em três passos, não um formulário de duas
 * caixas.
 *
 * O cadastro antigo pedia nome e função e acabava ali — e o resto (termo,
 * foto) ficava espalhado em botões na linha da tabela, cada um uma decisão
 * solta. Quem preenche isto é o RH, admitindo alguém: os três passos são a
 * ordem real dos fatos, e cada um só fica disponível quando o anterior torna
 * possível executá-lo (não dá para colher rosto de quem ainda não existe no
 * banco, nem gravar biometria sem consentimento).
 *
 * O passo 3 pode ficar pendente de propósito. Cadastro costuma acontecer
 * antes de a pessoa aparecer, e travar o RH até ela chegar faria o cadastro
 * ser feito de qualquer jeito depois — ou não ser feito. A lista mostra quem
 * ficou sem rosto.
 */
export function FichaPessoa({
  pessoa,
  aoFechar,
  aoMudar,
}: {
  /** `null` = cadastro novo. */
  pessoa: Pessoa | null;
  aoFechar: () => void;
  /** Avisa a lista para recarregar. */
  aoMudar: () => void;
}) {
  const [dados, setDados] = useState<Dados>(pessoa ? dePessoa(pessoa) : vazio);
  const [criada, setCriada] = useState<Pessoa | null>(pessoa);
  const [passo, setPasso] = useState<Passo>(1);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const editando = pessoa !== null;
  const temConsentimento = criada?.consentimento_vigente ?? false;
  const capturas = criada?.biometrias ?? 0;

  function campo<K extends keyof Dados>(chave: K, valor: Dados[K]) {
    setDados((d) => ({ ...d, [chave]: valor }));
  }

  async function salvarDados(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setOk(null);
    setSalvando(true);
    try {
      const corpo = {
        nome: dados.nome.trim(),
        funcao: ou(dados.funcao),
        setor: ou(dados.setor),
        admitido_em: ou(dados.admitido_em),
        matricula: ou(dados.matricula),
        ativo: dados.ativo,
      };
      const p = criada
        ? await api.editarPessoa(criada.id, corpo)
        : await api.criarPessoa(corpo);
      setCriada(p);
      setDados(dePessoa(p));
      aoMudar();
      // Sem concordância de gênero: o cadastro não guarda o gênero da
      // pessoa, e "cadastrado" errava metade das vezes.
      setOk(criada ? 'Dados atualizados.' : `Cadastro de ${p.nome} criado.`);
      setPasso(2);
    } catch (e2) {
      setErro(e2 instanceof ErroApi ? e2.message : 'Falha ao salvar.');
    } finally {
      setSalvando(false);
    }
  }

  async function consentir() {
    if (!criada) return;
    setErro(null);
    try {
      await api.consentir(criada.id, VERSAO_TERMO);
      setCriada({ ...criada, consentimento_vigente: true });
      aoMudar();
      setOk('Termo registrado.');
      setPasso(3);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Falha ao registrar o termo.');
    }
  }

  async function revogar() {
    if (!criada) return;
    const confirmado = window.confirm(
      `Revogar o consentimento de ${criada.nome}?\n\n` +
        `Isso APAGA os ${criada.biometrias} vetor(es) faciais dela, de forma ` +
        `permanente. A pessoa deixa de ser reconhecida no terminal até ser ` +
        `cadastrada de novo.\n\n` +
        `A eliminação do dado é o que a LGPD exige na revogação — não há ` +
        `como desfazer.`,
    );
    if (!confirmado) return;
    setErro(null);
    try {
      const r = await api.revogar(criada.id);
      setCriada({ ...criada, consentimento_vigente: false, biometrias: 0 });
      aoMudar();
      setOk(`Termo revogado. ${r.biometrias_eliminadas} vetor(es) eliminado(s).`);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Falha ao revogar.');
    }
  }

  const irPara = (n: Passo): (() => void) | undefined => {
    if (n === 1) return () => setPasso(1);
    // 2 e 3 exigem que a pessoa exista no banco: sem id não há a quem
    // vincular termo nem vetor.
    if (!criada) return undefined;
    if (n === 3 && !temConsentimento) return undefined;
    return () => setPasso(n);
  };

  return (
    <div className="cartao" style={{ marginBottom: 18 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <div>
          <b style={{ fontSize: 17, fontWeight: 700 }}>
            {editando ? `Ficha de ${pessoa.nome}` : 'Novo funcionário'}
          </b>
          {criada ? (
            <p style={{ color: 'var(--slate-500)', fontSize: 13, margin: '4px 0 0' }}>
              {criada.matricula ? `matrícula ${criada.matricula} · ` : ''}
              <span className="mono">#{criada.id}</span>
            </p>
          ) : null}
        </div>
        <button className="pequeno" onClick={aoFechar}>
          <Icone caminho={mdiClose} />
          Fechar
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 24,
          flexWrap: 'wrap',
          paddingBottom: 14,
          marginBottom: 16,
          borderBottom: '1px solid var(--slate-200)',
        }}
      >
        <Cabecalho
          numero={1}
          atual={passo}
          concluido={criada !== null}
          titulo="Dados"
          icone={mdiAccountOutline}
          onClick={irPara(1)}
        />
        <Cabecalho
          numero={2}
          atual={passo}
          concluido={temConsentimento}
          titulo="Termo de consentimento"
          icone={mdiFileDocumentOutline}
          onClick={irPara(2)}
        />
        <Cabecalho
          numero={3}
          atual={passo}
          concluido={capturas > 0}
          titulo="Fotos"
          icone={mdiCameraOutline}
          onClick={irPara(3)}
        />
      </div>

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {ok ? <Aviso tipo="ok">{ok}</Aviso> : null}

      {passo === 1 ? (
        <form onSubmit={salvarDados}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 14,
              marginBottom: 16,
            }}
          >
            <Campo rotulo="Matrícula">
              <input
                value={dados.matricula}
                onChange={(e) => campo('matricula', e.target.value)}
                placeholder="opcional"
              />
            </Campo>
            <Campo rotulo="Nome completo">
              <input
                value={dados.nome}
                onChange={(e) => campo('nome', e.target.value)}
                required
                autoFocus
              />
            </Campo>
            <Campo rotulo="Função">
              <input
                value={dados.funcao}
                onChange={(e) => campo('funcao', e.target.value)}
                placeholder="ex.: Mecânico"
              />
            </Campo>
            <Campo rotulo="Setor">
              <input
                value={dados.setor}
                onChange={(e) => campo('setor', e.target.value)}
                placeholder="ex.: Manutenção"
              />
            </Campo>
            <Campo rotulo="Admissão">
              <input
                type="date"
                value={dados.admitido_em}
                onChange={(e) => campo('admitido_em', e.target.value)}
              />
            </Campo>
          </div>

          {editando ? (
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                marginBottom: 16,
                fontSize: 13,
                color: 'var(--slate-600)',
                maxWidth: 620,
              }}
            >
              <input
                type="checkbox"
                checked={dados.ativo}
                onChange={(e) => campo('ativo', e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>
                <b>Vínculo ativo.</b> Desmarcar preserva todo o histórico de
                passagens — desligamento não apaga registro de segurança do
                trabalho. Para eliminar a biometria, revogue o termo no passo 2.
              </span>
            </label>
          ) : null}

          <button className="primario" type="submit" disabled={salvando}>
            {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Cadastrar e continuar'}
          </button>
        </form>
      ) : null}

      {passo === 2 ? (
        <>
          <Aviso>
            <b>Biometria é dado pessoal sensível</b> (LGPD, art. 11). Guardar o
            rosto de alguém exige consentimento específico, com finalidade
            declarada e revogação possível de verdade — por isso este passo não
            é uma caixinha marcada de passagem.
          </Aviso>

          <div
            style={{
              border: '1px solid var(--slate-200)',
              borderRadius: 10,
              padding: 16,
              background: 'var(--slate-50)',
              fontSize: 13,
              lineHeight: 1.65,
              color: 'var(--slate-700)',
              marginBottom: 16,
              maxWidth: 720,
            }}
          >
            <b>Termo, versão {VERSAO_TERMO}</b>
            <p style={{ margin: '8px 0 0' }}>
              <b>Finalidade:</b> {FINALIDADE}
            </p>
            <p style={{ margin: '8px 0 0' }}>
              <b>O que fica guardado:</b> um vetor numérico extraído da imagem.
              A foto não é gravada em disco, banco nem bucket — ela vira vetor
              no servidor e é descartada na hora.
            </p>
            <p style={{ margin: '8px 0 0' }}>
              <b>Revogação:</b> a qualquer momento, e apaga os vetores de
              imediato. A pessoa deixa de ser reconhecida na portaria.
            </p>
          </div>

          {temConsentimento ? (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Pastilha estado="ok">Termo registrado</Pastilha>
              <button className="primario" onClick={() => setPasso(3)}>
                Ir para as fotos
              </button>
              <button className="pequeno perigo" onClick={() => void revogar()}>
                Revogar termo
              </button>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 13, color: 'var(--slate-500)', margin: '0 0 12px' }}>
                Confirme abaixo depois que <b>{criada?.nome ?? 'o funcionário'}</b> tiver
                lido e concordado. Fica registrado quem colheu e quando.
              </p>
              <button className="primario" onClick={() => void consentir()} disabled={!criada}>
                <Icone caminho={mdiCheck} />
                Registrar consentimento
              </button>
            </>
          )}
        </>
      ) : null}

      {passo === 3 && criada ? (
        temConsentimento ? (
          <CadastroRosto
            pessoa={criada}
            embutida
            aoFechar={aoFechar}
            aoCadastrar={() => {
              setCriada((c) => (c ? { ...c, biometrias: c.biometrias + 1 } : c));
              aoMudar();
            }}
          />
        ) : (
          <Aviso tipo="atencao">
            <b>Falta o termo.</b> O servidor recusa gravar biometria sem
            consentimento vigente — volte ao passo 2.
          </Aviso>
        )
      ) : null}

      {passo === 3 ? (
        <div style={{ marginTop: 18, borderTop: '1px solid var(--slate-200)', paddingTop: 14 }}>
          <button onClick={aoFechar}>
            {capturas > 0 ? 'Concluir' : 'Salvar e cadastrar as fotos depois'}
          </button>
          {capturas === 0 ? (
            <p style={{ fontSize: 12.5, color: 'var(--slate-500)', margin: '8px 0 0' }}>
              A pessoa fica cadastrada, mas <b>não será reconhecida na portaria</b> até
              ter ao menos uma captura. A lista marca quem está assim.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
