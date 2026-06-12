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

function switchLanguage(lang: LangCode) {
  i18n.changeLanguage(lang);
  localStorage.setItem('sinaur_lang', lang);
}

export function CCLayout() {
  const { t, i18n: i18nInstance } = useTranslation();
  const logout = useAuthStore(s => s.logout);
  const { events, connected } = useRealtimeFeed();

  const alerts = events.filter(e => e.type === 'NEW_ALERT').slice(0, 10);

  const NAV = [
    { to: '/dashboard',     icon: '📊',  label: t('nav_dashboard')    },
    { to: '/ops',           icon: '🖥️',  label: t('nav_ops')           },
    { to: '/crises',        icon: '🚨',  label: t('nav_crises')        },
    { to: '/registre',      icon: '👥',  label: t('nav_registry')      },
    { to: '/distributions', icon: '📤',  label: t('nav_distributions') },
    { to: '/stocks',        icon: '📦',  label: t('nav_stocks')        },
    { to: '/coordination',  icon: '🤝',  label: t('nav_coordination')  },
    { to: '/rapports',      icon: '📄',  label: t('nav_reports')       },
    { to: '/ai',            icon: '🤖',  label: t('nav_ai')            },
    { to: '/conflit',       icon: '⚔️',  label: t('nav_conflit')       },
    { to: '/idp',           icon: '🏕️',  label: t('nav_idp')           },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-cc-950">

      {/* Sidebar */}
      <aside className="flex flex-col w-56 bg-cc-900 border-r border-cc-700 shrink-0">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-cc-700">
          <div className="flex items-center gap-2">
            <span className="text-xl">🛡️</span>
            <div>
              <div className="text-white font-bold text-sm leading-tight">SINAUR-RDC</div>
              <div className="text-cc-600 text-xs font-mono">CENTRE DE COMMANDEMENT</div>
            </div>
          </div>
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
          {NAV.map(({ to, icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-sinaur-700 text-white font-medium'
                    : 'text-gray-400 hover:bg-cc-800 hover:text-gray-100'
                }`
              }
            >
              <span>{icon}</span>
              <span className="leading-tight">{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-cc-700 space-y-2">
          {/* Language switcher */}
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

          {/* Logout */}
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
        {/* Alert ticker */}
        {alerts.length > 0 && <AlertTicker alerts={alerts} />}

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
