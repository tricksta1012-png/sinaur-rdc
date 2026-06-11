import { useQuery } from '@tanstack/react-query';
import { useState, useMemo, useEffect } from 'react';
import MapGL, { Source, Layer, Popup, type MapLayerMouseEvent } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { apiClient } from '../lib/api.js';
import { useRealtimeFeed } from '../hooks/useRealtimeFeed.js';
import { LiveFeed } from '../components/LiveFeed.js';

// Dark command-center style — OSM raster with desaturation filter, no API key required
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

interface PopupInfo {
  lng: number; lat: number;
  title: string; severity: string;
  hazardType: string; locationPcode: string;
}

export function OpsRoomPage() {
  const { events, connected, clearFeed } = useRealtimeFeed();
  const [popup, setPopup] = useState<PopupInfo | null>(null);
  // Accumulates alerts pushed via WebSocket since last full refresh
  const [wsAlerts, setWsAlerts] = useState<any[]>([]);

  const { data: statsData } = useQuery({
    queryKey: ['cc-stats'],
    queryFn: () => apiClient.get('/dashboard/stats').then(r => r.data.data),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const { data: activeAlerts = [] } = useQuery({
    queryKey: ['cc-alerts'],
    queryFn: () => apiClient.get('/alerts?status=actual&limit=50').then(r => r.data.data),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  // Province centroids — used to place alert dots on the map
  const { data: divisions = [] } = useQuery({
    queryKey: ['cc-divisions-l1'],
    queryFn: () => apiClient.get('/geo/divisions?level=1').then(r => r.data.data),
    staleTime: 5 * 60_000,
  });

  // Province boundary polygons — used for choropleth; cached 1 h
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

  // Build pcode → [lng, lat] from province centroids
  const centroidByPcode = useMemo(() => {
    const m = new Map<string, [number, number]>();
    for (const d of divisions as any[]) {
      if (d.centroid?.coordinates) {
        m.set(d.pcode, d.centroid.coordinates as [number, number]);
      }
    }
    return m;
  }, [divisions]);

  // Merge NEW_ALERT WebSocket events into the local live list
  useEffect(() => {
    const last = events[0];
    if (!last || last.type !== 'NEW_ALERT') return;
    const p = last.payload as any;
    setWsAlerts(prev => {
      if (prev.some(a => a.identifier === p.identifier)) return prev;
      return [{ ...p, _isLive: true }, ...prev].slice(0, 50);
    });
  }, [events]);

  // Merge API alerts + WebSocket alerts, deduplicated
  const allAlerts = useMemo(() => {
    const seen = new Set<string>();
    const merged: any[] = [];
    for (const a of [...wsAlerts, ...(activeAlerts as any[])]) {
      const key = a.identifier ?? a.id ?? JSON.stringify(a);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(a);
    }
    return merged;
  }, [activeAlerts, wsAlerts]);

  // Build GeoJSON points using real province centroids
  const alertFeatures = useMemo(() =>
    allAlerts
      .map((a, i) => {
        const pcode = a.areaPcode ?? a.locationPcode ?? '';
        // Try exact pcode, then 4-char province prefix (e.g. CD10 from CD10T01)
        const coords = centroidByPcode.get(pcode)
          ?? centroidByPcode.get(pcode.slice(0, 4));
        if (!coords) return null;
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: coords },
          properties: {
            id: a.identifier ?? a.id ?? i,
            title: a.headline ?? a.title ?? 'Événement',
            severity: a.severity ?? 'Unknown',
            hazardType: a.event ?? a.hazardType ?? '',
            locationPcode: pcode,
            color: SEVERITY_COLOR[a.severity] ?? '#6b7280',
            isLive: !!(a._isLive),
          },
        };
      })
      .filter(Boolean) as GeoJSON.Feature[],
  [allAlerts, centroidByPcode]);

  // Build province choropleth colored by number of active alerts per province
  const provinceGeoJSON = useMemo(() => {
    const countByPcode = new Map<string, number>();
    for (const f of alertFeatures) {
      const p = (f.properties as any).locationPcode as string;
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
  }, [divisionsGeo, alertFeatures]);

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
    });
  };

  return (
    <div className="flex h-full">
      {/* Map — 65% */}
      <div className="flex-1 relative">

        {/* Stats bar */}
        <div className="absolute top-3 left-3 right-3 z-10 flex gap-2 flex-wrap">
          {[
            { label: 'Alertes actives',  value: statsData?.activeAlerts ?? '…',               color: 'bg-red-900/90 border-red-700'       },
            { label: 'Événements 24h',   value: statsData?.eventsToday  ?? '…',               color: 'bg-orange-900/90 border-orange-700' },
            { label: 'Crises ouvertes',  value: activeCrises?.length    ?? '…',               color: 'bg-yellow-900/90 border-yellow-700' },
            { label: 'Flux temps réel',  value: connected ? '● EN DIRECT' : '○ Déconnecté',  color: connected ? 'bg-green-900/90 border-green-700' : 'bg-cc-800/90 border-cc-700' },
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
          interactiveLayerIds={['alert-circles']}
          onClick={onMapClick}
        >
          {/* Province choropleth — colored by alert density */}
          {provinceGeoJSON.features.length > 0 && (
            <Source id="provinces" type="geojson" data={provinceGeoJSON}>
              <Layer
                id="province-fill"
                type="fill"
                paint={{
                  'fill-color': [
                    'interpolate', ['linear'], ['get', 'alertCount'],
                    0, 'rgba(30,58,95,0.25)',
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

          {/* Alert circles with larger pulse for live WS events */}
          {alertFeatures.length > 0 && (
            <Source id="alerts" type="geojson" data={{ type: 'FeatureCollection', features: alertFeatures }}>
              <Layer
                id="alert-halo"
                type="circle"
                paint={{
                  'circle-radius':  ['case', ['get', 'isLive'], 28, 18],
                  'circle-color':   ['get', 'color'],
                  'circle-opacity': ['case', ['get', 'isLive'], 0.22, 0.12],
                }}
              />
              <Layer
                id="alert-circles"
                type="circle"
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
              <div className="text-sm p-1.5 min-w-44">
                <div className="font-semibold text-gray-900">{popup.title}</div>
                <div className="text-xs text-gray-600 mt-0.5">
                  {popup.hazardType && <span>{popup.hazardType} · </span>}
                  <span className="font-medium">{popup.severity}</span>
                </div>
                {popup.locationPcode && (
                  <div className="text-xs text-gray-500 font-mono mt-0.5">{popup.locationPcode}</div>
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
                {k}
              </div>
            ))}
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
