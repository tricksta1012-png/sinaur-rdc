/**
 * Écran Paramètres — SINAUR-RDC Mobile.
 * Langue (5 langues RDC), mode économie de données, mode mémoire faible,
 * informations sur la version.
 */
import React from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Switch, Alert,
} from 'react-native'
import { useAppSettings } from '../context/AppSettingsContext.js'
import { SUPPORTED_LOCALES, type SupportedLocale } from '@sinaur/i18n'

const LOCALE_FLAGS: Record<SupportedLocale, string> = {
  fr: '🇫🇷',
  ln: '🇨🇩',
  sw: '🇨🇩',
  kg: '🇨🇩',
  lua: '🇨🇩',
}

export function SettingsScreen() {
  const { locale, dataSaver, lowMemoryMode, setAppLocale, toggleDataSaver, toggleLowMemory, t } = useAppSettings()

  const handleLocaleChange = (newLocale: SupportedLocale) => {
    if (newLocale === locale) return
    Alert.alert(
      'Changer la langue',
      `Passer à ${SUPPORTED_LOCALES[newLocale]} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Confirmer', onPress: () => void setAppLocale(newLocale) },
      ],
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Langue */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings.language')}</Text>
        <Text style={styles.sectionHint}>SINAUR-RDC fonctionne en 5 langues nationales</Text>
        {(Object.entries(SUPPORTED_LOCALES) as [SupportedLocale, string][]).map(([code, name]) => (
          <TouchableOpacity
            key={code}
            style={[styles.localeRow, locale === code && styles.localeRowActive]}
            onPress={() => handleLocaleChange(code)}
          >
            <Text style={styles.localeFlag}>{LOCALE_FLAGS[code]}</Text>
            <Text style={[styles.localeName, locale === code && styles.localeNameActive]}>
              {name}
            </Text>
            {locale === code && <Text style={styles.checkmark}>✓</Text>}
          </TouchableOpacity>
        ))}
      </View>

      {/* Performances */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Performances</Text>

        <View style={styles.settingRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.settingLabel}>{t('settings.data_saver')}</Text>
            <Text style={styles.settingHint}>
              Réduit la fréquence de sync (90s), compresse les images. Recommandé sur réseau 2G.
            </Text>
          </View>
          <Switch
            value={dataSaver}
            onValueChange={() => void toggleDataSaver()}
            trackColor={{ false: '#d1d5db', true: '#b91c1c' }}
            thumbColor="#fff"
          />
        </View>

        <View style={styles.divider} />

        <View style={styles.settingRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.settingLabel}>Mode mémoire faible</Text>
            <Text style={styles.settingHint}>
              Désactive animations, réduit le nombre d'éléments rendus. Pour appareils Android entry-level.
            </Text>
          </View>
          <Switch
            value={lowMemoryMode}
            onValueChange={() => void toggleLowMemory()}
            trackColor={{ false: '#d1d5db', true: '#b91c1c' }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* À propos */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings.about')}</Text>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Application</Text>
          <Text style={styles.aboutValue}>SINAUR-RDC Mobile</Text>
        </View>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Version</Text>
          <Text style={styles.aboutValue}>0.4.0-phase4</Text>
        </View>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Organisme</Text>
          <Text style={styles.aboutValue}>DGSS-RDC / OCHA</Text>
        </View>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Standard</Text>
          <Text style={styles.aboutValue}>CAP 1.2 / P-codes OCHA</Text>
        </View>
        <Text style={styles.disclaimer}>
          Les données de cette application sont protégées et traitées conformément
          aux principes humanitaires. Les données personnelles des bénéficiaires
          sont chiffrées et cloisonnées (spec §9).
        </Text>
      </View>

      {/* Accès sans données */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Accès sans données (USSD)</Text>
        <Text style={styles.ussdInfo}>
          Pour signaler un événement sans connexion internet ni application:
        </Text>
        <View style={styles.ussdCode}>
          <Text style={styles.ussdCodeText}>*777*SINAUR#</Text>
        </View>
        <Text style={styles.ussdHint}>
          Disponible sur tous les opérateurs mobiles en RDC.{'\n'}
          Fonctionne sur téléphones basiques (non-smartphone).{'\n'}
          Menus disponibles en FR / Lingala / Kiswahili.
        </Text>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 16, paddingBottom: 40 },
  section: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 4 },
  sectionHint: { fontSize: 12, color: '#9ca3af', marginBottom: 12 },
  localeRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4, borderRadius: 10, gap: 12 },
  localeRowActive: { backgroundColor: '#fef2f2' },
  localeFlag: { fontSize: 24 },
  localeName: { flex: 1, fontSize: 15, color: '#374151' },
  localeNameActive: { color: '#b91c1c', fontWeight: '600' },
  checkmark: { fontSize: 16, color: '#b91c1c', fontWeight: '700' },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  settingLabel: { fontSize: 14, fontWeight: '600', color: '#374151' },
  settingHint: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  divider: { height: 1, backgroundColor: '#f3f4f6', marginVertical: 12 },
  aboutRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  aboutLabel: { fontSize: 13, color: '#6b7280' },
  aboutValue: { fontSize: 13, fontWeight: '600', color: '#374151' },
  disclaimer: { fontSize: 11, color: '#9ca3af', marginTop: 12, lineHeight: 16 },
  ussdInfo: { fontSize: 13, color: '#6b7280', marginBottom: 10 },
  ussdCode: { backgroundColor: '#111827', borderRadius: 10, padding: 12, alignItems: 'center', marginBottom: 10 },
  ussdCodeText: { color: '#34d399', fontFamily: 'monospace', fontSize: 20, fontWeight: '700', letterSpacing: 2 },
  ussdHint: { fontSize: 12, color: '#9ca3af', lineHeight: 18 },
})
