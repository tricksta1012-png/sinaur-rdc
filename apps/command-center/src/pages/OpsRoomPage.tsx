import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import MapGL, { Source, Layer, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { apiClient } from '../lib/api.js';
import { useRealtimeFeed } from '../hooks/useRealtimeFeed.js';
import { LiveFeed } from '../components/LiveFeed.js';
import { useAuthStore } from '../stores/auth.js';
import { FraicheurBadge } from '../components/FraicheurBadge.js';

const MAP_STYLE = {
  version: 8 as const,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [
    { id: 'bg', type: 'background' as const, paint: { 'background-color': '#0d1b2a' } },
    {
      id: 'osm',
      type: 'raster' as const,
      source: 'osm',
      paint: {
        'raster-saturation': -1,
        'raster-brightness-max': 0.32,
        'raster-opacity': 0.88,
        'raster-contrast': 0.05,
      },
    },
  ],
};

const SEVERITY_COLOR: Record<string, string> = {
  Extreme:  '#dc2626',
  Severe:   '#ea580c',
  Moderate: '#ca8a04',
  Minor:    '#2563eb',
  Unknown:  '#6b7280',
};

const SEVERITY_FR: Record<string, string> = {
  Extreme: 'Extrême', Severe: 'Sévère', Moderate: 'Modérée',
  Minor: 'Mineure', Unknown: 'Inconnue',
};

const HAZARD_FR: Record<string, string> = {
  flood: 'Inondation', landslide: 'Glissement de terrain',
  mass_displacement: 'Déplacement de masse', humanitarian_crisis: 'Crise humanitaire',
  health_epidemic: 'Épidémie sanitaire', volcanic_eruption: 'Éruption volcanique',
  drought: 'Sécheresse', fire: 'Incendie', conflict: 'Conflit armé',
  earthquake: 'Séisme', other: 'Autre',
};

const HAZARD_ICON: Record<string, string> = {
  flood: '🌊', landslide: '⛰️', mass_displacement: '🏃', humanitarian_crisis: '🆘',
  health_epidemic: '🦠', volcanic_eruption: '🌋', drought: '☀️',
  fire: '🔥', conflict: '⚔️', earthquake: '📳', other: '⚠️',
};

const DRC_BOUNDS: [[number, number], [number, number]] = [[12.2, -13.5], [31.3, 5.4]];

const PROVINCE_BOUNDS: Record<string, [[number, number], [number, number]]> = {
  CD10: [[15.0, -4.65], [16.1, -4.15]], CD20: [[13.0, -5.8], [16.5, -4.0]],
  CD21: [[16.5, -7.0], [19.0, -4.5]],  CD22: [[16.5, -7.0], [19.5, -4.0]],
  CD23: [[17.0, -4.5], [20.5, -1.5]],  CD41: [[17.0, -2.5], [23.0, 2.5]],
  CD42: [[18.0, 2.0],  [22.0, 5.5]],   CD43: [[20.0, 3.0],  [24.5, 5.5]],
  CD44: [[19.0, 0.5],  [23.0, 4.0]],   CD45: [[20.0, -3.0], [25.0, 1.0]],
  CD51: [[23.0, -2.0], [28.0, 2.0]],   CD52: [[22.5, 0.5],  [27.0, 4.5]],
  CD53: [[27.0, 1.0],  [31.0, 5.5]],   CD54: [[27.5, 0.0],  [31.5, 3.5]],
  CD61: [[26.8, -3.5], [30.2, 2.5]],   CD62: [[26.5, -5.5], [29.5, -1.0]],
  CD63: [[25.5, -5.0], [29.0, -1.0]],  CD71: [[25.5, -13.5],[29.5, -8.0]],
  CD72: [[22.5, -12.5],[26.0, -8.0]],  CD73: [[24.0, -11.0],[27.5, -7.0]],
  CD74: [[27.5, -8.5], [31.5, -4.5]],  CD81: [[23.0, -9.0], [26.5, -6.0]],
  CD82: [[23.5, -8.5], [27.0, -5.0]],  CD83: [[20.5, -7.5], [24.0, -4.0]],
  CD84: [[21.5, -8.5], [25.0, -5.5]],  CD85: [[23.5, -5.5], [27.0, -2.5]],
};

const PROVINCE_NAMES: Record<string, string> = {
  CD10:'Kinshasa', CD20:'Kongo-Central', CD21:'Kwango', CD22:'Kwilu', CD23:'Maï-Ndombe',
  CD41:'Équateur', CD42:'Sud-Ubangi', CD43:'Nord-Ubangi', CD44:'Mongala', CD45:'Tshuapa',
  CD51:'Tshopo', CD52:'Bas-Uélé', CD53:'Haut-Uélé', CD54:'Ituri',
  CD61:'Nord-Kivu', CD62:'Sud-Kivu', CD63:'Maniema',
  CD71:'Haut-Katanga', CD72:'Lualaba', CD73:'Haut-Lomami', CD74:'Tanganyika',
  CD81:'Lomami', CD82:'Kasaï-Oriental', CD83:'Kasaï', CD84:'Kasaï-Central', CD85:'Sankuru',
};

function decodeJwtScope(token: string): string[] {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return Array.isArray(payload.scope) ? payload.scope : [];
  } catch { return []; }
}

