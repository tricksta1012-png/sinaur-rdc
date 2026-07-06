import { useQuery } from '@tanstack/react-query';
import { useState, useCallback, useRef } from 'react';
import Map, { Source, Layer, Popup, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { publicApi } from '../api.js';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

// ── Constants ────────────────────────────────────────────────────────────────

const HAZARD_COLOR: Record<string, string> = {
  conflict:          '#ef4444',
  health_epidemic:   '#8b5cf6',
  flood:             '#3b82f6',
  drought:           '#f59e0b',
  mass_displacement: '#f97316',
  other:             '#6b7280',
};

const HAZARD_LABEL: Record<string, string> = {
  conflict:          'Conflit armé',
  health_epidemic:   'Épidémie / Santé',
  flood:             'Inondation',
  drought:           'Sécheresse',
  mass_displacement: 'Déplacement',
  other:             'Autre',
};

const HAZARD_ICON: Record<string, string> = {
  conflict:          '⚔️',
  health_epidemic:   '🦠',
  flood:             '🌊',
  drought:           '🌵',
  mass_displacement: '🚶',
  other:             '⚠️',
};

const HAZARD_EXPLICATION: Record<string, string> = {
  conflict:
    'Zone touchée par un conflit armé. Risques élevés pour les civils : déplacements forcés, accès humanitaire limité, violences. Éviter la zone sauf nécessité impérative.',
  health_epidemic:
    'Épidémie ou urgence sanitaire en cours. Suivre strictement les consignes des autorités sanitaires : mesures barrières, centres de traitement à consulter. Ne pas sous-estimer le risque de propagation.',
  flood:
    "Inondation active ou imminente. Risques : coupures routières, accès à l'eau potable compromis, maladies hydriques (choléra, typhoïde). Chercher un terrain surélevé si nécessaire.",
  drought:
    "Sécheresse affectant les cultures et l'accès à l'eau. Risque sur la sécurité alimentaire et le bétail. Les populations vulnérables peuvent avoir besoin d'assistance alimentaire d'urgence.",
  mass_displacement:
    "Déplacement massif de populations en cours. Afflux de personnes déplacées nécessitant abri, eau, nourriture et soins. Les infrastructures locales peuvent être sous pression.",
  other:
    "Événement en cours d'évaluation. Suivre les communications officielles de SINAUR-RDC pour des informations actualisées.",
};

const SEVERITY_COLOR: Record<string, string> = {
  Extreme:  '#b91c1c',
  Severe:   '#ea580c',
  Moderate: '#ca8a04',
  Minor:    '#2563eb',
  Unknown:  '#6b7280',
};

const SEVERITY_LABEL: Record<string, string> = {
  Extreme: 'Extrême', Severe: 'Sévère', Moderate: 'Modérée',
  Minor: 'Mineure', Unknown: 'Inconnue',
};

const MAP_STYLE = {
  version: 8 as const,
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap',
    },
  },
  layers: [{ id: 'osm-tiles', type: 'raster' as const, source: 'osm' }],
};

const EMPTY_GEOJSON = { type: 'FeatureCollection' as const, features: [] };

// ── Types ────────────────────────────────────────────────────────────────────

interface SelectedProvince {
  pcode: string;
  nameFr: string;
  events30d: number;
  events7d: number;
  activeAlerts: number;
  lastEventAt: string | null;
}

interface SelectedEvent {
  id: string;
  hazardType: string;
  severity: string;
  locationName: string;
  provinceName: string;
  description: string;
  createdAt: string;
  lng: number;
  lat: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string | null) {
  if (!dateStr) return null;
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: fr });
  } catch {
    return null;
  }
}

function intensityStep(n: number): string {
  if (n === 0) return '#f3f4f6';
  if (n <= 3)  return '#fef9c3';
  if (n <= 8)  return '#fde68a';
  if (n <= 15) return '#fb923c';
  return '#dc2626';
}

// ── Panneau Province ─────────────────────────────────────────────────────────

