import { Outlet, NavLink } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.js';
import { OfflineIndicator } from './OfflineIndicator.js';
import { LanguageSelector } from './LanguageSelector.js';
import { I18nProvider } from '@sinaur/i18n/react';
import type { UserRole } from '@sinaur/shared-types';

const NAV_ITEMS = [
  { to: '/dashboard',     label: 'Tableau de bord',    icon: '📊' },
  { to: '/map',           label: 'Carte',               icon: '🗺️' },
  { to: '/events',        label: 'Événements',          icon: '⚠️' },
  { to: '/report',        label: 'Signaler',            icon: '📢' },
  { to: '/registry',      label: 'Registre',            icon: '👥' },
  { to: '/distributions', label: 'Distributions',       icon: '📦' },
  { to: '/resources',     label: 'Stocks & Ressources', icon: '🏭' },
  { to: '/crises',        label: 'Crises',              icon: '🚨' },
] as const;

const ROLE_LABELS: Record<UserRole, string> = {
  citizen:                 'Citoyen',
  field_agent:             'Agent terrain',
  local_validator:         'Validateur local',
  territory_admin:         'Admin territoire',
  humanitarian_partner:    'Partenaire',
  national_decision_maker: 'Décideur national',
  system_admin:            'Administrateur',
};

const ROLE_BADGE: Record<UserRole, string> = {
  citizen:                 'bg-gray-700 text-gray-300',
  field_agent:             'bg-blue-900 text-blue-300',
  local_validator:         'bg-teal-900 text-teal-300',
  territory_admin:         'bg-purple-900 text-purple-300',
  humanitarian_partner:    'bg-orange-900 text-orange-300',
  national_decision_maker: 'bg-sinaur-900 text-red-300',
  system_admin:            'bg-sinaur-700 text-white',
};

function NavItem({ to, label, icon }: { to: string; label: string; icon: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
          isActive
            ? 'bg-sinaur-700 text-white'
            : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'
        }`
      }
    >
      <span className="text-base shrink-0">{icon}</span>
      <span className="leading-tight">{label}</span>
    </NavLink>
  );
}

function LayoutInner() {
  const logout  = useAuthStore((s) => s.logout);
  const user    = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'system_admin';
  const canSeeAudit = user?.role === 'system_admin' || user?.role === 'national_decision_maker';

  const roleLabel = user?.role ? ROLE_LABELS[user.role] : '';
  const roleBadge = user?.role ? ROLE_BADGE[user.role] : 'bg-gray-700 text-gray-300';

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">

      {/* ── Sidebar ──────────────────────────────── */}
      <aside className="flex flex-col w-64 bg-gray-900 text-white shrink-0">

        {/* Logo */}
        <div className="px-4 py-5 border-b border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-sinaur-700 flex items-center justify-center shrink-0">
              <span className="text-lg">🛡️</span>
            </div>
            <div>
              <div className="font-bold text-sm leading-tight tracking-wide text-white">SINAUR-RDC</div>
              <div className="text-gray-500 text-xs leading-tight mt-0.5">Système National d'Alerte</div>
            </div>
          </div>
          {/* RDC flag accent bar */}
          <div className="flex mt-3 gap-0.5 h-0.5 rounded-full overflow-hidden">
            <div className="flex-1 bg-rdc-blue" />
            <div className="flex-1 bg-rdc-yellow" />
            <div className="flex-1 bg-rdc-red" />
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-0.5">
          {NAV_ITEMS.map(({ to, label, icon }) => (
            <NavItem key={to} to={to} label={label} icon={icon} />
          ))}

          {(isAdmin || canSeeAudit) && (
            <>
              <div className="pt-5 pb-1 px-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                  Administration
                </span>
              </div>
              {isAdmin      && <NavItem to="/admin/users"     label="Utilisateurs"   icon="👤" />}
              {canSeeAudit  && <NavItem to="/admin/audit-log" label="Journal d'audit" icon="🔒" />}
            </>
          )}
        </nav>

        {/* Footer — user info + controls */}
        <div className="border-t border-gray-800 px-3 py-3 space-y-2.5">
          {/* Role badge */}
          {user?.role && (
            <div className="flex items-center gap-2.5 px-1">
              <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center shrink-0 text-xs">
                👤
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadge}`}>
                {roleLabel}
              </span>
            </div>
          )}
          {/* Language */}
          <div className="px-1">
            <LanguageSelector />
          </div>
          {/* Logout */}
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-500 hover:bg-gray-800 hover:text-gray-300 transition-colors"
          >
            <span>⏻</span>
            <span>Déconnexion</span>
          </button>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

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
