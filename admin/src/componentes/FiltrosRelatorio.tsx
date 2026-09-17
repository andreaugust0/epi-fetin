import { useEffect, useRef, useState } from 'react';
import { mdiClose } from '@mdi/js';
import { api, type AnalyticsOpcoes, type FiltrosAnalytics, type Pessoa } from '../api/cliente';
import { Campo, Icone, Pastilha } from './basicos';

/** Estado do formulário de filtros — datas como string `yyyy-mm-dd`, o
 * formato nativo de `<input type="date">`; tudo mais como IDs em texto,
 * porque é o que um `<select>` devolve. */
export interface FiltrosEstado {
  desde: string;
  ate: string;
  pontoId: string;
  situacao: string;
  setor: string;
  tipoEpi: string;
  versaoModelo: string;
  pessoaId: string;
  pessoaRotulo: string;
}

/**
 * Data local do navegador, no formato `yyyy-mm-dd` que `<input type="date">`
 * usa.
 *
 * `d.toISOString()` estava aqui antes, e é o bug clássico: ela devolve a
 * data em UTC, não a data local. Depois das 21h em São Paulo (UTC-3), o
 * relógio já virou o dia em UTC — então "hoje" calculado assim vira amanhã,
 * e os atalhos de 7/30/90 dias passam a cobrir uma janela inteira deslocada
 * para a frente bem nas horas em que mais gente passa pela portaria.
 */
const paraEntradaData = (d: Date): string => {
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
};

/** 30 dias (hoje incluso) é o padrão ao abrir a página — o mesmo recorte do
 * painel executivo, para os dois não começarem contando histórias diferentes. */
export function filtrosIniciais(dias = 30): FiltrosEstado {
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - (dias - 1));
  return {
    desde: paraEntradaData(inicio),
    ate: paraEntradaData(hoje),
    pontoId: '',
    situacao: '',
    setor: '',
    tipoEpi: '',
    versaoModelo: '',
    pessoaId: '',
    pessoaRotulo: '',
  };
}

/**
 * Converte o formulário nos parâmetros que a API espera.
 *
 * `desde`/`ate` viajam como data pura (`yyyy-mm-dd`), sem hora nem fuso — é
 * o próprio servidor que decide o que "o dia 17" significa em segundos UTC,
 * usando o fuso de exibição configurado nele (`TZ_EXIBICAO`). Construir o
 * limite UTC aqui no navegador era o bug antigo: `T00:00:00Z`/`T23:59:59Z`
 * ignoravam que o servidor exibe em UTC-3, e cortavam as últimas ~3 horas de
 * cada dia local para o dia seguinte.
 */
export function paraConsulta(f: FiltrosEstado): FiltrosAnalytics {
  return {
    desde: f.desde || undefined,
    ate: f.ate || undefined,
    ponto_id: f.pontoId ? Number(f.pontoId) : undefined,
    situacao: f.situacao || undefined,
    setor: f.setor || undefined,
    tipo_epi: f.tipoEpi || undefined,
    pessoa_id: f.pessoaId ? Number(f.pessoaId) : undefined,
    versao_modelo: f.versaoModelo || undefined,
  };
}

export const SITUACOES_ROTULO: Record<string, string> = {
  APROVADA: 'Aprovada',
  REPROVADA: 'Reprovada',
  EXPIRADA: 'Expirada',
  AGUARDANDO_ANALISE: 'Analisando',
  ERRO: 'Com erro',
};

const ATALHOS = [7, 30, 90];

interface Props {
  filtros: FiltrosEstado;
  opcoes: AnalyticsOpcoes | null;
  aoMudar(patch: Partial<FiltrosEstado>): void;
  aoLimpar(): void;
}

