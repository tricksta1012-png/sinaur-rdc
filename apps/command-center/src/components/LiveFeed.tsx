import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { FeedEvent } from '../hooks/useRealtimeFeed.js';

const TYPE_META: Record<string, { icon: string; label: string; color: string }> = {
  NEW_EVENT:      { icon: '⚠️', label: 'Événement',    color: 'text-yellow-400' },
  EVENT_UPDATED:  { icon: '🔄', label: 'Mise à jour',  color: 'text-blue-400'  },
  NEW_ALERT:      { icon: '🚨', label: 'Alerte CAP',   color: 'text-red-400'   },
  CRISIS_CREATED: { icon: '🆘', label: 'Crise ouverte',color: 'text-red-500'   },
  CRISIS_UPDATED: { icon: '📋', label: 'Crise MAJ',    color: 'text-orange-400'},
  TASK_CREATED:   { icon: '✅', label: 'Tâche créée',  color: 'text-green-400' },
  TASK_UPDATED:   { icon: '🔁', label: 'Tâche MAJ',    color: 'text-cyan-400'  },
};

function getEventTitle(event: FeedEvent): string {
  switch (event.type) {
    case 'NEW_EVENT':      return event.payload.title ?? `${event.payload.hazardType} — ${event.payload.locationPcode}`;
    case 'NEW_ALERT':      return event.payload.headline;
    case 'CRISIS_CREATED': return `${event.payload.glideNumber} — ${event.payload.title}`;
    case 'CRISIS_UPDATED': return `${event.payload.title} → ${event.payload.status}`;
    case 'TASK_UPDATED':   return `Tâche → ${event.payload.status}`;
    default:               return event.type;
  }
}

interface Props {
  events: (FeedEvent & { receivedAt: string })[];
  onClear: () => void;
}

export function LiveFeed({ events, onClear }: Props) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-cc-700 shrink-0">
        <div className="text-xs font-mono text-cc-600 uppercase tracking-wider">Flux temps réel</div>
        <button onClick={onClear} className="text-xs text-cc-600 hover:text-gray-300 transition-colors">
          Effacer
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-cc-600 text-xs font-mono">
            <span className="text-2xl mb-2">📡</span>
            En attente d'événements…
          </div>
        ) : (
          <div className="divide-y divide-cc-800">
            {events.map((e, i) => {
              const meta = TYPE_META[e.type] ?? { icon: '•', label: e.type, color: 'text-gray-400' };
              return (
                <div key={i} className="px-3 py-2.5 hover:bg-cc-800/50 transition-colors">
                  <div className="flex items-start gap-2">
                    <span className="text-base shrink-0 mt-0.5">{meta.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className={`text-xs font-medium ${meta.color}`}>{meta.label}</div>
                      <div className="text-xs text-gray-300 leading-snug mt-0.5 truncate">
                        {getEventTitle(e)}
                      </div>
                      <div className="text-xs text-cc-600 font-mono mt-0.5">
                        {formatDistanceToNow(new Date(e.receivedAt), { addSuffix: true, locale: fr })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
