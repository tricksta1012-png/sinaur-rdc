/**
 * Écran d'enregistrement de bénéficiaire — offline-first.
 * Identique au formulaire web, adapté React Native.
 * Stocke dans AsyncStorage si hors-ligne, synchronise au retour en connexion.
 */
import React, { useState } from 'react'
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Switch, Alert, ActivityIndicator,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { apiClient } from '../lib/api.js'
import { useOfflineSync } from '../hooks/useOfflineSync.js'

const HAZARD_TYPES = [
  { value: 'flood', label: 'Inondation' },
  { value: 'mass_displacement', label: 'Déplacement' },
  { value: 'humanitarian_crisis', label: 'Crise humanitaire' },
  { value: 'health_epidemic', label: 'Épidémie' },
  { value: 'drought', label: 'Sécheresse' },
  { value: 'conflict', label: 'Conflit armé' },
  { value: 'landslide', label: 'Glissement' },
  { value: 'fire', label: 'Incendie' },
]

const VULN_FACTORS = [
  { value: 'elderly', label: 'Personne âgée' },
  { value: 'child_alone', label: 'Enfant non accompagné' },
  { value: 'disability', label: 'Handicap' },
  { value: 'chronic_illness', label: 'Maladie chronique' },
  { value: 'gbv_survivor', label: 'Survivant(e) VBG' },
  { value: 'conflict_survivor', label: 'Survivant(e) conflit' },
]

const OFFLINE_QUEUE_KEY = 'sinaur_beneficiary_queue'

interface FormState {
  headFirstName: string
  headLastName: string
  headBirthDate: string
  headGender: 'M' | 'F' | 'other'
  locationPcode: string
  locationName: string
  disasterType: string
  vulnerabilityFactors: string[]
  isSensitive: boolean
  notes: string
}

type SubmitState = 'idle' | 'submitting' | 'success_online' | 'success_offline' | 'error'

