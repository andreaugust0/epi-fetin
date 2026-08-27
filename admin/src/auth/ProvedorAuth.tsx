import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, guardarToken, limparToken, lerToken, SESSAO_EXPIRADA } from '../api/cliente';
import { ContextoAuth } from './contexto';

export function ProvedorAuth({ children }: { children: React.ReactNode }) {
  const [autenticado, setAutenticado] = useState(() => Boolean(lerToken()));

  // O cliente HTTP dispara este evento ao receber 401. Assim o token
  // expirado derruba a sessão de qualquer lugar do app, sem cada tela
  // precisar tratar isso.
  useEffect(() => {
    const aoExpirar = () => setAutenticado(false);
    window.addEventListener(SESSAO_EXPIRADA, aoExpirar);
    return () => window.removeEventListener(SESSAO_EXPIRADA, aoExpirar);
  }, []);

  const entrar = useCallback(async (email: string, senha: string) => {
    const t = await api.login(email, senha);
    guardarToken(t.access_token);
    setAutenticado(true);
  }, []);

  const sair = useCallback(() => {
    limparToken();
    setAutenticado(false);
  }, []);

  const valor = useMemo(() => ({ autenticado, entrar, sair }), [autenticado, entrar, sair]);
  return <ContextoAuth.Provider value={valor}>{children}</ContextoAuth.Provider>;
}
