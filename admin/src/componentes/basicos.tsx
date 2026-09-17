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

/** Título + a frase que diz por que este bloco existe, e o cartão. */
export function Secao({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao: string;
  children: ReactNode;
}) {
  return (
    <>
      <h2>{titulo}</h2>
      <p
        style={{
          color: 'var(--slate-500)',
          fontSize: 13,
          margin: '-6px 0 12px',
          maxWidth: 760,
          lineHeight: 1.6,
        }}
      >
        {descricao}
      </p>
      <div className="cartao" style={{ marginBottom: 24 }}>
        {children}
      </div>
    </>
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

/**
 * Variação contra um valor de referência (período anterior, por exemplo).
 *
 * `bomSubir` existe porque nem toda subida é boa, e fingir que é seria pior
 * que não mostrar nada. Conformidade subindo é bom. Já "bloqueios subindo" é
 * ambíguo: pode ser mais gente circulando, pode ser o sistema pegando o que
 * antes passava, pode ser piora real. Quando o sinal é ambíguo, `bomSubir`
 * fica indefinido e o número sai em cinza — o leitor decide o que significa,
 * em vez de a cor decidir por ele.
 */
export function Variacao({
  atual,
  anterior,
  sufixo = '',
  bomSubir,
}: {
  atual: number | null | undefined;
  anterior: number | null | undefined;
  sufixo?: string;
  bomSubir?: boolean;
}) {
  if (atual == null || anterior == null) return null;
  const delta = Math.round((atual - anterior) * 10) / 10;
  if (delta === 0) {
    return <span style={{ color: 'var(--slate-400)' }}>igual ao período anterior</span>;
  }
  const subiu = delta > 0;
  const cor =
    bomSubir === undefined
      ? 'var(--slate-500)'
      : subiu === bomSubir
        ? 'var(--ok-text)'
        : 'var(--alerta-text)';
  return (
    <span style={{ color: cor }}>
      {subiu ? '▲' : '▼'} {Math.abs(delta)}
      {sufixo} vs. período anterior
    </span>
  );
}
