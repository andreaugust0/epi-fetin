import { createContext, useContext } from 'react';

export interface Sessao {
  autenticado: boolean;
  entrar: (email: string, senha: string) => Promise<void>;
  sair: () => void;
}

export const ContextoAuth = createContext<Sessao | null>(null);

export function useSessao(): Sessao {
  const s = useContext(ContextoAuth);
  if (!s) throw new Error('useSessao precisa estar dentro de <ProvedorAuth>');
  return s;
}
