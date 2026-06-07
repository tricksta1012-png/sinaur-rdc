import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import type { ApiResponse } from '@sinaur/shared-types';

interface DashboardStats {
  counts: {
    activeEvents: number;
    pendingEvents: number;
    criticalEvents: number;
    events24h: number;
    events7d: number;
    totalAffected: number;
    moderationQueue: number;
    wsConnected: number;
  };
  hazardBreakdown: Array<{ hazardType: string; count: number }>;
  trend: Array<{ day: string; count: number }>;
  topProvinces: Array<{ pcode: string; provinceName: string; activeEvents: number; severeEvents: number; totalAffected: number }>;
}

const HAZARD_ICONS: Record<string, string> = {
  flood: '🌊', landslide: '⛰️', mass_displacement: '🏃',
  humanitarian_crisis: '🆘', health_epidemic: '🦠', volcanic_eruption: '🌋',
  drought: '☀️', fire: '🔥', conflict: '⚔️', earthquake: '📳', other: '⚠️',
};
const HAZARD_FR: Record<string, string> = {
  flood: 'Inondation', landslide: 'Glissement', mass_displacement: 'Déplacement',
  humanitarian_crisis: 'Crise hum.', health_epidemic: 'Épidémie', volcanic_eruption: 'Volcan',
  drought: 'Sécheresse', fire: 'Incendie', conflict: 'Conflit', earthquake: 'Séisme', other: 'Autre',
};

function StatCard({ label, value, icon, sub, color }: { label: string; value: number | string; icon: string; sub?: string; color: string }) {
  return (
    <div className={`bg-white rounded-xl p-5 shadow-sm border-l-4 ${color}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{typeof value === 'number' ? value.toLocaleString('fr-FR') : value}</p>
          {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        </div>
        <span className="text-2xl mt-1">{icon}</span>
      </div>
    </div>
  );
}

function MiniBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
      <div className="h-full bg-red-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function DashboardPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<DashboardStats>>('/dashboard/stats');
      return data.data!;
    },
    refetchInterval: 60_000,
  });

  const handleWsMessage = useCallback((msg: any) => {
    if (msg.type === 'NEW_EVENT' || msg.type === 'EVENT_UPDATED' || msg.type === 'STATS_UPDATE') {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    }
  }, [queryClient]);

  const { connected } = useWebSocket(handleWsMessage);

  const stats = data?.counts;
  const maxHazard = Math.max(...(data?.hazardBreakdown.map((h) => Number(h.count)) ?? [1]));
  const maxAffected = Math.max(...(data?.topProvinces.map((p) => p.totalAffected) ?? [1]));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* En-tête */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Centre National de Commandement</h1>
          <p className="text-gray-500 text-sm mt-1">République Démocratique du Congo — vue nationale en temps réel</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
            {connected ? 'Temps réel actif' : 'Connexion...'}
          </div>
          <a
            href="/api/dashboard/export.csv"
            target="_blank"
            className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
          >
            ↓ Export CSV (HXL)
          </a>
        </div>
      </div>

      {/* KPIs */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-5 shadow-sm border-l-4 border-gray-200 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-3" />
              <div className="h-8 bg-gray-200 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Événements actifs" value={stats?.activeEvents ?? 0} icon="🔴" color="border-red-500" />
          <StatCard label="Niveau critique" value={stats?.criticalEvents ?? 0} icon="⚠️" color="border-orange-500" sub="Sévère ou Extrême" />
          <StatCard label="Dernières 24h" value={stats?.events24h ?? 0} icon="🕐" color="border-blue-500" />
          <StatCard label="Personnes affectées" value={stats?.totalAffected ?? 0} icon="👥" color="border-purple-500" sub="Actifs confirmés" />
          <StatCard label="En modération" value={stats?.pendingEvents ?? 0} icon="🔍" color="border-yellow-500" sub="Signalements en attente" />
          <StatCard label="File de validation" value={stats?.moderationQueue ?? 0} icon="📋" color="border-indigo-500" />
          <StatCard label="Événements (7j)" value={stats?.events7d ?? 0} icon="📈" color="border-teal-500" />
          <StatCard label="Décideurs connectés" value={stats?.wsConnected ?? 0} icon="🔗" color="border-green-500" sub="WebSocket actif" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Répartition par type d'aléa */}
        <div className="bg-white rounded-xl shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">Répartition par type d'aléa</h2>
            <p className="text-xs text-gray-500 mt-0.5">Événements actifs</p>
          </div>
          <div className="p-5 space-y-3">
            {data?.hazardBreakdown.length === 0 && <p className="text-sm text-gray-500">Aucun événement actif</p>}
            {data?.hazardBreakdown.map((h) => (
              <div key={h.hazardType} className="flex items-center gap-3">
                <span className="text-lg w-6 shrink-0">{HAZARD_ICONS[h.hazardType] ?? '⚠️'}</span>
                <span className="text-sm text-gray-700 w-28 shrink-0">{HAZARD_FR[h.hazardType] ?? h.hazardType}</span>
                <div className="flex-1">
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-red-500 rounded-full transition-all"
                      style={{ width: `${maxHazard > 0 ? (Number(h.count) / maxHazard) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <span className="text-sm font-semibold text-gray-900 w-6 text-right">{h.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top provinces */}
        <div className="bg-white rounded-xl shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">Provinces les plus touchées</h2>
            <p className="text-xs text-gray-500 mt-0.5">Par nombre d'événements sévères</p>
          </div>
          <div className="p-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-100">
                  <th className="text-left pb-2 font-medium">Province</th>
                  <th className="text-right pb-2 font-medium">Actifs</th>
                  <th className="text-right pb-2 font-medium">Sévères</th>
                  <th className="text-right pb-2 pr-0 font-medium">Affectés</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data?.topProvinces.slice(0, 8).map((p) => (
                  <tr key={p.pcode} className="hover:bg-gray-50">
                    <td className="py-2 font-medium text-gray-900">{p.provinceName}</td>
                    <td className="py-2 text-right text-gray-700">{p.activeEvents}</td>
                    <td className="py-2 text-right">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${p.severeEvents > 0 ? 'bg-red-100 text-red-700' : 'text-gray-400'}`}>
                        {p.severeEvents}
                      </span>
                    </td>
                    <td className="py-2 text-right text-gray-600">
                      <div className="flex items-center justify-end gap-2">
                        <MiniBar value={p.totalAffected} max={maxAffected} />
                        <span className="text-xs w-12 text-right">{p.totalAffected > 0 ? p.totalAffected.toLocaleString('fr-FR') : '—'}</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {(data?.topProvinces.length ?? 0) === 0 && (
                  <tr><td colSpan={4} className="py-4 text-center text-gray-400 text-sm">Aucune donnée disponible</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Tendance 30 jours */}
      {data?.trend && data.trend.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">Tendance — 30 derniers jours</h2>
          </div>
          <div className="p-5 flex items-end gap-0.5 h-24">
            {(() => {
              const max = Math.max(...data.trend.map((t) => Number(t.count)), 1);
              return data.trend.map((t) => (
                <div
                  key={t.day}
                  className="flex-1 bg-red-500 rounded-t opacity-80 hover:opacity-100 transition-opacity"
                  style={{ height: `${(Number(t.count) / max) * 100}%`, minHeight: Number(t.count) > 0 ? 4 : 0 }}
                  title={`${t.day}: ${t.count} événement(s)`}
                />
              ));
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
