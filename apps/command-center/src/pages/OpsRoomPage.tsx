import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import Map, { Source, Layer, Popup, type MapLayerMouseEvent } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { apiClient } from '../lib/api.js';
import { useRealtimeFeed } from '../hooks/useRealtimeFeed.js';
import { LiveFeed } from '../components/LiveFeed.js';

const SEVERITY_COLOR: Record<string, string> = {
  Extreme:  '#dc2626',
  Severe:   '#ea580c',
  Moderate: '#ca8a04',
  Minor:    '#2563eb',
  Unknown:  '#6b7280',
};

interface PopupInfo { lng: number; lat: number; title: string; severity: string; hazardType: string; locationPcode: string }

export function OpsRoomPage() {
  const { events, clearFeed } = useRealtimeFeed();
  const [popup, setPopup] = useState<PopupInfo | null>(null);

  const { data: statsData } = useQuery({
    queryKey: ['cc-stats'],
    queryFn: () => apiClient.get('/dashboard/stats').then(r => r.data.data),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const { data: activeAlerts } = useQuery({
    queryKey: ['cc-alerts'],
    queryFn: () => apiClient.get('/alerts?status=actual&limit=50').then(r => r.data.data),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const { data: activeCrises } = useQuery({
    queryKey: ['cc-crises-active'],
    queryFn: () => apiClient.get('/crises?status=active&limit=10').then(r => r.data.data),
    staleTime: 30_000,
  });

  const onMapClick = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties as any;
    setPopup({ lng: e.lngLat.lng, lat: e.lngLat.lat, title: p.title ?? 'Événement', severity: p.severity ?? 'Unknown', hazardType: p.hazardType ?? '', locationPcode: p.locationPcode ?? '' });
  };

  // Construire GeoJSON des alertes actives (points approximatifs depuis pcode)
  const alertFeatures = (activeAlerts ?? [])
    .filter((a: any) => a.areaPcode)
    .map((a: any, i: number) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [24.0 + (i % 5) * 0.5 - 1, -4.0 + Math.floor(i / 5) * 0.5 - 0.5] },
      properties: { title: a.headline, severity: a.severity, hazardType: a.event, locationPcode: a.areaPcode, color: SEVERITY_COLOR[a.severity] ?? '#6b7280' },
    }));

  return (
    <div className="flex h-full">
      {/* Map — 65% */}
      <div className="flex-1 relative">
        {/* Stats top bar */}
        <div className="absolute top-3 left-3 right-3 z-10 flex gap-2 flex-wrap">
          {[
            { label: 'Alertes actives',  value: statsData?.activeAlerts ?? '…',  color: 'bg-red-900/90 border-red-700'    },
            { label: 'Événements 24h',   value: statsData?.eventsToday  ?? '…',  color: 'bg-orange-900/90 border-orange-700' },
            { label: 'Crises ouvertes',  value: activeCrises?.length ?? '…',     color: 'bg-yellow-900/90 border-yellow-700' },
            { label: 'Connectés WS',     value: events.length > 0 ? '●' : '○',  color: 'bg-cc-800/90 border-cc-700'        },
          ].map(s => (
            <div key={s.label} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs backdrop-blur-sm ${s.color}`}>
              <span className="font-mono font-bold text-white text-sm">{s.value}</span>
              <span className="text-gray-400">{s.label}</span>
            </div>
          ))}
        </div>

        <Map
          initialViewState={{ longitude: 24.0, latitude: -4.0, zoom: 5.2 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle="https://demotiles.maplibre.org/style.json"
          interactiveLayerIds={['alert-circles']}
          onClick={onMapClick}
        >
          {alertFeatures.length > 0 && (
            <Source id="alerts" type="geojson" data={{ type: 'FeatureCollection', features: alertFeatures }}>
              <Layer
                id="alert-circles-halo"
                type="circle"
                paint={{ 'circle-radius': 20, 'circle-color': ['get', 'color'], 'circle-opacity': 0.15 }}
              />
              <Layer
                id="alert-circles"
                type="circle"
                paint={{
                  'circle-radius': 10,
                  'circle-color': ['get', 'color'],
                  'circle-opacity': 0.85,
                  'circle-stroke-color': '#fff',
                  'circle-stroke-width': 1.5,
                }}
              />
            </Source>
          )}

          {popup && (
            <Popup longitude={popup.lng} latitude={popup.lat} onClose={() => setPopup(null)} anchor="bottom">
              <div className="text-sm p-1 min-w-40">
                <div className="font-semibold text-gray-900">{popup.title}</div>
                <div className="text-xs text-gray-600 mt-0.5">{popup.hazardType} · {popup.severity}</div>
                {popup.locationPcode && <div className="text-xs text-gray-500 font-mono mt-0.5">{popup.locationPcode}</div>}
              </div>
            </Popup>
          )}
        </Map>

        {/* Crises actives flottant en bas à gauche */}
        {activeCrises && activeCrises.length > 0 && (
          <div className="absolute bottom-4 left-3 w-64 bg-cc-900/95 border border-cc-700 rounded-xl p-3 backdrop-blur-sm">
            <div className="text-xs font-mono text-cc-600 uppercase mb-2">Crises actives</div>
            <div className="space-y-1.5">
              {activeCrises.slice(0, 5).map((c: any) => (
                <div key={c.id} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 animate-pulse" />
                  <div className="min-w-0">
                    <div className="text-xs text-gray-200 truncate font-medium">{c.title}</div>
                    <div className="text-xs text-cc-600 font-mono">{c.glideNumber}</div>
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
