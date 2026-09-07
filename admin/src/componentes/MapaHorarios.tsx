import { useId, useState } from 'react';

export interface CelulaHorario {
  /** 0 = domingo, no padrão do PostgreSQL. */
  dia_semana: number;
  hora: number;
  total: number;
  bloqueios: number;
  taxa_bloqueio: number | null;
}

interface Props {
  celulas: CelulaHorario[];
  fuso: string;
}

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/**
 * Rampa de um hue só, clara → escura, validada com
 * `validate_palette.js --ordinal` contra a superfície branca dos cartões:
 * monotônica, degraus visíveis (ΔL ≥ 0.06) e o extremo claro em 2.77:1.
 *
 * Vermelho porque a medida É calor no sentido literal do termo: o valor
 * alto é o problema. Um ramp azul aqui exigiria do leitor traduzir "azul
 * escuro = ruim", que é exatamente o trabalho que a cor deveria poupar.
 */
const RAMPA = ['#f87171', '#ef4444', '#b91c1c', '#7f1d1d'];

/** Faixas da rampa, em pontos percentuais de bloqueio. */
const FAIXAS = [10, 25, 50];

const ESPACO = 2;
const LARGURA_ROTULO = 38;

/**
 * Lado da célula, conforme quantas horas têm movimento.
 *
 * Uma fábrica de turno único enche cinco horas do dia. Com célula fixa de
 * 26px isso dava uma grade de 180px encolhida num canto de um cartão de mil
 * — o gráfico parecia um erro de layout. Com 24 colunas, ao contrário, 26px
 * já é o limite antes de estourar a largura.
 *
 * Então a célula cresce quando há poucas colunas e encolhe quando há muitas,
 * mirando uns 560px de grade. Não é esticar: a célula continua quadrada e a
 * escala é a mesma para todas.
 */
const ladoDaCelula = (colunas: number): number =>
  Math.round(Math.min(54, Math.max(26, 560 / colunas)));

/**
 * Zero bloqueios NÃO recebe cor da rampa.
 *
 * Se recebesse o degrau mais claro, uma hora impecável apareceria
 * levemente avermelhada — a cor diria "um pouquinho de problema" onde não
 * houve problema nenhum. Cinza neutro diz o que aconteceu: passou gente,
 * ninguém foi barrado.
 */
const SEM_BLOQUEIO = 'var(--slate-100)';

/** Sem verificação nenhuma: a célula fica vazia, não cinza. */
const SEM_DADO = 'transparent';

/**
 * Abaixo disto a célula NÃO recebe cor de taxa.
 *
 * Uma quarta-feira às 15h com cinco passagens e três bloqueios dá 60% — o
 * degrau mais escuro da rampa, o mesmo tom do início de turno onde cem
 * pessoas passam e vinte são barradas. Os dois quadrados ficam idênticos, e
 * um deles é uma coincidência de três eventos.
 *
 * O corte não é um número escolhido a dedo: é o tamanho a partir do qual UM
 * bloqueio isolado ainda cai na faixa mais clara. Com a primeira faixa em
 * 10%, são dez passagens. Abaixo disso, um único azar já promove a célula de
 * degrau, e a cor passa a relatar sorte em vez de rotina — e se as faixas
 * mudarem, o mínimo acompanha sozinho.
 *
 * O mapa não tem como mostrar incerteza com a cor: cor aqui é magnitude, e
 * qualquer tom que essa célula receba afirma alguma coisa. Então ela não
 * recebe tom nenhum — fica hachurada, dizendo "passou gente, não dá para
 * concluir", e o número exato continua no tooltip para quem quiser ver.
 */
const MINIMO_AMOSTRA = Math.ceil(100 / (FAIXAS[0] as number));

const corDe = (c: CelulaHorario, hachura: string): string => {
  if (c.total === 0) return SEM_DADO;
  if (c.total < MINIMO_AMOSTRA) return hachura;
  const taxa = c.taxa_bloqueio ?? 0;
  if (taxa === 0) return SEM_BLOQUEIO;
  const i = FAIXAS.findIndex((limite) => taxa < limite);
  return RAMPA[i === -1 ? RAMPA.length - 1 : i] as string;
};

/**
 * Mapa de calor de reprovações por hora e dia da semana.
 *
 * É o gráfico que transforma um número em ação. "18% de reprovação" não diz
 * o que fazer; "quase todas as reprovações acontecem entre 7h e 7h30, de
 * segunda a sexta" diz: o problema é a rotina de início de turno, não as
 * pessoas — e a resposta é onde os equipamentos ficam guardados, não uma
 * advertência.
 */
