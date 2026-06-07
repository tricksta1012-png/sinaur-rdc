import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';
import type { ApiResponse, DisasterEvent } from '@sinaur/shared-types';

const HAZARD_ICONS: Record<string, string> = {
  flood: '🌊', landslide: '⛰️', mass_displacement: '🏃',
  humanitarian_crisis: '🆘', health_epidemic: '🦠', volcanic_eruption: '🌋',
  drought: '☀️', fire: '🔥', conflict: '⚔️', earthquake: '📳', other: '⚠️',
};

const SEVERITY_CLASSES: Record<string, string> = {
  Minor: 'bg-yellow-100 text-yellow-800',
  Moderate: 'bg-orange-100 text-orange-800',
  Severe: 'bg-red-100 text-red-800',
  Extreme: 'bg-red-900 text-white',
  Unknown: 'bg-gray-100 text-gray-700',
};

const STATUS_LABELS: Record<string, string> = {
  reported: 'Signalé', under_review: 'En examen',
  validated: 'Validé', active: 'Actif', resolved: 'Résolu', rejected: 'Rejeté',
};

export function EventsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['events', { page, search }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (search) params.set('search', search);
      const { data } = await apiClient.get<ApiResponse<DisasterEvent[]>>(`/events?${params}`);
      return data;
    },
  });

  const events = data?.data ?? [];
  const pagination = data?.pagination;

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Événements</h1>
        <a href="/report" className="px-4 py-2 bg-red-700 text-white rounded-lg text-sm font-medium hover:bg-red-800 transition-colors">
          + Signaler
        </a>
      </div>

      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Rechercher un événement..."
          className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 text-sm"
        />
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-500">Chargement...</div>
      ) : events.length === 0 ? (
        <div className="text-center py-12 text-gray-500">Aucun événement trouvé</div>
      ) : (
        <>
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Événement</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Localisation</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Gravité</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Statut</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {events.map((event) => (
                  <tr key={event.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{HAZARD_ICONS[event.hazardType] ?? '⚠️'}</span>
                        <span className="font-medium text-gray-900 max-w-xs truncate">{event.title}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 max-w-[180px] truncate">{event.locationName}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${SEVERITY_CLASSES[event.severity] ?? SEVERITY_CLASSES.Unknown}`}>
                        {event.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{STATUS_LABELS[event.status] ?? event.status}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(event.startDate).toLocaleDateString('fr-FR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="flex justify-center items-center gap-3 mt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm disabled:opacity-50 hover:bg-gray-50"
              >
                ← Précédent
              </button>
              <span className="text-sm text-gray-600">
                Page {pagination.page} / {pagination.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={page === pagination.totalPages}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm disabled:opacity-50 hover:bg-gray-50"
              >
                Suivant →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
