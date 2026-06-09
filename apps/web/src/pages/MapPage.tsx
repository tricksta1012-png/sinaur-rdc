import { useState, useCallback, useRef } from 'react';
import Map, { Marker, Popup, NavigationControl, ScaleControl, Source, Layer } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import type { ApiResponse } from '@sinaur/shared-types';
import 'maplibre-gl/dist/maplibre-gl.css';

interface MapEvent {
  id: string;
  title: string;
  hazardType: string;
  status: string;
  severity: string;
  locationName: string;
  locationPcode: string;
  estimatedAffected: number | null;
  startDate: string;
  endDate: string | null;
  glideNumber: string | null;
  source: string | null;
  lng: number | null;
  lat: number | null;
}

// ---------------------------------------------------------------------------
// Centroïdes des 26 provinces RDC (WGS-84 : [lng, lat])
// Utilisés comme fallback pour les événements sans coordonnées exactes.
// ---------------------------------------------------------------------------
const PROVINCE_CENTROIDS: Record<string, [number, number]> = {
  'CD-BC': [15.3, -5.0],  'CD-BU': [25.5,  1.5],  'CD-EQ': [21.0,  2.5],
  'CD-HK': [27.8, -3.0],  'CD-HL': [26.0, -5.5],  'CD-HU': [24.0, -7.0],
  'CD-IT': [23.5,  1.0],  'CD-KA': [26.5,-10.5],  'CD-KC': [21.5, -6.0],
  'CD-KE': [26.0, -7.5],  'CD-KL': [16.0, -4.5],  'CD-KN': [15.5, -4.3],
  'CD-KW': [22.5, -8.5],  'CD-LO': [25.0,  0.5],  'CD-LT': [22.5, -5.0],
  'CD-LU': [26.5, -8.0],  'CD-MA': [20.0, -5.5],  'CD-MN': [25.5, -3.5],
  'CD-MO': [19.5,  3.5],  'CD-NK': [28.5, -0.5],  'CD-NU': [22.0,  3.0],
  'CD-SA': [26.5,-12.5],  'CD-SK': [28.0, -4.0],  'CD-SU': [25.0,  5.5],
  'CD-TA': [26.5, -5.5],  'CD-TO': [21.0, -2.5],
};

/**
 * Retourne le centroïde pour un P-code de province (ex: "CD-KN" ou "CD-KN-123").
 * Essaie d'abord le match exact, puis le préfixe à 5 caractères.
 */
function getProvinceCentroid(pcode: string): [number, number] | null {
  if (!pcode) return null;
  if (PROVINCE_CENTROIDS[pcode]) return PROVINCE_CENTROIDS[pcode];
  // Essai préfixe CD-XX
  const prefix = pcode.slice(0, 5).toUpperCase();
  return PROVINCE_CENTROIDS[prefix] ?? null;
}

const HAZARD_ICONS: Record<string, string> = {
  flood: '🌊', landslide: '⛰️', mass_displacement: '🏃',
  humanitarian_crisis: '🆘', health_epidemic: '🦠', volcanic_eruption: '🌋',
  drought: '☀️', fire: '🔥', conflict: '⚔️', earthquake: '📳', other: '⚠️',
};

const SEVERITY_BG: Record<string, string> = {
  Minor: 'bg-yellow-400', Moderate: 'bg-orange-500',
  Severe: 'bg-red-600', Extreme: 'bg-red-900', Unknown: 'bg-gray-400',
};

const HAZARD_FR: Record<string, string> = {
  flood: 'Inondation', landslide: 'Glissement', mass_displacement: 'Déplacement',
  humanitarian_crisis: 'Crise hum.', health_epidemic: 'Épidémie', volcanic_eruption: 'Volcan',
  drought: 'Sécheresse', fire: 'Incendie', conflict: 'Conflit', earthquake: 'Séisme', other: 'Autre',
};

const SOURCE_FR: Record<string, string> = {
  citizen: 'Citoyen',
  field_agent: 'Agent terrain',
  ai_prediction: 'IA Prédiction',
  reliefweb: 'ReliefWeb',
};

type FilterType = 'all' | 'flood' | 'mass_displacement' | 'health_epidemic' | 'conflict' | 'other_hazards';
type SourceFilter = 'all' | 'citizen' | 'field_agent' | 'ai_prediction' | 'reliefweb';

