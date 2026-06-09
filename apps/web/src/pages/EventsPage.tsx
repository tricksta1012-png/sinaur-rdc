import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';
import type { ApiResponse, DisasterEvent } from '@sinaur/shared-types';

const HAZARD_ICONS: Record<string, string> = {
  flood: '🌊', landslide: '⛰️', mass_displacement: '🏃',
  humanitarian_crisis: '🆘', health_epidemic: '🦠', volcanic_eruption: '🌋',
  drought: '☀️', fire: '🔥', conflict: '⚔️', earthquake: '📳', other: '⚠️',
};

const SEVERITY_BADGE: Record<string, string> = {
  Minor:   'sn-badge-yellow',
  Moderate:'sn-badge-orange',
  Severe:  'sn-badge-red',
  Extreme: 'sn-badge-dark',
  Unknown: 'sn-badge-gray',
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
    <div className="sn-page">
      <div className="sn-page-header">
        <div>
          <h1 className="sn-page-title">Événements</h1>
          <p className="sn-page-subtitle">Liste des catastrophes et urgences signalées</p>
        </div>
        <a href="/report" className="sn-btn-primary">+ Signaler</a>
      </div>

      {/* Barre de recherche */}
      <input
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        placeholder="Rechercher un événement…"
        className="sn-input max-w-md"
      />

      {isLoading ? (
        <div className="sn-empty">Chargement…</div>
      ) : events.length === 0 ? (
        <div className="sn-empty">Aucun événement trouvé</div>
      ) : (
        <>
          <div className="sn-table-wrap">
            <table className="sn-table">
              <thead>
                <tr>
                  <th>Événement</th>
                  <th>Localisation</th>
                  <th>Gravité</th>
                  <th>Statut</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="text-base shrink-0">{HAZARD_ICONS[event.hazardType] ?? '⚠️'}</span>
                        <span className="font-medium text-gray-900 max-w-xs truncate">{event.title}</span>
                      </div>
                    </td>
                    <td className="max-w-[180px] truncate text-gray-500">{event.location?.name}</td>
                    <td>
                      <span className={SEVERITY_BADGE[event.severity] ?? 'sn-badge-gray'}>
                        {event.severity}
                      </span>
                    </td>
                    <td className="text-gray-500">{STATUS_LABELS[event.status] ?? event.status}</td>
                    <td className="text-gray-500 whitespace-nowrap">
                      {new Date(event.startDate).toLocaleDateString('fr-FR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="sn-pagination">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="sn-page-btn"
              >
                ← Précédent
              </button>
              <span className="text-sm text-gray-600 px-2">
                Page {pagination.page} / {pagination.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={page === pagination.totalPages}
                className="sn-page-btn"
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
