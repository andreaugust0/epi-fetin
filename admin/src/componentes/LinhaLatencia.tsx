import { useId } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface PontoLatencia {
  dia: string;
  latencia_media_ms: number | null;
}

interface Props {
  pontos: PontoLatencia[];
}

const formatarDia = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

/** Latência média de inferência por dia — a mesma leitura de `LinhaTendencia`
 * (uma série só, sem segundo eixo), mudando apenas a grandeza: milissegundos
 * em vez de percentual. */
export function LinhaLatencia({ pontos }: Props) {
  const idGradiente = `gradLatencia${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const comDado = pontos.filter((p): p is { dia: string; latencia_media_ms: number } =>
    p.latencia_media_ms !== null,
  );

  if (comDado.length < 2) {
    return (
      <div className="vazio">
        {comDado.length === 0
          ? 'Nenhuma verificação com latência registrada no período.'
          : 'Um único dia com latência registrada — ainda não há tendência para desenhar.'}
      </div>
    );
  }

  const serie = comDado.map((p) => ({ rotuloDia: formatarDia(p.dia), ms: p.latencia_media_ms }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={serie} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={idGradiente} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.18} />
            <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
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
          width={48}
          tickFormatter={(v: number) => `${v}ms`}
        />
        <Tooltip
          contentStyle={{
            borderRadius: 8,
            border: 'none',
            boxShadow: 'var(--sh-md)',
            fontSize: 12,
          }}
          formatter={(v) => [`${Math.round(Number(v))} ms`, 'Latência média']}
          labelFormatter={(v) => `Dia ${v}`}
        />
        <Area
          type="monotone"
          dataKey="ms"
          stroke="var(--primary)"
          strokeWidth={2}
          fill={`url(#${idGradiente})`}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
