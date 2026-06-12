import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../lib/api.js';
import { useRealtimeFeed } from '../hooks/useRealtimeFeed.js';

const HAZARD_FR: Record<string, string> = {
  flood: 'Inondation', landslide: 'Glissement', mass_displacement: 'Déplacement',
  humanitarian_crisis: 'Crise hum.', health_epidemic: 'Épidémie',
  volcanic_eruption: 'Éruption', drought: 'Sécheresse', fire: 'Incendie',
  conflict: 'Conflit', earthquake: 'Séisme', other: 'Autre',
};

const HAZARD_COLOR: Record<string, string> = {
  flood: '#2563eb', landslide: '#92400e', mass_displacement: '#7c3aed',
  humanitarian_crisis: '#be185d', health_epidemic: '#065f46',
  volcanic_eruption: '#dc2626', drought: '#b45309', conflict: '#991b1b',
  earthquake: '#1e3a5f', fire: '#ea580c', other: '#4b5563',
};

function KpiCard({ label, value, sub, color, href }: { label: string; value: string | number; sub?: string; color: string; href?: string }) {
  const navigate = useNavigate();
  return (
    <div
      className={`cc-card p-4 border-l-4 ${href ? 'cursor-pointer hover:bg-cc-800 transition-colors group' : ''}`}
      style={{ borderLeftColor: color }}
      onClick={href ? () => navigate(href) : undefined}
    >
      <div className="text-2xl font-bold font-mono text-white leading-none">
        {typeof value === 'number' ? value.toLocaleString('fr') : value}
      </div>
      <div className="text-xs text-gray-400 mt-1.5 font-medium">{label}</div>
      {sub && <div className="text-[11px] text-cc-600 mt-0.5">{sub}</div>}
      {href && <div className="text-[10px] text-cc-600 group-hover:text-sinaur-400 mt-1 font-mono transition-colors">Voir →</div>}
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { connected } = useRealtimeFeed();

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => apiClient.get('/dashboard/stats').then(r => r.data.data),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const { data: recentEvents = [] } = useQuery({
    queryKey: ['dashboard-events'],
    queryFn: () => apiClient.get('/events?limit=8&status=active').then(r => r.data.data ?? []),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const counts      = data?.counts      ?? {};
  const crisisStats = data?.crisisStats  ?? {};
  const hazardBreakdown = data?.hazardBreakdown ?? [];
  const topProvinces    = data?.topProvinces    ?? [];
  const recentActivity  = data?.recentActivity  ?? [];

  // Max count for hazard bar chart
  const maxHazard = Math.max(1, ...hazardBreakdown.map((h: any) => Number(h.count)));

  if (isLoading) {
    return (
      <div className="h-full p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-20 cc-card animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Tableau de bord</h1>
          <p className="text-sm text-cc-600 mt-0.5">
            Vue nationale · {connected ? (
              <span className="text-green-400">● Temps réel actif</span>
            ) : (
              <span className="text-red-400">○ Hors ligne</span>
            )}
          </p>
        </div>
        <div className="text-xs text-cc-600 font-mono">
          Mis à jour : {new Date().toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      {/* Quick access bar */}
      <div className="flex flex-wrap gap-2 mb-6">
        {[
          { label: '🗺️ Carte opérationnelle', href: '/ops', color: 'border-sinaur-700 hover:bg-sinaur-900/30' },
          { label: '🚨 Crises actives',        href: '/crises', color: 'border-red-800 hover:bg-red-900/20' },
          { label: '⚔️ Surveillance conflits', href: '/conflit', color: 'border-orange-800 hover:bg-orange-900/20' },
          { label: '🤖 Intelligence IA',       href: '/ai', color: 'border-purple-800 hover:bg-purple-900/20' },
          { label: '📦 Stocks humanitaires',  href: '/stocks', color: 'border-cc-600 hover:bg-cc-800' },
        ].map(l => (
          <button
            key={l.href}
            onClick={() => navigate(l.href)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-mono text-gray-300 hover:text-white transition-colors ${l.color}`}
          >
            {l.label}
          </button>
        ))}
      </div>

      {/* KPI Row 1 — événements */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KpiCard label="Événements actifs"    value={counts.activeEvents   ?? '…'} color="#dc2626" href="/ops" />
        <KpiCard label="Événements 24h"       value={counts.events24h      ?? '…'} color="#ea580c" href="/ops" />
        <KpiCard label="Événements 7j"        value={counts.events7d       ?? '…'} color="#ca8a04" href="/ops" />
        <KpiCard label="Personnes affectées"  value={counts.totalAffected  ?? '…'} sub="événements actifs" color="#7c3aed" />
      </div>

      {/* KPI Row 2 — crises & ressources */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Crises actives"      value={crisisStats.activeCrises   ?? '…'} color="#dc2626" href="/crises" />
        <KpiCard label="Personnes déplacées" value={crisisStats.crisisDisplaced ?? '…'} color="#7c3aed" href="/crises" />
        <KpiCard label="Stocks critiques"    value={data?.stockStats?.criticalStocks ?? '…'} color="#ea580c" href="/stocks" />
        <KpiCard label="Connexions actives"  value={counts.wsConnected ?? '…'} sub="opérateurs en ligne" color="#2563eb" />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Left: Répartition par type */}
        <div className="cc-card p-4">
          <div className="text-xs font-mono text-cc-500 uppercase tracking-wider mb-4">
            Répartition par type de risque
          </div>
          {hazardBreakdown.length === 0 ? (
            <EmptyState text="Aucun événement actif" />
          ) : (
            <div className="space-y-2.5">
              {hazardBreakdown.slice(0, 8).map((h: any) => {
                const pct = Math.round((Number(h.count) / maxHazard) * 100);
                const color = HAZARD_COLOR[h.hazardType] ?? '#4b5563';
                return (
                  <div
                    key={h.hazardType}
                    className="cursor-pointer group"
                    onClick={() => navigate(`/ops?hazardType=${h.hazardType}`)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-300 group-hover:text-white transition-colors">
                        {HAZARD_FR[h.hazardType] ?? h.hazardType}
                      </span>
                      <span className="text-xs font-mono text-gray-400 group-hover:text-white transition-colors">{h.count} →</span>
                    </div>
                    <div className="h-1.5 bg-cc-700 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Top provinces */}
        <div className="cc-card p-4">
          <div className="text-xs font-mono text-cc-500 uppercase tracking-wider mb-4">
            Provinces les plus touchées
          </div>
          {topProvinces.length === 0 ? (
            <EmptyState text="Aucune donnée provinciale" />
          ) : (
            <div className="space-y-2">
              {topProvinces.slice(0, 7).map((p: any, i: number) => (
                <div
                  key={p.pcode}
                  className="flex items-center gap-3 cursor-pointer group"
                  onClick={() => navigate('/ops')}
                >
                  <span className="text-[10px] font-mono text-cc-600 w-4 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-300 group-hover:text-white truncate transition-colors">{p.provinceName}</span>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        {p.severeEvents > 0 && (
                          <span className="text-[10px] text-red-400 font-mono">{p.severeEvents} sév.</span>
                        )}
                        <span className="text-xs font-mono text-gray-400 group-hover:text-white transition-colors">{p.activeEvents} →</span>
                      </div>
                    </div>
                    <div className="h-1 bg-cc-700 rounded-full overflow-hidden mt-1">
                      <div
                        className="h-full rounded-full bg-sinaur-600 group-hover:bg-sinaur-400 transition-colors"
                        style={{ width: `${Math.min(100, (p.activeEvents / Math.max(1, topProvinces[0]?.activeEvents ?? 1)) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Activité récente */}
        <div className="cc-card p-4">
          <div className="text-xs font-mono text-cc-500 uppercase tracking-wider mb-4">
            Activité récente
          </div>
          {recentActivity.length === 0 ? (
            <EmptyState text="Aucune activité récente" />
          ) : (
            <div className="space-y-2">
              {recentActivity.map((a: any, i: number) => (
                <div key={i} className="flex items-start gap-2.5 py-1.5 border-b border-cc-800 last:border-0">
                  <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                    a.urgency === 'critical' ? 'bg-red-500' :
                    a.urgency === 'high' ? 'bg-orange-500' : 'bg-cc-600'
                  }`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-gray-200 truncate">{a.label}</div>
                    <div className="text-[10px] text-cc-600 mt-0.5 font-mono">
                      {a.activityType === 'crisis' ? 'Crise' : 'Demande'} ·{' '}
                      {new Date(a.createdAt).toLocaleDateString('fr', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <StatusBadge status={a.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Événements actifs récents */}
        <div className="cc-card p-4">
          <div className="text-xs font-mono text-cc-500 uppercase tracking-wider mb-4">
            Événements actifs récents
          </div>
          {(recentEvents as any[]).length === 0 ? (
            <EmptyState
              text="Aucun événement actif"
              sub="Les événements signalés apparaîtront ici"
              action={{ label: '+ Signaler un événement', href: '/coordination' }}
            />
          ) : (
            <div className="space-y-1.5">
              {(recentEvents as any[]).slice(0, 7).map((e: any) => (
                <div
                  key={e.id}
                  className="flex items-start gap-2 py-1.5 border-b border-cc-800 last:border-0 cursor-pointer group hover:bg-cc-800/50 rounded px-1 -mx-1 transition-colors"
                  onClick={() => navigate('/ops')}
                >
                  <span
                    className="mt-1 w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: HAZARD_COLOR[e.hazardType] ?? '#4b5563' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-gray-200 group-hover:text-white truncate font-medium transition-colors">{e.title}</div>
                    <div className="text-[10px] text-cc-600 mt-0.5">
                      {HAZARD_FR[e.hazardType] ?? e.hazardType} ·{' '}
                      <span className="font-mono">{e.locationPcode}</span>
                      {e.estimatedAffected ? ` · ${Number(e.estimatedAffected).toLocaleString('fr')} aff.` : ''}
                    </div>
                  </div>
                  <span className="text-[10px] text-cc-700 group-hover:text-sinaur-400 shrink-0 mt-1 transition-colors">→</span>
                </div>
              ))}
              <div className="pt-1">
                <button
                  onClick={() => navigate('/ops')}
                  className="text-[10px] text-sinaur-400 hover:text-sinaur-300 font-mono transition-colors"
                >
                  Voir tous sur la carte →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text, sub, action }: { text: string; sub?: string; action?: { label: string; href: string } }) {
  return (
    <div className="py-8 text-center">
      <div className="text-cc-600 text-2xl mb-2">—</div>
      <p className="text-sm text-cc-600">{text}</p>
      {sub && <p className="text-xs text-cc-700 mt-1">{sub}</p>}
      {action && (
        <a href={action.href} className="inline-block mt-3 text-xs text-sinaur-400 hover:text-sinaur-300 underline">
          {action.label}
        </a>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active:    'bg-red-900/60 text-red-300',
    pending:   'bg-yellow-900/60 text-yellow-300',
    approved:  'bg-blue-900/60 text-blue-300',
    fulfilled: 'bg-green-900/60 text-green-300',
    closed:    'bg-cc-800 text-cc-500',
  };
  return (
    <span className={`cc-badge shrink-0 text-[10px] ${map[status] ?? 'bg-cc-800 text-cc-500'}`}>
      {status}
    </span>
  );
}
