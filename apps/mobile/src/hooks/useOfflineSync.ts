import { useEffect, useState, useCallback } from 'react';
import * as Network from 'expo-network';
import { syncQueue, getQueueCount } from '../stores/offlineQueue.js';

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshPending = useCallback(async () => {
    const count = await getQueueCount();
    setPendingCount(count);
  }, []);

  const sync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    await syncQueue();
    await refreshPending();
    setSyncing(false);
  }, [syncing, refreshPending]);

  useEffect(() => {
    void refreshPending();

    // Vérifier la connectivité toutes les 30s et synchroniser si en ligne
    const interval = setInterval(async () => {
      const state = await Network.getNetworkStateAsync();
      const online = state.isConnected === true && state.isInternetReachable !== false;
      setIsOnline(online);
      if (online) await sync();
    }, 30_000);

    // Vérification initiale
    Network.getNetworkStateAsync().then((state) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;
      setIsOnline(online);
    });

    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { isOnline, pendingCount, syncing, sync };
}
