import { Outlet, NavLink } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.js';
import { OfflineIndicator } from './OfflineIndicator.js';
import { LanguageSelector } from './LanguageSelector.js';
import { I18nProvider } from '@sinaur-rdc/i18n/react';

const NAV_ITEMS = [
  { to: '/dashboard',     label: 'Tableau de bord',   icon: '📊' },
  { to: '/map',           label: 'Carte',              icon: '🗺️' },
  { to: '/events',        label: 'Événements',         icon: '⚠️' },
  { to: '/report',        label: 'Signaler',           icon: '📢' },
  { to: '/registry',      label: 'Registre',           icon: '👥' },
  { to: '/distributions', label: 'Distributions',      icon: '📦' },
] as const;

function LayoutInner() {
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
        <div className="px-2 pb-1 border-t border-gray-700 pt-2">
          <LanguageSelector />
        </div>
        <div className="px-4 py-3">
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

export function Layout() {
  return (
    <I18nProvider>
      <LayoutInner />
    </I18nProvider>
  );
}
