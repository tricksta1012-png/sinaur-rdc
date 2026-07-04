import { useState, useEffect } from 'react';

function tempsEcoule(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 5)    return "à l'instant";
  if (s < 60)   return `il y a ${s}s`;
  if (s < 3600) return `il y a ${Math.floor(s / 60)}min`;
  return `il y a ${Math.floor(s / 3600)}h`;
}

interface FraicheurBadgeProps {
  dataUpdatedAt: number;   // React Query's dataUpdatedAt (ms timestamp)
  isFetching:   boolean;
  isError:      boolean;
  onRefresh:    () => void;
  className?:   string;
}

export function FraicheurBadge({ dataUpdatedAt, isFetching, isError, onRefresh, className = '' }: FraicheurBadgeProps) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const isLive = !isError && dataUpdatedAt > 0;

  return (
    <div className={`flex items-center gap-1.5 font-mono text-[9px] ${className}`}>
      {isFetching ? (
        <span className="text-cc-500 animate-pulse">↻ sync…</span>
      ) : isError ? (
        <span className="flex items-center gap-1 text-red-500">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
          hors ligne
        </span>
      ) : isLive ? (
        <span className="flex items-center gap-1 text-green-500">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block animate-pulse" />
          {tempsEcoule(dataUpdatedAt)}
        </span>
      ) : (
        <span className="text-cc-600">—</span>
      )}
      <button
        onClick={onRefresh}
        title="Actualiser maintenant"
        className="text-cc-600 hover:text-gray-300 transition-colors px-0.5"
      >
        ↻
      </button>
    </div>
  );
}
