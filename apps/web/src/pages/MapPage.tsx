import { useState, useCallback } from 'react';
import Map, { Marker, Popup, NavigationControl, ScaleControl } from 'react-map-gl/maplibre';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';
import type { ApiResponse, DisasterEvent } from '@sinaur/shared-types';
import 'maplibre-gl/dist/maplibre-gl.css';

const HAZARD_ICONS: Record<string, string> = {
  flood: '🌊', landslide: '⛰️', mass_displacement: '🏃',
  humanitarian_crisis: '🆘', health_epidemic: '🦠', volcanic_eruption: '🌋',
  drought: '☀️', fire: '🔥', conflict: '⚔️', earthquake: '📳', other: '⚠️',
};

const SEVERITY_COLORS: Record<string, string> = {
  Minor: '#fbbf24', Moderate: '#f97316', Severe: '#ef4444', Extreme: '#7f1d1d', Unknown: '#6b7280',
};

export function MapPage() {
  const [selectedEvent, setSelectedEvent] = useState<DisasterEvent | null>(null);

  const { data } = useQuery({
    queryKey: ['events', 'map'],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<DisasterEvent[]>>('/events?limit=100&page=1');
      return data.data ?? [];
    },
  });

  const eventsWithCoords = (data ?? []).filter(
    (e) => e.locationPoint?.latitude && e.locationPoint?.longitude,
  );

  const handleMarkerClick = useCallback((event: DisasterEvent) => {
    setSelectedEvent(event);
  }, []);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 bg-white border-b border-gray-200 shrink-0">
        <h1 className="text-xl font-bold text-gray-900">Carte nationale des incidents</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Données OpenStreetMap · {eventsWithCoords.length} événements géolocalisés
        </p>
      </div>

      <div className="flex-1">
        <Map
          initialViewState={{ longitude: 24.0, latitude: -3.5, zoom: 5 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle={import.meta.env.VITE_MAPLIBRE_STYLE_URL ?? 'https://demotiles.maplibre.org/style.json'}
          attributionControl={{ customAttribution: '© OpenStreetMap contributors · SINAUR-RDC' }}
        >
          <NavigationControl position="top-right" />
          <ScaleControl position="bottom-left" unit="metric" />

          {eventsWithCoords.map((event) => (
            <Marker
              key={event.id}
              longitude={event.locationPoint!.longitude}
              latitude={event.locationPoint!.latitude}
              onClick={() => handleMarkerClick(event)}
            >
              <div
                className="cursor-pointer text-xl hover:scale-125 transition-transform"
                title={event.title}
              >
                {HAZARD_ICONS[event.hazardType] ?? '⚠️'}
              </div>
            </Marker>
          ))}

          {selectedEvent?.locationPoint && (
            <Popup
              longitude={selectedEvent.locationPoint.longitude}
              latitude={selectedEvent.locationPoint.latitude}
              onClose={() => setSelectedEvent(null)}
              closeOnClick={false}
              maxWidth="300px"
            >
              <div className="p-2 min-w-[200px]">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{HAZARD_ICONS[selectedEvent.hazardType] ?? '⚠️'}</span>
                  <span className="font-semibold text-sm text-gray-900 leading-tight">{selectedEvent.title}</span>
                </div>
                <p className="text-xs text-gray-600">{selectedEvent.locationName}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span
                    className="px-1.5 py-0.5 rounded text-xs font-bold text-white"
                    style={{ backgroundColor: SEVERITY_COLORS[selectedEvent.severity] ?? '#6b7280' }}
                  >
                    {selectedEvent.severity}
                  </span>
                  <span className="text-xs text-gray-500">
                    {new Date(selectedEvent.startDate).toLocaleDateString('fr-FR')}
                  </span>
                </div>
                {selectedEvent.estimatedAffected && (
                  <p className="text-xs text-gray-700 mt-1">
                    ~{selectedEvent.estimatedAffected.toLocaleString('fr-FR')} personnes affectées
                  </p>
                )}
              </div>
            </Popup>
          )}
        </Map>
      </div>
    </div>
  );
}
