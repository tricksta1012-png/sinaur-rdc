import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';

type Tab = 'predictions' | 'veille' | 'antifraud';

const LEVEL_BADGE: Record<string, string> = {
  critical: 'bg-red-900 text-white',
  high:     'bg-red-600 text-white',
  medium:   'bg-yellow-500 text-black',
  low:      'bg-green-700 text-white',
};
const HAZARD_ICONS: Record<string, string> = {
  flood: '🌊', landslide: '⛰️', mass_displacement: '🏃', humanitarian_crisis: '🆘',
  health_epidemic: '🦠', drought: '☀️', fire: '🔥', conflict: '⚔️', earthquake: '📳', other: '⚠️',
};
const SOURCE_LABELS: Record<string, string> = {
  reliefweb: 'ReliefWeb', fews_net: 'FEWS NET', gdacs: 'GDACS',
  open_meteo: 'Open-Meteo', mettelsat: 'METTELSAT',
};
const CONNECTOR_STATUS: Record<string, string> = {
  ok: 'bg-green-500', degraded: 'bg-yellow-400', down: 'bg-red-500', no_data: 'bg-gray-500',
};

function PredictionsTab() {
  const [horizon, setHorizon] = useState<7 | 30 | 90>(7);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['ai-risks', horizon],
    queryFn: () => apiClient.get(`/predictions/risks?horizon=${horizon}`).then(r => r.data),
    staleTime: 60_000,
  });

  const refresh = useMutation({
    mutationFn: () => apiClient.post('/predictions/refresh').then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ai-risks'] }); },
  });

  const risks: any[] = data?.data ?? [];
  const critical = risks.filter(r => r.level === 'critical');
  const high = risks.filter(r => r.level === 'high');

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'CRITIQUE', value: critical.length, cls: 'bg-red-900 border-red-700' },
          { label: 'ÉLEVÉ',    value: high.length,     cls: 'bg-red-800 border-red-600' },
          { label: 'TOTAL',    value: risks.length,    cls: 'bg-cc-800 border-cc-600'   },
        ].map(k => (
          <div key={k.label} className={`rounded-lg border p-3 ${k.cls}`}>
            <div className="text-xs font-mono text-gray-400 mb-1">{k.label}</div>
            <div className="text-2xl font-bold text-white">{k.value}</div>
          </div>
        ))}
      </div>

      {/* Contrôles */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1 bg-cc-800 rounded-lg p-1">
          {([7, 30, 90] as const).map(h => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
                horizon === h ? 'bg-sinaur-700 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {h}J
            </button>
          ))}
        </div>
        <button
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="ml-auto px-3 py-1.5 text-xs font-mono bg-cc-700 hover:bg-cc-600 text-gray-300 rounded-lg transition-colors disabled:opacity-50"
        >
          {refresh.isPending ? '⟳ Calcul…' : '⟳ Recalculer'}
        </button>
      </div>

      {/* Tableau */}
      {isLoading ? (
        <div className="text-center text-gray-500 text-sm py-8">Chargement…</div>
      ) : risks.length === 0 ? (
        <div className="text-center text-gray-500 text-sm py-8">Aucune donnée — lancer un recalcul</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-cc-700 text-gray-500 font-mono uppercase">
                <th className="pb-2 text-left">Province</th>
                <th className="pb-2 text-left">Aléa</th>
                <th className="pb-2 text-right">Score</th>
                <th className="pb-2 text-center">Niveau</th>
              </tr>
            </thead>
            <tbody>
              {risks.slice(0, 30).map((r, i) => (
                <tr key={i} className="border-b border-cc-800 hover:bg-cc-800 transition-colors">
                  <td className="py-2 font-mono text-gray-300">{r.pcode}</td>
                  <td className="py-2 text-gray-300">
                    <span className="mr-1">{HAZARD_ICONS[r.hazard_type] ?? '⚠️'}</span>
                    {r.hazard_type}
                  </td>
                  <td className="py-2 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <div
                        className="h-1.5 rounded-full bg-sinaur-600"
                        style={{ width: `${Math.round(r.score / 5)}px`, maxWidth: '40px', minWidth: '2px' }}
                      />
                      <span className="text-white font-bold">{r.score}</span>
                    </div>
                  </td>
                  <td className="py-2 text-center">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${LEVEL_BADGE[r.level] ?? 'bg-gray-700 text-gray-300'}`}>
                      {r.level?.toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {risks.length > 30 && (
            <p className="text-center text-xs text-gray-600 mt-2">+{risks.length - 30} entrées supplémentaires</p>
          )}
        </div>
      )}
    </div>
  );
}

function VeilleTab() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['ai-veille'],
    queryFn: () => apiClient.get('/ai/veille/events?limit=40').then(r => r.data),
    staleTime: 60_000,
  });

  const { data: healthData } = useQuery({
    queryKey: ['ai-veille-health'],
    queryFn: () => apiClient.get('/ai/veille/health').then(r => r.data),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const events: any[] = data?.events ?? [];
  const connectors: any[] = healthData?.connectors ?? [];

  return (
    <div className="space-y-4">
      {/* Connecteurs */}
      {connectors.length > 0 && (
        <div>
          <div className="text-xs font-mono text-gray-500 uppercase mb-2">Connecteurs d'ingestion</div>
          <div className="grid grid-cols-5 gap-2">
            {connectors.map(c => (
              <div key={c.source} className="bg-cc-800 rounded-lg p-2 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <span className={`w-2 h-2 rounded-full ${CONNECTOR_STATUS[c.status] ?? 'bg-gray-500'}`} />
                  <span className={`text-[10px] font-mono font-bold ${c.status === 'ok' ? 'text-green-400' : c.status === 'degraded' ? 'text-yellow-400' : 'text-red-400'}`}>
                    {c.status.toUpperCase()}
                  </span>
                </div>
                <div className="text-[10px] text-gray-400">{SOURCE_LABELS[c.source] ?? c.source}</div>
                <div className="text-xs font-bold text-white">{c.events_48h}</div>
                <div className="text-[9px] text-gray-600">evt / 48h</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Événements collectés */}
      <div className="flex items-center justify-between">
        <div className="text-xs font-mono text-gray-500 uppercase">
          Signaux récents ({events.length})
        </div>
        <button onClick={() => refetch()} className="text-xs text-gray-500 hover:text-gray-300 font-mono">
          ↺ Actualiser
        </button>
      </div>

      {isLoading ? (
        <div className="text-center text-gray-500 text-sm py-8">Chargement…</div>
      ) : events.length === 0 ? (
        <div className="text-center text-gray-500 text-sm py-8">Aucun signal sur les 48 dernières heures</div>
      ) : (
        <div className="space-y-1.5 max-h-96 overflow-y-auto">
          {events.map((e, i) => (
            <div key={i} className="bg-cc-800 rounded-lg p-3 flex items-start gap-3">
              <span className="text-base shrink-0 mt-0.5">{HAZARD_ICONS[e.hazard_type] ?? '⚠️'}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-mono text-gray-500">{SOURCE_LABELS[e.source] ?? e.source}</span>
                  <span className="text-[10px] font-mono text-gray-600">{e.location_pcode}</span>
                  {e.is_duplicate && <span className="text-[10px] text-yellow-500">DOUBLON</span>}
                </div>
                <p className="text-xs text-gray-200 truncate">{e.title}</p>
              </div>
              <div className="text-[10px] text-gray-600 whitespace-nowrap shrink-0">
                {e.fetched_at ? new Date(e.fetched_at).toLocaleDateString('fr-FR') : '—'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AntifraudTab() {
  const { data: statsData } = useQuery({
    queryKey: ['ai-antifraud-stats'],
    queryFn: () => apiClient.get('/ai/antifraud/stats').then(r => r.data),
    staleTime: 60_000,
  });

  const { data: queueData, isLoading: queueLoading } = useQuery({
    queryKey: ['ai-antifraud-queue'],
    queryFn: () => apiClient.get('/ai/antifraud/queue').then(r => r.data),
    staleTime: 30_000,
  });

  const stats = statsData ?? {};
  const queue: any[] = queueData?.queue ?? [];

  return (
    <div className="space-y-4">
      {/* Stats */}
      {stats.events && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-cc-800 rounded-lg p-3 col-span-2">
            <div className="text-xs font-mono text-gray-500 uppercase mb-2">30 derniers jours</div>
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-xl font-bold text-white">{stats.events.total.toLocaleString()}</div>
                <div className="text-[10px] text-gray-500">Événements</div>
              </div>
              <div>
                <div className="text-xl font-bold text-yellow-400">{stats.moderation_queue?.pending ?? 0}</div>
                <div className="text-[10px] text-gray-500">En attente</div>
              </div>
              <div>
                <div className="text-xl font-bold text-red-400">{stats.events.rejected}</div>
                <div className="text-[10px] text-gray-500">Rejetés</div>
              </div>
              <div>
                <div className="text-xl font-bold text-orange-400">{stats.events.rejection_rate_pct}%</div>
                <div className="text-[10px] text-gray-500">Taux rejet</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* File de modération */}
      <div>
        <div className="text-xs font-mono text-gray-500 uppercase mb-2">
          File de modération ({queue.length} en attente)
        </div>
        {queueLoading ? (
          <div className="text-center text-gray-500 text-sm py-6">Chargement…</div>
        ) : queue.length === 0 ? (
          <div className="text-center text-gray-500 text-sm py-6">File vide — aucun dossier en attente</div>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {queue.map((item, i) => (
              <div key={i} className="bg-cc-800 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-gray-200 truncate">{item.notes ?? `Dossier ${item.id?.slice(0, 8) ?? i}`}</div>
                  <div className="text-[10px] text-gray-600 font-mono">
                    {item.created_at ? new Date(item.created_at).toLocaleDateString('fr-FR') : '—'}
                  </div>
                </div>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                  item.priority >= 5 ? 'bg-red-800 text-red-200' : 'bg-yellow-800 text-yellow-200'
                }`}>
                  P{item.priority ?? '?'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: 'predictions', icon: '📊', label: 'Prédictions' },
  { key: 'veille',      icon: '🔭', label: 'Veille'       },
  { key: 'antifraud',   icon: '🛡️', label: 'Anti-Fraude'  },
];

export function AiPage() {
  const [tab, setTab] = useState<Tab>('predictions');

  return (
    <div className="p-6 space-y-4 h-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="text-2xl">🤖</span>
        <div>
          <h1 className="text-white font-bold text-lg leading-tight">Intelligence Artificielle</h1>
          <p className="text-cc-600 text-xs font-mono">3 AGENTS ACTIFS — SINAUR-RDC AI</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-cc-800 rounded-lg p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded text-sm font-medium transition-colors ${
              tab === t.key
                ? 'bg-cc-700 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Contenu */}
      <div className="bg-cc-900 rounded-xl border border-cc-700 p-4">
        {tab === 'predictions' && <PredictionsTab />}
        {tab === 'veille'      && <VeilleTab />}
        {tab === 'antifraud'   && <AntifraudTab />}
      </div>
    </div>
  );
}
