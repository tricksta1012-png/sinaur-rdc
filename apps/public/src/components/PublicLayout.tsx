import { NavLink, Outlet } from 'react-router-dom';

const NAV = [
  { to: '/',              label: 'Accueil',        exact: true },
  { to: '/carte',         label: 'Carte',          exact: false },
  { to: '/statistiques',  label: 'Statistiques',   exact: false },
  { to: '/donnees',       label: 'Données ouvertes', exact: false },
];

export function PublicLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-rdc-red shadow-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🛡️</span>
            <div>
              <div className="text-white font-bold text-base leading-tight">SINAUR-RDC</div>
              <div className="text-red-200 text-xs leading-tight">Portail Public d'Alertes</div>
            </div>
          </div>

          <nav className="hidden sm:flex items-center gap-1">
            {NAV.map(({ to, label, exact }) => (
              <NavLink
                key={to}
                to={to}
                end={exact}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'text-red-100 hover:bg-white/10 hover:text-white'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <a
            href="/public/feed.atom"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white text-sm transition-colors"
            title="Flux Atom RSS"
          >
            <span>📡</span>
            <span className="hidden sm:inline">Flux Atom</span>
          </a>
        </div>

        {/* Mobile nav */}
        <div className="sm:hidden px-4 pb-2 flex gap-2 overflow-x-auto">
          {NAV.map(({ to, label, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                `whitespace-nowrap px-3 py-1 rounded-full text-xs font-medium ${
                  isActive ? 'bg-white text-rdc-red' : 'bg-white/20 text-white'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="bg-gray-800 text-gray-400 text-xs py-6">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div>
            <span className="text-white font-medium">SINAUR-RDC</span> — Système National Intelligent d'Alerte, d'Urgence et de Réponse aux Sinistres<br />
            Gouvernement de la République Démocratique du Congo | Aligné EW4All (ONU) | CAP 1.2 | HXL | P-codes OCHA
          </div>
          <div className="flex items-center gap-4">
            <a href="https://reliefweb.int" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">ReliefWeb</a>
            <a href="https://data.humdata.org" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">HDX</a>
            <a href="/public/feed.atom" className="hover:text-white transition-colors">Atom Feed</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
