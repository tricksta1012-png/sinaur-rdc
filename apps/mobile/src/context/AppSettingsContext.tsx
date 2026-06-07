/**
 * Contexte global des paramètres de l'application SINAUR-RDC Mobile.
 * Persiste dans AsyncStorage. Fournit : langue, mode économie, mode mémoire faible.
 */
import React, {
  createContext, useContext, useState, useEffect, type ReactNode,
} from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { type SupportedLocale, loadLocale, setLocale, t as tRaw, type TranslationKey } from '@sinaur/i18n'

interface AppSettings {
  locale: SupportedLocale
  dataSaver: boolean       // Réduit sync, compresse images, limite requêtes parallèles
  lowMemoryMode: boolean   // Réduit renders, désactive animations
}

interface AppSettingsContextValue extends AppSettings {
  setAppLocale: (locale: SupportedLocale) => Promise<void>
  toggleDataSaver: () => Promise<void>
  toggleLowMemory: () => Promise<void>
  t: (key: TranslationKey, fallback?: string) => string
  localeLoaded: boolean
}

const SETTINGS_KEY = 'sinaur_app_settings'

const defaults: AppSettings = {
  locale: 'fr',
  dataSaver: false,
  lowMemoryMode: false,
}

const AppSettingsContext = createContext<AppSettingsContextValue>({
  ...defaults,
  setAppLocale: async () => {},
  toggleDataSaver: async () => {},
  toggleLowMemory: async () => {},
  t: (key) => key,
  localeLoaded: false,
})

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(defaults)
  const [localeLoaded, setLocaleLoaded] = useState(false)
  const [, setVersion] = useState(0)

  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY).then(raw => {
      const saved: Partial<AppSettings> = raw ? JSON.parse(raw) : {}
      const merged = { ...defaults, ...saved }
      setSettings(merged)
      loadLocale(merged.locale).then(translations => {
        setLocale(merged.locale, translations)
        setLocaleLoaded(true)
        setVersion(v => v + 1)
      })
    })
  }, [])

  const persist = async (next: AppSettings) => {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
    setSettings(next)
  }

  const setAppLocale = async (locale: SupportedLocale) => {
    const translations = await loadLocale(locale)
    setLocale(locale, translations)
    setVersion(v => v + 1)
    await persist({ ...settings, locale })
  }

  const toggleDataSaver = async () => {
    await persist({ ...settings, dataSaver: !settings.dataSaver })
  }

  const toggleLowMemory = async () => {
    await persist({ ...settings, lowMemoryMode: !settings.lowMemoryMode })
  }

  return (
    <AppSettingsContext.Provider value={{
      ...settings,
      setAppLocale,
      toggleDataSaver,
      toggleLowMemory,
      t: (key, fallback) => tRaw(key, fallback),
      localeLoaded,
    }}>
      {children}
    </AppSettingsContext.Provider>
  )
}

export function useAppSettings() {
  return useContext(AppSettingsContext)
}
