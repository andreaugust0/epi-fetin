import type { ReactNode } from 'react';
import {
  mdiAlertCircleOutline,
  mdiAlertOutline,
  mdiCheckCircleOutline,
  mdiInformationOutline,
  mdiShieldCheck,
} from '@mdi/js';

export type Estado = 'ok' | 'alerta' | 'aviso' | 'neutro' | 'info';

/** Ícone MDI — a mesma família que o app do totem usa. */
export function Icone({ caminho, tamanho }: { caminho: string; tamanho?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={tamanho ? { width: tamanho, height: tamanho } : undefined}
    >
      <path d={caminho} />
    </svg>
  );
}

export const ICONE_MARCA = mdiShieldCheck;

/**
 * Estado codificado em forma além de cor: o ponto e o rótulo continuam
 * legíveis para quem não distingue as cores, e numa impressão em preto.
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

const ICONE_AVISO: Record<string, string> = {
  info: mdiInformationOutline,
  erro: mdiAlertCircleOutline,
  ok: mdiCheckCircleOutline,
  atencao: mdiAlertOutline,
};

export function Aviso({
  tipo = 'info',
  children,
}: {
  tipo?: 'info' | 'erro' | 'ok' | 'atencao';
  children: ReactNode;
}) {
  return (
    <div
      className={tipo === 'info' ? 'faixa' : `faixa ${tipo}`}
      role={tipo === 'erro' ? 'alert' : undefined}
    >
      <Icone caminho={ICONE_AVISO[tipo]} />
      <div>{children}</div>
    </div>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="vazio">{children}</div>;
}

export function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <label className="campo">
      <span>{rotulo}</span>
      {children}
    </label>
  );
}

export const formatarData = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : '—';

export const ESTADO_VERIFICACAO: Record<string, { estado: Estado; texto: string }> = {
  APROVADA: { estado: 'ok', texto: 'Aprovada' },
  REPROVADA: { estado: 'alerta', texto: 'Reprovada' },
  AGUARDANDO_ANALISE: { estado: 'info', texto: 'Analisando' },
  EXPIRADA: { estado: 'neutro', texto: 'Expirada' },
  ERRO: { estado: 'alerta', texto: 'Erro' },
};
