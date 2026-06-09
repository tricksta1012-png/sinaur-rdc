import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';

const HAZARD_ICONS: Record<string, string> = {
  flood: '🌊', landslide: '⛰️', mass_displacement: '🏃',
  humanitarian_crisis: '🆘', health_epidemic: '🦠', volcanic_eruption: '🌋',
  drought: '☀️', fire: '🔥', conflict: '⚔️', earthquake: '📳', other: '⚠️',
};
const HAZARD_LABELS: Record<string, string> = {
  flood: 'Inondation', landslide: 'Glissement de terrain', mass_displacement: 'Déplacement de masse',
  humanitarian_crisis: 'Crise humanitaire', health_epidemic: 'Épidémie / Santé',
  volcanic_eruption: 'Éruption volcanique', drought: 'Sécheresse', fire: 'Incendie',
  conflict: 'Conflit armé', earthquake: 'Séisme', other: 'Autre',
};
const SEVERITY_BADGE: Record<string, string> = {
  Minor: 'sn-badge-yellow', Moderate: 'sn-badge-orange',
  Severe: 'sn-badge-red', Extreme: 'sn-badge-dark', Unknown: 'sn-badge-gray',
};
const STATUS_BADGE: Record<string, string> = {
  reported: 'sn-badge-gray', under_review: 'sn-badge-yellow',
  validated: 'sn-badge-blue', active: 'sn-badge-red',
  resolved: 'sn-badge-green', rejected: 'sn-badge-gray',
};
const STATUS_LABELS: Record<string, string> = {
  reported: 'Signalé', under_review: 'En examen', validated: 'Validé',
  active: 'Actif', resolved: 'Résolu', rejected: 'Rejeté',
};
const CONFIDENCE_BADGE: Record<string, string> = {
  low: 'sn-badge-gray', medium: 'sn-badge-yellow', high: 'sn-badge-green', confirmed: 'sn-badge-blue',
};
const SOURCE_LABELS: Record<string, string> = {
  citizen: 'Citoyen', field_agent: 'Agent terrain', ai_prediction: 'IA SINAUR',
  reliefweb: 'ReliefWeb', fews_net: 'FEWS NET', mettelsat: 'METTELSAT',
  ocha: 'OCHA', official: 'Officiel', other: 'Autre (GDACS…)',
};

interface EventRow {
  id: string;
  title: string;
  hazardType: string;
  status: string;
  severity: string;
  confidence: string;
  source: string;
  locationName: string;
  locationPcode: string;
  estimatedAffected?: number;
  startDate: string;
  tags: string[];
  reportedByName?: string;
}

interface EventDetail extends EventRow {
  description: string;
  sourceUrl?: string;
  sourceRef?: string;
  glideNumber?: string;
  locationLevel: number;
  locationAccuracy: string;
  affectedPcodes: string[];
  endDate?: string;
  isFlaggedSensitive: boolean;
  validatedByName?: string;
  validatedAt?: string;
  media: Array<{ id: string; type: string; url: string; thumbnailUrl?: string }>;
  createdAt: string;
  updatedAt: string;
}

function DetailField({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div>
      <p className="sn-section-label mb-1">{label}</p>
      <div className="text-gray-900 text-sm">{value}</div>
    </div>
  );
}