const SOURCE_FR: Record<string, string> = {
  official: 'Source officielle', field_agent: 'Agent terrain', ngo: 'ONG',
  community: 'Communauté', media: 'Médias', reliefweb: 'ReliefWeb',
  gdacs: 'GDACS', other: 'Autre',
};

const STATUS_FR: Record<string, { label: string; color: string }> = {
  active:       { label: 'Actif',            color: 'bg-red-900/70 text-red-300 border-red-700' },
  monitoring:   { label: 'Surveillance',     color: 'bg-yellow-900/70 text-yellow-300 border-yellow-700' },
  under_review: { label: 'En révision',      color: 'bg-blue-900/70 text-blue-300 border-blue-700' },
  resolved:     { label: 'Résolu',           color: 'bg-green-900/70 text-green-300 border-green-700' },
  rejected:     { label: 'Rejeté',           color: 'bg-cc-800 text-gray-500 border-cc-700' },
};

// Détecte si un texte est probablement en anglais (pas de caractères français)
function isLikelyEnglish(text: string): boolean {
  if (!text || text.length < 20) return false;
  const frenchChars = /[àâäéèêëîïôùûüçœæÀÂÄÉÈÊËÎÏÔÙÛÜÇŒÆ]/;
  const englishWords = /\b(the|and|in|of|is|for|to|was|has|been|this|that|with|from|notification|reported|affected|areas|located|fire|flood)\b/i;
  return !frenchChars.test(text) && englishWords.test(text);
}

