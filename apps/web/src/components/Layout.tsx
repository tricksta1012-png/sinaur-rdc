import { Outlet, NavLink } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.js';
import { OfflineIndicator } from './OfflineIndicator.js';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Tableau de bord', icon: '📊' },
  { to: '/map',       label: 'Carte',            icon: '🗺️' },
  { to: '/events',    label: 'Événements',        icon: '⚠️' },
  { to: '/report',    label: 'Signaler',          icon: '📢' },
] as const;

export function Layout() {
  const logout = useAuthStore((s) => s.logout);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="flex flex-col w-64 bg-gray-900 text-white shrink-0">
        <div className="flex items-center gap-2 px-4 py-5 border-b border-gray-700">
          <span className="text-2xl">🛡️</span>
          <div>
            <div className="font-bold text-sm leading-tight">SINAUR-RDC</div>
            <div className="text-gray-400 text-xs">Système National d'Alerte</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-1">
          {NAV_ITEMS.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-red-700 text-white'
                    : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                }`
              }
            >
              <span className="text-base">{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-gray-700">
          <button
            onClick={logout}
            className="w-full text-left text-sm text-gray-400 hover:text-white transition-colors py-1"
          >
            Déconnexion
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>

      <OfflineIndicator />
    </div>
  );
}
