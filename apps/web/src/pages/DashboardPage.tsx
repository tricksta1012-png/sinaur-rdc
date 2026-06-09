import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import type { ApiResponse } from '@sinaur/shared-types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DashboardStats {
  counts: {
    activeEvents: number; pendingEvents: number; criticalEvents: number;
    events24h: number; events7d: number; totalAffected: number;
    moderationQueue: number; wsConnected: number;
  };
  crisisStats: {
    activeCrises: number; containedCrises: number;
    crisisAffected: number; crisisDisplaced: number; crisisDeaths: number;
  };
  demandStats: {
    pendingDemands: number; approvedDemands: number; fulfilledDemands: number;
  };
  stockStats: {
    criticalStocks: number; totalDepots: number; totalStockLines: number;
  };
  recentActivity: Array<{
    activityType: 'crisis' | 'demand';
    label: string; status: string; urgency: string | null; createdAt: string;
  }>;
  hazardBreakdown: Array<{ hazardType: string; count: number }>;
  trend: Array<{ day: string; count: number }>;
  topProvinces: Array<{
    pcode: string; provinceName: string;
    activeEvents: number; severeEvents: number; totalAffected: number;
  }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

const ACTIVITY_BADGE: Record<string, string> = {
  active:    'bg-red-100 text-red-700',
  contained: 'bg-amber-100 text-amber-700',
  closed:    'bg-gray-100 text-gray-500',
  pending:   'bg-yellow-100 text-yellow-700',
  approved:  'bg-green-100 text-green-700',
  rejected:  'bg-red-100 text-red-700',
  fulfilled: 'bg-blue-100 text-blue-700',
};
const ACTIVITY_STATUS_FR: Record<string, string> = {
  active: 'Active', contained: 'Maîtrisée', closed: 'Clôturée',
  pending: 'En attente', approved: 'Approuvée', rejected: 'Rejetée', fulfilled: 'Réalisée',
};
const URGENCY_BADGE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  high:     'bg-orange-100 text-orange-700',
  normal:   'bg-blue-100 text-blue-600',
  low:      'bg-gray-100 text-gray-500',
};

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}h`;
  return `il y a ${Math.floor(h / 24)}j`;
}

// ── Composants ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, icon, sub, accent, to,
}: {
  label: string; value: number | string; icon: string;
  sub?: string; accent: string; to?: string;
}) {
  const inner = (
    <div className={`bg-white rounded-xl p-5 shadow-sm border-l-4 ${accent} ${to ? 'hover:shadow-md transition-shadow cursor-pointer' : ''}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            {typeof value === 'number' ? value.toLocaleString('fr-FR') : value}
          </p>
          {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        </div>
        <span className="text-2xl mt-0.5">{icon}</span>
      </div>
    </div>
  );
  if (to) return <Link to={to} className="block">{inner}</Link>;
  return inner;
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border-l-4 border-gray-200">
      <div className="sn-skeleton h-3 w-3/4 mb-3" />
      <div className="sn-skeleton h-8 w-1/2" />
    </div>
  );
}

function MiniBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
      <div className="h-full bg-sinaur-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

