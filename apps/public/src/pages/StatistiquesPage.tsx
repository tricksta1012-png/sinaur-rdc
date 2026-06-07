import { useQuery } from '@tanstack/react-query';
import { publicApi } from '../api.js';

const HAZARD_FR: Record<string, string> = {
  flood:            '🌊 Inondation',
  conflict:         '⚔️ Conflit armé',
  health_epidemic:  '🦠 Épidémie',
  mass_displacement:'🚶 Déplacement',
  drought:          '🏜️ Sécheresse',
  other:            '📌 Autre',
};

const HAZARD_COLOR: Record<string, string> = {
  flood:            'bg-blue-500',
  conflict:         'bg-red-600',
  health_epidemic:  'bg-purple-500',
  mass_displacement:'bg-orange-500',
  drought:          'bg-yellow-500',
  other:            'bg-gray-500',
};

export function StatistiquesPage() {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['public-stats'],
    queryFn: publicApi.getStats,
    staleTime: 300_000,
  });

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12 space-y-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-48 bg-gray-200 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12 text-center text-gray-500">
        Impossible de charger les statistiques. Réessayez plus tard.
      </div>
    );
  }

  // Regrouper la tendance par date
  const trendByDate: Record<string, Record<string, number>> = {};
  for (const { statDate, hazardType, eventCount } of stats.trend) {
    if (!trendByDate[statDate]) trendByDate[statDate] = {};
    trendByDate[statDate][hazardType] = eventCount;
  }
  const sortedDates = Object.keys(trendByDate).sort();
  const maxDay = Math.max(...sortedDates.map(d => Object.values(trendByDate[d]).reduce((a, b) => a + b, 0)), 1);

  const maxHazard = stats.byHazardType[0]?.count ?? 1;
  const maxProv   = stats.byProvince[0]?.events30d ?? 1;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-10">

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Statistiques</h1>
        <p className="text-gray-500 text-sm mt-1">Données anonymisées — 30 derniers jours</p>
      </div>

      {/* Par type de risque */}
      <section>
        <h2 className="text-base font-semibold text-gray-800 mb-4">Événements par type de risque</h2>
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          {stats.byHazardType.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-4">Aucune donnée disponible</p>
          ) : stats.byHazardType.map(({ hazardType, count }) => {
            const pct = Math.round((count / maxHazard) * 100);
            return (
              <div key={hazardType} className="flex items-center gap-3">
                <div className="w-40 text-sm text-gray-700 shrink-0">{HAZARD_FR[hazardType] ?? hazardType}</div>
                <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${HAZARD_COLOR[hazardType] ?? 'bg-gray-400'}`}
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                </div>
                <div className="w-10 text-sm font-semibold text-right text-gray-800">{count}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Tendance 30 jours */}
      <section>
        <h2 className="text-base font-semibold text-gray-800 mb-4">Tendance quotidienne (30 jours)</h2>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          {sortedDates.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-4">Aucune donnée disponible</p>
          ) : (
            <div className="flex items-end gap-px h-32 overflow-x-auto">
              {sortedDates.map(date => {
                const dayTotal = Object.values(trendByDate[date]).reduce((a, b) => a + b, 0);
                const h = Math.round((dayTotal / maxDay) * 100);
                return (
                  <div
                    key={date}
                    className="flex-1 min-w-[6px] bg-sinaur-600 rounded-t hover:bg-sinaur-700 transition-colors cursor-default relative group"
                    style={{ height: `${Math.max(h, 2)}%` }}
                    title={`${new Date(date).toLocaleDateString('fr-CD', { day: 'numeric', month: 'short' })} : ${dayTotal} événement${dayTotal > 1 ? 's' : ''}`}
                  >
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-gray-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10">
                      {new Date(date).toLocaleDateString('fr-CD', { day: 'numeric', month: 'short' })} : {dayTotal}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex justify-between text-xs text-gray-400 mt-2">
            <span>{sortedDates[0] ? new Date(sortedDates[0]).toLocaleDateString('fr-CD', { day: 'numeric', month: 'short' }) : ''}</span>
            <span>{sortedDates.at(-1) ? new Date(sortedDates.at(-1)!).toLocaleDateString('fr-CD', { day: 'numeric', month: 'short' }) : ''}</span>
          </div>
        </div>
      </section>

      {/* Par province */}
      <section>
        <h2 className="text-base font-semibold text-gray-800 mb-4">Activité par province (30 jours)</h2>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Province</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">7 jours</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">30 jours</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Alertes</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Activité</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stats.byProvince
                .filter(p => p.events30d > 0 || p.activeAlerts > 0)
                .map(p => {
                  const pct = Math.round((p.events30d / maxProv) * 100);
                  return (
                    <tr key={p.pcode} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">{p.nameFr}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{p.events7d}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-800">{p.events30d}</td>
                      <td className="px-4 py-3 text-right">
                        {p.activeAlerts > 0 ? (
                          <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                            🚨 {p.activeAlerts}
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <div className="w-full bg-gray-100 rounded-full h-2">
                          <div className="h-2 bg-sinaur-600 rounded-full" style={{ width: `${Math.max(pct, 1)}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              {stats.byProvince.filter(p => p.events30d > 0 || p.activeAlerts > 0).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">Aucun événement enregistré</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
