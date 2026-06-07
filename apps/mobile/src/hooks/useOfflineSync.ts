/**
 * Hook de synchronisation offline — SINAUR-RDC Mobile.
 * Utilise le SyncManager unifié. Déclenche la sync sur reconnexion
 * et en arrière-plan via AppState (app retour au premier plan).
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import * as Network from 'expo-network'
import { syncAll, getQueueStats, type SyncResult } from '../stores/syncManager.js'

const POLL_INTERVAL_MS = 30_000     // vérification réseau toutes les 30s
const DATA_SAVER_INTERVAL_MS = 90_000 // mode économie : toutes les 90s

export function useOfflineSync(dataSaverMode = false) {
  const [isOnline, setIsOnline] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null)
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null)
  const syncingRef = useRef(false)

  const refreshStats = useCallback(async () => {
    const stats = await getQueueStats()
    setPendingCount(stats.pending)
    setFailedCount(stats.failed)
  }, [])

  const sync = useCallback(async () => {
    if (syncingRef.current) return
    syncingRef.current = true
    setSyncing(true)
    setSyncProgress(null)
    try {
      const result = await syncAll((done, total) => setSyncProgress({ done, total }))
      setLastSyncResult(result)
      await refreshStats()
    } finally {
      syncingRef.current = false
      setSyncing(false)
      setSyncProgress(null)
    }
  }, [refreshStats])

  const checkConnectivity = useCallback(async () => {
    const state = await Network.getNetworkStateAsync()
    const online = state.isConnected === true && state.isInternetReachable !== false
    setIsOnline(online)
    return online
  }, [])

  useEffect(() => {
    void refreshStats()

    // Vérification initiale
    checkConnectivity().then(online => {
      if (online) void sync()
    })

    const intervalMs = dataSaverMode ? DATA_SAVER_INTERVAL_MS : POLL_INTERVAL_MS
    const interval = setInterval(async () => {
      const online = await checkConnectivity()
      if (online) void sync()
    }, intervalMs)

    // Sync au retour en premier plan
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        checkConnectivity().then(online => {
          if (online) void sync()
        })
      }
    }
    const appStateSub = AppState.addEventListener('change', handleAppState)

    return () => {
      clearInterval(interval)
      appStateSub.remove()
    }
  }, [dataSaverMode]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    isOnline,
    pendingCount,
    failedCount,
    syncing,
    syncProgress,
    lastSyncResult,
    sync,
    refreshStats,
  }
}
