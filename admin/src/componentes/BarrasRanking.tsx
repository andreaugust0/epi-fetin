import { useId, useState } from 'react';

export interface ItemBarra {
  rotulo: string;
  valor: number;
  /** Texto do rótulo direto à direita da barra. Ex.: "12 (18%)". */
  anotacao?: string;
  /** Linhas extras do tooltip. */
  detalhe?: string;
}

interface Props {
  itens: ItemBarra[];
  titulo: string;
  unidade?: string;
  /** Quantos itens mostrar antes de agrupar o resto. */
  maximo?: number;
}

const ALTURA_LINHA = 34;
const ESPACO = 2; // gap de superfície entre barras adjacentes
const RAIO = 6; // arredondamento só na ponta de dados (radii.sm do app)
const LARGURA_ROTULO = 132;
const MARGEM_DIREITA = 96;

/**
 * Ranking horizontal de uma única medida.
 *
 * Série única de propósito: não há legenda (o título nomeia a série) e a cor
 * não carrega identidade — a categoria está escrita no eixo. Isso mantém o
 * gráfico legível sem depender de cor, que é o caso de acessibilidade mais
 * comum e o mais fácil de errar.
 */
export function BarrasRanking({ itens, titulo, unidade = '', maximo = 8 }: Props) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const [tabela, setTabela] = useState(false);
  const idTitulo = useId();

  if (itens.length === 0) {
    return <div className="vazio">Sem dados no período.</div>;
  }

  // Nunca truncar em silêncio: o que sobra vira uma linha "outros".
  const ordenados = [...itens].sort((a, b) => b.valor - a.valor);
  const visiveis = ordenados.slice(0, maximo);
  const resto = ordenados.slice(maximo);
  if (resto.length > 0) {
    visiveis.push({
      rotulo: `outros (${resto.length})`,
      valor: resto.reduce((s, i) => s + i.valor, 0),
    });
  }

  const maiorValor = Math.max(...visiveis.map((i) => i.valor), 1);
  const largura = 640;
  const areaBarras = largura - LARGURA_ROTULO - MARGEM_DIREITA;
  const altura = visiveis.length * (ALTURA_LINHA + ESPACO);

  if (tabela) {
    return (
      <div>
        <div className="filtros" style={{ marginBottom: 10 }}>
          <button className="pequeno" onClick={() => setTabela(false)}>
            Ver como gráfico
          </button>
        </div>
        <div className="rolagem">
          <table>
            <caption className="vazio" style={{ padding: '8px 14px', textAlign: 'left' }}>
              {titulo}
            </caption>
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">{unidade || 'Valor'}</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((i) => (
                <tr key={i.rotulo}>
                  <td>{i.rotulo}</td>
                  <td className="num">{i.anotacao ?? i.valor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <div className="filtros" style={{ marginBottom: 10 }}>
        <button className="pequeno" onClick={() => setTabela(true)}>
          Ver como tabela
        </button>
      </div>

      <svg
        viewBox={`0 0 ${largura} ${altura}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-labelledby={idTitulo}
      >
        <title id={idTitulo}>{titulo}</title>

        {/* Linha de base recessiva — o único eixo do gráfico. */}
        <line
          x1={LARGURA_ROTULO}
          y1={0}
          x2={LARGURA_ROTULO}
          y2={altura}
          className="gr-eixo"
        />

        {visiveis.map((item, i) => {
          const y = i * (ALTURA_LINHA + ESPACO);
          const h = ALTURA_LINHA;
          const w = Math.max(2, (item.valor / maiorValor) * areaBarras);
          const r = Math.min(RAIO, w);
          // Ponta de dados arredondada, base quadrada e ancorada no eixo.
          const d = `M${LARGURA_ROTULO},${y} h${w - r} a${r},${r} 0 0 1 ${r},${r} v${h - 2 * r} a${r},${r} 0 0 1 ${-r},${r} H${LARGURA_ROTULO} Z`;

          return (
            <g
              key={item.rotulo}
              onMouseEnter={() => setAtivo(i)}
              onMouseLeave={() => setAtivo(null)}
            >
              {/* Área de acionamento maior que a marca. */}
              <rect x={0} y={y} width={largura} height={h} fill="transparent" />
              <rect
                x={LARGURA_ROTULO}
                y={y}
                width={areaBarras}
                height={h}
                className="gr-trilho"
                opacity={ativo === i ? 0.85 : 0.4}
              />
              <path d={d} className="gr-barra" />
              <text
                x={LARGURA_ROTULO - 10}
                y={y + h / 2}
                textAnchor="end"
                dominantBaseline="central"
                className="gr-rotulo"
              >
                {item.rotulo}
              </text>
              <text
                x={LARGURA_ROTULO + w + 8}
                y={y + h / 2}
                dominantBaseline="central"
                className="gr-valor"
              >
                {item.anotacao ?? `${item.valor}${unidade ? ` ${unidade}` : ''}`}
              </text>
            </g>
          );
        })}
      </svg>

      {ativo !== null && visiveis[ativo]?.detalhe ? (
        <div
          role="status"
          style={{
            marginTop: 8,
            fontSize: 13,
            color: 'var(--slate-500)',
          }}
        >
          <b style={{ color: 'var(--slate-900)' }}>{visiveis[ativo].rotulo}</b>
          {' — '}
          {visiveis[ativo].detalhe}
        </div>
      ) : null}
    </div>
  );
}
