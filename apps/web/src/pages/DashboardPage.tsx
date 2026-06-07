import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';
import type { ApiResponse, DisasterEvent } from '@sinaur/shared-types';

function StatCard({ label, value, icon, color }: { label: string; value: number | string; icon: string; color: string }) {
  return (
    <div className={`bg-white rounded-xl p-5 shadow-sm border-l-4 ${color}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 font-medium">{label}</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
        </div>
        <span className="text-3xl">{icon}</span>
      </div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    Minor: 'bg-yellow-100 text-yellow-800',
    Moderate: 'bg-orange-100 text-orange-800',
    Severe: 'bg-red-100 text-red-800',
    Extreme: 'bg-red-900 text-white',
    Unknown: 'bg-gray-100 text-gray-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${colors[severity] ?? colors.Unknown}`}>
      {severity}
    </span>
  );
}

export function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['events', 'dashboard'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<DisasterEvent[]>>('/events?limit=10&page=1');
      return data;
    },
  });

  const events = data?.data ?? [];
  const active = events.filter((e) => e.status === 'active').length;
  const severe = events.filter((e) => e.severity === 'Severe' || e.severity === 'Extreme').length;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Tableau de bord national</h1>
        <p className="text-gray-500 text-sm mt-1">Vue d'ensemble en temps réel — République Démocratique du Congo</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Événements actifs" value={active} icon="🔴" color="border-red-500" />
        <StatCard label="Niveau Sévère/Extrême" value={severe} icon="⚠️" color="border-orange-500" />
        <StatCard label="Événements totaux" value={data?.pagination?.total ?? 0} icon="📋" color="border-blue-500" />
        <StatCard label="Provinces surveillées" value="26" icon="📍" color="border-green-500" />
      </div>

      <div className="bg-white rounded-xl shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center">
          <h2 className="font-semibold text-gray-800">Événements récents</h2>
          <a href="/events" className="text-sm text-red-600 hover:underline">Voir tout</a>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Chargement...</div>
        ) : events.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Aucun événement</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {events.map((event) => (
              <div key={event.id} className="px-5 py-3 flex items-start gap-3 hover:bg-gray-50">
                <span className="text-xl mt-0.5">
                  {event.hazardType === 'flood' ? '🌊'
                    : event.hazardType === 'mass_displacement' ? '🏃'
                    : event.hazardType === 'health_epidemic' ? '🦠'
                    : event.hazardType === 'landslide' ? '⛰️'
                    : '⚠️'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-gray-900 truncate">{event.title}</span>
                    <SeverityBadge severity={event.severity} />
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{event.locationName} · {new Date(event.startDate).toLocaleDateString('fr-FR')}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