const PERIOD_OPTIONS = [
  { value: 'all', label: 'Toutes périodes' },
  { value: '2025', label: '2025' },
  { value: '2024', label: '2024' },
  { value: '2023', label: '2023' },
  { value: '2022', label: '2022' },
  { value: '2021', label: '2021' },
  { value: '2020', label: '2020' },
  { value: 'before2020', label: 'Avant 2020' },
];

export function MapPage() {
  const mapRef = useRef<MapRef>(null);
  const [selected, setSelected] = useState<MapEvent | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [showLayers, setShowLayers] = useState(true);
  const [historyMode, setHistoryMode] = useState(false);
  const [periodFilter, setPeriodFilter] = useState('all');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['map', 'events', historyMode],
    queryFn: async () => {
      const url = historyMode ? '/dashboard/map-data?history=true' : '/dashboard/map-data';
      const { data } = await apiClient.get<ApiResponse<MapEvent[]>>(url);
      return data.data ?? [];
    },
    staleTime: 0,                                      // FIX 1: invalidation force toujours un refetch immédiat
    refetchInterval: historyMode ? false : 10_000,     // FIX 3: 10s au lieu de 30s en mode live
  });

  const handleWs = useCallback((msg: any) => {
    if (msg.type === 'NEW_EVENT' || msg.type === 'EVENT_UPDATED') {
      void queryClient.invalidateQueries({ queryKey: ['map'] });
      // FIX 4: aussi appeler refetchQueries directement pour NEW_EVENT
      if (msg.type === 'NEW_EVENT') {
        void queryClient.refetchQueries({ queryKey: ['map', 'events', historyMode] });
      }
    }
  }, [queryClient, historyMode]);

  const { connected } = useWebSocket(handleWs);

  // ---------------------------------------------------------------------------
  // Résolution des coordonnées — FIX 2 : fallback centroïde province
  // ---------------------------------------------------------------------------
  const resolvedEvents = (data ?? []).map((e) => {
    if (e.lat && e.lng) return { ...e, isApprox: false };
    const centroid = getProvinceCentroid(e.locationPcode ?? '');
    if (centroid) {
      return { ...e, lng: centroid[0], lat: centroid[1], isApprox: true };
    }
    return { ...e, isApprox: false };
  });

  // ---------------------------------------------------------------------------
  // Filtrage
  // ---------------------------------------------------------------------------
  const filtered = resolvedEvents.filter((e) => {
    if (!e.lat || !e.lng) return false;

    // Filtre type d'aléa
    if (filter !== 'all') {
      if (filter === 'other_hazards' && ['flood', 'mass_displacement', 'health_epidemic', 'conflict'].includes(e.hazardType)) return false;
      if (filter !== 'other_hazards' && e.hazardType !== filter) return false;
    }

    // FIX 5 : filtre source
    if (sourceFilter !== 'all' && e.source !== sourceFilter) return false;

    // Filtre période
    if (periodFilter !== 'all') {
      const year = new Date(e.startDate).getFullYear();
      if (periodFilter === 'before2020' && year >= 2020) return false;
      if (periodFilter !== 'before2020' && String(year) !== periodFilter) return false;
    }

    return true;
  });

  // Seuls les événements avec coordonnées précises alimentent la couche cluster GeoJSON
  const exactFiltered = filtered.filter((e) => !e.isApprox);
  const geoJson = {
    type: 'FeatureCollection' as const,
    features: exactFiltered.map((e) => ({
      type: 'Feature' as const,
      properties: { id: e.id, severity: e.severity, hazardType: e.hazardType },
      geometry: { type: 'Point' as const, coordinates: [e.lng!, e.lat!] },
    })),
  };

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="px-4 py-3 bg-white border-b border-gray-200 flex items-center gap-3 flex-wrap shrink-0">
        <div>
          <h1 className="text-base font-bold text-gray-900 leading-tight">
            Carte nationale des incidents
            {historyMode && <span className="ml-2 text-xs font-normal text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Mode historique</span>}
          </h1>
          <p className="text-xs text-gray-400">OpenStreetMap · MapLibre GL · {filtered.length} événement{filtered.length > 1 ? 's' : ''}{historyMode ? ' (2000-2025)' : ' actifs'}</p>
        </div>
        <div className="flex-1" />

        {/* Filtre type d'aléa */}
        <div className="flex items-center gap-1 flex-wrap">
          {(['all', 'flood', 'mass_displacement', 'health_epidemic', 'conflict', 'other_hazards'] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                filter === f ? 'bg-red-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f === 'all' ? 'Tous' : f === 'other_hazards' ? 'Autres' : HAZARD_FR[f] ?? f}
            </button>
          ))}
        </div>

        {/* FIX 5 : Filtre source */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs text-gray-400 shrink-0">Source :</span>
          {(['all', 'citizen', 'field_agent', 'ai_prediction', 'reliefweb'] as SourceFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setSourceFilter(s)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                sourceFilter === s ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {s === 'all' ? 'Toutes' : SOURCE_FR[s] ?? s}
            </button>
          ))}
        </div>

        {/* Filtre période (mode historique seulement) */}
        {historyMode && (
          <select
            value={periodFilter}
            onChange={(e) => setPeriodFilter(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-red-400"
          >
            {PERIOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}

        {/* Bouton mode historique */}
        <button
          onClick={() => { setHistoryMode((h) => !h); setPeriodFilter('all'); setSelected(null); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
            historyMode
              ? 'bg-amber-500 text-white border-amber-600 shadow'
              : 'bg-white text-gray-600 border-gray-200 hover:border-amber-400 hover:text-amber-700'
          }`}
        >
          🕐 {historyMode ? 'Quitter historique' : 'Carte historique'}
        </button>

        <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
          connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
          {connected ? 'Temps réel' : 'Hors ligne'}
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 bg-white/70 z-10 flex items-center justify-center">
            <span className="text-gray-500 text-sm">Chargement de la carte...</span>
          </div>
        )}

        <Map
          ref={mapRef}
          initialViewState={{ longitude: 24.0, latitude: -3.5, zoom: 5 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle={import.meta.env.VITE_MAPLIBRE_STYLE_URL ?? 'https://demotiles.maplibre.org/style.json'}
          attributionControl={{ customAttribution: '© OpenStreetMap · SINAUR-RDC' }}
        >
          <NavigationControl position="top-right" />
          <ScaleControl position="bottom-left" unit="metric" />

          {/* Couche cluster — uniquement pour les événements à coordonnées exactes */}
          {showLayers && (
            <Source id="events" type="geojson" data={geoJson} cluster clusterMaxZoom={10} clusterRadius={50}>
              <Layer
                id="clusters"
                type="circle"
                filter={['has', 'point_count']}
                paint={{
                  'circle-color': ['step', ['get', 'point_count'], '#f97316', 5, '#ef4444', 20, '#7f1d1d'],
                  'circle-radius': ['step', ['get', 'point_count'], 18, 5, 24, 20, 32],
                  'circle-opacity': 0.85,
                }}
              />
              <Layer
                id="cluster-count"
                type="symbol"
                filter={['has', 'point_count']}
                layout={{ 'text-field': '{point_count_abbreviated}', 'text-size': 12, 'text-font': ['Open Sans Bold'] }}
                paint={{ 'text-color': '#fff' }}
              />
            </Source>
          )}

          {/* Marqueurs individuels */}
          {filtered.map((event) => {
            const isResolved = event.status === 'resolved';
            const isApprox = (event as any).isApprox === true;

            return (
              <Marker
                key={event.id}
                longitude={event.lng!}
                latitude={event.lat!}
                onClick={() => setSelected(event)}
                style={{
                  cursor: 'pointer',
                  opacity: isApprox ? 0.6 : (isResolved ? 0.55 : 1),
                }}
              >
                {/* FIX 2 : marqueur visuel différencié pour les coordonnées approx */}
                <div className={`relative group${isApprox ? ' approx' : ''}`}>
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shadow-lg text-base ${
                      SEVERITY_BG[event.severity] ?? 'bg-gray-500'
                    } ${isApprox ? 'border-2 border-dashed border-white/80' : 'border-2 border-white'}`}
                  >
                    {HAZARD_ICONS[event.hazardType] ?? '⚠️'}
                  </div>
                  {event.severity === 'Extreme' && !isResolved && !isApprox && (
                    <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-ping" />
                  )}
                  {isResolved && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-gray-400 rounded-full border border-white text-white flex items-center justify-center" style={{ fontSize: 7 }}>✓</span>
                  )}
                  {isApprox && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-gray-300 rounded-full border border-white text-gray-600 flex items-center justify-center" style={{ fontSize: 7 }} title="Position approximative (centroïde province)">~</span>
                  )}
                </div>
              </Marker>
            );
          })}

          {selected?.lat && selected?.lng && (
            <Popup
              longitude={selected.lng}
              latitude={selected.lat}
              onClose={() => setSelected(null)}
              closeOnClick={false}
              maxWidth="340px"
            >
              <div className="p-3 min-w-[240px]">
                <div className="flex items-start gap-2 mb-2">
                  <span className="text-xl shrink-0">{HAZARD_ICONS[selected.hazardType] ?? '⚠️'}</span>
                  <div>
                    <p className="font-semibold text-sm text-gray-900 leading-tight">{selected.title}</p>
                    <p className="text-xs text-gray-500">{selected.locationName} · {selected.locationPcode}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap text-xs mb-2">
                  <span className={`px-1.5 py-0.5 rounded font-bold text-white ${SEVERITY_BG[selected.severity] ?? 'bg-gray-500'}`}>
                    {selected.severity}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                    selected.status === 'active' ? 'bg-green-100 text-green-700' :
                    selected.status === 'resolved' ? 'bg-gray-100 text-gray-500' :
                    'bg-yellow-100 text-yellow-700'
                  }`}>{selected.status === 'active' ? 'Actif' : selected.status === 'resolved' ? 'Résolu' : selected.status}</span>
                  {(selected as any).isApprox && (
                    <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500" title="Coordonnées exactes indisponibles">
                      ~ Position approx.
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-600 space-y-1">
                  <div className="flex gap-2">
                    <span className="text-gray-400 w-14 shrink-0">Début</span>
                    <span>{new Date(selected.startDate).toLocaleDateString('fr-FR')}</span>
                  </div>
                  {selected.endDate && (
                    <div className="flex gap-2">
                      <span className="text-gray-400 w-14 shrink-0">Fin</span>
                      <span>{new Date(selected.endDate).toLocaleDateString('fr-FR')}</span>
                    </div>
                  )}
                  {selected.estimatedAffected && (
                    <div className="flex gap-2">
                      <span className="text-gray-400 w-14 shrink-0">Affectés</span>
                      <span className="font-medium text-gray-800">~{selected.estimatedAffected.toLocaleString('fr-FR')}</span>
                    </div>
                  )}
                  {selected.glideNumber && (
                    <div className="flex gap-2">
                      <span className="text-gray-400 w-14 shrink-0">GLIDE</span>
                      <span className="font-mono text-gray-700 text-xs">{selected.glideNumber}</span>
                    </div>
                  )}
                  {selected.source && (
                    <div className="flex gap-2">
                      <span className="text-gray-400 w-14 shrink-0">Source</span>
                      <span className="text-gray-700">{SOURCE_FR[selected.source] ?? selected.source}</span>
                    </div>
                  )}
                </div>
                <a href="/events" className="block mt-2 text-xs text-red-600 hover:underline">
                  Voir tous les événements →
                </a>
              </div>
            </Popup>
          )}
        </Map>

        {/* Légende */}
        <div className="absolute bottom-8 right-4 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg p-3 text-xs">
          <p className="font-semibold text-gray-700 mb-2">Gravité</p>
          {[['Minor', 'bg-yellow-400', 'Mineure'], ['Moderate', 'bg-orange-500', 'Modérée'], ['Severe', 'bg-red-600', 'Sévère'], ['Extreme', 'bg-red-900', 'Extrême']].map(([, cls, label]) => (
            <div key={label} className="flex items-center gap-1.5 mb-1">
              <span className={`w-3 h-3 rounded-full ${cls}`} />
              <span className="text-gray-600">{label}</span>
            </div>
          ))}
          <hr className="my-2 border-gray-200" />
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-3 h-3 rounded-full bg-gray-300 border border-dashed border-gray-400" />
            <span className="text-gray-500">Position approx.</span>
          </div>
          {historyMode && (
            <>
              <hr className="my-2 border-gray-200" />
              <p className="font-semibold text-gray-700 mb-2">Statut</p>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-3 h-3 rounded-full bg-red-600 opacity-100" />
                <span className="text-gray-600">Actif</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-gray-400 opacity-55" />
                <span className="text-gray-600">Résolu</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
