import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';

type Tab = 'status' | 'predictions' | 'veille' | 'antifraud' | 'stocks' | 'signalements' | 'epidemie' | 'logistique' | 'reporting';

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

  // API returns array directly, not {events:[...]}
  const events: any[] = Array.isArray(data) ? data : (data?.events ?? []);
  const connectors: any[] = healthData?.connectors ?? [];

  return (
    <div className="space-y-4">
      {/* Connecteurs */}
      {connectors.length > 0 && (
        <div>
          <div className="text-xs font-mono text-gray-500 uppercase mb-2">Connecteurs d'ingestion</div>
          <div className="grid grid-cols-5 gap-2">
            {connectors.map(c => {
              const srcId = c.source_id ?? c.source ?? String(Math.random());
              const status = c.status ?? (c.circuit_open ? 'down' : 'ok');
              return (
              <div key={srcId} className="bg-cc-800 rounded-lg p-2 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <span className={`w-2 h-2 rounded-full ${CONNECTOR_STATUS[status] ?? 'bg-gray-500'}`} />
                  <span className={`text-[10px] font-mono font-bold ${status === 'ok' ? 'text-green-400' : status === 'degraded' ? 'text-yellow-400' : 'text-red-400'}`}>
                    {status.toUpperCase()}
                  </span>
                </div>
                <div className="text-[10px] text-gray-400">{SOURCE_LABELS[srcId] ?? srcId}</div>
                <div className="text-xs font-bold text-white">{c.events_48h ?? c.event_store_size ?? '—'}</div>
                <div className="text-[9px] text-gray-600">evt / 48h</div>
              </div>
              );
            })}
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

// ── Tab 4–8 : nouveaux agents ─────────────────────────────────────────────────

const AGENT_STATUS_COLORS: Record<string, string> = {
  ok: 'bg-green-500', degraded: 'bg-yellow-400', error: 'bg-red-500',
};

function AgentsStatusTab() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['ai-agents-status'],
    queryFn: () => apiClient.get('/ai/agents/status').then(r => r.data),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const agents: any[] = data?.agents ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-mono text-gray-500 uppercase">
          {agents.length} agents — {data?.response_ms != null ? `${data.response_ms}ms` : '…'}
        </div>
        <button onClick={() => refetch()} className="text-xs text-gray-500 hover:text-gray-300 font-mono">
          ↺ Actualiser
        </button>
      </div>

      {isLoading ? (
        <div className="text-center text-gray-500 text-sm py-8">Chargement…</div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {agents.map((a: any) => (
            <div key={a.id} className="bg-cc-800 rounded-lg p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full shrink-0 ${AGENT_STATUS_COLORS[a.status] ?? 'bg-gray-500'}`} />
                <span className="text-xs font-bold text-white leading-tight">{a.name}</span>
                <span className={`ml-auto text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                  a.status === 'ok' ? 'bg-green-900 text-green-300' :
                  a.status === 'degraded' ? 'bg-yellow-900 text-yellow-300' :
                  'bg-red-900 text-red-300'
                }`}>{a.status.toUpperCase()}</span>
              </div>
              <p className="text-[10px] text-gray-500 leading-tight">{a.description}</p>
              {Object.keys(a.metrics ?? {}).length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {Object.entries(a.metrics).map(([k, v]: any) => (
                    <span key={k} className="text-[10px] font-mono text-gray-400">
                      {k.replace(/_/g, ' ')}: <span className="text-gray-200">{v}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StocksTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['ai-stocks-dashboard'],
    queryFn: () => apiClient.get('/ai/anomalie-stocks/dashboard').then(r => r.data),
    staleTime: 30_000,
  });

  const { data: alertsData } = useQuery({
    queryKey: ['ai-stocks-alerts'],
    queryFn: () => apiClient.get('/ai/anomalie-stocks/alerts').then(r => r.data),
    staleTime: 20_000,
  });

  const alerts: any[] = alertsData?.alerts ?? [];

  return (
    <div className="space-y-4">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'CRITIQUE', value: data.by_level?.CRITICAL ?? 0, cls: 'bg-red-900 border-red-700' },
            { label: 'ÉLEVÉ',    value: data.by_level?.HIGH ?? 0,     cls: 'bg-red-800 border-red-600' },
            { label: 'NON TRAITÉS', value: data.unresolved ?? 0,      cls: 'bg-cc-800 border-cc-600' },
          ].map(k => (
            <div key={k.label} className={`rounded-lg border p-3 ${k.cls}`}>
              <div className="text-xs font-mono text-gray-400 mb-1">{k.label}</div>
              <div className="text-2xl font-bold text-white">{k.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="text-xs font-mono text-gray-500 uppercase">Anomalies récentes</div>
      {isLoading ? (
        <div className="text-center text-gray-500 text-sm py-6">Chargement…</div>
      ) : alerts.length === 0 ? (
        <div className="text-center text-gray-500 text-sm py-6">Aucune anomalie détectée</div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {alerts.slice(0, 20).map((a: any, i: number) => (
            <div key={i} className="bg-cc-800 rounded-lg px-3 py-2 flex items-center gap-3">
              <span className={`w-2 h-2 rounded-full shrink-0 ${a.level === 'CRITICAL' ? 'bg-red-500' : a.level === 'HIGH' ? 'bg-orange-400' : 'bg-yellow-400'}`} />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-gray-200 truncate">{a.pattern_id ?? 'Anomalie'} — {a.entrepot_id}</div>
                <div className="text-[10px] text-gray-500 font-mono">{a.province ?? ''}</div>
              </div>
              <span className="text-[10px] font-bold text-white">{a.score}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SignalementsTab() {
  const { data: statsData } = useQuery({
    queryKey: ['ai-signalements-stats'],
    queryFn: () => apiClient.get('/ai/signalements/stats').then(r => r.data),
    staleTime: 30_000,
  });

  const { data: priorityData, isLoading } = useQuery({
    queryKey: ['ai-signalements-priority'],
    queryFn: () => apiClient.get('/ai/signalements/priority').then(r => r.data),
    staleTime: 20_000,
  });

  const priority: any[] = priorityData?.queue ?? [];
  const stats = statsData ?? {};

  return (
    <div className="space-y-4">
      {stats.total != null && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'TOTAL', value: stats.total ?? 0 },
            { label: 'CLUSTERS', value: stats.cluster_count ?? 0 },
            { label: 'FIABILITÉ MOY.', value: stats.avg_reliability ? `${Math.round(stats.avg_reliability * 100)}%` : '—' },
            { label: 'À TRAITER', value: stats.high_priority ?? 0 },
          ].map(k => (
            <div key={k.label} className="bg-cc-800 rounded-lg p-3">
              <div className="text-xs font-mono text-gray-400 mb-1">{k.label}</div>
              <div className="text-xl font-bold text-white">{k.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="text-xs font-mono text-gray-500 uppercase">File de priorité</div>
      {isLoading ? (
        <div className="text-center text-gray-500 text-sm py-6">Chargement…</div>
      ) : priority.length === 0 ? (
        <div className="text-center text-gray-500 text-sm py-6">Aucun signalement prioritaire</div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {priority.slice(0, 20).map((s: any, i: number) => (
            <div key={i} className="bg-cc-800 rounded-lg px-3 py-2 flex items-start gap-3">
              <span className="text-base shrink-0">
                {s.classe === 'INONDATION' ? '🌊' : s.classe === 'EPIDEMIE' ? '🦠' : s.classe === 'CONFLIT' ? '⚔️' : '⚠️'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-mono text-gray-500">{s.classe}</span>
                  <span className="text-[10px] font-mono text-gray-600">{s.province}</span>
                </div>
                <p className="text-xs text-gray-200 truncate">{s.text}</p>
              </div>
              <div className="text-[10px] font-bold text-white shrink-0">
                {s.priority_score != null ? Math.round(s.priority_score * 100) : '—'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EpidemieTab() {
  const { data: dashData, isLoading } = useQuery({
    queryKey: ['ai-epidemie-dashboard'],
    queryFn: () => apiClient.get('/ai/epidemie/dashboard').then(r => r.data),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: clustersData } = useQuery({
    queryKey: ['ai-epidemie-clusters'],
    queryFn: () => apiClient.get('/ai/epidemie/clusters').then(r => r.data),
    staleTime: 60_000,
  });

  const clusters: any[] = clustersData?.clusters ?? [];

  const DISEASE_ICONS: Record<string, string> = {
    cholera: '💧', mpox: '🐒', rougeole: '🔴', meningite: '🧠', ebola: '☣️',
  };

  return (
    <div className="space-y-4">
      {dashData && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'CLUSTERS ACTIFS', value: dashData.active_clusters ?? 0, cls: 'bg-red-900 border-red-700' },
            { label: 'ALERTES CAP',     value: dashData.active_alerts ?? 0,   cls: 'bg-orange-900 border-orange-700' },
            { label: 'MALADIES SUIVIES',value: dashData.diseases_monitored ?? 5, cls: 'bg-cc-800 border-cc-600' },
          ].map(k => (
            <div key={k.label} className={`rounded-lg border p-3 ${k.cls}`}>
              <div className="text-xs font-mono text-gray-400 mb-1">{k.label}</div>
              <div className="text-2xl font-bold text-white">{k.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="text-xs font-mono text-gray-500 uppercase">Clusters actifs</div>
      {isLoading ? (
        <div className="text-center text-gray-500 text-sm py-6">Chargement…</div>
      ) : clusters.length === 0 ? (
        <div className="text-center text-gray-500 text-sm py-6">Aucun cluster sanitaire détecté</div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {clusters.map((c: any, i: number) => (
            <div key={i} className="bg-cc-800 rounded-lg px-3 py-2 flex items-center gap-3">
              <span className="text-lg shrink-0">{DISEASE_ICONS[c.disease_id] ?? '🦠'}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-bold text-white capitalize">{c.disease_id}</span>
                  <span className="text-[10px] text-gray-500">{c.province}</span>
                </div>
                <div className="text-[10px] text-gray-400">{c.case_count} cas — rayon {c.radius_km?.toFixed(1)}km</div>
              </div>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                c.alert_level === 'CRITICAL' ? 'bg-red-800 text-red-200' :
                c.alert_level === 'HIGH' ? 'bg-orange-800 text-orange-200' : 'bg-yellow-800 text-yellow-200'
              }`}>{c.alert_level}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LogistiqueTab() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['ai-logistique-recs'],
    queryFn: () => apiClient.get('/ai/logistique/recommendations').then(r => r.data),
    staleTime: 60_000,
  });

  const recs: any[] = data?.recommendations ?? [];
  const pending = recs.filter((r: any) => r.status === 'PENDING');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-mono text-gray-500 uppercase">
          {pending.length} recommandation{pending.length !== 1 ? 's' : ''} en attente de validation
        </div>
        <button onClick={() => refetch()} className="text-xs text-gray-500 hover:text-gray-300 font-mono">
          ↺ Actualiser
        </button>
      </div>
      {isLoading ? (
        <div className="text-center text-gray-500 text-sm py-6">Chargement…</div>
      ) : recs.length === 0 ? (
        <div className="text-center text-gray-500 text-sm py-6">Aucune recommandation logistique</div>
      ) : (
        <div className="space-y-1.5 max-h-80 overflow-y-auto">
          {recs.slice(0, 20).map((r: any, i: number) => (
            <div key={i} className="bg-cc-800 rounded-lg px-3 py-2.5 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white truncate flex-1">{r.resource_type ?? 'Ressource'}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                  r.status === 'PENDING' ? 'bg-yellow-800 text-yellow-200' :
                  r.status === 'ACCEPTED' ? 'bg-green-800 text-green-200' : 'bg-gray-700 text-gray-300'
                }`}>{r.status}</span>
              </div>
              <div className="text-[10px] text-gray-400">
                {r.warehouse_name ?? r.warehouse_id} → {r.disaster_pcode} · {r.distance_km?.toFixed(0)}km · P{r.priority ?? '?'}
              </div>
              <div className="text-[10px] text-gray-500 italic">{r.reason}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportingTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['ai-reports'],
    queryFn: () => apiClient.get('/ai/reporting/reports').then(r => r.data),
    staleTime: 60_000,
  });

  const reports: any[] = data?.reports ?? [];

  return (
    <div className="space-y-4">
      <div className="text-xs font-mono text-gray-500 uppercase">
        Rapports générés ({reports.length})
      </div>
      {isLoading ? (
        <div className="text-center text-gray-500 text-sm py-6">Chargement…</div>
      ) : reports.length === 0 ? (
        <div className="text-center text-gray-500 text-sm py-6">Aucun rapport généré — le premier bulletin quotidien sera produit à 06h00</div>
      ) : (
        <div className="space-y-1.5 max-h-80 overflow-y-auto">
          {reports.map((r: any, i: number) => (
            <div key={i} className="bg-cc-800 rounded-lg px-3 py-2 flex items-center gap-3">
              <span className="text-base shrink-0">
                {r.report_type === 'daily' ? '📋' : r.report_type === 'weekly' ? '📊' : '📄'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-gray-200 truncate">{r.title ?? r.report_type}</div>
                <div className="text-[10px] text-gray-500 font-mono">
                  {r.generated_at ? new Date(r.generated_at).toLocaleDateString('fr-FR') : '—'}
                </div>
              </div>
              <a
                href={`/ai/reporting/reports/${r.id}`}
                className="text-[10px] text-sinaur-400 hover:text-sinaur-300 font-mono shrink-0"
              >
                Voir →
              </a>
            </div>
          ))}
        </div>
      )}
      <div className="pt-1">
        <a
          href="/ai/reporting/hxl/latest"
          target="_blank"
          className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 font-mono transition-colors"
        >
          ⬇ Export HXL (CSV)
        </a>
      </div>
    </div>
  );
}

// ── Navigation ────────────────────────────────────────────────────────────────

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: 'status',       icon: '🖥️',  label: 'Tableau de bord' },
  { key: 'predictions',  icon: '📊',  label: 'Prédictions'     },
  { key: 'veille',       icon: '🔭',  label: 'Veille'          },
  { key: 'antifraud',    icon: '🛡️',  label: 'Anti-Fraude'     },
  { key: 'stocks',       icon: '📦',  label: 'Stocks'          },
  { key: 'signalements', icon: '📡',  label: 'Signalements'    },
  { key: 'epidemie',     icon: '🦠',  label: 'Épidémie'        },
  { key: 'logistique',   icon: '🚚',  label: 'Logistique'      },
  { key: 'reporting',    icon: '📄',  label: 'Reporting'       },
];

export function AiPage() {
  const [tab, setTab] = useState<Tab>('status');

  return (
    <div className="p-6 space-y-4 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="text-2xl">🤖</span>
        <div>
          <h1 className="text-white font-bold text-lg leading-tight">Intelligence Artificielle</h1>
          <p className="text-cc-600 text-xs font-mono">8 AGENTS ACTIFS — SINAUR-RDC AI</p>
        </div>
      </div>

      {/* Tabs — scrollable */}
      <div className="overflow-x-auto">
        <div className="flex gap-1 bg-cc-800 rounded-lg p-1 w-fit">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded text-xs font-medium transition-colors whitespace-nowrap ${
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
      </div>

      {/* Contenu */}
      <div className="bg-cc-900 rounded-xl border border-cc-700 p-4">
        {tab === 'status'       && <AgentsStatusTab />}
        {tab === 'predictions'  && <PredictionsTab />}
        {tab === 'veille'       && <VeilleTab />}
        {tab === 'antifraud'    && <AntifraudTab />}
        {tab === 'stocks'       && <StocksTab />}
        {tab === 'signalements' && <SignalementsTab />}
        {tab === 'epidemie'     && <EpidemieTab />}
        {tab === 'logistique'   && <LogistiqueTab />}
        {tab === 'reporting'    && <ReportingTab />}
      </div>
    </div>
  );
}
