import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useState, useRef, useEffect } from 'react';
import type { FeedEvent } from '../hooks/useRealtimeFeed.js';

const TYPE_META: Record<string, { icon: string; label: string; color: string; bg: string }> = {
  NEW_EVENT:      { icon: '⚠️', label: 'Événement',     color: 'text-yellow-400', bg: 'border-l-yellow-600' },
  EVENT_UPDATED:  { icon: '🔄', label: 'Mise à jour',   color: 'text-blue-400',   bg: 'border-l-blue-700'   },
  NEW_ALERT:      { icon: '🚨', label: 'Alerte CAP',    color: 'text-red-400',    bg: 'border-l-red-600'    },
  CRISIS_CREATED: { icon: '🆘', label: 'Crise ouverte', color: 'text-red-400',    bg: 'border-l-red-600'    },
  CRISIS_UPDATED: { icon: '📋', label: 'Crise MAJ',     color: 'text-orange-400', bg: 'border-l-orange-700' },
  TASK_CREATED:   { icon: '✅', label: 'Tâche créée',   color: 'text-green-400',  bg: 'border-l-green-800'  },
  TASK_UPDATED:   { icon: '🔁', label: 'Tâche MAJ',     color: 'text-cyan-400',   bg: 'border-l-cyan-800'   },
};

const SEVERITY_BADGE: Record<string, string> = {
  Extreme:  'bg-red-900/80 text-red-200 border border-red-700',
  Severe:   'bg-orange-900/80 text-orange-200 border border-orange-700',
  Moderate: 'bg-yellow-900/80 text-yellow-200 border border-yellow-700',
  Minor:    'bg-blue-900/80 text-blue-300 border border-blue-800',
  Unknown:  'bg-cc-800 text-gray-500 border border-cc-700',
};

const SEVERITY_FR: Record<string, string> = {
  Extreme: 'Extrême', Severe: 'Sévère', Moderate: 'Modérée', Minor: 'Mineure', Unknown: 'Inconnue',
};

const HAZARD_ICONS: Record<string, string> = {
  flood: '🌊', landslide: '⛰️', mass_displacement: '🏃', humanitarian_crisis: '🆘',
  health_epidemic: '🦠', volcanic_eruption: '🌋', drought: '☀️', fire: '🔥',
  conflict: '⚔️', earthquake: '📳', other: '⚠️',
};

const SOURCE_FR: Record<string, string> = {
  reliefweb: 'ReliefWeb', gdacs: 'GDACS', fews_net: 'FEWS NET',
  official: 'Officiel', field_agent: 'Terrain', citizen: 'Citoyen',
  ai_prediction: 'IA', ngo: 'ONG', media: 'Médias',
};

function isCritical(e: FeedEvent): boolean {
  const p = e.payload as any;
  return e.type === 'CRISIS_CREATED' ||
    (e.type === 'NEW_ALERT' && (p.severity === 'Extreme' || p.urgency === 'Immediate')) ||
    (e.type === 'NEW_EVENT' && p.severity === 'Extreme');
}

function getTitle(e: FeedEvent): string {
  const p = e.payload as any;
  switch (e.type) {
    case 'NEW_EVENT':      return p.title ?? `${p.hazardType ?? '?'} — ${p.locationPcode ?? ''}`;
    case 'EVENT_UPDATED':  return `Événement ${(p.id as string)?.slice(0, 8) ?? ''} → ${p.status ?? ''}`;
    case 'NEW_ALERT':      return p.headline ?? p.identifier ?? 'Alerte CAP';
    case 'CRISIS_CREATED': return `${p.glideNumber ? p.glideNumber + ' — ' : ''}${p.title ?? 'Nouvelle crise'}`;
    case 'CRISIS_UPDATED': return `${p.title ?? 'Crise'} → ${p.status ?? ''}`;
    case 'TASK_CREATED':   return `Tâche créée — Crise ${(p.crisisId as string)?.slice(0, 8) ?? ''}`;
    case 'TASK_UPDATED':   return `Tâche ${(p.id as string)?.slice(0, 8) ?? ''} → ${p.status ?? ''}`;
    default:               return e.type.replace(/_/g, ' ');
  }
}

