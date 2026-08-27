import { useState, type FormEvent } from 'react';
import { useSessao } from '../auth/contexto';
import { Aviso, Campo } from '../componentes/basicos';
import { ErroApi } from '../api/cliente';

export function Login() {
  const { entrar } = useSessao();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function aoEnviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await entrar(email, senha);
    } catch (exc) {
      setErro(exc instanceof ErroApi ? exc.message : 'Falha inesperada ao entrar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login-tela">
      <form className="login-caixa" onSubmit={aoEnviar}>
        <h1>EPI Guard</h1>
        <p className="subtitulo">Painel administrativo</p>

        {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

        <Campo rotulo="E-mail">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
        </Campo>
        <Campo rotulo="Senha">
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Campo>
        <button className="primario" type="submit" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
