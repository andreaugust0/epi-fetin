import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import {
  mdiAccountGroupOutline,
  mdiClipboardTextClockOutline,
  mdiDoorSlidingOpen,
  mdiLogoutVariant,
  mdiViewDashboardOutline,
} from '@mdi/js';
import { ProvedorAuth } from './auth/ProvedorAuth';
import { useSessao } from './auth/contexto';
import { BarraStatus } from './componentes/BarraStatus';
import { Icone, ICONE_MARCA } from './componentes/basicos';
import { Login } from './paginas/Login';
import { Painel } from './paginas/Painel';
import { Verificacoes } from './paginas/Verificacoes';
import { Pessoas } from './paginas/Pessoas';
import { Pontos } from './paginas/Pontos';

const LINKS = [
  { para: '/', rotulo: 'Painel', icone: mdiViewDashboardOutline, exato: true },
  { para: '/verificacoes', rotulo: 'Verificações', icone: mdiClipboardTextClockOutline },
  { para: '/pessoas', rotulo: 'Pessoas', icone: mdiAccountGroupOutline },
  { para: '/pontos', rotulo: 'Pontos de acesso', icone: mdiDoorSlidingOpen },
];

function Moldura() {
  const { sair } = useSessao();
  return (
    <>
      <BarraStatus />
      <div className="app">
        <aside className="lateral">
          <div className="marca">
            <span className="selo">
              <Icone caminho={ICONE_MARCA} />
            </span>
            <span>
              <b>EPI Fetin</b>
              <span>Administração</span>
            </span>
          </div>
          <nav className="nav">
            {LINKS.map((l) => (
              <NavLink
                key={l.para}
                to={l.para}
                end={l.exato}
                className={({ isActive }) => (isActive ? 'ativo' : undefined)}
              >
                <Icone caminho={l.icone} />
                {l.rotulo}
              </NavLink>
            ))}
          </nav>
          <div className="rodape-lateral">
            <button className="pequeno" onClick={sair}>
              <Icone caminho={mdiLogoutVariant} />
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
    </>
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