type FilterKey = 'ALL' | 'CRITICAL' | 'ALERT' | 'EVENT' | 'CRISIS';

const FILTER_OPTS: { key: FilterKey; label: string }[] = [
  { key: 'ALL',      label: 'Tout'     },
  { key: 'CRITICAL', label: '🔴 Crit.' },
  { key: 'ALERT',    label: '🚨 CAP'   },
  { key: 'EVENT',    label: '⚠️ Évén.' },
  { key: 'CRISIS',   label: '🆘 Crise' },
];

interface Props {
  events: (FeedEvent & { receivedAt: string })[];
  onClear: () => void;
}

export function LiveFeed({ events, onClear }: Props) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLen = useRef(events.length);

  // Scroll to top when new events arrive
  useEffect(() => {
    if (events.length > prevLen.current && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    prevLen.current = events.length;
  }, [events.length]);

  const visible = events.filter(e => {
    if (filter === 'ALL')      return true;
    if (filter === 'CRITICAL') return isCritical(e);
    if (filter === 'ALERT')    return e.type === 'NEW_ALERT';
    if (filter === 'EVENT')    return e.type === 'NEW_EVENT' || e.type === 'EVENT_UPDATED';
    if (filter === 'CRISIS')   return e.type === 'CRISIS_CREATED' || e.type === 'CRISIS_UPDATED';
    return true;
  });

  const criticalCount = events.filter(isCritical).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 pt-2.5 pb-2 border-b border-cc-700 shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
            <span className="text-[10px] font-mono text-cc-500 uppercase tracking-wider">Flux temps réel</span>
            {events.length > 0 && (
              <span className="text-[10px] bg-cc-800 text-cc-400 px-1.5 py-0.5 rounded-full font-mono">{events.length}</span>
            )}
            {criticalCount > 0 && (
              <span className="text-[10px] bg-red-900 text-red-300 px-1.5 py-0.5 rounded-full font-mono animate-pulse">
                {criticalCount} crit.
              </span>
            )}
          </div>
          <button onClick={onClear} className="text-[10px] text-cc-600 hover:text-gray-300 transition-colors font-mono">
            ✕ Effacer
          </button>
        </div>

        {/* Filter pills */}
        <div className="flex gap-1 flex-wrap">
          {FILTER_OPTS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                filter === f.key
                  ? 'bg-sinaur-900 text-sinaur-300 border border-sinaur-700'
                  : 'text-cc-500 hover:text-gray-400'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Feed list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-cc-600 text-xs font-mono space-y-2">
            <span className="text-2xl opacity-50">📡</span>
            <span>En attente d'événements…</span>
          </div>
        ) : (
          <div>
            {visible.map((e, i) => {
              const meta = TYPE_META[e.type] ?? { icon: '•', label: e.type, color: 'text-gray-400', bg: 'border-l-cc-700' };
              const critical = isCritical(e);
              const isOpen = expandedIdx === i;
              const p = e.payload as any;

              return (
                <div
                  key={i}
                  onClick={() => setExpandedIdx(isOpen ? null : i)}
                  className={`border-l-2 ${meta.bg} px-3 py-2.5 cursor-pointer transition-colors border-b border-b-cc-800/60 ${
                    critical ? 'bg-red-950/25 hover:bg-red-950/40' : 'hover:bg-cc-800/35'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {/* Icon */}
                    <span className={`text-sm shrink-0 mt-0.5 ${critical && !isOpen ? 'animate-bounce' : ''}`}>
                      {meta.icon}
                    </span>

                    <div className="min-w-0 flex-1">
                      {/* Type label + badges */}
                      <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                        <span className={`text-[10px] font-bold uppercase ${meta.color}`}>{meta.label}</span>
                        {p.severity && (
                          <span className={`text-[9px] font-bold px-1.5 py-px rounded-full ${SEVERITY_BADGE[p.severity] ?? SEVERITY_BADGE.Unknown}`}>
                            {SEVERITY_FR[p.severity] ?? p.severity}
                          </span>
                        )}
                        {p.urgency && p.urgency !== 'Unknown' && (
                          <span className={`text-[9px] font-mono px-1 py-px rounded ${
                            p.urgency === 'Immediate' ? 'bg-red-900 text-red-300' :
                            p.urgency === 'Expected'  ? 'bg-orange-900 text-orange-300' : 'bg-cc-800 text-cc-500'
                          }`}>
                            {p.urgency}
                          </span>
                        )}
                        {critical && (
                          <span className="text-[9px] font-bold bg-red-900 text-red-300 px-1 py-px rounded-full animate-pulse">
                            CRITIQUE
                          </span>
                        )}
                      </div>

                      {/* Title — full text when expanded */}
                      <div className={`text-xs text-gray-200 leading-snug ${isOpen ? 'whitespace-normal' : 'truncate'}`}>
                        {e.type === 'NEW_EVENT' && p.hazardType && (
                          <span className="mr-1">{HAZARD_ICONS[p.hazardType] ?? '⚠️'}</span>
                        )}
                        {getTitle(e)}
                      </div>

                      {/* Expanded detail */}
                      {isOpen && (
                        <div className="mt-2 space-y-1 border-t border-cc-800 pt-1.5">
                          {p.locationPcode && (
                            <div className="flex items-center gap-1 text-[10px] text-cc-400 font-mono">
                              <span>📍</span><span>{p.locationPcode}</span>
                            </div>
                          )}
                          {p.areaPcode && (
                            <div className="flex items-center gap-1 text-[10px] text-cc-400 font-mono">
                              <span>📍</span><span>Zone : {p.areaPcode}</span>
                            </div>
                          )}
                          {p.glideNumber && (
                            <div className="text-[10px] text-sinaur-400 font-mono">GLIDE : {p.glideNumber}</div>
                          )}
                          {p.hazardType && e.type !== 'NEW_EVENT' && (
                            <div className="text-[10px] text-cc-400">
                              {HAZARD_ICONS[p.hazardType] ?? ''} Type : {p.hazardType}
                            </div>
                          )}
                          {p.source && (
                            <div className="text-[10px] text-cc-500">
                              Source : {SOURCE_FR[p.source] ?? p.source}
                            </div>
                          )}
                          {p.status && e.type !== 'NEW_EVENT' && (
                            <div className="text-[10px] text-cc-400">Statut : <span className="text-gray-300">{p.status}</span></div>
                          )}
                          {(p.id || p.identifier) && (
                            <div className="text-[9px] text-cc-700 font-mono truncate">
                              ID : {(p.id ?? p.identifier as string)?.slice(0, 16)}…
                            </div>
                          )}
                          {/* Full timestamp */}
                          <div className="text-[9px] text-cc-600 font-mono pt-0.5">
                            {new Date(e.receivedAt).toLocaleString('fr-FR')}
                          </div>
                        </div>
                      )}

                      {/* Relative time (always visible) */}
                      {!isOpen && (
                        <div className="text-[10px] text-cc-600 font-mono mt-0.5">
                          {new Date(e.receivedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} — {formatDistanceToNow(new Date(e.receivedAt), { addSuffix: true, locale: fr })}
                        </div>
                      )}
                    </div>

                    {/* Chevron */}
                    <span className="text-[10px] text-cc-700 shrink-0 mt-1">{isOpen ? '▲' : '▼'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer count */}
      {visible.length > 0 && (
        <div className="px-3 py-1.5 border-t border-cc-700 shrink-0 text-[10px] font-mono text-cc-600">
          {visible.length} entrée{visible.length !== 1 ? 's' : ''}{filter !== 'ALL' ? ` (filtre: ${filter})` : ''}
        </div>
      )}
    </div>
  );
}
