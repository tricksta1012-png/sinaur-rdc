export type SupportedLocale = 'fr' | 'ln' | 'sw' | 'kg' | 'lua';

export const SUPPORTED_LOCALES: Record<SupportedLocale, string> = {
  fr:  'Français',
  ln:  'Lingala',
  sw:  'Kiswahili',
  kg:  'Kikongo',
  lua: 'Tshiluba',
};

export type TranslationKey =
  | 'nav.dashboard' | 'nav.map' | 'nav.events' | 'nav.report'
  | 'nav.registry' | 'nav.distributions' | 'nav.settings'
  | 'alert.flood' | 'alert.landslide' | 'alert.mass_displacement'
  | 'alert.humanitarian_crisis' | 'alert.health_epidemic' | 'alert.volcanic_eruption'
  | 'alert.drought' | 'alert.fire' | 'alert.conflict' | 'alert.earthquake' | 'alert.other'
  | 'severity.Minor' | 'severity.Moderate' | 'severity.Severe' | 'severity.Extreme' | 'severity.Unknown'
  | 'action.report' | 'action.validate' | 'action.cancel' | 'action.submit'
  | 'action.register' | 'action.scan'
  | 'report.title' | 'report.description' | 'report.location' | 'report.submit_success'
  | 'registry.title' | 'registry.new' | 'registry.search'
  | 'registry.status.pending' | 'registry.status.validated' | 'registry.status.rejected'
  | 'distribution.title' | 'distribution.scan_qr' | 'distribution.confirm'
  | 'distribution.success' | 'distribution.already_received'
  | 'sync.pending' | 'sync.syncing' | 'sync.failed' | 'sync.manual'
  | 'settings.language' | 'settings.data_saver' | 'settings.about'
  | 'ussd.welcome' | 'ussd.report' | 'ussd.confirm' | 'ussd.sent'
  | 'error.unauthorized' | 'error.network' | 'error.generic'
  | 'error.duplicate' | 'error.not_validated';

type Translations = Record<TranslationKey, string>;

// Lazy-load locales at runtime to keep bundle small
export async function loadLocale(locale: SupportedLocale): Promise<Translations> {
  const mod = await import(`../locales/${locale}.json`, { assert: { type: 'json' } });
  return mod.default as Translations;
}

let currentLocale: SupportedLocale = 'fr';
let translations: Partial<Translations> = {};

export function setLocale(locale: SupportedLocale, t: Partial<Translations>): void {
  currentLocale = locale;
  translations = t;
}

export function t(key: TranslationKey, fallback?: string): string {
  return translations[key] ?? fallback ?? key;
}

export function getLocale(): SupportedLocale {
  return currentLocale;
}
