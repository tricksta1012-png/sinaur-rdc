import { useOfflineQueue } from '../hooks/useOfflineQueue.js';

export function OfflineIndicator() {
  const { isOnline, pendingCount, syncNow, syncing } = useOfflineQueue();

  if (isOnline && pendingCount === 0) return null;

  return (
    <div className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg text-sm font-medium transition-all ${
      isOnline ? 'bg-orange-500 text-white' : 'bg-gray-800 text-white'
    }`}>
      <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-orange-200' : 'bg-red-400 animate-pulse'}`} />
      {!isOnline && 'Hors ligne'}
      {isOnline && pendingCount > 0 && (
        <>
          {pendingCount} signalement{pendingCount > 1 ? 's' : ''} en attente
          <button
            onClick={syncNow}
            disabled={syncing}
            className="ml-1 underline underline-offset-2 hover:no-underline disabled:opacity-60"
          >
            {syncing ? 'Envoi...' : 'Synchroniser'}
          </button>
        </>
      )}
    </div>
  );
}
