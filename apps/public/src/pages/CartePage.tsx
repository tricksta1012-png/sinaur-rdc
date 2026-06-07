import { useQuery } from '@tanstack/react-query';
import { useState, useCallback } from 'react';
import Map, { Source, Layer, Popup, type MapLayerMouseEvent } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { publicApi } from '../api.js';

const SEVERITY_COLOR: Record<string, string> = {
  Extreme:  '#b91c1c',
  Severe:   '#ea580c',
  Moderate: '#ca8a04',
  Minor:    '#2563eb',
  Unknown:  '#6b7280',
};

interface PopupInfo {
  longitude: number
  latitude: number
  name: string
  events30d: number
  activeAlerts: number
}

export function CartePage() {
  const { data: stats } = useQuery({
    queryKey: ['public-stats'],
    queryFn: publicApi.getStats,
    staleTime: 300_000,
  });

  const { data: alerts } = useQuery({
    queryKey: ['public-alerts'],
    queryFn: publicApi.getAlerts,
    staleTime: 60_000,
  });

  const [popup, setPopup] = useState<PopupInfo | null>(null);

  const onMapClick = useCallback((e: MapLayerMouseEvent) => {
    const feature = e.features?.[0];
    if (!feature) return;
    const props = feature.properties as any;
    setPopup({
      longitude: e.lngLat.lng,
      latitude:  e.lngLat.lat,
      name:       props.ADM1_FR ?? props.name ?? props.NAME_1 ?? 'Province',
      events30d:  0,
      activeAlerts: 0,
    });
  }, []);

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 130px)' }}>
      {/* Légende */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex flex-wrap items-center gap-4 text-xs text-gray-600">
        <span className="font-medium">Légende :</span>
        {Object.entries(SEVERITY_COLOR).map(([label, color]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full inline-block" style={{ background: color }} />
            {label}
          </span>
        ))}
        <span className="ml-auto text-gray-400">Alertes actives : {alerts?.length ?? 0}</span>
      </div>

      {/* Carte */}
      <div className="flex-1 relative">
        <Map
          initialViewState={{
            longitude: 24.0,
            latitude:  -4.0,
            zoom:      5.2,
          }}
          style={{ width: '100%', height: '100%' }}
          mapStyle="https://demotiles.maplibre.org/style.json"
          interactiveLayerIds={['provinces-fill']}
          onClick={onMapClick}
        >
          {/* Cercles pour les alertes actives */}
          {alerts && alerts.length > 0 && (
            <Source
              id="alerts"
              type="geojson"
              data={{
                type: 'FeatureCollection',
                features: alerts
                  .filter(a => a.areaPcode)
                  .map(a => ({
                    type: 'Feature' as const,
                    geometry: { type: 'Point' as const, coordinates: [24.0, -4.0] },
                    properties: {
                      identifier: a.identifier,
                      headline:   a.headline,
                      severity:   a.severity,
                      color:      SEVERITY_COLOR[a.severity] ?? '#6b7280',
                    },
                  })),
              }}
            >
              <Layer
                id="alert-circles"
                type="circle"
                paint={{
                  'circle-radius': 12,
                  'circle-color': ['get', 'color'],
                  'circle-opacity': 0.7,
                  'circle-stroke-color': '#fff',
                  'circle-stroke-width': 2,
                }}
              />
            </Source>
          )}

          {popup && (
            <Popup
              longitude={popup.longitude}
              latitude={popup.latitude}
              onClose={() => setPopup(null)}
              closeButton
              anchor="bottom"
            >
              <div className="text-sm p-1">
                <div className="font-semibold">{popup.name}</div>
                {popup.events30d > 0 && <div className="text-gray-500">Événements (30j) : {popup.events30d}</div>}
                {popup.activeAlerts > 0 && <div className="text-red-600 font-medium">Alertes actives : {popup.activeAlerts}</div>}
              </div>
            </Popup>
          )}
        </Map>

        {/* Panel latéral alertes */}
        {alerts && alerts.length > 0 && (
          <div className="absolute top-3 right-3 w-72 max-h-96 overflow-y-auto bg-white/95 backdrop-blur rounded-xl shadow-lg border border-gray-200 p-3 space-y-2">
            <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
              {alerts.length} alerte{alerts.length > 1 ? 's' : ''} active{alerts.length > 1 ? 's' : ''}
            </div>
            {alerts.map(a => (
              <div key={a.identifier} className="text-xs border-l-4 pl-2 py-0.5" style={{ borderColor: SEVERITY_COLOR[a.severity] ?? '#6b7280' }}>
                <div className="font-medium text-gray-800 leading-snug">{a.headline}</div>
                <div className="text-gray-500">{a.areaName || a.areaPcode}</div>
              </div>
            ))}
          </div>
        )}

        {(!alerts || alerts.length === 0) && (
          <div className="absolute top-3 right-3 bg-green-50 border border-green-300 text-green-700 text-sm px-4 py-2 rounded-xl shadow">
            ✅ Aucune alerte active
          </div>
        )}
      </div>
    </div>
  );
}
