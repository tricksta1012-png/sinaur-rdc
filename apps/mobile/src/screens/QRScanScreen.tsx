/**
 * Écran de scan QR pour enregistrement des distributions d'aide — SINAUR-RDC.
 * Utilise expo-camera pour scanner le QR code du bénéficiaire.
 * Offline-first : stocke les reçus en AsyncStorage si hors-ligne.
 */
import React, { useState, useRef } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, TextInput, ActivityIndicator, Alert,
} from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { apiClient } from '../lib/api.js'
import { useOfflineSync } from '../hooks/useOfflineSync.js'

const OFFLINE_RECEIPTS_KEY = 'sinaur_receipt_queue'

interface ScanResult {
  type: string
  id?: string
  regNum?: string
  v?: number
}

type ScanStep = 'scan' | 'confirm' | 'submitting' | 'success' | 'error'

interface ReceiptPayload {
  distributionId: string
  qrCodeScanned: string
  beneficiaryId?: string
  quantity: number
  notes?: string
  clientCreatedAt: string
}

export function QRScanScreen({ route }: { route: any }) {
  const distributionId: string = route?.params?.distributionId ?? ''
  const distributionLabel: string = route?.params?.label ?? 'Distribution'

  const { isOnline } = useOfflineSync()
  const [permission, requestPermission] = useCameraPermissions()
  const [scanned, setScanned] = useState(false)
  const [scanData, setScanData] = useState<ScanResult | null>(null)
  const [rawQR, setRawQR] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [notes, setNotes] = useState('')
  const [step, setStep] = useState<ScanStep>('scan')
  const [resultMessage, setResultMessage] = useState('')
  const [successCount, setSuccessCount] = useState(0)
  const [useManualEntry, setUseManualEntry] = useState(false)

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned) return
    setScanned(true)
    setRawQR(data)
    try {
      const parsed: ScanResult = JSON.parse(data)
      if (parsed.type === 'SINAUR_BENEFICIARY' && parsed.id) {
        setScanData(parsed)
        setStep('confirm')
      } else {
        Alert.alert('QR invalide', 'Ce QR code ne correspond pas à un bénéficiaire SINAUR-RDC.')
        setTimeout(() => setScanned(false), 2000)
      }
    } catch {
      Alert.alert('QR invalide', 'Impossible de lire ce QR code.')
      setTimeout(() => setScanned(false), 2000)
    }
  }

  const handleManualConfirm = () => {
    if (!rawQR.trim()) {
      Alert.alert('Données requises', 'Entrez les données QR')
      return
    }
    try {
      const parsed: ScanResult = JSON.parse(rawQR.trim())
      setScanData(parsed)
    } catch {
      // traiter comme opaque
      setScanData({ type: 'SINAUR_BENEFICIARY' })
    }
    setStep('confirm')
  }

  const handleConfirm = async () => {
    if (!distributionId) {
      Alert.alert('Erreur', 'Aucune distribution sélectionnée')
      return
    }

    setStep('submitting')

    const payload: ReceiptPayload = {
      distributionId,
      qrCodeScanned: rawQR,
      beneficiaryId: scanData?.id,
      quantity: parseFloat(quantity) || 1,
      notes: notes.trim() || undefined,
      clientCreatedAt: new Date().toISOString(),
    }

    if (!isOnline) {
      await enqueueReceipt(payload)
      setSuccessCount(n => n + 1)
      setResultMessage('Reçu enregistré hors-ligne. Synchronisation au retour en connexion.')
      setStep('success')
      return
    }

    try {
      await apiClient.post(`/distributions/${distributionId}/receipts`, payload)
      setSuccessCount(n => n + 1)
      setResultMessage(`Aide distribuée avec succès ! Bénéficiaire : ${scanData?.regNum ?? 'Inconnu'}`)
      setStep('success')
    } catch (e: any) {
      const code = e.response?.data?.error?.code
      if (code === 'ALREADY_RECEIVED') {
        setResultMessage('Ce bénéficiaire a déjà reçu cette aide pour cette distribution.')
      } else if (code === 'BENEFICIARY_NOT_VALIDATED') {
        setResultMessage('Bénéficiaire non encore validé par la chaîne hiérarchique.')
      } else if (e.code === 'ERR_NETWORK' || e.code === 'ECONNABORTED') {
        await enqueueReceipt(payload)
        setResultMessage('Hors-ligne — reçu mis en file de synchronisation.')
        setStep('success')
        return
      } else {
        setResultMessage(e.response?.data?.error?.message ?? 'Erreur inconnue')
      }
      setStep('error')
    }
  }

  const enqueueReceipt = async (payload: ReceiptPayload) => {
    const raw = await AsyncStorage.getItem(OFFLINE_RECEIPTS_KEY)
    const queue: ReceiptPayload[] = raw ? JSON.parse(raw) : []
    queue.push(payload)
    await AsyncStorage.setItem(OFFLINE_RECEIPTS_KEY, JSON.stringify(queue))
  }

  const resetForNextScan = () => {
    setScanned(false)
    setScanData(null)
    setRawQR('')
    setQuantity('1')
    setNotes('')
    setStep('scan')
    setResultMessage('')
  }

  if (!permission) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#b91c1c" /></View>
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionText}>Permission caméra requise pour scanner les QR codes</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
          <Text style={styles.primaryButtonText}>Autoriser la caméra</Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (step === 'success') {
    return (
      <View style={styles.center}>
        <Text style={{ fontSize: 56, marginBottom: 16 }}>✓</Text>
        <Text style={[styles.resultText, { color: '#065f46' }]}>{resultMessage}</Text>
        <Text style={styles.counterText}>{successCount} distribution(s) ce session</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={resetForNextScan}>
          <Text style={styles.primaryButtonText}>Scanner suivant</Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (step === 'error') {
    return (
      <View style={styles.center}>
        <Text style={{ fontSize: 56, marginBottom: 16 }}>✗</Text>
        <Text style={[styles.resultText, { color: '#b91c1c' }]}>{resultMessage}</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={resetForNextScan}>
          <Text style={styles.primaryButtonText}>Réessayer</Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (step === 'confirm') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Confirmer la distribution</Text>
          <Text style={styles.distributionLabel}>{distributionLabel}</Text>
          {!isOnline && (
            <View style={styles.offlineBadge}>
              <Text style={styles.offlineBadgeText}>Hors-ligne — sera synchronisé</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Bénéficiaire</Text>
          <View style={styles.benCard}>
            <Text style={styles.benRegNum}>{scanData?.regNum ?? 'QR scanné'}</Text>
            <Text style={styles.benId}>{scanData?.id?.slice(0, 16) ?? rawQR.slice(0, 30)}...</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Quantité distribuée</Text>
          <TextInput
            style={styles.input}
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="decimal-pad"
            placeholder="1"
          />

          <Text style={styles.label}>Notes (optionnel)</Text>
          <TextInput
            style={[styles.input, { height: 60, textAlignVertical: 'top' }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Observations..."
            multiline
          />
        </View>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={handleConfirm}
        >
          <Text style={styles.primaryButtonText}>Confirmer la distribution</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelButton} onPress={resetForNextScan}>
          <Text style={styles.cancelButtonText}>Annuler</Text>
        </TouchableOpacity>
      </ScrollView>
    )
  }

  if (step === 'submitting') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#b91c1c" />
        <Text style={{ marginTop: 16, color: '#6b7280' }}>Enregistrement en cours...</Text>
      </View>
    )
  }

  // Étape scan
  return (
    <View style={styles.container}>
      {!isOnline && (
        <View style={styles.offlineBannerTop}>
          <Text style={styles.offlineBannerText}>Hors-ligne — reçus mis en file</Text>
        </View>
      )}

      {!useManualEntry ? (
        <View style={{ flex: 1 }}>
          <CameraView
            style={styles.camera}
            onBarcodeScanned={handleBarCodeScanned}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          >
            <View style={styles.cameraOverlay}>
              <View style={styles.scanFrame} />
              <Text style={styles.scanHint}>Pointez vers le QR code du bénéficiaire</Text>
              <Text style={styles.distributionBadge}>{distributionLabel}</Text>
            </View>
          </CameraView>
          <TouchableOpacity
            style={styles.manualEntryButton}
            onPress={() => setUseManualEntry(true)}
          >
            <Text style={styles.manualEntryText}>Saisie manuelle</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
          <Text style={styles.sectionTitle}>Saisie manuelle du QR</Text>
          <TextInput
            style={[styles.input, { fontFamily: 'monospace', height: 80, textAlignVertical: 'top' }]}
            value={rawQR}
            onChangeText={setRawQR}
            placeholder='{"type":"SINAUR_BENEFICIARY","id":"...","regNum":"BEN-..."}'
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity style={styles.primaryButton} onPress={handleManualConfirm}>
            <Text style={styles.primaryButtonText}>Valider</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={() => setUseManualEntry(false)}>
            <Text style={styles.cancelButtonText}>Scanner avec la caméra</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#f9fafb' },
  camera: { flex: 1 },
  cameraOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  scanFrame: { width: 220, height: 220, borderWidth: 3, borderColor: '#fff', borderRadius: 16, backgroundColor: 'transparent' },
  scanHint: { color: '#fff', fontSize: 14, textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  distributionBadge: { color: '#fff', fontSize: 12, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },
  manualEntryButton: { padding: 16, alignItems: 'center', backgroundColor: '#fff' },
  manualEntryText: { color: '#b91c1c', fontWeight: '600', fontSize: 14 },
  offlineBannerTop: { backgroundColor: '#fef3c7', padding: 8 },
  offlineBannerText: { color: '#92400e', fontSize: 12, textAlign: 'center' },
  offlineBadge: { backgroundColor: '#fef3c7', borderRadius: 8, padding: 8, marginTop: 8 },
  offlineBadgeText: { color: '#92400e', fontSize: 12, textAlign: 'center' },
  section: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 8 },
  distributionLabel: { fontSize: 14, color: '#6b7280' },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 4, marginTop: 8 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#111827', backgroundColor: '#fff' },
  benCard: { backgroundColor: '#f9fafb', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  benRegNum: { fontSize: 18, fontWeight: '700', fontFamily: 'monospace', color: '#111827' },
  benId: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  primaryButton: { backgroundColor: '#b91c1c', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelButton: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  cancelButtonText: { color: '#6b7280', fontSize: 15 },
  permissionText: { fontSize: 16, textAlign: 'center', color: '#374151', marginBottom: 20 },
  resultText: { fontSize: 16, textAlign: 'center', fontWeight: '600', marginBottom: 12, paddingHorizontal: 16 },
  counterText: { fontSize: 13, color: '#9ca3af', marginBottom: 24 },
})