function EventDetailPanel({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const { data: ev, isLoading } = useQuery<EventDetail>({
    queryKey: ['event', eventId],
    queryFn: async () => {
      const { data } = await apiClient.get<{ success: boolean; data: EventDetail }>(`/events/${eventId}`);
      return data.data;
    },
  });

  return (
    <div className="sn-card sticky top-6">
      <div className="sn-card-header">
        <div className="min-w-0">
          {ev && (
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              <span className="text-base">{HAZARD_ICONS[ev.hazardType] ?? '⚠️'}</span>
              <span className={STATUS_BADGE[ev.status] ?? 'sn-badge-gray'}>{STATUS_LABELS[ev.status] ?? ev.status}</span>
              <span className={SEVERITY_BADGE[ev.severity] ?? 'sn-badge-gray'}>{ev.severity}</span>
              <span className={CONFIDENCE_BADGE[ev.confidence] ?? 'sn-badge-gray'}>{ev.confidence}</span>
              {ev.isFlaggedSensitive && <span className="sn-badge-red">⚠ Sensible</span>}
            </div>
          )}
          <h2 className="font-semibold text-gray-900 text-sm leading-snug line-clamp-2">
            {isLoading ? 'Chargement…' : (ev?.title ?? '')}
          </h2>
        </div>
        <button onClick={onClose} className="sn-modal-close shrink-0 ml-2">✕</button>
      </div>

      {isLoading && (
        <div className="p-6 text-center text-sm text-gray-500">Chargement des détails…</div>
      )}

      {ev && (
        <div className="p-5 space-y-5 overflow-y-auto max-h-[calc(100vh-200px)]">

          {/* Description */}
          {ev.description && (
            <div>
              <p className="sn-section-label mb-1">Description</p>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{ev.description}</p>
            </div>
          )}

          {/* Identifiants & source */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <DetailField label="Type d'aléa" value={
              <span className="flex items-center gap-1">
                {HAZARD_ICONS[ev.hazardType]} {HAZARD_LABELS[ev.hazardType] ?? ev.hazardType}
              </span>
            } />
            <DetailField label="Source" value={
              ev.sourceUrl
                ? <a href={ev.sourceUrl} target="_blank" rel="noopener noreferrer"
                     className="text-blue-600 hover:underline flex items-center gap-1">
                    {SOURCE_LABELS[ev.source] ?? ev.source} ↗
                  </a>
                : SOURCE_LABELS[ev.source] ?? ev.source
            } />
            {ev.glideNumber && (
              <DetailField label="GLIDE Number" value={
                <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{ev.glideNumber}</span>
              } />
            )}
            {ev.sourceRef && ev.sourceRef !== 'GDACS' && (
              <DetailField label="Réf. source" value={
                <span className="font-mono text-xs">{ev.sourceRef}</span>
              } />
            )}
          </div>

          {/* Localisation */}
          <div>
            <p className="sn-section-label mb-2">Localisation</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <span className="text-gray-500">Zone : </span>
                <span className="text-gray-900 font-medium">{ev.locationName}</span>
              </div>
              <div>
                <span className="text-gray-500">P-code OCHA : </span>
                <span className="font-mono text-xs text-gray-700">{ev.locationPcode}</span>
              </div>
              {ev.affectedPcodes?.length > 0 && (
                <div className="col-span-2">
                  <span className="text-gray-500">Zones affectées : </span>
                  <span className="font-mono text-xs text-gray-700">{ev.affectedPcodes.join(', ')}</span>
                </div>
              )}
              <div>
                <span className="text-gray-500">Précision : </span>
                <span className="text-gray-700">{ev.locationAccuracy}</span>
              </div>
            </div>
          </div>

          {/* Dates & chiffres */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <DetailField label="Date début" value={
              new Date(ev.startDate).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
            } />
            {ev.endDate && (
              <DetailField label="Date fin" value={
                new Date(ev.endDate).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
              } />
            )}
            {ev.estimatedAffected != null && (
              <DetailField label="Personnes affectées" value={
                <span className="text-lg font-bold text-sinaur-700">
                  {ev.estimatedAffected.toLocaleString('fr-FR')}
                </span>
              } />
            )}
          </div>

          {/* Tags */}
          {ev.tags?.length > 0 && (
            <div>
              <p className="sn-section-label mb-2">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {ev.tags.map(tag => (
                  <span key={tag} className="sn-badge-gray">{tag}</span>
                ))}
              </div>
            </div>
          )}

          {/* Traçabilité */}
          <div>
            <p className="sn-section-label mb-2">Traçabilité</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {ev.reportedByName && (
                <div>
                  <span className="text-gray-500">Signalé par : </span>
                  <span className="text-gray-900">{ev.reportedByName}</span>
                </div>
              )}
              {ev.validatedByName && (
                <div>
                  <span className="text-gray-500">Validé par : </span>
                  <span className="text-gray-900">{ev.validatedByName}</span>
                </div>
              )}
              {ev.validatedAt && (
                <div>
                  <span className="text-gray-500">Validé le : </span>
                  <span className="text-gray-700">{new Date(ev.validatedAt).toLocaleDateString('fr-FR')}</span>
                </div>
              )}
              <div>
                <span className="text-gray-500">Enregistré le : </span>
                <span className="text-gray-700">{new Date(ev.createdAt).toLocaleDateString('fr-FR')}</span>
              </div>
            </div>
          </div>

          {/* Médias */}
          {ev.media?.length > 0 && (
            <div>
              <p className="sn-section-label mb-2">Médias ({ev.media.length})</p>
              <div className="grid grid-cols-3 gap-2">
                {ev.media.map(m => (
                  <a key={m.id} href={m.url} target="_blank" rel="noopener noreferrer"
                     className="block rounded-lg overflow-hidden border border-gray-200 hover:border-blue-400 transition-colors">
                    {m.thumbnailUrl
                      ? <img src={m.thumbnailUrl} alt={m.type} className="w-full h-16 object-cover" />
                      : <div className="h-16 bg-gray-100 flex items-center justify-center text-xs text-gray-500">{m.type}</div>
                    }
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function EventsPage() {
  const [page, setPage]             = useState(1);
  const [search, setSearch]         = useState('');
  const [hazardType, setHazardType] = useState('');
  const [severity, setSeverity]     = useState('');
  const [status, setStatus]         = useState('');
  const [source, setSource]         = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function resetPage() { setPage(1); setSelectedId(null); }

  const { data, isLoading } = useQuery({
    queryKey: ['events', { page, search, hazardType, severity, status, source }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (search)     params.set('search', search);
      if (hazardType) params.set('hazardType', hazardType);
      if (severity)   params.set('severity', severity);
      if (status)     params.set('status', status);
      if (source)     params.set('source', source);
      const { data } = await apiClient.get<{
        success: boolean;
        data: EventRow[];
        pagination: { page: number; totalPages: number; total: number };
      }>(`/events?${params}`);
      return data;
    },
  });

  const events     = data?.data ?? [];
  const pagination = data?.pagination;
  const total      = pagination?.total ?? 0;

  return (
    <div className="sn-page">
      <div className="sn-page-header">
        <div>
          <h1 className="sn-page-title">Événements</h1>
          <p className="sn-page-subtitle">
            {total > 0
              ? `${total.toLocaleString('fr-FR')} catastrophes et urgences`
              : 'Catastrophes et urgences signalées'}
          </p>
        </div>
        <a href="/report" className="sn-btn-primary">+ Signaler</a>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-2">
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); resetPage(); }}
          placeholder="Rechercher…"
          className="sn-input w-48"
        />
        <select value={hazardType} onChange={e => { setHazardType(e.target.value); resetPage(); }} className="sn-select w-44">
          <option value="">Tous les aléas</option>
          {Object.entries(HAZARD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={severity} onChange={e => { setSeverity(e.target.value); resetPage(); }} className="sn-select w-36">
          <option value="">Toute gravité</option>
          {['Minor','Moderate','Severe','Extreme','Unknown'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={status} onChange={e => { setStatus(e.target.value); resetPage(); }} className="sn-select w-36">
          <option value="">Tout statut</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={source} onChange={e => { setSource(e.target.value); resetPage(); }} className="sn-select w-40">
          <option value="">Toute source</option>
          {Object.entries(SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div className={`grid gap-6 ${selectedId ? 'lg:grid-cols-5' : ''}`}>

        {/* Liste */}
        <div className={selectedId ? 'lg:col-span-2' : ''}>
          {isLoading ? (
            <div className="sn-empty">Chargement…</div>
          ) : events.length === 0 ? (
            <div className="sn-empty">Aucun événement trouvé</div>
          ) : (
            <div className="space-y-3">

              {/* Tableau plein (pas de détail ouvert) */}
              {!selectedId && (
                <div className="sn-table-wrap">
                  <table className="sn-table">
                    <thead>
                      <tr>
                        <th>Événement</th>
                        <th>Localisation</th>
                        <th>Gravité</th>
                        <th>Statut</th>
                        <th>Source</th>
                        <th>Date</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map(event => (
                        <tr
                          key={event.id}
                          className="cursor-pointer"
                          onClick={() => setSelectedId(event.id)}
                        >
                          <td>
                            <div className="flex items-center gap-2">
                              <span className="text-base shrink-0">{HAZARD_ICONS[event.hazardType] ?? '⚠️'}</span>
                              <span className="font-medium text-gray-900 max-w-[200px] truncate">{event.title}</span>
                            </div>
                          </td>
                          <td className="max-w-[140px] truncate text-gray-500">{event.locationName}</td>
                          <td>
                            <span className={SEVERITY_BADGE[event.severity] ?? 'sn-badge-gray'}>{event.severity}</span>
                          </td>
                          <td>
                            <span className={STATUS_BADGE[event.status] ?? 'sn-badge-gray'}>
                              {STATUS_LABELS[event.status] ?? event.status}
                            </span>
                          </td>
                          <td className="text-gray-500 text-xs">{SOURCE_LABELS[event.source] ?? event.source}</td>
                          <td className="text-gray-500 whitespace-nowrap text-xs">
                            {new Date(event.startDate).toLocaleDateString('fr-FR')}
                          </td>
                          <td>
                            <button className="sn-btn-link-blue">Détail →</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Vue compacte quand le panneau de détail est ouvert */}
              {selectedId && (
                <div className="space-y-1">
                  {events.map(event => (
                    <button
                      key={event.id}
                      onClick={() => setSelectedId(event.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        selectedId === event.id
                          ? 'border-sinaur-500 bg-red-50'
                          : 'border-gray-200 bg-white hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-base mt-0.5 shrink-0">{HAZARD_ICONS[event.hazardType] ?? '⚠️'}</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900 text-sm truncate">{event.title}</p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className={`${SEVERITY_BADGE[event.severity] ?? 'sn-badge-gray'} text-[10px]`}>
                              {event.severity}
                            </span>
                            <span className={`${STATUS_BADGE[event.status] ?? 'sn-badge-gray'} text-[10px]`}>
                              {STATUS_LABELS[event.status] ?? event.status}
                            </span>
                            <span className="text-[10px] text-gray-400">{event.locationName}</span>
                          </div>
                        </div>
                        <span className="text-[10px] text-gray-400 whitespace-nowrap shrink-0">
                          {new Date(event.startDate).toLocaleDateString('fr-FR')}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {pagination && pagination.totalPages > 1 && (
                <div className="sn-pagination">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="sn-page-btn"
                  >
                    ← Précédent
                  </button>
                  <span className="text-sm text-gray-600 px-2">
                    Page {pagination.page} / {pagination.totalPages}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                    disabled={page === pagination.totalPages}
                    className="sn-page-btn"
                  >
                    Suivant →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Panneau de détail */}
        {selectedId && (
          <div className="lg:col-span-3">
            <EventDetailPanel eventId={selectedId} onClose={() => setSelectedId(null)} />
          </div>
        )}
      </div>
    </div>
  );
}