export function FiltrosRelatorio({ filtros, opcoes, aoMudar, aoLimpar }: Props) {
  const aplicarAtalho = (dias: number) => {
    const padrao = filtrosIniciais(dias);
    aoMudar({ desde: padrao.desde, ate: padrao.ate });
  };

  const ativos: { rotulo: string; remover: () => void }[] = [];
  if (filtros.pontoId) {
    const nome =
      opcoes?.pontos.find((p) => String(p.id) === filtros.pontoId)?.nome ?? filtros.pontoId;
    ativos.push({ rotulo: `Ponto: ${nome}`, remover: () => aoMudar({ pontoId: '' }) });
  }
  if (filtros.situacao) {
    ativos.push({
      rotulo: `Situação: ${SITUACOES_ROTULO[filtros.situacao] ?? filtros.situacao}`,
      remover: () => aoMudar({ situacao: '' }),
    });
  }
  if (filtros.setor) {
    ativos.push({ rotulo: `Setor: ${filtros.setor}`, remover: () => aoMudar({ setor: '' }) });
  }
  if (filtros.tipoEpi) {
    const rotulo = opcoes?.tipos_epi.find((t) => t.codigo === filtros.tipoEpi)?.rotulo ?? filtros.tipoEpi;
    ativos.push({
      rotulo: `EPI inspecionado: ${rotulo}`,
      remover: () => aoMudar({ tipoEpi: '' }),
    });
  }
  if (filtros.versaoModelo) {
    ativos.push({
      rotulo: `Modelo: ${filtros.versaoModelo}`,
      remover: () => aoMudar({ versaoModelo: '' }),
    });
  }
  if (filtros.pessoaId) {
    ativos.push({
      rotulo: `Pessoa: ${filtros.pessoaRotulo}`,
      remover: () => aoMudar({ pessoaId: '', pessoaRotulo: '' }),
    });
  }

  return (
    <div className="cartao" style={{ marginBottom: 20 }}>
      <div className="filtros" style={{ marginBottom: ativos.length ? 12 : 0 }}>
        <Campo rotulo="De">
          <input
            type="date"
            value={filtros.desde}
            max={filtros.ate || undefined}
            onChange={(e) => aoMudar({ desde: e.target.value })}
          />
        </Campo>
        <Campo rotulo="Até">
          <input
            type="date"
            value={filtros.ate}
            min={filtros.desde || undefined}
            onChange={(e) => aoMudar({ ate: e.target.value })}
          />
        </Campo>
        <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-end', paddingBottom: 1 }}>
          {ATALHOS.map((d) => (
            <button key={d} type="button" className="pequeno" onClick={() => aplicarAtalho(d)}>
              {d}d
            </button>
          ))}
        </div>

        <Campo rotulo="Ponto de acesso">
          <select value={filtros.pontoId} onChange={(e) => aoMudar({ pontoId: e.target.value })}>
            <option value="">Todos</option>
            {(opcoes?.pontos ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </Campo>

        <Campo rotulo="Situação">
          <select value={filtros.situacao} onChange={(e) => aoMudar({ situacao: e.target.value })}>
            <option value="">Todas</option>
            {(opcoes?.situacoes ?? []).map((s) => (
              <option key={s} value={s}>
                {SITUACOES_ROTULO[s] ?? s}
              </option>
            ))}
          </select>
        </Campo>

        <Campo rotulo="Setor">
          <select value={filtros.setor} onChange={(e) => aoMudar({ setor: e.target.value })}>
            <option value="">Todos</option>
            {(opcoes?.setores ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Campo>

        {/* "Inspecionado", não "ausente": o filtro casa qualquer verificação em
            que este EPI foi checado, esteja presente ou faltando — não só as
            que reprovaram por causa dele. O rótulo existe para não deixar
            isso subentendido. */}
        <Campo rotulo="EPI inspecionado">
          <select value={filtros.tipoEpi} onChange={(e) => aoMudar({ tipoEpi: e.target.value })}>
            <option value="">Todos</option>
            {(opcoes?.tipos_epi ?? []).map((t) => (
              <option key={t.codigo} value={t.codigo}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </Campo>

        {/* Só aparece com duas versões ou mais — com uma só não há o que
            comparar, e o filtro seria um combo sempre com a mesma opção. */}
        {(opcoes?.versoes_modelo.length ?? 0) >= 2 ? (
          <Campo rotulo="Versão do modelo">
            <select
              value={filtros.versaoModelo}
              onChange={(e) => aoMudar({ versaoModelo: e.target.value })}
            >
              <option value="">Todas</option>
              {(opcoes?.versoes_modelo ?? []).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Campo>
        ) : null}

        <SeletorPessoa
          pessoaId={filtros.pessoaId}
          rotulo={filtros.pessoaRotulo}
          aoEscolher={(id, rotulo) => aoMudar({ pessoaId: id, pessoaRotulo: rotulo })}
        />

        <button type="button" className="pequeno" onClick={aoLimpar} style={{ alignSelf: 'flex-end' }}>
          Limpar filtros
        </button>
      </div>

      {ativos.length > 0 ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {ativos.map((a) => (
            <button
              key={a.rotulo}
              type="button"
              onClick={a.remover}
              style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}
              aria-label={`remover filtro ${a.rotulo}`}
            >
              <Pastilha estado="info">
                {a.rotulo}
                <Icone caminho={mdiClose} tamanho={12} />
              </Pastilha>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Campo de pessoa: busca por nome/registro em vez de um combo com todo
 * mundo cadastrado — a base pode ter milhares de pessoas, e um `<select>`
 * com todas seria tanto lento quanto inútil de rolar.
 */
function SeletorPessoa({
  pessoaId,
  rotulo,
  aoEscolher,
}: {
  pessoaId: string;
  rotulo: string;
  aoEscolher: (id: string, rotulo: string) => void;
}) {
  const [busca, setBusca] = useState(rotulo);
  const [sugestoes, setSugestoes] = useState<Pessoa[]>([]);
  const [aberto, setAberto] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Duas teclas digitadas com menos de 300ms de intervalo entre si podem ter
  // as duas buscas em voo ao mesmo tempo; sem isto, a resposta da busca MAIS
  // ANTIGA pode chegar depois e substituir sugestões já mais recentes.
  const buscaAtual = useRef(0);

  useEffect(() => setBusca(rotulo), [rotulo]);

  function aoDigitar(valor: string) {
    setBusca(valor);
    if (pessoaId) aoEscolher('', '');
    if (temporizador.current) clearTimeout(temporizador.current);
    if (valor.trim().length < 2) {
      setSugestoes([]);
      return;
    }
    temporizador.current = setTimeout(() => {
      const idDestaBusca = ++buscaAtual.current;
      api
        .pessoas({ busca: valor.trim(), limite: 8 })
        .then((pagina) => {
          if (idDestaBusca !== buscaAtual.current) return;
          setSugestoes(pagina.itens);
          setAberto(true);
        })
        .catch(() => {
          if (idDestaBusca === buscaAtual.current) setSugestoes([]);
        });
    }, 300);
  }

  return (
    <Campo rotulo="Pessoa">
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          placeholder="Nome ou registro…"
          value={busca}
          onChange={(e) => aoDigitar(e.target.value)}
          onFocus={() => sugestoes.length > 0 && setAberto(true)}
          onBlur={() => setTimeout(() => setAberto(false), 150)}
        />
        {aberto && sugestoes.length > 0 ? (
          <div
            className="cartao"
            style={{
              position: 'absolute',
              zIndex: 5,
              top: '100%',
              left: 0,
              right: 0,
              marginTop: 4,
              padding: 6,
              maxHeight: 220,
              overflowY: 'auto',
              minWidth: 220,
            }}
          >
            {sugestoes.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  aoEscolher(String(p.id), p.nome);
                  setBusca(p.nome);
                  setAberto(false);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  border: 'none',
                  background: 'none',
                  padding: '6px 8px',
                  cursor: 'pointer',
                  fontSize: 13,
                  borderRadius: 'var(--r-sm)',
                }}
              >
                {p.nome}
                {p.matricula ? (
                  <span className="mono" style={{ color: 'var(--slate-400)' }}>
                    {' '}
                    · {p.matricula}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </Campo>
  );
}
