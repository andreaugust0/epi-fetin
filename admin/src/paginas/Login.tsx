import { useState, type FormEvent } from 'react';
import { mdiLoginVariant } from '@mdi/js';
import { useSessao } from '../auth/contexto';
import { Aviso, Campo, Icone, ICONE_MARCA } from '../componentes/basicos';
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
        <div className="login-marca">
          <span className="selo">
            <Icone caminho={ICONE_MARCA} />
          </span>
          <div>
            <h1>EPI Fetin</h1>
            <p className="subtitulo">Painel administrativo</p>
          </div>
        </div>

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
        <button className="primario largo" type="submit" disabled={enviando}>
          <Icone caminho={mdiLoginVariant} />
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
