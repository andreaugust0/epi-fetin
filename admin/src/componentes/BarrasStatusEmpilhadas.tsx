import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface DiaStatus {
  dia: string;
  aprovadas: number;
  bloqueios: number;
  expiradas: number;
  erros: number;
}

interface Props {
  dias: DiaStatus[];
}

const formatarDia = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

/**
 * Uma série por status, nunca uma taxa junto — a conformidade já tem o
 * próprio gráfico de linha. Empilhar contagem de status com uma taxa no
 * mesmo quadro pediria um segundo eixo, e é exatamente esse segundo eixo
 * que `LinhaTendencia` evita de propósito.
 */
const SERIES = [
  { chave: 'aprovadas', rotulo: 'Aprovada', cor: 'var(--ok)' },
  { chave: 'bloqueios', rotulo: 'Reprovada', cor: 'var(--alerta)' },
  { chave: 'expiradas', rotulo: 'Expirada', cor: 'var(--slate-400)' },
  { chave: 'erros', rotulo: 'Erro', cor: 'var(--aviso)' },
] as const;

export function BarrasStatusEmpilhadas({ dias }: Props) {
  if (dias.length === 0) {
    return <div className="vazio">Nenhuma verificação no período.</div>;
  }

  const dados = dias.map((d) => ({ ...d, rotuloDia: formatarDia(d.dia) }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--slate-200)" />
        <XAxis
          dataKey="rotuloDia"
          tick={{ fontSize: 11, fill: 'var(--slate-400)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: 'var(--slate-400)' }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          width={36}
        />
        <Tooltip
          cursor={{ fill: 'var(--slate-50)' }}
          contentStyle={{
            borderRadius: 8,
            border: 'none',
            boxShadow: 'var(--sh-md)',
            fontSize: 12,
          }}
          labelFormatter={(v) => `Dia ${v}`}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
        {SERIES.map((s, i) => (
          <Bar
            key={s.chave}
            dataKey={s.chave}
            name={s.rotulo}
            stackId="status"
            fill={s.cor}
            radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
