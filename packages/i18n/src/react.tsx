/**
 * React context + hook pour l'internationalisation SINAUR-RDC.
 * Fonctionne dans Web (React) et Mobile (React Native).
 */
import React, {
  createContext, useContext, useState, useEffect, useCallback, type ReactNode,
} from 'react'
import {
  type SupportedLocale, type TranslationKey,
  SUPPORTED_LOCALES, loadLocale, setLocale, getLocale, t as tRaw,
} from './index.js'

interface I18nContextValue {
  locale: SupportedLocale
  changeLocale: (locale: SupportedLocale) => Promise<void>
  t: (key: TranslationKey, fallback?: string) => string
  isLoading: boolean
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'fr',
  changeLocale: async () => {},
  t: (key) => key,
  isLoading: false,
})

const STORAGE_KEY = 'sinaur_locale'

function readStoredLocale(): SupportedLocale {
  try {
    // Web: localStorage
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored && stored in SUPPORTED_LOCALES) return stored as SupportedLocale
    }
  } catch {}
  return 'fr'
}

async function persistLocale(locale: SupportedLocale): Promise<void> {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, locale)
    }
  } catch {}
}

export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: SupportedLocale }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(initialLocale ?? readStoredLocale())
  const [isLoading, setIsLoading] = useState(true)
  // Force re-render when translations change
  const [, setVersion] = useState(0)

  const applyLocale = useCallback(async (newLocale: SupportedLocale) => {
    setIsLoading(true)
    const translations = await loadLocale(newLocale)
    setLocale(newLocale, translations)
    setLocaleState(newLocale)
    setVersion(v => v + 1)
    await persistLocale(newLocale)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void applyLocale(locale)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const tFn = useCallback((key: TranslationKey, fallback?: string) => tRaw(key, fallback), [])

  return (
    <I18nContext.Provider value={{ locale, changeLocale: applyLocale, t: tFn, isLoading }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useTranslation() {
  return useContext(I18nContext)
}

export { SUPPORTED_LOCALES, type SupportedLocale, type TranslationKey }
