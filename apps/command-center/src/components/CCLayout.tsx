import { Outlet, NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores/auth.js';
import { useRealtimeFeed } from '../hooks/useRealtimeFeed.js';
import { AlertTicker } from './AlertTicker.js';
import i18n from '../i18n.js';

const LANGS = [
  { code: 'fr', label: 'FR' },
  { code: 'sw', label: 'SW' },
  { code: 'ln', label: 'LN' },
] as const;

type LangCode = 'fr' | 'sw' | 'ln';

const PROVINCE_NAMES: Record<string, string> = {
  CD10: 'Kinshasa', CD20: 'Kongo-Central', CD21: 'Kwango', CD22: 'Kwilu',
  CD23: 'Maï-Ndombe', CD41: 'Équateur', CD42: 'Sud-Ubangi', CD43: 'Nord-Ubangi',
  CD44: 'Mongala', CD45: 'Tshuapa', CD51: 'Tshopo', CD52: 'Bas-Uélé',
  CD53: 'Haut-Uélé', CD54: 'Ituri', CD61: 'Nord-Kivu', CD62: 'Sud-Kivu',
  CD63: 'Maniema', CD71: 'Haut-Katanga', CD72: 'Lualaba', CD73: 'Haut-Lomami',
  CD74: 'Tanganyika', CD81: 'Lomami', CD82: 'Kasaï-Oriental', CD83: 'Kasaï',
  CD84: 'Kasaï-Central', CD85: 'Sankuru',
};

const ROLE_META: Record<string, { label: string; color: string }> = {
  system_admin:             { label: 'Admin Système',       color: 'bg-red-900 text-red-300'     },
  national_decision_maker:  { label: 'Décideur National',   color: 'bg-purple-900 text-purple-300' },
  provincial_coordinator:   { label: 'Coord. Provincial',   color: 'bg-blue-900 text-blue-300'   },
  territory_admin:          { label: 'Admin Territorial',   color: 'bg-orange-900 text-orange-300' },
  humanitarian_partner:     { label: 'Partenaire Hum.',     color: 'bg-green-900 text-green-300'  },
  field_agent:              { label: 'Agent Terrain',       color: 'bg-yellow-900 text-yellow-300' },
  local_validator:          { label: 'Validateur Local',    color: 'bg-gray-700 text-gray-300'   },
  citizen:                  { label: 'Citoyen',             color: 'bg-gray-800 text-gray-400'   },
};

// Nav items avec les rôles autorisés (undefined = tous les rôles)
const NAV_ITEMS = [
  { to: '/dashboard',     icon: '📊', labelKey: 'nav_dashboard'    },
  { to: '/ops',           icon: '🖥️', labelKey: 'nav_ops'           },
  { to: '/crises',        icon: '🚨', labelKey: 'nav_crises'        },
  { to: '/idp',           icon: '🏕️', labelKey: 'nav_idp'           },
  { to: '/epidemie',      icon: '🦠', labelKey: 'nav_epidemie'      },
  { to: '/registre',      icon: '👥', labelKey: 'nav_registry'      },
  { to: '/distributions', icon: '📤', labelKey: 'nav_distributions' },
  { to: '/stocks',        icon: '📦', labelKey: 'nav_stocks'        },
  { to: '/coordination',  icon: '🤝', labelKey: 'nav_coordination'  },
  { to: '/rapports',      icon: '📄', labelKey: 'nav_reports'       },
  { to: '/ai',            icon: '🤖', labelKey: 'nav_ai',
    roles: ['system_admin', 'national_decision_maker', 'provincial_coordinator', 'territory_admin', 'humanitarian_partner'] },
  { to: '/conflit',       icon: '⚔️', labelKey: 'nav_conflit',
    roles: ['system_admin', 'national_decision_maker', 'territory_admin', 'humanitarian_partner'] },
  { to: '/renseignement', icon: '🔎', labelKey: 'nav_renseignement',
    roles: ['system_admin', 'national_decision_maker', 'humanitarian_partner'] },
  { to: '/admin',         icon: '⚙️', labelKey: 'nav_admin',
    roles: ['system_admin'] },
] as const;

function switchLanguage(lang: LangCode) {
  i18n.changeLanguage(lang);
  localStorage.setItem('sinaur_lang', lang);
}

export function CCLayout() {
  const { t, i18n: i18nInstance } = useTranslation();
  const logout = useAuthStore(s => s.logout);
  const user   = useAuthStore(s => s.user);
  const { events, connected } = useRealtimeFeed();

  const alerts = events.filter(e => e.type === 'NEW_ALERT').slice(0, 10);
  const role = user?.role ?? '';
  const roleMeta = ROLE_META[role] ?? { label: role, color: 'bg-gray-700 text-gray-300' };
  const isScoped = (user?.scope?.length ?? 0) > 0;
  const scopeLabel = isScoped
    ? user!.scope.map(p => PROVINCE_NAMES[p] ?? p).join(', ')
    : null;

  const visibleNav = NAV_ITEMS.filter(item => {
    if (!('roles' in item) || !item.roles) return true;
    return role === 'system_admin' || (item.roles as readonly string[]).includes(role);
  });

  return (
    <div className="flex h-screen overflow-hidden bg-cc-950">

      {/* Sidebar */}
      <aside className="flex flex-col w-56 bg-cc-900 border-r border-cc-700 shrink-0">

        {/* Logo */}
        <div className="px-4 py-3 border-b border-cc-700">
          <div className="flex items-center gap-2">
            <span className="text-xl">🛡️</span>
            <div>
              <div className="text-white font-bold text-sm leading-tight">SINAUR-RDC</div>
              <div className="text-cc-600 text-[10px] font-mono">CENTRE DE COMMANDEMENT</div>
            </div>
          </div>
        </div>

        {/* Utilisateur connecté */}
        <div className="px-3 py-3 border-b border-cc-700 space-y-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-sinaur-800 border border-sinaur-600 flex items-center justify-center text-xs font-bold text-sinaur-300 shrink-0">
              {(user?.email?.[0] ?? '?').toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-xs text-gray-200 font-medium truncate">
                {user?.email ?? '—'}
              </div>
            </div>
          </div>
          <span className={`inline-block text-[10px] font-mono px-2 py-0.5 rounded font-bold ${roleMeta.color}`}>
            {roleMeta.label}
          </span>
          {isScoped && (
            <div className="flex items-center gap-1 text-[10px] text-blue-400 font-mono">
              <span>📍</span>
              <span className="truncate">{scopeLabel}</span>
            </div>
          )}
          {!isScoped && role !== 'citizen' && (
            <div className="text-[10px] text-cc-600 font-mono">🌍 Vue nationale</div>
          )}
        </div>

        {/* Status WS */}
        <div className="px-4 py-2 border-b border-cc-700">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-xs text-cc-600 font-mono">
              {connected ? t('live') : t('offline')}
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          {visibleNav.map(({ to, icon, labelKey }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? to === '/admin'
                      ? 'bg-red-900/60 text-red-200 font-medium'
                      : 'bg-sinaur-700 text-white font-medium'
                    : to === '/admin'
                      ? 'text-red-500 hover:bg-red-900/30 hover:text-red-300'
                      : 'text-gray-400 hover:bg-cc-800 hover:text-gray-100'
                }`
              }
            >
              <span>{icon}</span>
              <span className="leading-tight">{t(labelKey as any)}</span>
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-cc-700 space-y-2">
          <div className="flex items-center gap-1">
            {LANGS.map(({ code, label }) => (
              <button
                key={code}
                onClick={() => switchLanguage(code)}
                className={`flex-1 text-center text-xs font-mono py-1 rounded transition-colors ${
                  i18nInstance.language === code
                    ? 'bg-sinaur-700 text-white'
                    : 'text-cc-600 hover:text-gray-300 hover:bg-cc-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={logout}
            className="w-full text-left text-xs text-cc-600 hover:text-gray-300 transition-colors py-1 font-mono"
          >
            ⏻ {t('logout')}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {alerts.length > 0 && <AlertTicker alerts={alerts} />}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
