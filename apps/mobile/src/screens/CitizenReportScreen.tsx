import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../lib/api.js';
import { enqueueReport } from '../stores/offlineQueue.js';
import { useLocation } from '../hooks/useLocation.js';
import { useOfflineSync } from '../hooks/useOfflineSync.js';

type HazardType = 'flood' | 'landslide' | 'mass_displacement' | 'humanitarian_crisis' | 'health_epidemic' | 'volcanic_eruption' | 'drought' | 'fire' | 'conflict' | 'earthquake' | 'other';

const HAZARD_OPTIONS: Array<{ value: HazardType; icon: string; label: string }> = [
  { value: 'flood',               icon: '🌊', label: 'Inondation' },
  { value: 'landslide',           icon: '⛰️',  label: 'Glissement' },
  { value: 'mass_displacement',   icon: '🏃', label: 'Déplacement' },
  { value: 'humanitarian_crisis', icon: '🆘', label: 'Crise hum.' },
  { value: 'health_epidemic',     icon: '🦠', label: 'Épidémie' },
  { value: 'volcanic_eruption',   icon: '🌋', label: 'Volcan' },
  { value: 'drought',             icon: '☀️',  label: 'Sécheresse' },
  { value: 'fire',                icon: '🔥', label: 'Incendie' },
  { value: 'conflict',            icon: '⚔️',  label: 'Conflit' },
  { value: 'earthquake',          icon: '📳', label: 'Séisme' },
  { value: 'other',               icon: '⚠️',  label: 'Autre' },
];

type Step = 'type' | 'details' | 'location' | 'confirm';

interface FormState {
  hazardType: HazardType | null;
  title: string;
  description: string;
  locationPcode: string;
  locationName: string;
  estimatedAffected: string;
  photoUri: string | null;
}