function ActivityFeed({ items }: { items: DashboardStats['recentActivity'] }) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-400 py-4 text-center">Aucune activité récente</p>;
  }
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-3">
          <span className="text-xl shrink-0 mt-0.5">
            {item.activityType === 'crisis' ? '🚨' : '📋'}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{item.label}</p>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${ACTIVITY_BADGE[item.status] ?? 'bg-gray-100 text-gray-600'}`}>
                {ACTIVITY_STATUS_FR[item.status] ?? item.status}
              </span>
              {item.urgency && item.urgency !== 'normal' && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${URGENCY_BADGE[item.urgency] ?? ''}`}>
                  {item.urgency}
                </span>
              )}
            </div>
          </div>
          <span className="text-xs text-gray-400 shrink-0 whitespace-nowrap mt-0.5">
            {relativeTime(item.createdAt)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

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
    if (['NEW_EVENT', 'EVENT_UPDATED', 'STATS_UPDATE', 'CRISIS_CREATED', 'CRISIS_UPDATED'].includes(msg.type)) {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    }
  }, [queryClient]);

  const { connected } = useWebSocket(handleWsMessage);

  const counts       = data?.counts;
  const crisis       = data?.crisisStats;
  const demands      = data?.demandStats;
  const stocks       = data?.stockStats;
  const maxHazard    = Math.max(...(data?.hazardBreakdown.map((h) => Number(h.count)) ?? [1]));
  const maxAffected  = Math.max(...(data?.topProvinces.map((p) => p.totalAffected) ?? [1]));

  return (
    <div className="sn-page">

      {/* ── En-tête ─────────────────────────────────────────────────────── */}
      <div className="sn-page-header">
        <div>
          <h1 className="sn-page-title">Centre National de Commandement</h1>
          <p className="sn-page-subtitle">République Démocratique du Congo — vue nationale en temps réel</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
            connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
            {connected ? 'Temps réel actif' : 'Connexion…'}
          </span>
          <a href="/api/dashboard/export.csv" target="_blank" className="sn-btn-secondary text-xs py-1.5">
            ↓ Export CSV (HXL)
          </a>
        </div>
      </div>

      {/* ── Section : Événements terrain ────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
          Événements terrain
        </h2>
        {isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Événements actifs"   value={counts?.activeEvents ?? 0}   icon="🔴" accent="border-red-500" />
            <StatCard label="Niveau critique"      value={counts?.criticalEvents ?? 0} icon="⚠️" accent="border-orange-500" sub="Sévère ou Extrême" />
            <StatCard label="Dernières 24h"        value={counts?.events24h ?? 0}      icon="🕐" accent="border-blue-500" />
            <StatCard label="Personnes affectées"  value={counts?.totalAffected ?? 0}  icon="👥" accent="border-purple-500" sub="Actifs confirmés" />
          </div>
        )}
      </div>

      {/* ── Section : Opérations en cours ───────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
          Opérations en cours
        </h2>
        {isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Crises actives" value={crisis?.activeCrises ?? 0}
              icon="🚨" accent="border-red-700"
              sub={crisis?.containedCrises ? `${crisis.containedCrises} maîtrisée(s)` : undefined}
              to="/crises"
            />
            <StatCard
              label="Demandes en attente" value={demands?.pendingDemands ?? 0}
              icon="📋" accent="border-yellow-500"
              sub={demands?.approvedDemands ? `${demands.approvedDemands} approuvée(s)` : undefined}
              to="/resources"
            />
            <StatCard
              label="Stocks critiques" value={stocks?.criticalStocks ?? 0}
              icon="📉" accent="border-orange-600"
              sub={stocks?.totalDepots ? `sur ${stocks.totalDepots} dépôt(s)` : undefined}
              to="/resources"
            />
            <StatCard
              label="Déplacés (crises)" value={crisis?.crisisDisplaced ?? 0}
              icon="🏠" accent="border-indigo-500"
              sub={crisis?.crisisDeaths ? `${crisis.crisisDeaths.toLocaleString('fr-FR')} décès confirmés` : undefined}
            />
          </div>
        )}
      </div>

      {/* ── Section : Analyse & Activité ────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Répartition par type d'aléa */}
        <div className="sn-card">
          <div className="sn-card-header">
            <div>
              <h2 className="font-semibold text-gray-800">Répartition par aléa</h2>
              <p className="text-xs text-gray-500 mt-0.5">Événements actifs</p>
            </div>
          </div>
          <div className="sn-card-body space-y-3">
            {(data?.hazardBreakdown.length ?? 0) === 0 && (
              <p className="text-sm text-gray-400">Aucun événement actif</p>
            )}
            {data?.hazardBreakdown.map((h) => (
              <div key={h.hazardType} className="flex items-center gap-3">
                <span className="text-lg w-6 shrink-0">{HAZARD_ICONS[h.hazardType] ?? '⚠️'}</span>
                <span className="text-sm text-gray-700 w-24 shrink-0">{HAZARD_FR[h.hazardType] ?? h.hazardType}</span>
                <div className="flex-1">
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-sinaur-600 rounded-full transition-all"
                      style={{ width: `${maxHazard > 0 ? (Number(h.count) / maxHazard) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <span className="text-sm font-semibold text-gray-900 w-6 text-right">{h.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Provinces les plus touchées */}
        <div className="sn-card">
          <div className="sn-card-header">
            <div>
              <h2 className="font-semibold text-gray-800">Provinces touchées</h2>
              <p className="text-xs text-gray-500 mt-0.5">Par événements sévères</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="sn-table">
              <thead>
                <tr>
                  <th>Province</th>
                  <th className="text-right">Actifs</th>
                  <th className="text-right">Sévères</th>
                  <th className="text-right">Affectés</th>
                </tr>
              </thead>
              <tbody>
                {data?.topProvinces.slice(0, 6).map((p) => (
                  <tr key={p.pcode}>
                    <td className="font-medium text-gray-900 text-xs">{p.provinceName}</td>
                    <td className="text-right tabular-nums text-xs">{p.activeEvents}</td>
                    <td className="text-right text-xs">
                      {p.severeEvents > 0
                        ? <span className="sn-badge-red">{p.severeEvents}</span>
                        : <span className="text-gray-300">0</span>
                      }
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <MiniBar value={p.totalAffected} max={maxAffected} />
                        <span className="text-xs tabular-nums w-12 text-right">
                          {p.totalAffected > 0 ? p.totalAffected.toLocaleString('fr-FR') : '—'}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
                {(data?.topProvinces.length ?? 0) === 0 && (
                  <tr><td colSpan={4} className="sn-empty">Aucune donnée</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Activité récente */}
        <div className="sn-card">
          <div className="sn-card-header">
            <div>
              <h2 className="font-semibold text-gray-800">Activité récente</h2>
              <p className="text-xs text-gray-500 mt-0.5">Crises &amp; demandes</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Link to="/crises"    className="text-xs text-sinaur-600 hover:underline">Crises</Link>
              <span className="text-gray-300">·</span>
              <Link to="/resources" className="text-xs text-sinaur-600 hover:underline">Ressources</Link>
            </div>
          </div>
          <div className="sn-card-body">
            {isLoading
              ? <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex gap-3">
                    <div className="sn-skeleton w-8 h-8 rounded-full shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="sn-skeleton h-3 w-3/4" />
                      <div className="sn-skeleton h-2.5 w-1/3" />
                    </div>
                  </div>
                ))}</div>
              : <ActivityFeed items={data?.recentActivity ?? []} />
            }
          </div>
        </div>
      </div>

      {/* ── Tendance 30 jours ────────────────────────────────────────────── */}
      {data?.trend && data.trend.length > 0 && (
        <div className="sn-card">
          <div className="sn-card-header">
            <div>
              <h2 className="font-semibold text-gray-800">Tendance — 30 derniers jours</h2>
              <p className="text-xs text-gray-500 mt-0.5">Nouveaux événements par jour</p>
            </div>
          </div>
          <div className="sn-card-body flex items-end gap-0.5 h-24">
            {(() => {
              const max = Math.max(...data.trend.map((t) => Number(t.count)), 1);
              return data.trend.map((t) => (
                <div
                  key={t.day}
                  className="flex-1 bg-sinaur-600 rounded-t opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                  style={{ height: `${(Number(t.count) / max) * 100}%`, minHeight: Number(t.count) > 0 ? 4 : 0 }}
                  title={`${t.day} : ${t.count} événement(s)`}
                />
              ));
            })()}
          </div>
        </div>
      )}

      {/* ── Barre de statut opérationnel ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 text-xs text-gray-400">
        <span>
          <span className="font-medium text-gray-600">{counts?.pendingEvents ?? '—'}</span> signalements en modération
        </span>
        <span>
          <span className="font-medium text-gray-600">{counts?.events7d ?? '—'}</span> événements (7 jours)
        </span>
        <span>
          <span className="font-medium text-gray-600">{demands?.fulfilledDemands ?? '—'}</span> demandes réalisées
        </span>
        <span>
          <span className="font-medium text-gray-600">{stocks?.totalStockLines ?? '—'}</span> lignes de stock actives
        </span>
        <span className={`ml-auto flex items-center gap-1 ${counts?.wsConnected ? 'text-green-600' : 'text-gray-400'}`}>
          🔗 {counts?.wsConnected ?? 0} décideur(s) connecté(s)
        </span>
      </div>

    </div>
  );
}
