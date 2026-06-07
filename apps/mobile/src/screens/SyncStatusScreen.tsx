/**
 * Écran de statut de synchronisation offline — SINAUR-RDC Mobile.
 * Affiche les éléments en attente par type, permet la sync manuelle
 * et le retry des éléments en échec.
 */
import React, { useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import {
  loadQueue, retryFailed, clearSynced, syncAll,
  type QueueItem, type QueueItemStatus,
} from '../stores/syncManager.js'
import { useOfflineSync } from '../hooks/useOfflineSync.js'
import { useAppSettings } from '../context/AppSettingsContext.js'

const STATUS_LABEL: Record<QueueItemStatus, string> = {
  pending: 'En attente',
  syncing: 'En cours',
  synced: 'Synchronisé',
  failed: 'Échec',
  duplicate: 'Doublon',
}

const STATUS_COLOR: Record<QueueItemStatus, string> = {
  pending: '#f59e0b',
  syncing: '#3b82f6',
  synced: '#10b981',
  failed: '#ef4444',
  duplicate: '#9ca3af',
}

const TYPE_LABEL: Record<string, string> = {
  event: 'Événement',
  beneficiary: 'Bénéficiaire',
  receipt: 'Reçu distribution',
}

const TYPE_ICON: Record<string, string> = {
  event: '⚠️',
  beneficiary: '👤',
  receipt: '📦',
}

export function SyncStatusScreen() {
  const { t, dataSaver } = useAppSettings()
  const { isOnline, syncing, sync, lastSyncResult } = useOfflineSync(dataSaver)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    const q = await loadQueue()
    setQueue(q.sort((a, b) => new Date(b.enqueuedAt).getTime() - new Date(a.enqueuedAt).getTime()))
    setLoading(false)
  }, [])

  useFocusEffect(useCallback(() => { void loadData() }, [loadData]))

  const handleSync = async () => {
    setSyncProgress({ done: 0, total: 0 })
    await syncAll((done, total) => setSyncProgress({ done, total }))
    setSyncProgress(null)
    await loadData()
  }

  const handleRetry = async () => {
    await retryFailed()
    await loadData()
  }

  const handleClear = async () => {
    Alert.alert(
      'Effacer les éléments synchronisés',
      'Supprimer les éléments déjà synchronisés de l\'historique?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Effacer', style: 'destructive',
          onPress: async () => { await clearSynced(); await loadData() },
        },
      ],
    )
  }

  const pending = queue.filter(i => i.status === 'pending').length
  const failed = queue.filter(i => i.status === 'failed').length
  const synced = queue.filter(i => i.status === 'synced' || i.status === 'duplicate').length

  const renderItem = ({ item }: { item: QueueItem }) => (
    <View style={styles.itemCard}>
      <View style={styles.itemHeader}>
        <Text style={styles.itemType}>{TYPE_ICON[item.type]} {TYPE_LABEL[item.type] ?? item.type}</Text>
        <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[item.status] + '20' }]}>
          <Text style={[styles.statusText, { color: STATUS_COLOR[item.status] }]}>
            {STATUS_LABEL[item.status]}
          </Text>
        </View>
      </View>
      <Text style={styles.itemEndpoint}>{item.method} {item.endpoint}</Text>
      <View style={styles.itemMeta}>
        <Text style={styles.itemDate}>
          {new Date(item.enqueuedAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </Text>
        {item.attempts > 0 && (
          <Text style={styles.itemAttempts}>{item.attempts} tentative(s)</Text>
        )}
        {item.priority > 0 && (
          <Text style={styles.priorityBadge}>PRIORITÉ</Text>
        )}
      </View>
      {item.lastError && (
        <Text style={styles.errorText} numberOfLines={2}>{item.lastError}</Text>
      )}
    </View>
  )

  return (
    <View style={styles.container}>
      {/* Header stats */}
      <View style={styles.statsRow}>
        <View style={[styles.statCard, { borderColor: '#f59e0b' }]}>
          <Text style={styles.statNumber}>{pending}</Text>
          <Text style={styles.statLabel}>En attente</Text>
        </View>
        <View style={[styles.statCard, { borderColor: '#ef4444' }]}>
          <Text style={[styles.statNumber, { color: '#ef4444' }]}>{failed}</Text>
          <Text style={styles.statLabel}>Échec</Text>
        </View>
        <View style={[styles.statCard, { borderColor: '#10b981' }]}>
          <Text style={[styles.statNumber, { color: '#10b981' }]}>{synced}</Text>
          <Text style={styles.statLabel}>Synchronisé</Text>
        </View>
      </View>

      {/* Connexion + mode */}
      <View style={styles.statusBar}>
        <View style={[styles.dot, { backgroundColor: isOnline ? '#10b981' : '#ef4444' }]} />
        <Text style={styles.statusText2}>
          {isOnline ? 'En ligne' : 'Hors ligne'}
          {dataSaver ? ' · Mode économie' : ''}
        </Text>
        {lastSyncResult && (
          <Text style={styles.lastSync}>
            Dernière sync : {lastSyncResult.synced}↑ {lastSyncResult.failed}✗
          </Text>
        )}
      </View>

      {/* Progression */}
      {syncProgress && syncProgress.total > 0 && (
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${(syncProgress.done / syncProgress.total) * 100}%` }]} />
        </View>
      )}

      {/* Actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionBtn, (!isOnline || syncing) && styles.actionBtnDisabled]}
          onPress={handleSync}
          disabled={!isOnline || syncing}
        >
          {syncing
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.actionBtnText}>{t('sync.manual')}</Text>
          }
        </TouchableOpacity>

        {failed > 0 && (
          <TouchableOpacity style={[styles.actionBtn, styles.retryBtn]} onPress={handleRetry}>
            <Text style={styles.actionBtnText}>Réessayer les échecs</Text>
          </TouchableOpacity>
        )}

        {synced > 5 && (
          <TouchableOpacity style={[styles.actionBtn, styles.clearBtn]} onPress={handleClear}>
            <Text style={[styles.actionBtnText, { color: '#6b7280' }]}>Effacer l'historique</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Liste */}
      <FlatList
        data={queue}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadData} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>✓</Text>
            <Text style={styles.emptyText}>Aucun élément en attente</Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
        // Optimisations Android bas de gamme
        maxToRenderPerBatch={8}
        windowSize={5}
        removeClippedSubviews
        initialNumToRender={10}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  statsRow: { flexDirection: 'row', gap: 8, padding: 12 },
  statCard: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#e5e7eb' },
  statNumber: { fontSize: 24, fontWeight: '800', color: '#111827' },
  statLabel: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  statusBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingBottom: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText2: { fontSize: 13, color: '#374151', flex: 1 },
  lastSync: { fontSize: 11, color: '#9ca3af' },
  progressBar: { height: 3, backgroundColor: '#e5e7eb', marginHorizontal: 12, borderRadius: 2, marginBottom: 8 },
  progressFill: { height: 3, backgroundColor: '#b91c1c', borderRadius: 2 },
  actionsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 8, flexWrap: 'wrap' },
  actionBtn: { backgroundColor: '#b91c1c', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  actionBtnDisabled: { opacity: 0.5 },
  retryBtn: { backgroundColor: '#f59e0b' },
  clearBtn: { backgroundColor: '#f3f4f6' },
  actionBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  listContent: { padding: 12, paddingTop: 4 },
  itemCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 3, elevation: 1 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  itemType: { fontSize: 14, fontWeight: '600', color: '#111827' },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: 11, fontWeight: '600' },
  itemEndpoint: { fontSize: 11, color: '#9ca3af', fontFamily: 'monospace', marginBottom: 4 },
  itemMeta: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  itemDate: { fontSize: 11, color: '#6b7280' },
  itemAttempts: { fontSize: 11, color: '#9ca3af' },
  priorityBadge: { fontSize: 9, fontWeight: '700', color: '#b91c1c', backgroundColor: '#fef2f2', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  errorText: { fontSize: 11, color: '#ef4444', marginTop: 4 },
  emptyState: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, color: '#9ca3af' },
})