function ProvincePanel({ province, onClose }: { province: SelectedProvince; onClose: () => void }) {
  const risk = province.events30d === 0 ? 'calme'
    : province.events30d <= 3  ? 'faible'
    : province.events30d <= 8  ? 'modéré'
    : province.events30d <= 15 ? 'élevé'
    : 'critique';

  const riskColor = risk === 'calme' ? 'text-gray-500'
    : risk === 'faible'   ? 'text-yellow-600'
    : risk === 'modéré'   ? 'text-orange-500'
    : risk === 'élevé'    ? 'text-red-600'
    : 'text-red-700 font-bold';

  return (
    <div className="absolute top-3 right-3 w-80 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-10">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wide">Province</div>
          <div className="font-bold text-gray-900 text-base">{province.nameFr}</div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
      </div>

      <div className="p-4 space-y-4">
        {/* Niveau de risque */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Niveau d'activité :</span>
          <span className={`text-sm font-semibold capitalize ${riskColor}`}>{risk}</span>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-gray-50 rounded-lg py-2">
            <div className="text-xl font-bold text-gray-800">{province.events30d}</div>
            <div className="text-[10px] text-gray-500">Événements<br />30 jours</div>
          </div>
          <div className="bg-gray-50 rounded-lg py-2">
            <div className="text-xl font-bold text-gray-800">{province.events7d}</div>
            <div className="text-[10px] text-gray-500">Événements<br />7 jours</div>
          </div>
          <div className={`rounded-lg py-2 ${province.activeAlerts > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
            <div className={`text-xl font-bold ${province.activeAlerts > 0 ? 'text-red-600' : 'text-gray-800'}`}>
              {province.activeAlerts}
            </div>
            <div className="text-[10px] text-gray-500">Alertes<br />actives</div>
          </div>
        </div>

        {/* Dernière activité */}
        {province.lastEventAt && (
          <div className="text-xs text-gray-500 flex items-center gap-1">
            <span>Dernière activité :</span>
            <span className="text-gray-700 font-medium">{timeAgo(province.lastEventAt)}</span>
          </div>
        )}

        {/* Explication contextuelle */}
        {province.events30d > 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
            <div className="font-semibold mb-1">Situation</div>
            <p>
              {province.events30d} événements recensés sur 30 jours
              {province.events7d > 0 ? `, dont ${province.events7d} sur la dernière semaine` : ''}.
              {province.activeAlerts > 0
                ? ` ${province.activeAlerts} alerte${province.activeAlerts > 1 ? 's' : ''} officielle${province.activeAlerts > 1 ? 's' : ''} en cours.`
                : ''}
            </p>
            <p className="mt-1 text-amber-700">
              Cliquez sur les marqueurs de la carte pour plus de détails sur chaque événement.
            </p>
          </div>
        ) : (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800">
            Aucun événement enregistré dans cette province sur les 30 derniers jours.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Panneau Événement ────────────────────────────────────────────────────────

function EventPanel({ event, onClose }: { event: SelectedEvent; onClose: () => void }) {
  const color  = HAZARD_COLOR[event.hazardType]  ?? '#6b7280';
  const icon   = HAZARD_ICON[event.hazardType]   ?? '⚠️';
  const label  = HAZARD_LABEL[event.hazardType]  ?? event.hazardType;
  const explication = HAZARD_EXPLICATION[event.hazardType] ?? HAZARD_EXPLICATION.other;

  return (
    <div className="absolute top-3 right-3 w-80 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-10">
      {/* Header coloré */}
      <div className="px-4 py-3 flex items-center justify-between" style={{ backgroundColor: color + '15', borderBottom: `2px solid ${color}` }}>
        <div className="flex items-center gap-2">
          <span className="text-2xl">{icon}</span>
          <div>
            <div className="text-xs font-semibold" style={{ color }}>{label}</div>
            <div className="text-xs text-gray-500">
              Sévérité : <span className="font-medium" style={{ color: SEVERITY_COLOR[event.severity] ?? '#6b7280' }}>
                {SEVERITY_LABEL[event.severity] ?? event.severity}
              </span>
            </div>
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
      </div>

      <div className="p-4 space-y-3">
        {/* Description */}
        {event.description && (
          <p className="text-sm text-gray-800 font-medium leading-snug">{event.description}</p>
        )}

        {/* Localisation + date */}
        <div className="space-y-1 text-xs text-gray-600">
          <div className="flex items-center gap-1.5">
            <span>📍</span>
            <span>{event.locationName || event.provinceName || 'Localisation inconnue'}</span>
            {event.provinceName && event.locationName !== event.provinceName && (
              <span className="text-gray-400">· {event.provinceName}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span>🕐</span>
            <span>{timeAgo(event.createdAt)}</span>
          </div>
        </div>

        {/* Explication */}
        <div className="rounded-lg p-3 text-xs" style={{ backgroundColor: color + '10', border: `1px solid ${color}30` }}>
          <div className="font-semibold mb-1" style={{ color }}>Ce que cela signifie</div>
          <p className="text-gray-700 leading-relaxed">{explication}</p>
        </div>

        {/* Instruction SINAUR */}
        <p className="text-[10px] text-gray-400 text-center">
          Pour signaler un sinistre : composez <span className="font-mono font-semibold text-gray-600">*777*SINAUR#</span>
        </p>
      </div>
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export function CartePage() {
  const mapRef = useRef<MapRef>(null);

  const { data: provinceGeo } = useQuery({
    queryKey: ['public-province-geo'],
    queryFn:  publicApi.getProvinceGeo,
    staleTime: 300_000,
  });

  const { data: eventsGeo, dataUpdatedAt } = useQuery({
    queryKey: ['public-events-map'],
    queryFn:  publicApi.getEventsMap,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: alerts } = useQuery({
    queryKey: ['public-alerts'],
    queryFn:  publicApi.getAlerts,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const [selectedProvince, setSelectedProvince] = useState<SelectedProvince | null>(null);
  const [selectedEvent, setSelectedEvent]       = useState<SelectedEvent | null>(null);

  const closeAll = () => { setSelectedProvince(null); setSelectedEvent(null); };

  const onMapClick = useCallback((e: MapLayerMouseEvent) => {
    const feature = e.features?.[0];
    if (!feature) { closeAll(); return; }

    if (feature.layer.id === 'event-circles') {
      const p = feature.properties as Record<string, unknown>;
      const coords = (feature.geometry as unknown as { coordinates: [number, number] }).coordinates;
      setSelectedEvent({
        id:           String(p.id ?? ''),
        hazardType:   String(p.hazardType ?? p.hazard_type ?? 'other'),
        severity:     String(p.severity ?? 'Unknown'),
        locationName: String(p.locationName ?? p.location_name ?? ''),
        provinceName: String(p.provinceName ?? p.province_name ?? ''),
        description:  String(p.description ?? ''),
        createdAt:    String(p.createdAt ?? p.created_at ?? ''),
        lng: coords[0],
        lat: coords[1],
      });
      setSelectedProvince(null);
      return;
    }

    if (feature.layer.id === 'province-fill') {
      const p = feature.properties as Record<string, unknown>;
      setSelectedProvince({
        pcode:        String(p.pcode ?? ''),
        nameFr:       String(p.nameFr ?? p.name_fr ?? 'Province'),
        events30d:    Number(p.events30d ?? p.events_30d ?? 0),
        events7d:     Number(p.events7d  ?? p.events_7d  ?? 0),
        activeAlerts: Number(p.activeAlerts ?? p.active_alerts ?? 0),
        lastEventAt:  (p.lastEventAt ?? p.last_event_at ?? null) as string | null,
      });
      setSelectedEvent(null);
    }
  }, []);

  const eventCount = eventsGeo?.features.length ?? 0;
  const alertCount = alerts?.length ?? 0;
  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 130px)' }}>
      {/* Barre de légende */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-gray-600">
        {/* Types événements */}
        <span className="font-medium text-gray-700">Événements :</span>
        {Object.entries(HAZARD_LABEL).map(([key, label]) => (
          <span key={key} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: HAZARD_COLOR[key] }} />
            {label}
          </span>
        ))}

        {/* Intensité provinces */}
        <span className="font-medium text-gray-700 ml-2">Provinces :</span>
        {[['0', '#f3f4f6'], ['1–3', '#fef9c3'], ['4–8', '#fde68a'], ['9–15', '#fb923c'], ['16+', '#dc2626']].map(([label, color]) => (
          <span key={label} className="flex items-center gap-1">
            <span className="w-3 h-3 inline-block border border-gray-300" style={{ background: color }} />
            {label} évt
          </span>
        ))}

        {/* État live */}
        <div className="ml-auto flex items-center gap-3 text-gray-400">
          {alertCount > 0 && (
            <span className="text-red-600 font-medium">{alertCount} alerte{alertCount > 1 ? 's' : ''}</span>
          )}
          <span>{eventCount} point{eventCount > 1 ? 's' : ''}</span>
          {lastUpdate && <span>mis à jour {lastUpdate}</span>}
        </div>
      </div>

      {/* Zone carte + panneau */}
      <div className="flex-1 relative">
        <Map
          ref={mapRef}
          initialViewState={{
            bounds: [[12.2, -13.5], [31.3, 5.4]],
            fitBoundsOptions: { padding: 20 },
          }}
          style={{ width: '100%', height: '100%' }}
          mapStyle={MAP_STYLE}
          interactiveLayerIds={['province-fill', 'event-circles']}
          onClick={onMapClick}
          cursor="pointer"
        >
          {/* Provinces — toujours monté en premier */}
          <Source
            id="provinces"
            type="geojson"
            data={provinceGeo ?? EMPTY_GEOJSON}
          >
            <Layer
              id="province-fill"
              type="fill"
              paint={{
                'fill-color': [
                  'step', ['get', 'events30d'],
                  '#f3f4f6',
                  1,  '#fef9c3',
                  4,  '#fde68a',
                  9,  '#fb923c',
                  16, '#dc2626',
                ],
                'fill-opacity': 0.55,
              }}
            />
            <Layer
              id="province-border"
              type="line"
              paint={{
                'line-color': '#9ca3af',
                'line-width': 0.8,
              }}
            />
            <Layer
              id="province-border-selected"
              type="line"
              filter={selectedProvince
                ? ['==', ['get', 'pcode'], selectedProvince.pcode]
                : ['==', '1', '0']
              }
              paint={{
                'line-color': '#1d4ed8',
                'line-width': 2.5,
              }}
            />
          </Source>

          {/* Événements — montés après les provinces */}
          <Source
            id="events"
            type="geojson"
            data={eventsGeo ?? EMPTY_GEOJSON}
          >
            <Layer
              id="event-halos"
              type="circle"
              paint={{
                'circle-radius': 14,
                'circle-color': [
                  'match', ['get', 'hazardType'],
                  'conflict',          HAZARD_COLOR.conflict,
                  'health_epidemic',   HAZARD_COLOR.health_epidemic,
                  'flood',             HAZARD_COLOR.flood,
                  'drought',           HAZARD_COLOR.drought,
                  'mass_displacement', HAZARD_COLOR.mass_displacement,
                  HAZARD_COLOR.other,
                ],
                'circle-opacity': 0.15,
              }}
            />
            <Layer
              id="event-circles"
              type="circle"
              paint={{
                'circle-radius': 7,
                'circle-color': [
                  'match', ['get', 'hazardType'],
                  'conflict',          HAZARD_COLOR.conflict,
                  'health_epidemic',   HAZARD_COLOR.health_epidemic,
                  'flood',             HAZARD_COLOR.flood,
                  'drought',           HAZARD_COLOR.drought,
                  'mass_displacement', HAZARD_COLOR.mass_displacement,
                  HAZARD_COLOR.other,
                ],
                'circle-stroke-color': '#fff',
                'circle-stroke-width': 1.5,
                'circle-opacity': 0.9,
              }}
            />
          </Source>

          {/* Popup rapide sur l'événement sélectionné */}
          {selectedEvent && (
            <Popup
              longitude={selectedEvent.lng}
              latitude={selectedEvent.lat}
              onClose={closeAll}
              closeButton={false}
              anchor="bottom"
              offset={16}
            >
              <div className="text-xs font-medium text-gray-800">
                {HAZARD_ICON[selectedEvent.hazardType]} {selectedEvent.locationName || selectedEvent.provinceName}
              </div>
            </Popup>
          )}
        </Map>

        {/* Panneau détail Province */}
        {selectedProvince && (
          <ProvincePanel province={selectedProvince} onClose={closeAll} />
        )}

        {/* Panneau détail Événement */}
        {selectedEvent && (
          <EventPanel event={selectedEvent} onClose={closeAll} />
        )}

        {/* Aucune donnée — message discret */}
        {!selectedProvince && !selectedEvent && alertCount === 0 && eventCount === 0 && (
          <div className="absolute top-3 right-3 bg-green-50 border border-green-300 text-green-700 text-sm px-4 py-2 rounded-xl shadow">
            ✅ Aucune alerte active — situation calme
          </div>
        )}

        {/* Instruction mobile */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-white/80 backdrop-blur text-xs text-gray-500 px-3 py-1 rounded-full shadow pointer-events-none">
          Cliquez sur une province ou un marqueur pour les détails
        </div>
      </div>
    </div>
  );
}
