import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { ProvedorAuth } from './auth/ProvedorAuth';
import { useSessao } from './auth/contexto';
import { Login } from './paginas/Login';
import { Painel } from './paginas/Painel';
import { Verificacoes } from './paginas/Verificacoes';
import { Pessoas } from './paginas/Pessoas';
import { Pontos } from './paginas/Pontos';

const LINKS = [
  { para: '/', rotulo: 'Painel', exato: true },
  { para: '/verificacoes', rotulo: 'Verificações' },
  { para: '/pessoas', rotulo: 'Pessoas' },
  { para: '/pontos', rotulo: 'Pontos de acesso' },
];

function Moldura() {
  const { sair } = useSessao();
  return (
    <div className="app">
      <aside className="lateral">
        <div className="marca">
          <span>EPI Guard</span>
          <b>Administração</b>
        </div>
        <nav className="nav">
          {LINKS.map((l) => (
            <NavLink
              key={l.para}
              to={l.para}
              end={l.exato}
              className={({ isActive }) => (isActive ? 'ativo' : undefined)}
            >
              {l.rotulo}
            </NavLink>
          ))}
        </nav>
        <div className="rodape-lateral">
          <button className="pequeno" onClick={sair}>
            Sair
          </button>
        </div>
      </aside>
      <main className="conteudo">
        <Routes>
          <Route path="/" element={<Painel />} />
          <Route path="/verificacoes" element={<Verificacoes />} />
          <Route path="/pessoas" element={<Pessoas />} />
          <Route path="/pontos" element={<Pontos />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Roteador() {
  const { autenticado } = useSessao();
  return autenticado ? <Moldura /> : <Login />;
}

export function App() {
  return (
    <ProvedorAuth>
      <Roteador />
    </ProvedorAuth>
  );
}