function DescriptionBlock({ text, eventTitle }: { text: string; eventTitle: string }) {
  const [translated, setTranslated] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const displayText = translated ?? text;
  const isLong = displayText.length > 280;
  const needsTranslation = isLikelyEnglish(text);

  const translate = async () => {
    setTranslating(true);
    try {
      const res = await fetch(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|fr`,
      );
      const json = await res.json();
      const t = json?.responseData?.translatedText;
      if (t && t !== text) setTranslated(t);
    } catch { /* ignore */ } finally {
      setTranslating(false);
    }
  };

  return (
    <div className="border-t border-cc-800 pt-2 mt-1">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] font-mono text-cc-500 uppercase">Description</div>
        <div className="flex items-center gap-2">
          {needsTranslation && !translated && (
            <button
              onClick={translate}
              disabled={translating}
              className="text-[10px] text-sinaur-400 hover:text-sinaur-300 font-mono disabled:opacity-50 flex items-center gap-1"
            >
              {translating ? '⟳ Traduction…' : '🌐 Traduire'}
            </button>
          )}
          {translated && (
            <button onClick={() => setTranslated(null)} className="text-[10px] text-cc-500 hover:text-cc-400 font-mono">
              Original
            </button>
          )}
        </div>
      </div>
      {needsTranslation && !translated && (
        <span className="inline-flex items-center gap-1 text-[9px] text-yellow-600 font-mono mb-1">
          <span>⚠</span> Texte source en anglais
        </span>
      )}
      <p className={`text-gray-300 leading-relaxed text-[11px] transition-all ${expanded ? '' : 'line-clamp-4'}`}>
        {displayText}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-1.5 text-[10px] text-sinaur-400 hover:text-sinaur-300 font-mono flex items-center gap-1 transition-colors"
        >
          {expanded ? '▲ Réduire' : `▼ Lire la suite (${displayText.length} car.)`}
        </button>
      )}
    </div>
  );
}

// Convert lng/lat to XYZ tile coords
function lngLatToTile(lng: number, lat: number, z: number) {
  const n = Math.pow(2, z);
  const x = Math.floor((lng + 180) / 360 * n);
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x, y };
}

// ESRI World Imagery — free, no API key, high-res satellite
const esriTile = (z: number, y: number, x: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

function SatelliteMosaic({ lng, lat }: { lng: number; lat: number }) {
  const z = 13;
  const { x, y } = lngLatToTile(lng, lat, z);
  return (
    <div className="relative w-full h-40 overflow-hidden bg-cc-900">
      <div className="grid grid-cols-3 absolute inset-0" style={{ gridTemplateRows: 'repeat(3,1fr)' }}>
        {[-1, 0, 1].flatMap(dy =>
          [-1, 0, 1].map(dx => (
            <img
              key={`${dx},${dy}`}
              src={esriTile(z, y + dy, x + dx)}
              className="w-full h-full object-cover"
              alt=""
              loading="lazy"
              onError={e => { (e.target as HTMLImageElement).style.opacity = '0'; }}
            />
          ))
        )}
      </div>
      {/* Crosshair */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="relative">
          <div className="w-5 h-5 rounded-full border-2 border-white shadow-lg" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-px h-7 bg-white/80" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-px w-7 bg-white/80" />
        </div>
      </div>
      {/* Attribution */}
      <div className="absolute bottom-1 right-1 text-[8px] text-white/50 font-mono bg-black/40 px-1 rounded">
        © Esri Satellite
      </div>
    </div>
  );
}

interface SelectedEvent {
  id: string;
  lng: number; lat: number;
  title: string; severity: string;
  hazardType: string; status: string;
  locationPcode: string; locationName: string;
  estimatedAffected: number; startDate: string; source: string;
}

function EventDetailPanel({ event, onClose }: { event: SelectedEvent; onClose: () => void }) {
  const { data: detail } = useQuery({
    queryKey: ['event-detail', event.id],
    queryFn: () => apiClient.get(`/events/${event.id}`).then(r => r.data.data),
    staleTime: 5 * 60_000,
    enabled: !!event.id,
  });

  const sev = SEVERITY_COLOR[event.severity] ?? '#6b7280';
  const st  = STATUS_FR[event.status] ?? { label: event.status, color: 'bg-cc-800 text-gray-400 border-cc-700' };

  return (
    <div className="absolute top-28 left-3 w-72 z-20 bg-cc-950/97 border border-cc-700 rounded-xl shadow-2xl overflow-hidden backdrop-blur-sm">
      {/* Satellite view */}
      <SatelliteMosaic lng={event.lng} lat={event.lat} />

      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 text-white/80 hover:text-white flex items-center justify-center text-sm leading-none"
      >×</button>

      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-cc-800">
        <div className="flex items-start gap-2">
          <span className="text-xl shrink-0 mt-0.5">{HAZARD_ICON[event.hazardType] ?? '⚠️'}</span>
          <div className="min-w-0">
            <h3 className="text-white text-sm font-bold leading-snug line-clamp-2">{event.title}</h3>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {/* Severity badge */}
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                style={{ borderColor: sev + '80', color: sev, background: sev + '22' }}
              >
                {SEVERITY_FR[event.severity] ?? event.severity}
              </span>
              {/* Status badge */}
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${st.color}`}>
                {st.label}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="px-3 py-2.5 space-y-2 text-xs">
        {/* Hazard type */}
        <div className="flex items-center gap-2 text-gray-400">
          <span className="w-4 text-center shrink-0">🏷️</span>
          <span>{HAZARD_FR[event.hazardType] ?? event.hazardType}</span>
        </div>

        {/* Location */}
        {event.locationName && (
          <div className="flex items-start gap-2 text-gray-300">
            <span className="w-4 text-center shrink-0 mt-0.5">📍</span>
            <div>
              <div>{event.locationName}</div>
              <div className="text-[10px] font-mono text-cc-500">{event.locationPcode}</div>
            </div>
          </div>
        )}

        {/* GPS coords */}
        <div className="flex items-center gap-2 text-cc-500 font-mono text-[10px]">
          <span className="w-4 text-center shrink-0">🌐</span>
          <span>{event.lat.toFixed(4)}°, {event.lng.toFixed(4)}°</span>
        </div>

        {/* Affected */}
        {event.estimatedAffected > 0 && (
          <div className="flex items-center gap-2 text-gray-300">
            <span className="w-4 text-center shrink-0">👥</span>
            <span>
              <span className="font-bold text-white">{event.estimatedAffected.toLocaleString('fr')}</span>
              {' '}personnes estimées
            </span>
          </div>
        )}

        {/* Date */}
        {event.startDate && (
          <div className="flex items-center gap-2 text-gray-400">
            <span className="w-4 text-center shrink-0">📅</span>
            <span>
              {new Date(event.startDate).toLocaleDateString('fr-FR', {
                day: 'numeric', month: 'long', year: 'numeric',
              })}
            </span>
          </div>
        )}

        {/* Source */}
        <div className="flex items-center gap-2 text-gray-400">
          <span className="w-4 text-center shrink-0">📡</span>
          <span>{SOURCE_FR[event.source] ?? event.source}</span>
        </div>

        {/* Description — détection langue + traduction */}
        {detail?.description && (
          <DescriptionBlock text={detail.description} eventTitle={event.title} />
        )}

        {/* Tags */}
        {detail?.tags && (detail.tags as string[]).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {(detail.tags as string[]).map(t => (
              <span key={t} className="text-[10px] bg-cc-800 text-cc-400 px-1.5 py-0.5 rounded font-mono">
                #{t}
              </span>
            ))}
          </div>
        )}

        {/* Confidence */}
        {detail?.confidence && (
          <div className="flex items-center gap-2 text-gray-400">
            <span className="w-4 text-center shrink-0">🎯</span>
            <span className="capitalize">{
              detail.confidence === 'confirmed' ? 'Confirmé' :
              detail.confidence === 'probable'  ? 'Probable' :
              detail.confidence === 'possible'  ? 'Possible' : detail.confidence
            }</span>
          </div>
        )}

        {/* Media thumbnails */}
        {detail?.media && (detail.media as any[]).length > 0 && (
          <div className="border-t border-cc-800 pt-2">
            <div className="text-[10px] font-mono text-cc-500 uppercase mb-1.5">Médias ({(detail.media as any[]).length})</div>
            <div className="flex gap-1.5 flex-wrap">
              {(detail.media as any[]).slice(0, 4).map((m: any) => (
                <img
                  key={m.id}
                  src={m.thumbnailUrl ?? m.url}
                  alt=""
                  className="w-14 h-14 object-cover rounded border border-cc-700"
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 pb-3">
        <a
          href={`/crises?event=${event.id}`}
          className="block w-full text-center text-[11px] font-mono text-sinaur-400 hover:text-sinaur-300 border border-sinaur-800 hover:border-sinaur-600 rounded-lg py-1.5 transition-colors"
        >
          Voir dans Gestion des crises →
        </a>
      </div>
    </div>
  );
}

export function OpsRoomPage() {
  const { events, connected, clearFeed, reconnect } = useRealtimeFeed();
  const { tokens } = useAuthStore();
  const qc = useQueryClient();
  const [selectedEvent, setSelectedEvent] = useState<SelectedEvent | null>(null);
  const [wsLiveIds, setWsLiveIds] = useState<Set<string>>(new Set());
  const mapRef = useRef<MapRef>(null);
  const [clusterHover, setClusterHover] = useState<{ x: number; y: number; count: number } | null>(null);
  const [riskHover, setRiskHover] = useState<{ x: number; y: number; level: string; score: number; province?: string } | null>(null);
  const [filterHazard, setFilterHazard]   = useState('');
  const [filterPeriod, setFilterPeriod]   = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [showRiskLayer, setShowRiskLayer] = useState(false);
  const [riskHorizon, setRiskHorizon]     = useState<7 | 30 | 90>(7);

  const userScope = useMemo((): string[] => {
    if (!tokens?.accessToken) return [];
    return decodeJwtScope(tokens.accessToken);
  }, [tokens?.accessToken]);

  const provinceBounds = userScope.length > 0 ? (PROVINCE_BOUNDS[userScope[0]] ?? null) : null;
  const provinceName   = userScope.length > 0 ? (PROVINCE_NAMES[userScope[0]] ?? userScope[0]) : null;

  const mapQueryParams = useMemo(() => {
    const p = new URLSearchParams({ limit: '200' });
    if (filterHazard)   p.set('hazardType', filterHazard);
    if (filterSeverity) p.set('severity', filterSeverity);
    if (filterPeriod === '24h') p.set('dateFrom', new Date(Date.now() - 86_400_000).toISOString());
    if (filterPeriod === '7j')  p.set('dateFrom', new Date(Date.now() - 7 * 86_400_000).toISOString());
    if (filterPeriod === '30j') p.set('dateFrom', new Date(Date.now() - 30 * 86_400_000).toISOString());
    if (userScope.length === 1) p.set('province', userScope[0]);
    return p.toString();
  }, [filterHazard, filterSeverity, filterPeriod, userScope]);

  const hasActiveFilters = !!(filterHazard || filterPeriod || filterSeverity);

  const { data: statsData, isFetching: statsFetching, isError: statsError, dataUpdatedAt: statsUpdatedAt, refetch: statsRefetch } = useQuery({
    queryKey: ['cc-stats'],
    queryFn: () => apiClient.get('/dashboard/stats').then(r => r.data.data),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  const { data: mapGeoJSON } = useQuery({
    queryKey: ['cc-events-map', mapQueryParams],
    queryFn: () => apiClient.get(`/events/map?${mapQueryParams}`).then(r => r.data),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  const { data: divisionsGeo = [] } = useQuery({
    queryKey: ['cc-divisions-geo'],
    queryFn: () => apiClient.get('/geo/divisions?level=1&withGeometry=true').then(r => r.data.data),
    staleTime: 60 * 60_000,
  });

  const { data: activeCrises } = useQuery({
    queryKey: ['cc-crises-active'],
    queryFn: () => apiClient.get('/crises?limit=20').then(r => {
      const rows: any[] = r.data.data ?? [];
      const cutoff = new Date(Date.now() - 30 * 86_400_000);
      return rows.filter(c =>
        c.status !== 'resolved' && c.status !== 'rejected' &&
        new Date(c.created_at ?? c.start_date) >= cutoff
      );
    }),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  const { data: riskMapData } = useQuery({
    queryKey: ['risk-map', riskHorizon],
    queryFn: () => apiClient.get(`/predictions/risk-map/${riskHorizon}`).then(r => r.data),
    enabled: showRiskLayer,
    staleTime: 5 * 60_000,
    refetchInterval: showRiskLayer ? 6 * 60_000 : false,
  });

  useEffect(() => {
    const last = events[0];
    if (!last) return;

    // Surbrillance carte pour nouveaux événements/alertes
    if (last.type === 'NEW_ALERT' || last.type === 'NEW_EVENT') {
      const id = (last.payload as any).id ?? (last.payload as any).identifier;
      if (id) setWsLiveIds(prev => new Set([...prev, id]));
      // Rafraîchir immédiatement la carte et les stats
      qc.invalidateQueries({ queryKey: ['cc-events-map'] });
      qc.invalidateQueries({ queryKey: ['cc-stats'] });
    }

    // Rafraîchir les crises si une crise est créée ou mise à jour
    if (last.type === 'CRISIS_CREATED' || last.type === 'CRISIS_UPDATED') {
      qc.invalidateQueries({ queryKey: ['cc-crises-active'] });
      qc.invalidateQueries({ queryKey: ['cc-stats'] });
    }

    // Rafraîchir la carte si un événement est mis à jour (statut changé)
    if (last.type === 'EVENT_UPDATED') {
      qc.invalidateQueries({ queryKey: ['cc-events-map'] });
    }
  }, [events, qc]);

  const annotatedGeoJSON = useMemo(() => {
    if (!mapGeoJSON) return null;
    return {
      ...mapGeoJSON,
      features: (mapGeoJSON.features ?? []).map((f: any) => ({
        ...f,
        properties: {
          ...f.properties,
          color: SEVERITY_COLOR[f.properties.severity] ?? '#6b7280',
          isLive: wsLiveIds.has(f.properties.id),
        },
      })),
    };
  }, [mapGeoJSON, wsLiveIds]);

  const provinceGeoJSON = useMemo(() => {
    const countByPcode = new Map<string, number>();
    for (const f of (mapGeoJSON?.features ?? [])) {
      const p = f.properties?.locationPcode as string;
      if (p) countByPcode.set(p, (countByPcode.get(p) ?? 0) + 1);
    }
    return {
      type: 'FeatureCollection' as const,
      features: (divisionsGeo as any[])
        .filter(d => d.geometry)
        .map(d => ({
          type: 'Feature' as const,
          geometry: d.geometry,
          properties: {
            pcode: d.pcode,
            name: d.name,
            alertCount: countByPcode.get(d.pcode) ?? 0,
          },
        })),
    };
  }, [divisionsGeo, mapGeoJSON]);

  const onMapClick = useCallback((e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) { setSelectedEvent(null); return; }
    const p = f.properties as any;

    // Cluster click → zoom in to expansion zoom
    if (p.cluster_id !== undefined) {
      const map = mapRef.current?.getMap();
      const source = map?.getSource('events') as any;
      if (source?.getClusterExpansionZoom) {
        source.getClusterExpansionZoom(p.cluster_id, (err: Error | null, zoom: number) => {
          if (err) return;
          map?.easeTo({ center: [e.lngLat.lng, e.lngLat.lat], zoom: zoom + 0.5, duration: 500 });
        });
      }
      return;
    }

    setSelectedEvent({
      id:                 p.id ?? '',
      lng:                e.lngLat.lng,
      lat:                e.lngLat.lat,
      title:              p.title ?? 'Événement',
      severity:           p.severity ?? 'Unknown',
      hazardType:         p.hazardType ?? 'other',
      status:             p.status ?? 'active',
      locationPcode:      p.locationPcode ?? '',
      locationName:       p.locationName ?? '',
      estimatedAffected:  Number(p.estimatedAffected ?? 0),
      startDate:          p.startDate ?? '',
      source:             p.source ?? 'other',
    });
  }, []);

  const onMouseMove = useCallback((e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (f?.layer?.id === 'risk-circles') {
      setClusterHover(null);
      setRiskHover({
        x: e.point.x,
        y: e.point.y,
        level: f.properties?.level ?? '?',
        score: Math.round(f.properties?.score ?? 0),
        province: f.properties?.province ?? f.properties?.pcode,
      });
    } else if (f?.properties?.point_count) {
      setRiskHover(null);
      setClusterHover({ x: e.point.x, y: e.point.y, count: f.properties.point_count as number });
    } else {
      setClusterHover(null);
      setRiskHover(null);
    }
  }, []);

  const resetView = useCallback(() => {
    const map = mapRef.current?.getMap();
    const bounds = provinceBounds ?? DRC_BOUNDS;
    map?.fitBounds(bounds as any, { padding: provinceBounds ? 40 : 40, duration: 800 });
  }, [provinceBounds]);

  const eventCount = mapGeoJSON?.features?.length ?? 0;

  return (
    <div className="flex h-full">
      {/* Map */}
      <div className="flex-1 relative">

        {/* Stats bar */}
        <div className="absolute top-3 left-3 right-3 z-10 flex gap-2 flex-wrap">
          {[
            { label: 'Événements actifs', value: statsData?.counts?.activeEvents ?? eventCount, color: 'bg-red-900/90 border-red-700' },
            { label: 'Événements 24h',    value: statsData?.counts?.events24h ?? '…',           color: 'bg-orange-900/90 border-orange-700' },
            { label: 'Crises ouvertes',   value: statsData?.crisisStats?.activeCrises ?? activeCrises?.length ?? '…', color: 'bg-yellow-900/90 border-yellow-700' },
            { label: 'Flux temps réel',   value: connected ? '● EN DIRECT' : '○ Déconnecté',   color: connected ? 'bg-green-900/90 border-green-700' : 'bg-cc-800/90 border-cc-700' },
          ].map(s => (
            <div key={s.label} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs backdrop-blur-sm ${s.color}`}>
              <span className="font-mono font-bold text-white text-sm">{s.value}</span>
              <span className="text-gray-400">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Filter bar */}
        <div className="absolute top-14 left-3 right-3 z-10 flex gap-2 flex-wrap items-center">
          {/* Hazard type */}
          <select
            value={filterHazard}
            onChange={e => setFilterHazard(e.target.value)}
            className="bg-cc-900/92 border border-cc-700 rounded-lg px-2 py-1 text-xs text-gray-300 backdrop-blur-sm focus:outline-none focus:border-sinaur-600"
          >
            <option value="">Tous les aléas</option>
            {Object.entries(HAZARD_FR).map(([k, v]) => (
              <option key={k} value={k}>{HAZARD_ICON[k]} {v}</option>
            ))}
          </select>

          {/* Severity */}
          <select
            value={filterSeverity}
            onChange={e => setFilterSeverity(e.target.value)}
            className="bg-cc-900/92 border border-cc-700 rounded-lg px-2 py-1 text-xs text-gray-300 backdrop-blur-sm focus:outline-none focus:border-sinaur-600"
          >
            <option value="">Toutes sévérités</option>
            {Object.entries(SEVERITY_FR).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>

          {/* Time period */}
          <div className="flex gap-1">
            {([['', 'Tout'], ['24h', '24h'], ['7j', '7j'], ['30j', '30j']] as [string, string][]).map(([v, l]) => (
              <button
                key={v}
                onClick={() => setFilterPeriod(v)}
                className={`px-2 py-1 rounded-lg text-xs font-mono backdrop-blur-sm border transition-colors ${
                  filterPeriod === v
                    ? 'bg-sinaur-700 border-sinaur-500 text-white'
                    : 'bg-cc-900/92 border-cc-700 text-gray-400 hover:border-cc-500 hover:text-gray-200'
                }`}
              >{l}</button>
            ))}
          </div>

          {/* Reset */}
          {hasActiveFilters && (
            <button
              onClick={() => { setFilterHazard(''); setFilterPeriod(''); setFilterSeverity(''); }}
              className="px-2 py-1 rounded-lg text-xs font-mono backdrop-blur-sm border border-cc-700 bg-cc-900/92 text-cc-500 hover:text-gray-200 hover:border-cc-500 transition-colors"
            >✕ Réinitialiser</button>
          )}

          {/* Risk layer toggle */}
          <button
            onClick={() => setShowRiskLayer(v => !v)}
            className={`px-2 py-1 rounded-lg text-xs font-mono backdrop-blur-sm border transition-colors flex items-center gap-1 ${
              showRiskLayer
                ? 'bg-purple-900/80 border-purple-600 text-purple-200'
                : 'bg-cc-900/92 border-cc-700 text-gray-400 hover:border-cc-500 hover:text-gray-200'
            }`}
          >
            🎯 Risques{showRiskLayer ? ' ●' : ''}
          </button>

          {/* Risk horizon pills (only when layer is on) */}
          {showRiskLayer && (
            <div className="flex gap-1">
              {([7, 30, 90] as const).map(h => (
                <button
                  key={h}
                  onClick={() => setRiskHorizon(h)}
                  className={`px-1.5 py-1 rounded text-[10px] font-mono border transition-colors ${
                    riskHorizon === h
                      ? 'bg-purple-800 border-purple-600 text-white'
                      : 'bg-cc-900/92 border-cc-700 text-cc-500 hover:text-gray-300'
                  }`}
                >
                  {h}j
                </button>
              ))}
            </div>
          )}

          {/* Reset view */}
          <button
            onClick={resetView}
            title={provinceBounds ? `Recentrer sur ${provinceName}` : 'Vue complète RDC'}
            className="px-2 py-1 rounded-lg text-xs font-mono backdrop-blur-sm border border-cc-700 bg-cc-900/92 text-cc-400 hover:text-white hover:border-cc-500 transition-colors"
          >
            {provinceBounds ? `🏛️ ${provinceName}` : '🌍 RDC'}
          </button>

          {/* Result count + freshness */}
          <div className="ml-auto flex items-center gap-2">
            <div className="text-[10px] font-mono text-cc-500 bg-cc-900/80 border border-cc-700 px-2 py-1 rounded-lg backdrop-blur-sm">
              {eventCount} événement{eventCount !== 1 ? 's' : ''}
            </div>
            <div className="bg-cc-900/80 border border-cc-700 px-2 py-1 rounded-lg backdrop-blur-sm">
              <FraicheurBadge
                dataUpdatedAt={statsUpdatedAt}
                isFetching={statsFetching}
                isError={statsError}
                onRefresh={() => statsRefetch()}
              />
            </div>
          </div>
        </div>

        <MapGL
          ref={mapRef}
          initialViewState={{
            bounds: provinceBounds ?? DRC_BOUNDS,
            fitBoundsOptions: { padding: 40 },
          }}
          style={{ width: '100%', height: '100%' }}
          mapStyle={MAP_STYLE}
          interactiveLayerIds={['event-unclustered', 'cluster-circle', 'risk-circles']}
          onClick={onMapClick}
          onMouseMove={onMouseMove}
          onMouseLeave={() => { setClusterHover(null); setRiskHover(null); }}
        >
          {/* Province source toujours monté en premier pour que les events soient au-dessus */}
          <Source id="provinces" type="geojson" data={provinceGeoJSON}>
            <Layer
              id="province-fill"
              type="fill"
              paint={{
                'fill-color': [
                  'interpolate', ['linear'], ['get', 'alertCount'],
                  0, 'rgba(30,58,95,0.20)',
                  1, 'rgba(202,138,4,0.28)',
                  3, 'rgba(234,88,12,0.38)',
                  6, 'rgba(220,38,38,0.48)',
                ],
                'fill-opacity': 1,
              }}
            />
            <Layer id="province-border" type="line" paint={{ 'line-color': '#2d4a6e', 'line-width': 1 }} />
          </Source>

          {/* Territoires (admin2) OCHA — lignes de référence entre les provinces */}
          <Source id="admin2" type="geojson" data="/geo/admin2.geojson">
            <Layer
              id="territory-lines"
              type="line"
              paint={{
                'line-color': '#93c5fd',
                'line-width': 0.4,
                'line-dasharray': [4, 3],
                'line-opacity': 0.45,
              }}
            />
          </Source>

          {annotatedGeoJSON && (
            <Source id="events" type="geojson" data={annotatedGeoJSON}
              cluster={true} clusterMaxZoom={8} clusterRadius={45}>
              <Layer id="cluster-halo" type="circle" filter={['has', 'point_count']}
                paint={{ 'circle-radius': ['step', ['get', 'point_count'], 22, 5, 30, 20, 38], 'circle-color': '#ea580c', 'circle-opacity': 0.15 }} />
              <Layer id="cluster-circle" type="circle" filter={['has', 'point_count']}
                paint={{
                  'circle-radius': ['step', ['get', 'point_count'], 14, 5, 20, 20, 26],
                  'circle-color': ['step', ['get', 'point_count'], '#2563eb', 5, '#ca8a04', 15, '#ea580c', 30, '#dc2626'],
                  'circle-opacity': 0.92, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#ffffff',
                }} />
              <Layer id="cluster-count" type="symbol" filter={['has', 'point_count']}
                layout={{ 'text-field': '{point_count_abbreviated}', 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'], 'text-size': 12 }}
                paint={{ 'text-color': '#ffffff' }} />
              <Layer id="event-halo" type="circle" filter={['!', ['has', 'point_count']]}
                paint={{
                  'circle-radius': ['case', ['get', 'isLive'], 28, 16],
                  'circle-color': ['get', 'color'],
                  'circle-opacity': ['case', ['get', 'isLive'], 0.25, 0.12],
                }} />
              <Layer id="event-unclustered" type="circle" filter={['!', ['has', 'point_count']]}
                paint={{
                  'circle-radius': ['case', ['get', 'isLive'], 11, 8],
                  'circle-color': ['get', 'color'],
                  'circle-opacity': 0.9,
                  'circle-stroke-color': '#ffffff',
                  'circle-stroke-width': ['case', ['get', 'isLive'], 2.5, 1.5],
                }} />
            </Source>
          )}

          {/* Predictive risk heatmap layer */}
          {showRiskLayer && riskMapData && (
            <Source id="risk-heatmap" type="geojson" data={riskMapData}>
              <Layer
                id="risk-heat"
                type="heatmap"
                maxzoom={8}
                paint={{
                  'heatmap-weight': ['interpolate', ['linear'], ['get', 'score'], 0, 0, 100, 1],
                  'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, 1, 8, 2],
                  'heatmap-color': [
                    'interpolate', ['linear'], ['heatmap-density'],
                    0,    'rgba(0,0,0,0)',
                    0.25, 'rgba(37,99,235,0.6)',
                    0.5,  'rgba(202,138,4,0.7)',
                    0.75, 'rgba(234,88,12,0.8)',
                    1,    'rgba(220,38,38,0.9)',
                  ],
                  'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 4, 30, 8, 50],
                  'heatmap-opacity': 0.7,
                }}
              />
              <Layer
                id="risk-circles"
                type="circle"
                minzoom={7}
                paint={{
                  'circle-color': [
                    'match', ['get', 'level'],
                    'CRITIQUE', '#dc2626',
                    'ELEVE',    '#ea580c',
                    'MODERE',   '#ca8a04',
                    'FAIBLE',   '#2563eb',
                    '#6b7280',
                  ],
                  'circle-radius': ['interpolate', ['linear'], ['get', 'score'], 0, 8, 100, 18],
                  'circle-opacity': 0.8,
                  'circle-stroke-width': 1.5,
                  'circle-stroke-color': '#ffffff',
                }}
              />
              <Layer
                id="risk-labels"
                type="symbol"
                minzoom={8}
                layout={{
                  'text-field': ['concat', ['to-string', ['round', ['get', 'score']]], '%'],
                  'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                  'text-size': 10,
                }}
                paint={{ 'text-color': '#ffffff' }}
              />
            </Source>
          )}
        </MapGL>

        {/* Province scope banner */}
        {provinceName && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-amber-900/90 border border-amber-700 text-amber-200 text-[10px] font-mono px-3 py-1 rounded-lg backdrop-blur-sm pointer-events-none whitespace-nowrap">
            🏛️ Vue provinciale — {provinceName} · Données filtrées sur votre périmètre
          </div>
        )}

        {/* Cluster hover tooltip */}
        {clusterHover && (
          <div
            className="absolute pointer-events-none z-30 bg-cc-900/95 border border-cc-700 rounded-lg px-2.5 py-1 text-xs text-white font-mono shadow-lg"
            style={{ left: clusterHover.x + 12, top: clusterHover.y - 36 }}
          >
            {clusterHover.count} événements · cliquer pour zoomer
          </div>
        )}

        {/* Risk hover tooltip */}
        {riskHover && (
          <div
            className="absolute pointer-events-none z-30 bg-purple-950/95 border border-purple-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono shadow-lg min-w-[140px]"
            style={{ left: riskHover.x + 14, top: riskHover.y - 48 }}
          >
            {riskHover.province && <div className="text-purple-300 text-[10px] mb-0.5">{riskHover.province}</div>}
            <div className="flex items-center gap-2">
              <span className="font-bold" style={{ color: riskHover.level === 'CRITIQUE' ? '#dc2626' : riskHover.level === 'ELEVE' ? '#ea580c' : riskHover.level === 'MODERE' ? '#ca8a04' : '#2563eb' }}>
                {riskHover.level}
              </span>
              <span className="text-gray-400">{riskHover.score}%</span>
            </div>
            <div className="text-[9px] text-purple-400 mt-0.5">Prédiction IA — validation requise</div>
          </div>
        )}

        {/* Event detail panel */}
        {selectedEvent && (
          <EventDetailPanel event={selectedEvent} onClose={() => setSelectedEvent(null)} />
        )}

        {/* Severity legend */}
        <div className="absolute bottom-4 left-3 bg-cc-900/95 border border-cc-700 rounded-lg px-3 py-2 backdrop-blur-sm">
          <div className="text-xs font-mono text-cc-500 mb-1.5 uppercase tracking-wider">Sévérité</div>
          <div className="space-y-1">
            {Object.entries(SEVERITY_COLOR).map(([k, c]) => (
              <div key={k} className="flex items-center gap-2 text-xs text-gray-300">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c }} />
                {SEVERITY_FR[k] ?? k}
              </div>
            ))}
          </div>
          <div className="border-t border-cc-700 mt-2 pt-1.5 text-[10px] text-cc-600 font-mono">
            {eventCount} événement{eventCount !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Risk layer legend + disclaimer */}
        {showRiskLayer && (
          <>
            <div className="absolute bottom-4 left-28 bg-purple-950/95 border border-purple-800 rounded-lg px-3 py-2 backdrop-blur-sm">
              <div className="text-[10px] font-mono text-purple-400 mb-1.5 uppercase tracking-wider">
                🎯 Risque IA — {riskHorizon}j
              </div>
              <div className="space-y-1">
                {[['CRITIQUE', '#dc2626', 'Critique'], ['ELEVE', '#ea580c', 'Élevé'], ['MODERE', '#ca8a04', 'Modéré'], ['FAIBLE', '#2563eb', 'Faible']] .map(([, c, l]) => (
                  <div key={l} className="flex items-center gap-2 text-[10px] text-gray-300">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c }} />
                    {l}
                  </div>
                ))}
              </div>
            </div>
            <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-20 bg-yellow-900/90 border border-yellow-700 text-yellow-200 text-[9px] font-mono px-4 py-1.5 rounded-lg backdrop-blur-sm whitespace-nowrap">
              ⚠️ Données prédictives IA — Validation humaine requise avant toute décision opérationnelle
            </div>
          </>
        )}

        <div className="absolute bottom-4 right-1 w-64 bg-cc-900/95 border border-cc-700 rounded-xl p-3 backdrop-blur-sm">
          <div className="text-xs font-mono text-cc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <span>Crises — 30 derniers jours</span>
            {activeCrises && activeCrises.length > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            )}
          </div>
          {!activeCrises || activeCrises.length === 0 ? (
            <div className="text-[10px] text-cc-600 font-mono">Aucune crise récente</div>
          ) : (
            <div className="space-y-1.5">
              {activeCrises.slice(0, 5).map((c: any) => (
                <div key={c.id} className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                    c.status === 'active' ? 'bg-red-500 animate-pulse' :
                    c.status === 'monitoring' ? 'bg-yellow-500' : 'bg-blue-500'
                  }`} />
                  <div className="min-w-0">
                    <div className="text-xs text-gray-200 truncate font-medium">{c.title}</div>
                    <div className="text-[10px] text-cc-500 font-mono">{c.glide_number ?? c.glideNumber}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Live feed */}
      <div className="w-80 shrink-0 bg-cc-900 border-l border-cc-700 flex flex-col">
        <LiveFeed events={events} onClear={clearFeed} onReconnect={reconnect} connected={connected} />
      </div>
    </div>
  );
}
