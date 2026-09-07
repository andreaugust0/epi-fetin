import { useId, useRef, useState } from 'react';

export interface PontoTendencia {
  /** ISO 8601, só a data. */
  dia: string;
  taxa: number | null;
  total: number;
  bloqueios: number;
}

interface Props {
  pontos: PontoTendencia[];
  titulo: string;
}

const LARGURA = 720;
const ALTURA = 240;
const MARGEM = { topo: 16, direita: 56, baixo: 30, esquerda: 42 };

/** Cor da série. Validada contra a superfície branca dos cartões. */
const SERIE = '#2563eb';

const formatarDia = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  });

/**
 * Conformidade dia a dia.
 *
 * Uma série só, e isso é decisão de leitura, não economia. A tentação óbvia
 * seria pôr o VOLUME de verificações junto, num segundo eixo — e um segundo
 * eixo inventa correlação: o alinhamento entre as duas escalas é arbitrário,
 * então qualquer subida ou descida paralela é acidente de escala, não fato.
 * O volume vive no tooltip e na tabela, onde não pode mentir.
 *
 * Sem legenda pelo mesmo motivo: com uma série, o título já nomeia o que
 * está plotado e uma caixinha de legenda só repetiria o título.
 */
export function LinhaTendencia({ pontos, titulo }: Props) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const [tabela, setTabela] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const idTitulo = useId();

  const comTaxa = pontos.filter((p) => p.taxa !== null);

  if (comTaxa.length < 2) {
    return (
      <div className="vazio">
        {comTaxa.length === 0
          ? 'Nenhuma verificação concluída no período.'
          : 'Um único dia com verificações — ainda não há tendência para desenhar.'}
      </div>
    );
  }

  if (tabela) {
    return (
      <>
        <div className="rolagem">
          <table>
            <caption className="visualmente-oculto">{titulo}</caption>
            <thead>
              <tr>
                <th>Dia</th>
                <th className="num">Verificações</th>
                <th className="num">Bloqueios</th>
                <th className="num">Conformidade</th>
              </tr>
            </thead>
            <tbody>
              {comTaxa.map((p) => (
                <tr key={p.dia}>
                  <td>{formatarDia(p.dia)}</td>
                  <td className="num">{p.total}</td>
                  <td className="num">{p.bloqueios}</td>
                  <td className="num">{p.taxa}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="pequeno" onClick={() => setTabela(false)}>
          Ver como gráfico
        </button>
      </>
    );
  }

  const larguraPlot = LARGURA - MARGEM.esquerda - MARGEM.direita;
  const alturaPlot = ALTURA - MARGEM.topo - MARGEM.baixo;

  /*
   * O teto é sempre 100; o piso desce só até onde os dados pedem.
   *
   * Com a escala presa em 0–100, uma operação que foi de 87% para 93% desenha
   * uma reta: seis pontos percentuais em 240px de altura são catorze pixels.
   * O bloco se chama "A conformidade está mudando?" e o gráfico respondia
   * "não" — sobre dados em que ela mudou.
   *
   * O risco do eixo cortado é o inverso: exagerar. Por isso o corte é só de
   * um lado. O 100 fica sempre no quadro, então ninguém confunde "alto" com
   * "perfeito", e o piso é um múltiplo de 5 abaixo do pior dia, com uma
   * janela mínima de 20 pontos — o zoom não aperta indefinidamente conforme
   * os dados ficam bons.
   *
   * A área preenchida sai junto quando o eixo é cortado: a mancha de tinta
   * seria proporcional a "quanto acima do piso", e piso arbitrário com área
   * proporcional é exatamente o gráfico que mente. Sem corte, ela volta.
   */
  const menor = Math.min(...comTaxa.map((p) => p.taxa as number));
  const piso = Math.max(0, Math.min(80, Math.floor((menor - 4) / 5) * 5));
  const faixa = 100 - piso;

  const x = (i: number) =>
    MARGEM.esquerda + (comTaxa.length === 1 ? larguraPlot / 2 : (i / (comTaxa.length - 1)) * larguraPlot);
  const y = (taxa: number) =>
    MARGEM.topo + alturaPlot - ((taxa - piso) / faixa) * alturaPlot;

  const caminho = comTaxa
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.taxa as number).toFixed(1)}`)
    .join(' ');

  const area =
    `${caminho} L ${x(comTaxa.length - 1).toFixed(1)} ${MARGEM.topo + alturaPlot} ` +
    `L ${x(0).toFixed(1)} ${MARGEM.topo + alturaPlot} Z`;

  const ultimo = comTaxa[comTaxa.length - 1]!;
  const marcasY = Array.from({ length: 5 }, (_, i) =>
    Math.round(piso + (faixa * i) / 4),
  );

  // Um rótulo a cada N dias: rótulo em todo ponto vira uma faixa preta.
  const passo = Math.max(1, Math.ceil(comTaxa.length / 8));

  /*
   * O último dia é sempre rotulado — é a data que dá sentido ao valor
   * destacado. Mas o passo fixo também acerta datas perto do fim, e quando
   * cai a um ou dois pontos do último os dois rótulos se sobrepõem: no
   * período de 30 dias saía "04/096/09", uma data que não existe.
   *
   * Então o último manda: um rótulo do passo que caia perto demais dele
   * simplesmente não é desenhado.
   */
  const ultimoIndice = comTaxa.length - 1;
  const rotulado = (i: number) =>
    i === ultimoIndice || (i % passo === 0 && ultimoIndice - i >= passo / 2);

  function aoMover(evento: React.PointerEvent<SVGSVGElement>) {
    const caixa = svgRef.current?.getBoundingClientRect();
    if (!caixa) return;
    const px = ((evento.clientX - caixa.left) / caixa.width) * LARGURA;
    const razao = (px - MARGEM.esquerda) / larguraPlot;
    const i = Math.round(razao * (comTaxa.length - 1));
    setAtivo(i >= 0 && i < comTaxa.length ? i : null);
  }

  const p = ativo !== null ? comTaxa[ativo] : null;

  return (
    <>
      <div style={{ position: 'relative' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${LARGURA} ${ALTURA}`}
          width="100%"
          role="img"
          aria-labelledby={idTitulo}
          style={{ display: 'block', overflow: 'visible', touchAction: 'none' }}
          onPointerMove={aoMover}
          onPointerLeave={() => setAtivo(null)}
        >
          <title id={idTitulo}>{titulo}</title>

          {marcasY.map((v) => (
            <g key={v}>
              <line
                x1={MARGEM.esquerda}
                x2={LARGURA - MARGEM.direita}
                y1={y(v)}
                y2={y(v)}
                stroke="var(--slate-200)"
                strokeWidth={1}
              />
              <text
                x={MARGEM.esquerda - 8}
                y={y(v) + 4}
                textAnchor="end"
                fontSize={11}
                fill="var(--slate-400)"
              >
                {v}%
              </text>
            </g>
          ))}

          {piso === 0 ? <path d={area} fill={SERIE} fillOpacity={0.1} /> : null}
          <path
            d={caminho}
            fill="none"
            stroke={SERIE}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {comTaxa.map((ponto, i) =>
            rotulado(i) ? (
              <text
                key={ponto.dia}
                x={x(i)}
                y={ALTURA - 8}
                textAnchor="middle"
                fontSize={11}
                fill="var(--slate-400)"
              >
                {formatarDia(ponto.dia)}
              </text>
            ) : null,
          )}

          {/* Crosshair: o leitor mira num dia, nunca numa linha de 2px. */}
          {ativo !== null && p ? (
            <>
              <line
                x1={x(ativo)}
                x2={x(ativo)}
                y1={MARGEM.topo}
                y2={MARGEM.topo + alturaPlot}
                stroke="var(--slate-300)"
                strokeWidth={1}
              />
              <circle
                cx={x(ativo)}
                cy={y(p.taxa as number)}
                r={5}
                fill={SERIE}
                stroke="var(--superficie)"
                strokeWidth={2}
              />
            </>
          ) : null}

          {/* Só o último ponto é rotulado: valor em todo ponto não se lê. */}
          <circle
            cx={x(comTaxa.length - 1)}
            cy={y(ultimo.taxa as number)}
            r={4}
            fill={SERIE}
            stroke="var(--superficie)"
            strokeWidth={2}
          />
          <text
            x={x(comTaxa.length - 1) + 10}
            y={y(ultimo.taxa as number) + 4}
            fontSize={13}
            fontWeight={700}
            fill="var(--slate-800)"
          >
            {ultimo.taxa}%
          </text>
        </svg>

        {ativo !== null && p ? (
          <div
            role="status"
            /*
             * Dentro do gráfico, ancorado embaixo — e não flutuando acima
             * dele, que era onde caía em cima do parágrafo da seção.
             *
             * Embaixo porque é onde não há linha: o eixo começa logo abaixo
             * do pior dia, então a metade inferior do quadro está sempre
             * vazia. E o `left` é preso entre 12% e 88% para o balão não
             * vazar pela borda do cartão no primeiro e no último ponto.
             */
            style={{
              position: 'absolute',
              left: `${Math.min(88, Math.max(12, (x(ativo) / LARGURA) * 100))}%`,
              bottom: 38,
              transform: 'translateX(-50%)',
              background: 'var(--slate-900)',
              color: '#fff',
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              boxShadow: 'var(--sh-md)',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 14 }}>{p.taxa}% em conformidade</div>
            <div style={{ opacity: 0.75 }}>
              {formatarDia(p.dia)} · {p.total} verificaç{p.total === 1 ? 'ão' : 'ões'} ·{' '}
              {p.bloqueios} bloqueio{p.bloqueios === 1 ? '' : 's'}
            </div>
          </div>
        ) : null}
      </div>

      <button className="pequeno" onClick={() => setTabela(true)} style={{ marginTop: 8 }}>
        Ver como tabela
      </button>
    </>
  );
}
