import { useQuery } from '@tanstack/react-query';
import { useState, useMemo, useEffect } from 'react';
import MapGL, { Source, Layer, type MapLayerMouseEvent } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { apiClient } from '../lib/api.js';
import { useRealtimeFeed } from '../hooks/useRealtimeFeed.js';
import { LiveFeed } from '../components/LiveFeed.js';

const MAP_STYLE = {
  version: 8 as const,
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
            Voir original
          </button>
        )}
      </div>
      {needsTranslation && !translated && (
        <span className="inline-flex items-center gap-1 text-[9px] text-yellow-600 font-mono mb-1">
          <span>⚠</span> Texte source en anglais
        </span>
      )}
      <p className="text-gray-300 leading-relaxed line-clamp-5 text-[11px]">
        {translated ?? text}
      </p>
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
    <div className="absolute top-14 left-3 w-72 z-20 bg-cc-950/97 border border-cc-700 rounded-xl shadow-2xl overflow-hidden backdrop-blur-sm">
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
  const { events, connected, clearFeed } = useRealtimeFeed();
  const [selectedEvent, setSelectedEvent] = useState<SelectedEvent | null>(null);
  const [wsLiveIds, setWsLiveIds] = useState<Set<string>>(new Set());

  const { data: statsData } = useQuery({
    queryKey: ['cc-stats'],
    queryFn: () => apiClient.get('/dashboard/stats').then(r => r.data.data),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const { data: mapGeoJSON } = useQuery({
    queryKey: ['cc-events-map'],
    queryFn: () => apiClient.get('/events/map?limit=200').then(r => r.data),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const { data: divisionsGeo = [] } = useQuery({
    queryKey: ['cc-divisions-geo'],
    queryFn: () => apiClient.get('/geo/divisions?level=1&withGeometry=true').then(r => r.data.data),
    staleTime: 60 * 60_000,
  });

  const { data: activeCrises } = useQuery({
    queryKey: ['cc-crises-active'],
    queryFn: () => apiClient.get('/crises?status=active&limit=10').then(r => r.data.data),
    staleTime: 30_000,
  });

  useEffect(() => {
    const last = events[0];
    if (!last || (last.type !== 'NEW_ALERT' && last.type !== 'NEW_EVENT')) return;
    const id = (last.payload as any).id ?? (last.payload as any).identifier;
    if (id) setWsLiveIds(prev => new Set([...prev, id]));
  }, [events]);

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

  const onMapClick = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) { setSelectedEvent(null); return; }
    const p = f.properties as any;
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
  };

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

        <MapGL
          initialViewState={{ longitude: 24.0, latitude: -4.0, zoom: 5.2 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle={MAP_STYLE}
          interactiveLayerIds={['event-unclustered']}
          onClick={onMapClick}
        >
          {provinceGeoJSON.features.length > 0 && (
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
          )}

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
        </MapGL>

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

        {activeCrises && activeCrises.length > 0 && (
          <div className="absolute bottom-4 right-1 w-64 bg-cc-900/95 border border-cc-700 rounded-xl p-3 backdrop-blur-sm">
            <div className="text-xs font-mono text-cc-500 uppercase tracking-wider mb-2">Crises actives</div>
            <div className="space-y-1.5">
              {activeCrises.slice(0, 5).map((c: any) => (
                <div key={c.id} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 animate-pulse" />
                  <div className="min-w-0">
                    <div className="text-xs text-gray-200 truncate font-medium">{c.title}</div>
                    <div className="text-xs text-cc-500 font-mono">{c.glideNumber}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Live feed */}
      <div className="w-80 shrink-0 bg-cc-900 border-l border-cc-700 flex flex-col">
        <LiveFeed events={events} onClear={clearFeed} />
      </div>
    </div>
  );
}