export function CitizenReportScreen() {
  const [step, setStep] = useState<Step>('type');
  const [form, setForm] = useState<FormState>({
    hazardType: null, title: '', description: '',
    locationPcode: 'CD01', locationName: '', estimatedAffected: '', photoUri: null,
  });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<'sent' | 'queued' | null>(null);

  const { location, loading: locLoading, error: locError, requestLocation } = useLocation();
  const { isOnline, pendingCount } = useOfflineSync();

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6, // Compression pour faible bande passante
      allowsEditing: true,
    });
    if (!result.canceled && result.assets[0]) {
      setForm((f) => ({ ...f, photoUri: result.assets[0]!.uri }));
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.5,
      allowsEditing: true,
    });
    if (!result.canceled && result.assets[0]) {
      setForm((f) => ({ ...f, photoUri: result.assets[0]!.uri }));
    }
  };

  const handleSubmit = async () => {
    if (!form.hazardType || !form.locationName.trim()) {
      Alert.alert('Champs manquants', 'Veuillez remplir le type d\'événement et la localisation.');
      return;
    }

    setSubmitting(true);

    const payload: Record<string, unknown> = {
      title: form.title.trim() || `${HAZARD_OPTIONS.find(h => h.value === form.hazardType)?.label} — ${form.locationName}`,
      description: form.description,
      hazardType: form.hazardType,
      severity: 'Unknown',
      source: 'citizen',
      locationPcode: form.locationPcode,
      locationName: form.locationName,
      locationLevel: 1,
      locationAccuracy: location ? 'gps' : 'province',
      estimatedAffected: form.estimatedAffected ? parseInt(form.estimatedAffected, 10) : undefined,
      locationLat: location?.latitude,
      locationLng: location?.longitude,
    };

    try {
      if (!isOnline) throw new Error('offline');
      await api.post('/events', payload);
      setDone('sent');
    } catch (err: any) {
      if (!isOnline || err.message === 'offline' || err?.code === 'ERR_NETWORK') {
        await enqueueReport(payload);
        setDone('queued');
      } else if (err?.response?.status === 409) {
        setDone('sent'); // Doublon côté serveur — traité
      } else {
        Alert.alert('Erreur', 'Impossible d\'envoyer. Le signalement sera sauvegardé localement.');
        await enqueueReport(payload);
        setDone('queued');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <View style={styles.doneContainer}>
        <Text style={styles.doneIcon}>{done === 'sent' ? '✅' : '📥'}</Text>
        <Text style={styles.doneTitle}>
          {done === 'sent' ? 'Signalement envoyé !' : 'Signalement sauvegardé'}
        </Text>
        <Text style={styles.doneText}>
          {done === 'sent'
            ? 'Votre signalement a été reçu. Un SMS de confirmation sera envoyé si votre numéro est enregistré.'
            : `Vous êtes hors ligne. Le signalement sera envoyé automatiquement à la reconnexion. ${pendingCount} en attente.`}
        </Text>
        <TouchableOpacity
          style={styles.newBtn}
          onPress={() => { setDone(null); setStep('type'); setForm({ hazardType: null, title: '', description: '', locationPcode: 'CD01', locationName: '', estimatedAffected: '', photoUri: null }); }}
        >
          <Text style={styles.newBtnText}>Nouveau signalement</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Indicateur hors-ligne */}
      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>📵 Hors ligne — enregistrement local</Text>
        </View>
      )}

      {/* Étape 1 : Sélection du type */}
      {step === 'type' && (
        <>
          <Text style={styles.stepTitle}>Que se passe-t-il ?</Text>
          <Text style={styles.stepSub}>Sélectionnez le type d'événement</Text>
          <View style={styles.hazardGrid}>
            {HAZARD_OPTIONS.map((h) => (
              <TouchableOpacity
                key={h.value}
                style={[styles.hazardBtn, form.hazardType === h.value && styles.hazardBtnActive]}
                onPress={() => { setForm((f) => ({ ...f, hazardType: h.value })); setStep('details'); }}
                activeOpacity={0.7}
              >
                <Text style={styles.hazardIcon}>{h.icon}</Text>
                <Text style={[styles.hazardLabel, form.hazardType === h.value && styles.hazardLabelActive]}>
                  {h.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {/* Étape 2 : Détails */}
      {step === 'details' && (
        <>
          <Text style={styles.stepTitle}>
            {HAZARD_OPTIONS.find(h => h.value === form.hazardType)?.icon} Décrivez la situation
          </Text>

          <Text style={styles.label}>Description (optionnel)</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            multiline
            numberOfLines={4}
            placeholder="Décrivez ce que vous observez, le nombre de personnes concernées, les besoins urgents..."
            value={form.description}
            onChangeText={(t) => setForm((f) => ({ ...f, description: t }))}
            placeholderTextColor="#9ca3af"
          />

          <Text style={styles.label}>Personnes affectées (estimation)</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            placeholder="Ex: 50"
            value={form.estimatedAffected}
            onChangeText={(t) => setForm((f) => ({ ...f, estimatedAffected: t }))}
            placeholderTextColor="#9ca3af"
          />

          <Text style={styles.label}>Photo (optionnel)</Text>
          <View style={styles.photoRow}>
            <TouchableOpacity style={styles.photoBtn} onPress={takePhoto}>
              <Text style={styles.photoBtnText}>📷 Prendre une photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.photoBtn} onPress={pickPhoto}>
              <Text style={styles.photoBtnText}>🖼️ Galerie</Text>
            </TouchableOpacity>
          </View>
          {form.photoUri && (
            <Image source={{ uri: form.photoUri }} style={styles.photoPreview} />
          )}

          <View style={styles.navRow}>
            <TouchableOpacity style={styles.backBtn} onPress={() => setStep('type')}>
              <Text style={styles.backBtnText}>← Retour</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.nextBtn} onPress={() => setStep('location')}>
              <Text style={styles.nextBtnText}>Suivant →</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* Étape 3 : Localisation */}
      {step === 'location' && (
        <>
          <Text style={styles.stepTitle}>📍 Où se passe-t-il ?</Text>

          <Text style={styles.label}>Province *</Text>
          <View style={styles.provinceNote}>
            <Text style={styles.provinceNoteText}>
              Province sélectionnée : Kinshasa (CD01){'\n'}
              (La liste complète se charge avec connexion)
            </Text>
          </View>

          <Text style={styles.label}>Localité précise *</Text>
          <TextInput
            style={styles.input}
            placeholder="Ville, quartier, village..."
            value={form.locationName}
            onChangeText={(t) => setForm((f) => ({ ...f, locationName: t }))}
            placeholderTextColor="#9ca3af"
          />

          <TouchableOpacity
            style={styles.gpsBtn}
            onPress={requestLocation}
            disabled={locLoading}
          >
            {locLoading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.gpsBtnText}>
                  {location ? `✓ GPS : ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}` : '📍 Obtenir ma position GPS'}
                </Text>
            }
          </TouchableOpacity>
          {locError && <Text style={styles.errorText}>{locError}</Text>}

          <View style={styles.navRow}>
            <TouchableOpacity style={styles.backBtn} onPress={() => setStep('details')}>
              <Text style={styles.backBtnText}>← Retour</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.nextBtn, !form.locationName.trim() && styles.nextBtnDisabled]}
              onPress={() => form.locationName.trim() && setStep('confirm')}
              disabled={!form.locationName.trim()}
            >
              <Text style={styles.nextBtnText}>Suivant →</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* Étape 4 : Confirmation */}
      {step === 'confirm' && (
        <>
          <Text style={styles.stepTitle}>Confirmer le signalement</Text>

          <View style={styles.confirmCard}>
            <Text style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Type : </Text>
              {HAZARD_OPTIONS.find(h => h.value === form.hazardType)?.icon}{' '}
              {HAZARD_OPTIONS.find(h => h.value === form.hazardType)?.label}
            </Text>
            {form.description ? (
              <Text style={styles.confirmRow}><Text style={styles.confirmLabel}>Description : </Text>{form.description}</Text>
            ) : null}
            <Text style={styles.confirmRow}><Text style={styles.confirmLabel}>Localité : </Text>{form.locationName}</Text>
            {location && (
              <Text style={styles.confirmRow}>
                <Text style={styles.confirmLabel}>GPS : </Text>
                {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
              </Text>
            )}
            {form.estimatedAffected ? (
              <Text style={styles.confirmRow}><Text style={styles.confirmLabel}>Affectés : </Text>~{form.estimatedAffected} personnes</Text>
            ) : null}
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.8}
          >
            {submitting
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.submitBtnText}>
                  {isOnline ? '📢 Envoyer le signalement' : '📥 Sauvegarder (hors ligne)'}
                </Text>
            }
          </TouchableOpacity>

          <TouchableOpacity style={styles.backBtn} onPress={() => setStep('location')}>
            <Text style={styles.backBtnText}>← Modifier</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 20, paddingBottom: 40 },
  offlineBanner: { backgroundColor: '#f97316', borderRadius: 10, padding: 10, marginBottom: 16, alignItems: 'center' },
  offlineText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  stepTitle: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 4 },
  stepSub: { fontSize: 14, color: '#6b7280', marginBottom: 20 },
  hazardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  hazardBtn: { width: '28%', alignItems: 'center', padding: 12, borderRadius: 14, borderWidth: 2, borderColor: '#e5e7eb', backgroundColor: '#fff' },
  hazardBtnActive: { borderColor: '#b91c1c', backgroundColor: '#fef2f2' },
  hazardIcon: { fontSize: 28, marginBottom: 4 },
  hazardLabel: { fontSize: 11, color: '#6b7280', textAlign: 'center', fontWeight: '500' },
  hazardLabelActive: { color: '#b91c1c', fontWeight: '700' },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 6, marginTop: 16 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, padding: 12, fontSize: 14, color: '#111827' },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  photoRow: { flexDirection: 'row', gap: 10 },
  photoBtn: { flex: 1, backgroundColor: '#f3f4f6', borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#e5e7eb' },
  photoBtnText: { fontSize: 13, color: '#374151', fontWeight: '500' },
  photoPreview: { width: '100%', height: 160, borderRadius: 10, marginTop: 10, backgroundColor: '#e5e7eb' },
  navRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 24 },
  backBtn: { paddingVertical: 10, paddingHorizontal: 20 },
  backBtnText: { fontSize: 15, color: '#6b7280', fontWeight: '500' },
  nextBtn: { backgroundColor: '#b91c1c', paddingVertical: 12, paddingHorizontal: 28, borderRadius: 12 },
  nextBtnDisabled: { backgroundColor: '#fca5a5' },
  nextBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  gpsBtn: { backgroundColor: '#1d4ed8', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 6 },
  gpsBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  errorText: { color: '#ef4444', fontSize: 12, marginTop: 4 },
  provinceNote: { backgroundColor: '#eff6ff', borderRadius: 8, padding: 10, marginBottom: 4 },
  provinceNoteText: { fontSize: 12, color: '#1e40af' },
  confirmCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#e5e7eb', marginBottom: 24, gap: 8 },
  confirmRow: { fontSize: 14, color: '#374151', lineHeight: 22 },
  confirmLabel: { fontWeight: '700', color: '#111827' },
  submitBtn: { backgroundColor: '#b91c1c', borderRadius: 14, padding: 18, alignItems: 'center', marginBottom: 16 },
  submitBtnDisabled: { backgroundColor: '#fca5a5' },
  submitBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  doneContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#f9fafb' },
  doneIcon: { fontSize: 72, marginBottom: 16 },
  doneTitle: { fontSize: 24, fontWeight: '700', color: '#111827', textAlign: 'center', marginBottom: 8 },
  doneText: { fontSize: 15, color: '#6b7280', textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  newBtn: { backgroundColor: '#b91c1c', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 36 },
  newBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
