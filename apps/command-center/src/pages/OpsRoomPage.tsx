import { useQuery } from '@tanstack/react-query';
import { useState, useMemo, useEffect } from 'react';
import MapGL, { Source, Layer, Popup, type MapLayerMouseEvent } from 'react-map-gl/maplibre';
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
  Extreme:  'Extrême',
  Severe:   'Sévère',
  Moderate: 'Modérée',
  Minor:    'Mineure',
  Unknown:  'Inconnue',
};

const HAZARD_FR: Record<string, string> = {
  flood:              'Inondation',
  landslide:          'Glissement',
  mass_displacement:  'Déplacement',
  humanitarian_crisis:'Crise humanitaire',
  health_epidemic:    'Épidémie',
  volcanic_eruption:  'Éruption',
  drought:            'Sécheresse',
  fire:               'Incendie',
  conflict:           'Conflit',
  earthquake:         'Séisme',
  other:              'Autre',
};

interface PopupInfo {
  lng: number; lat: number;
  title: string; severity: string;
  hazardType: string; locationPcode: string;
  locationName: string; estimatedAffected: number;
}

export function OpsRoomPage() {
  const { events, connected, clearFeed } = useRealtimeFeed();
  const [popup, setPopup] = useState<PopupInfo | null>(null);
  const [wsLiveIds, setWsLiveIds] = useState<Set<string>>(new Set());

  const { data: statsData } = useQuery({
    queryKey: ['cc-stats'],
    queryFn: () => apiClient.get('/dashboard/stats').then(r => r.data.data),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  // GeoJSON events for map dots — refreshed every 30s
  const { data: mapGeoJSON } = useQuery({
    queryKey: ['cc-events-map'],
    queryFn: () => apiClient.get('/events/map?limit=200').then(r => r.data),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  // Province boundary polygons — choropleth; cached 1h
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

  // Merge new WebSocket events into the live-highlight set
  useEffect(() => {
    const last = events[0];
    if (!last || (last.type !== 'NEW_ALERT' && last.type !== 'NEW_EVENT')) return;
    const id = (last.payload as any).id ?? (last.payload as any).identifier;
    if (id) setWsLiveIds(prev => new Set([...prev, id]));
  }, [events]);

  // Annotate map features with isLive flag for WebSocket highlights
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

  // Province choropleth: count events per province from map GeoJSON
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
    if (!f) return;
    const p = f.properties as any;
    setPopup({
      lng: e.lngLat.lng, lat: e.lngLat.lat,
      title: p.title ?? 'Événement',
      severity: p.severity ?? 'Unknown',
      hazardType: p.hazardType ?? '',
      locationPcode: p.locationPcode ?? '',
      locationName: p.locationName ?? '',
      estimatedAffected: p.estimatedAffected ?? 0,
    });
  };

  const eventCount = mapGeoJSON?.features?.length ?? 0;

  return (
    <div className="flex h-full">
      {/* Map — 65% */}
      <div className="flex-1 relative">

        {/* Stats bar */}
        <div className="absolute top-3 left-3 right-3 z-10 flex gap-2 flex-wrap">
          {[
            {
              label: 'Événements actifs',
              value: statsData?.counts?.activeEvents ?? eventCount,
              color: 'bg-red-900/90 border-red-700',
            },
            {
              label: 'Événements 24h',
              value: statsData?.counts?.events24h ?? '…',
              color: 'bg-orange-900/90 border-orange-700',
            },
            {
              label: 'Crises ouvertes',
              value: statsData?.crisisStats?.activeCrises ?? activeCrises?.length ?? '…',
              color: 'bg-yellow-900/90 border-yellow-700',
            },
            {
              label: 'Flux temps réel',
              value: connected ? '● EN DIRECT' : '○ Déconnecté',
              color: connected ? 'bg-green-900/90 border-green-700' : 'bg-cc-800/90 border-cc-700',
            },
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
          {/* Province choropleth */}
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
              <Layer
                id="province-border"
                type="line"
                paint={{ 'line-color': '#2d4a6e', 'line-width': 1 }}
              />
            </Source>
          )}

          {/* Event circles with clustering */}
          {annotatedGeoJSON && (
            <Source
              id="events"
              type="geojson"
              data={annotatedGeoJSON}
              cluster={true}
              clusterMaxZoom={8}
              clusterRadius={45}
            >
              {/* Cluster halos */}
              <Layer
                id="cluster-halo"
                type="circle"
                filter={['has', 'point_count']}
                paint={{
                  'circle-radius': ['step', ['get', 'point_count'], 22, 5, 30, 20, 38],
                  'circle-color': '#ea580c',
                  'circle-opacity': 0.15,
                }}
              />
              {/* Cluster circles */}
              <Layer
                id="cluster-circle"
                type="circle"
                filter={['has', 'point_count']}
                paint={{
                  'circle-radius': ['step', ['get', 'point_count'], 14, 5, 20, 20, 26],
                  'circle-color': ['step', ['get', 'point_count'],
                    '#2563eb', 5, '#ca8a04', 15, '#ea580c', 30, '#dc2626'],
                  'circle-opacity': 0.92,
                  'circle-stroke-width': 1.5,
                  'circle-stroke-color': '#ffffff',
                }}
              />
              {/* Cluster count labels */}
              <Layer
                id="cluster-count"
                type="symbol"
                filter={['has', 'point_count']}
                layout={{
                  'text-field': '{point_count_abbreviated}',
                  'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                  'text-size': 12,
                }}
                paint={{ 'text-color': '#ffffff' }}
              />
              {/* Individual event halo (pulse effect for live WS events) */}
              <Layer
                id="event-halo"
                type="circle"
                filter={['!', ['has', 'point_count']]}
                paint={{
                  'circle-radius':  ['case', ['get', 'isLive'], 28, 16],
                  'circle-color':   ['get', 'color'],
                  'circle-opacity': ['case', ['get', 'isLive'], 0.25, 0.12],
                }}
              />
              {/* Individual event dots */}
              <Layer
                id="event-unclustered"
                type="circle"
                filter={['!', ['has', 'point_count']]}
                paint={{
                  'circle-radius':       ['case', ['get', 'isLive'], 11, 8],
                  'circle-color':        ['get', 'color'],
                  'circle-opacity':      0.9,
                  'circle-stroke-color': '#ffffff',
                  'circle-stroke-width': ['case', ['get', 'isLive'], 2.5, 1.5],
                }}
              />
            </Source>
          )}

          {popup && (
            <Popup longitude={popup.lng} latitude={popup.lat} onClose={() => setPopup(null)} anchor="bottom">
              <div className="text-sm p-1.5 min-w-48">
                <div className="font-semibold text-gray-900 leading-snug">{popup.title}</div>
                <div className="text-xs text-gray-600 mt-1 flex flex-wrap gap-1.5">
                  {popup.hazardType && (
                    <span className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-700">
                      {HAZARD_FR[popup.hazardType] ?? popup.hazardType}
                    </span>
                  )}
                  <span className="font-medium" style={{ color: SEVERITY_COLOR[popup.severity] }}>
                    {SEVERITY_FR[popup.severity] ?? popup.severity}
                  </span>
                </div>
                {popup.locationName && (
                  <div className="text-xs text-gray-500 mt-0.5">{popup.locationName}</div>
                )}
                {popup.estimatedAffected > 0 && (
                  <div className="text-xs text-gray-600 mt-0.5 font-mono">
                    {popup.estimatedAffected.toLocaleString('fr')} affectés
                  </div>
                )}
                {popup.locationPcode && (
                  <div className="text-xs text-gray-400 font-mono mt-0.5">{popup.locationPcode}</div>
                )}
              </div>
            </Popup>
          )}
        </MapGL>

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

        {/* Active crises floating panel */}
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

      {/* Live feed — 35% */}
      <div className="w-80 shrink-0 bg-cc-900 border-l border-cc-700 flex flex-col">
        <LiveFeed events={events} onClear={clearFeed} />
      </div>
    </div>
  );
}