export function MapaHorarios({ celulas, fuso }: Props) {
  const [ativo, setAtivo] = useState<CelulaHorario | null>(null);
  const [tabela, setTabela] = useState(false);
  const idTitulo = useId();
  // `useId` devolve algo como `:r3:`, e dois-pontos quebram `url(#...)`.
  const idHachura = `hachura${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const hachura = `url(#${idHachura})`;

  const comMovimento = celulas.filter((c) => c.total > 0);
  if (comMovimento.length === 0) {
    return <div className="vazio">Nenhuma verificação no período.</div>;
  }

  // Só as horas com movimento: uma grade de 24 colunas com trabalho das 7 às
  // 17 seria mais de metade de vazio, e o vazio empurraria os dados para um
  // canto.
  const horas = [...new Set(comMovimento.map((c) => c.hora))].sort((a, b) => a - b);
  const porChave = new Map(comMovimento.map((c) => [`${c.dia_semana}-${c.hora}`, c]));

  if (tabela) {
    return (
      <>
        <div className="rolagem">
          <table>
            <thead>
              <tr>
                <th>Dia</th>
                <th className="num">Hora</th>
                <th className="num">Verificações</th>
                <th className="num">Bloqueios</th>
                <th className="num">Taxa</th>
              </tr>
            </thead>
            <tbody>
              {/*
                Ordena pela mesma regra do mapa: as células de amostra curta
                vão para o fim. Ordenar por taxa crua colocaria "1 de 1 =
                100%" no topo da tabela — o mesmo engano que a hachura evita
                no mapa, reintroduzido pela ordenação.
              */}
              {[...comMovimento]
                .sort((a, b) => {
                  const ta = a.total < MINIMO_AMOSTRA ? -1 : (a.taxa_bloqueio ?? 0);
                  const tb = b.total < MINIMO_AMOSTRA ? -1 : (b.taxa_bloqueio ?? 0);
                  return tb - ta;
                })
                .map((c) => (
                  <tr key={`${c.dia_semana}-${c.hora}`}>
                    <td>{DIAS[c.dia_semana]}</td>
                    <td className="num">{String(c.hora).padStart(2, '0')}h</td>
                    <td className="num">{c.total}</td>
                    <td className="num">{c.bloqueios}</td>
                    <td className="num">
                      {c.total < MINIMO_AMOSTRA ? (
                        <span title={`menos de ${MINIMO_AMOSTRA} passagens`}>—</span>
                      ) : (
                        `${c.taxa_bloqueio ?? 0}%`
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <button className="pequeno" onClick={() => setTabela(false)}>
          Ver como mapa
        </button>
      </>
    );
  }

  const CELULA = ladoDaCelula(horas.length);

  /*
   * Colunas de horas não contíguas ganham uma folga entre elas.
   *
   * O eixo mostra só as horas com movimento, então num turno único ele lê
   * "07 13 14 15 16" — e coladas, sem folga, essas colunas dizem que 7h e
   * 13h são vizinhas. São seis horas de intervalo. A folga não tenta ser
   * proporcional ao buraco (isso devolveria as dez colunas vazias que o
   * recorte existe para evitar); ela só marca que ali há um salto.
   */
  const VAO = Math.round(CELULA * 0.45);
  const deslocamentos = horas.map((_, i) =>
    horas.slice(0, i).reduce(
      (acc, h, j) => acc + CELULA + ESPACO + (horas[j + 1]! - h > 1 ? VAO : 0),
      0,
    ),
  );
  const colunaX = (i: number) => LARGURA_ROTULO + (deslocamentos[i] as number);
  const largura =
    LARGURA_ROTULO + (deslocamentos[horas.length - 1] as number) + CELULA + ESPACO;
  const altura = 18 + DIAS.length * (CELULA + ESPACO);

  return (
    <>
      <div style={{ position: 'relative' }} className="rolagem">
        <svg
          viewBox={`0 0 ${largura} ${altura}`}
          width={largura}
          role="img"
          aria-labelledby={idTitulo}
          style={{ display: 'block', maxWidth: '100%' }}
        >
          <title id={idTitulo}>
            Bloqueios por hora e dia da semana, fuso {fuso}
          </title>

          <defs>
            <pattern
              id={idHachura}
              width={5}
              height={5}
              patternTransform="rotate(45)"
              patternUnits="userSpaceOnUse"
            >
              <rect width={5} height={5} fill="var(--slate-100)" />
              <line
                x1={0}
                y1={0}
                x2={0}
                y2={5}
                stroke="var(--slate-300)"
                strokeWidth={1.5}
              />
            </pattern>
          </defs>

          {horas.map((h, i) => (
            <text
              key={h}
              x={colunaX(i) + CELULA / 2}
              y={11}
              textAnchor="middle"
              fontSize={10}
              fill="var(--slate-400)"
            >
              {String(h).padStart(2, '0')}
            </text>
          ))}

          {DIAS.map((nome, dow) => (
            <g key={nome}>
              <text
                x={0}
                y={18 + dow * (CELULA + ESPACO) + CELULA / 2 + 4}
                fontSize={11}
                fill="var(--slate-500)"
              >
                {nome}
              </text>
              {horas.map((h, i) => {
                const c = porChave.get(`${dow}-${h}`);
                const dados: CelulaHorario = c ?? {
                  dia_semana: dow,
                  hora: h,
                  total: 0,
                  bloqueios: 0,
                  taxa_bloqueio: null,
                };
                const destacada =
                  ativo?.dia_semana === dow && ativo?.hora === h;
                return (
                  <rect
                    key={h}
                    x={colunaX(i)}
                    y={18 + dow * (CELULA + ESPACO)}
                    width={CELULA}
                    height={CELULA}
                    rx={4}
                    fill={corDe(dados, hachura)}
                    stroke={destacada ? 'var(--slate-900)' : 'none'}
                    strokeWidth={destacada ? 2 : 0}
                    tabIndex={dados.total > 0 ? 0 : -1}
                    onPointerEnter={() => setAtivo(dados.total > 0 ? dados : null)}
                    onPointerLeave={() => setAtivo(null)}
                    onFocus={() => setAtivo(dados.total > 0 ? dados : null)}
                    onBlur={() => setAtivo(null)}
                    style={{ cursor: dados.total > 0 ? 'default' : 'default' }}
                  />
                );
              })}
            </g>
          ))}
        </svg>

        {ativo ? (
          <div
            role="status"
            style={{
              position: 'absolute',
              left: 12,
              top: 0,
              background: 'var(--slate-900)',
              color: '#fff',
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 12,
              lineHeight: 1.5,
              pointerEvents: 'none',
              boxShadow: 'var(--sh-md)',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              {ativo.bloqueios} bloqueio{ativo.bloqueios === 1 ? '' : 's'}
            </div>
            <div style={{ opacity: 0.75 }}>
              {DIAS[ativo.dia_semana]} · {String(ativo.hora).padStart(2, '0')}h ·{' '}
              {ativo.total} verificaç{ativo.total === 1 ? 'ão' : 'ões'}
              {ativo.total < MINIMO_AMOSTRA
                ? null
                : ` (${ativo.taxa_bloqueio ?? 0}%)`}
            </div>
            {ativo.total < MINIMO_AMOSTRA ? (
              <div style={{ opacity: 0.75 }}>
                poucas passagens para uma taxa
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 12,
          flexWrap: 'wrap',
          fontSize: 12,
          color: 'var(--slate-500)',
        }}
      >
        <span>Taxa de bloqueio</span>
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: 4,
            background: 'var(--slate-100)',
            display: 'inline-block',
          }}
        />
        <span>nenhum</span>
        {RAMPA.map((cor, i) => (
          <span key={cor} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 4,
                background: cor,
                display: 'inline-block',
              }}
            />
            {i === 0
              ? `até ${FAIXAS[0]}%`
              : i === RAMPA.length - 1
                ? `${FAIXAS[FAIXAS.length - 1]}%+`
                : `${FAIXAS[i - 1]}–${FAIXAS[i]}%`}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <svg width={14} height={14} aria-hidden="true" style={{ display: 'block' }}>
            <defs>
              <pattern
                id={`${idHachura}L`}
                width={5}
                height={5}
                patternTransform="rotate(45)"
                patternUnits="userSpaceOnUse"
              >
                <rect width={5} height={5} fill="var(--slate-100)" />
                <line x1={0} y1={0} x2={0} y2={5} stroke="var(--slate-300)" strokeWidth={1.5} />
              </pattern>
            </defs>
            <rect width={14} height={14} rx={4} fill={`url(#${idHachura}L)`} />
          </svg>
          menos de {MINIMO_AMOSTRA} passagens
        </span>
        <button className="pequeno" onClick={() => setTabela(true)} style={{ marginLeft: 'auto' }}>
          Ver como tabela
        </button>
      </div>
    </>
  );
}
