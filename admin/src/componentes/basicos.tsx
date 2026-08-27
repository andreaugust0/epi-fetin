import type { ReactNode } from 'react';

export type Estado = 'ok' | 'alerta' | 'aviso' | 'neutro';

/**
 * Estado codificado em forma além de cor: o ponto e o rótulo continuam
 * legíveis para quem não distingue as cores, e para impressão em preto.
 */
export function Pastilha({ estado, children }: { estado: Estado; children: ReactNode }) {
  return (
    <span className={`pastilha ${estado}`}>
      <span className="ponto" aria-hidden="true" />
      {children}
    </span>
  );
}

export function Metrica({
  rotulo,
  valor,
  nota,
  destaque,
}: {
  rotulo: string;
  valor: ReactNode;
  nota?: ReactNode;
  destaque?: boolean;
}) {
  return (
    <div className={`metrica${destaque ? ' destaque' : ''}`}>
      <span className="rotulo">{rotulo}</span>
      <span className="valor">{valor}</span>
      {nota ? <span className="nota">{nota}</span> : null}
    </div>
  );
}

export function Aviso({
  tipo = 'info',
  children,
}: {
  tipo?: 'info' | 'erro' | 'ok';
  children: ReactNode;
}) {
  const classe = tipo === 'info' ? 'aviso' : `aviso ${tipo}`;
  return (
    <p className={classe} role={tipo === 'erro' ? 'alert' : undefined}>
      {children}
    </p>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="vazio">{children}</div>;
}

export function Campo({
  rotulo,
  children,
}: {
  rotulo: string;
  children: ReactNode;
}) {
  return (
    <label className="campo">
      <span>{rotulo}</span>
      {children}
    </label>
  );
}

export const formatarData = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export const ESTADO_VERIFICACAO: Record<string, { estado: Estado; texto: string }> = {
  APROVADA: { estado: 'ok', texto: 'Aprovada' },
  REPROVADA: { estado: 'alerta', texto: 'Reprovada' },
  AGUARDANDO_ANALISE: { estado: 'aviso', texto: 'Analisando' },
  EXPIRADA: { estado: 'neutro', texto: 'Expirada' },
  ERRO: { estado: 'alerta', texto: 'Erro' },
};