export function BeneficiaryRegistrationScreen() {
  const { isOnline } = useOfflineSync()
  const [form, setForm] = useState<FormState>({
    headFirstName: '', headLastName: '', headBirthDate: '',
    headGender: 'M', locationPcode: '', locationName: '',
    disasterType: '', vulnerabilityFactors: [], isSensitive: false, notes: '',
  })
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [registrationNumber, setRegistrationNumber] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const toggleFactor = (value: string) => {
    setForm(f => ({
      ...f,
      vulnerabilityFactors: f.vulnerabilityFactors.includes(value)
        ? f.vulnerabilityFactors.filter(v => v !== value)
        : [...f.vulnerabilityFactors, value],
    }))
  }

  const validate = (): string | null => {
    if (!form.headFirstName.trim()) return 'Prénom du chef de ménage requis'
    if (!form.headLastName.trim()) return 'Nom du chef de ménage requis'
    if (!form.locationPcode.trim()) return 'P-code de province requis'
    if (!form.locationName.trim()) return 'Localité requise'
    if (!form.disasterType) return 'Type d\'aléa requis'
    return null
  }

  const enqueueBeneficiary = async (payload: object) => {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY)
    const queue: object[] = raw ? JSON.parse(raw) : []
    queue.push({ ...payload, _enqueuedAt: new Date().toISOString() })
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue))
  }

  const handleSubmit = async () => {
    const validationError = validate()
    if (validationError) {
      Alert.alert('Données manquantes', validationError)
      return
    }

    setSubmitState('submitting')
    setErrorMsg('')

    const payload = {
      householdHead: {
        firstName: form.headFirstName.trim(),
        lastName: form.headLastName.trim(),
        birthDate: form.headBirthDate || undefined,
        gender: form.headGender,
        isHeadOfHousehold: true,
      },
      householdMembers: [],
      vulnerabilityFactors: form.vulnerabilityFactors,
      disasterType: form.disasterType,
      locationPcode: form.locationPcode.trim().toUpperCase(),
      locationName: form.locationName.trim(),
      isSensitive: form.isSensitive,
      notes: form.notes.trim() || undefined,
      clientCreatedAt: new Date().toISOString(),
    }

    if (!isOnline) {
      await enqueueBeneficiary(payload)
      setSubmitState('success_offline')
      return
    }

    try {
      const res = await apiClient.post('/beneficiaries', payload)
      setRegistrationNumber(res.data.data.registrationNumber)
      setSubmitState('success_online')
    } catch (e: any) {
      const code = e.response?.data?.error?.code
      if (code === 'DUPLICATE_BENEFICIARY') {
        setSubmitState('error')
        setErrorMsg('Doublon détecté — ce bénéficiaire existe déjà dans le registre.')
      } else if (e.code === 'ERR_NETWORK' || e.code === 'ECONNABORTED') {
        await enqueueBeneficiary(payload)
        setSubmitState('success_offline')
      } else {
        setSubmitState('error')
        setErrorMsg(e.response?.data?.error?.message ?? 'Erreur de soumission')
      }
    }
  }

  const reset = () => {
    setForm({
      headFirstName: '', headLastName: '', headBirthDate: '', headGender: 'M',
      locationPcode: '', locationName: '', disasterType: '', vulnerabilityFactors: [],
      isSensitive: false, notes: '',
    })
    setSubmitState('idle')
    setRegistrationNumber(null)
    setErrorMsg('')
  }

  if (submitState === 'success_online' && registrationNumber) {
    return (
      <View style={styles.successContainer}>
        <Text style={styles.successIcon}>✓</Text>
        <Text style={styles.successTitle}>Bénéficiaire enregistré</Text>
        <Text style={styles.successSubtitle}>Numéro d'enregistrement :</Text>
        <Text style={styles.successRegNum}>{registrationNumber}</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={reset}>
          <Text style={styles.primaryButtonText}>Nouveau bénéficiaire</Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (submitState === 'success_offline') {
    return (
      <View style={styles.successContainer}>
        <Text style={styles.successIcon}>⏳</Text>
        <Text style={styles.successTitle}>Enregistré hors-ligne</Text>
        <Text style={styles.successSubtitle}>
          La fiche sera synchronisée automatiquement au retour en connexion.
        </Text>
        <TouchableOpacity style={styles.primaryButton} onPress={reset}>
          <Text style={styles.primaryButtonText}>Nouveau bénéficiaire</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>Mode hors-ligne — sera synchronisé à la reconnexion</Text>
        </View>
      )}

      {/* Chef de ménage */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Chef de ménage</Text>

        <Text style={styles.label}>Prénom *</Text>
        <TextInput style={styles.input} value={form.headFirstName}
          onChangeText={v => setForm(f => ({ ...f, headFirstName: v }))}
          placeholder="Prénom" />

        <Text style={styles.label}>Nom *</Text>
        <TextInput style={styles.input} value={form.headLastName}
          onChangeText={v => setForm(f => ({ ...f, headLastName: v }))}
          placeholder="Nom de famille" />

        <Text style={styles.label}>Date de naissance</Text>
        <TextInput style={styles.input} value={form.headBirthDate}
          onChangeText={v => setForm(f => ({ ...f, headBirthDate: v }))}
          placeholder="AAAA-MM-JJ" keyboardType="numeric" />

        <Text style={styles.label}>Genre</Text>
        <View style={styles.radioRow}>
          {(['M', 'F', 'other'] as const).map(g => (
            <TouchableOpacity
              key={g}
              style={[styles.radioButton, form.headGender === g && styles.radioButtonActive]}
              onPress={() => setForm(f => ({ ...f, headGender: g }))}
            >
              <Text style={[styles.radioText, form.headGender === g && styles.radioTextActive]}>
                {g === 'M' ? 'Masculin' : g === 'F' ? 'Féminin' : 'Autre'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Type d'aléa */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Type d'aléa *</Text>
        <View style={styles.chipGrid}>
          {HAZARD_TYPES.map(h => (
            <TouchableOpacity
              key={h.value}
              style={[styles.chip, form.disasterType === h.value && styles.chipActive]}
              onPress={() => setForm(f => ({ ...f, disasterType: h.value }))}
            >
              <Text style={[styles.chipText, form.disasterType === h.value && styles.chipTextActive]}>
                {h.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Localisation */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Localisation</Text>

        <Text style={styles.label}>Code province (P-code) *</Text>
        <TextInput style={styles.input} value={form.locationPcode}
          onChangeText={v => setForm(f => ({ ...f, locationPcode: v }))}
          placeholder="ex: CD01" autoCapitalize="characters" />

        <Text style={styles.label}>Localité actuelle *</Text>
        <TextInput style={styles.input} value={form.locationName}
          onChangeText={v => setForm(f => ({ ...f, locationName: v }))}
          placeholder="Village ou quartier" />
      </View>

      {/* Facteurs vulnérabilité */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Facteurs de vulnérabilité</Text>
        {VULN_FACTORS.map(f => (
          <TouchableOpacity
            key={f.value}
            style={styles.checkRow}
            onPress={() => toggleFactor(f.value)}
          >
            <View style={[styles.checkbox, form.vulnerabilityFactors.includes(f.value) && styles.checkboxChecked]}>
              {form.vulnerabilityFactors.includes(f.value) && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.checkLabel}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Données sensibles */}
      <View style={styles.section}>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>Données sensibles</Text>
            <Text style={styles.switchHint}>Cocher si localisation doit être masquée (ex: fuite conflit)</Text>
          </View>
          <Switch
            value={form.isSensitive}
            onValueChange={v => setForm(f => ({ ...f, isSensitive: v }))}
            trackColor={{ false: '#d1d5db', true: '#b91c1c' }}
            thumbColor="#fff"
          />
        </View>

        <Text style={styles.label}>Notes</Text>
        <TextInput
          style={[styles.input, { height: 70, textAlignVertical: 'top' }]}
          value={form.notes}
          onChangeText={v => setForm(f => ({ ...f, notes: v }))}
          placeholder="Observations particulières..."
          multiline
        />
      </View>

      {submitState === 'error' && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{errorMsg || 'Erreur lors de l\'enregistrement'}</Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.primaryButton, submitState === 'submitting' && styles.primaryButtonDisabled]}
        onPress={handleSubmit}
        disabled={submitState === 'submitting'}
      >
        {submitState === 'submitting'
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.primaryButtonText}>Enregistrer le bénéficiaire</Text>
        }
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 16, paddingBottom: 40 },
  offlineBanner: { backgroundColor: '#fef3c7', borderRadius: 10, padding: 10, marginBottom: 12 },
  offlineBannerText: { color: '#92400e', fontSize: 13, textAlign: 'center' },
  section: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 4, marginTop: 8 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#111827', backgroundColor: '#fff' },
  radioRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  radioButton: { flex: 1, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  radioButtonActive: { borderColor: '#b91c1c', backgroundColor: '#fef2f2' },
  radioText: { fontSize: 13, color: '#6b7280' },
  radioTextActive: { color: '#b91c1c', fontWeight: '600' },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { borderColor: '#b91c1c', backgroundColor: '#b91c1c' },
  chipText: { fontSize: 12, color: '#6b7280' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  checkRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: '#d1d5db', marginRight: 10, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: '#b91c1c', borderColor: '#b91c1c' },
  checkmark: { color: '#fff', fontSize: 12, fontWeight: '700' },
  checkLabel: { fontSize: 14, color: '#374151' },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  switchLabel: { fontSize: 14, fontWeight: '600', color: '#374151' },
  switchHint: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  errorBox: { backgroundColor: '#fef2f2', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#fecaca' },
  errorText: { color: '#b91c1c', fontSize: 13 },
  primaryButton: { backgroundColor: '#b91c1c', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  primaryButtonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  successContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#f9fafb' },
  successIcon: { fontSize: 64, marginBottom: 16 },
  successTitle: { fontSize: 22, fontWeight: '700', color: '#065f46', marginBottom: 8 },
  successSubtitle: { fontSize: 14, color: '#6b7280', marginBottom: 4 },
  successRegNum: { fontSize: 28, fontWeight: '800', fontFamily: 'monospace', color: '#111827', marginBottom: 24 },
})
