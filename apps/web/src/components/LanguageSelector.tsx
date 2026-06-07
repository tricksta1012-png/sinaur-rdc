import { useTranslation } from '@sinaur-rdc/i18n/react'
import type { SupportedLocale } from '@sinaur-rdc/i18n'

const LOCALES: { code: SupportedLocale; label: string; flag: string }[] = [
  { code: 'fr',  label: 'Français',   flag: '🇫🇷' },
  { code: 'ln',  label: 'Lingala',    flag: '🇨🇩' },
  { code: 'sw',  label: 'Kiswahili',  flag: '🇨🇩' },
  { code: 'kg',  label: 'Kikongo',    flag: '🇨🇩' },
  { code: 'lua', label: 'Tshiluba',   flag: '🇨🇩' },
]

export function LanguageSelector() {
  const { locale, changeLocale } = useTranslation()

  return (
    <div className="relative group">
      <button
        className="flex items-center gap-1.5 px-2 py-1.5 rounded text-sm text-gray-300 hover:text-white hover:bg-gray-700 transition-colors w-full"
        title="Changer de langue / Change language"
      >
        <span className="text-base">{LOCALES.find(l => l.code === locale)?.flag ?? '🌐'}</span>
        <span className="text-xs">{LOCALES.find(l => l.code === locale)?.label ?? locale}</span>
        <span className="ml-auto text-xs opacity-50">▾</span>
      </button>

      <div className="absolute bottom-full left-0 mb-1 w-44 bg-gray-800 border border-gray-700 rounded-lg shadow-xl opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50">
        {LOCALES.map(({ code, label, flag }) => (
          <button
            key={code}
            onClick={() => changeLocale(code)}
            className={`flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors first:rounded-t-lg last:rounded-b-lg ${
              locale === code
                ? 'bg-red-800 text-white'
                : 'text-gray-300 hover:bg-gray-700 hover:text-white'
            }`}
          >
            <span>{flag}</span>
            <span>{label}</span>
            {locale === code && <span className="ml-auto text-xs">✓</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
