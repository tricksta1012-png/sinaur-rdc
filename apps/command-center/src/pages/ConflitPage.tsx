import { useState, useMemo, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import MapGL, { Source, Layer, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { apiClient } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';

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
        'raster-brightness-max': 0.30,
        'raster-opacity': 0.80,
        'raster-contrast': 0.05,
      },
    },
  ],
};

// Province centroids [lon, lat] — mirrored from ai-prediction/agents/prediction/risk_map.py
const PROV_CENTROIDS: Record<string, [number, number]> = {
  'CD-NK':  [29.23, -1.68],
  'CD-SK':  [28.85, -2.49],
  'CD-MN':  [26.92, -3.12],
  'CD-HK':  [27.47, -11.66],
  'CD-IT':  [30.23,  1.57],
  'CD-TP':  [25.20,  0.52],
  'CD-BU':  [24.73,  2.82],
  'CD-MO':  [21.50,  2.15],
  'CD-NU':  [21.50,  4.00],
  'CD-EQ':  [18.26,  0.05],
  'CD-HL':  [25.90, -9.50],
  'CD-TA':  [29.19, -5.93],
  'CD-LO':  [25.47, -10.72],
  'CD-HU':  [28.60,  3.50],
  'CD-SU':  [23.60, -3.50],
  'CD-KC':  [22.42, -5.90],
  'CD-MK':  [23.60, -6.15],
  'CD-LM':  [24.50, -6.80],
  'CD-KW':  [18.83, -5.04],
  'CD-KO':  [17.00, -4.84],
  'CD-MN2': [18.50, -2.50],
  'CD-BC':  [13.46, -5.82],
  'CD-BN':  [17.80, -3.30],
  'CD-KN':  [15.32, -4.32],
};

const PROV_NAMES: Record<string, string> = {
  'CD-NK': 'Nord-Kivu', 'CD-SK': 'Sud-Kivu', 'CD-MN': 'Maniema',
  'CD-HK': 'Haut-Katanga', 'CD-IT': 'Ituri', 'CD-TP': 'Tshopo',
  'CD-BU': 'Bas-Uélé', 'CD-MO': 'Mongala', 'CD-NU': 'Nord-Ubangi',
  'CD-EQ': 'Équateur', 'CD-HL': 'Haut-Lomami', 'CD-TA': 'Tanganyika',
  'CD-LO': 'Lualaba', 'CD-HU': 'Haut-Uélé', 'CD-SU': 'Sankuru',
  'CD-KC': 'Kasaï-Central', 'CD-MK': 'Kasaï', 'CD-LM': 'Lomami',
  'CD-KW': 'Kwilu', 'CD-KO': 'Kongo-Central', 'CD-MN2': 'Mai-Ndombe',
  'CD-BC': 'Bas-Congo', 'CD-BN': 'Kwango', 'CD-KN': 'Kinshasa',
};

// Severity 1–5 color scale (blue→red)
const DRC_BOUNDS_C: [[number, number], [number, number]] = [[12.2, -13.5], [31.3, 5.4]];

const PROVINCE_BOUNDS_C: Record<string, [[number, number], [number, number]]> = {
  CD10:[[15.0,-4.65],[16.1,-4.15]], CD20:[[13.0,-5.8],[16.5,-4.0]],
  CD21:[[16.5,-7.0],[19.0,-4.5]],  CD22:[[16.5,-7.0],[19.5,-4.0]],
  CD23:[[17.0,-4.5],[20.5,-1.5]],  CD41:[[17.0,-2.5],[23.0,2.5]],
  CD42:[[18.0,2.0],[22.0,5.5]],   CD43:[[20.0,3.0],[24.5,5.5]],
  CD44:[[19.0,0.5],[23.0,4.0]],   CD45:[[20.0,-3.0],[25.0,1.0]],
  CD51:[[23.0,-2.0],[28.0,2.0]],  CD52:[[22.5,0.5],[27.0,4.5]],
  CD53:[[27.0,1.0],[31.0,5.5]],   CD54:[[27.5,0.0],[31.5,3.5]],
  CD61:[[26.8,-3.5],[30.2,2.5]],  CD62:[[26.5,-5.5],[29.5,-1.0]],
  CD63:[[25.5,-5.0],[29.0,-1.0]], CD71:[[25.5,-13.5],[29.5,-8.0]],
  CD72:[[22.5,-12.5],[26.0,-8.0]],CD73:[[24.0,-11.0],[27.5,-7.0]],
  CD74:[[27.5,-8.5],[31.5,-4.5]], CD81:[[23.0,-9.0],[26.5,-6.0]],
  CD82:[[23.5,-8.5],[27.0,-5.0]], CD83:[[20.5,-7.5],[24.0,-4.0]],
  CD84:[[21.5,-8.5],[25.0,-5.5]], CD85:[[23.5,-5.5],[27.0,-2.5]],
};

const PROVINCE_NAMES_C: Record<string, string> = {
  CD10:'Kinshasa', CD20:'Kongo-Central', CD21:'Kwango', CD22:'Kwilu', CD23:'Maï-Ndombe',
  CD41:'Équateur', CD42:'Sud-Ubangi', CD43:'Nord-Ubangi', CD44:'Mongala', CD45:'Tshuapa',
  CD51:'Tshopo', CD52:'Bas-Uélé', CD53:'Haut-Uélé', CD54:'Ituri',
  CD61:'Nord-Kivu', CD62:'Sud-Kivu', CD63:'Maniema',
  CD71:'Haut-Katanga', CD72:'Lualaba', CD73:'Haut-Lomami', CD74:'Tanganyika',
  CD81:'Lomami', CD82:'Kasaï-Oriental', CD83:'Kasaï', CD84:'Kasaï-Central', CD85:'Sankuru',
};

function decodeScope(token: string): string[] {
  try {
    const p = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    return Array.isArray(p.scope) ? p.scope : [];
  } catch { return []; }
}

const SEV_COLOR: Record<number, string> = {
  1: '#3b82f6', 2: '#22c55e', 3: '#eab308', 4: '#f97316', 5: '#ef4444',
};
const SEV_LABEL: Record<number, string> = {
  1: 'Mineur', 2: 'Limité', 3: 'Modéré', 4: 'Grave', 5: 'Critique',
};

const EVENT_TYPE_FR: Record<string, string> = {
  conflict: 'Conflit armé', armed_clashes: 'Affrontements armés',
  violence_civilians: 'Violence contre civils', explosion_remote: 'Explosion/Mine',
  protests: 'Manifestation', abduction: 'Enlèvement', other: 'Autre',
};

type HorizonDays = 7 | 14 | 30;

interface ConflictEvent {
  external_id: string;
  source: string;
  event_date: string;
  event_type: string;
  province: string;
  severity: number;
  displacement_risk: number;
  territoire?: string;
  p_code?: string;
  coordinates?: [number, number] | null;
  fatalities_reported?: number | null;
  raw_notes?: string | null;
  source_url?: string | null;
}

interface DisplacementPrediction {
  prediction_id: string;
  province: string;
  horizon_days: number;
  displaced_estimate_low: number;
  displaced_estimate_high: number;
  confidence: number;
  events_count: number;
  generated_at: string;
}

function getKey(e: ConflictEvent): string {
  return e.p_code || e.province || 'Unknown';
}

function getCentroid(e: ConflictEvent): [number, number] | null {
  if (e.coordinates) return e.coordinates;
  const k = e.p_code;
  if (k && PROV_CENTROIDS[k]) return PROV_CENTROIDS[k];
  // Match by province name (case-insensitive)
  for (const [code, name] of Object.entries(PROV_NAMES)) {
    if (name.toLowerCase() === (e.province || '').toLowerCase()) {
      return PROV_CENTROIDS[code] ?? null;
    }
  }
  return null;
}

export function ConflitPage() {
  const mapRef = useRef<MapRef>(null);
  const { tokens } = useAuthStore();
  const [horizon, setHorizon] = useState<HorizonDays>(14);
  const [showCorridors, setShowCorridors] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const userScope = useMemo((): string[] => {
    if (!tokens?.accessToken) return [];
    return decodeScope(tokens.accessToken);
  }, [tokens?.accessToken]);

  const provinceBounds = userScope.length > 0 ? (PROVINCE_BOUNDS_C[userScope[0]] ?? null) : null;
  const provinceName   = userScope.length > 0 ? (PROVINCE_NAMES_C[userScope[0]] ?? userScope[0]) : null;

  const resetView = useCallback(() => {
    const map = mapRef.current?.getMap();
    const bounds = provinceBounds ?? DRC_BOUNDS_C;
    map?.fitBounds(bounds as any, { padding: 40, duration: 800 });
  }, [provinceBounds]);

  const { data: eventsData, isLoading } = useQuery({
    queryKey: ['conflit-events', horizon, userScope[0]],
    queryFn: () => {
      const params = new URLSearchParams({ since_days: String(horizon) });
      return apiClient.get(`/conflit/events?${params}`).then(r => r.data);
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const { data: predictionsData } = useQuery({
    queryKey: ['conflit-predictions'],
    queryFn: () => apiClient.get('/conflit/predictions/displacement').then(r => r.data),
    staleTime: 10 * 60_000,
  });

  const allEvents: ConflictEvent[] = eventsData?.events ?? [];
  const events: ConflictEvent[] = userScope.length > 0
    ? allEvents.filter(e => !e.p_code || userScope.includes(e.p_code))
    : allEvents;
  const predictions: DisplacementPrediction[] = predictionsData?.predictions ?? [];

  // Province tension circles GeoJSON
  const provinceGeoJSON = useMemo(() => {
    const byKey: Record<string, ConflictEvent[]> = {};
    for (const e of events) {
      const k = getKey(e);
      (byKey[k] ??= []).push(e);
    }
    return {
      type: 'FeatureCollection' as const,
      features: Object.entries(byKey).flatMap(([, evs]) => {
        const c = getCentroid(evs[0]);
        if (!c) return [];
        const maxSev = Math.max(...evs.map(e => e.severity || 1));
        const maxRisk = Math.max(...evs.map(e => e.displacement_risk || 0));
        return [{
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: c },
          properties: {
            province: evs[0].province || getKey(evs[0]),
            eventCount: evs.length,
            maxSeverity: maxSev,
            maxRisk,
            color: SEV_COLOR[maxSev] ?? '#6b7280',
          },
        }];
      }),
    };
  }, [events]);

  // Movement corridors: connect consecutive events in different provinces within 5 days
  const corridorData = useMemo(() => {
    const sorted = [...events].sort((a, b) =>
      new Date(a.event_date).getTime() - new Date(b.event_date).getTime()
    );
    const lines: GeoJSON.Feature[] = [];
    const dests: GeoJSON.Feature[] = [];

    for (let i = 0; i < sorted.length - 1; i++) {
      const e1 = sorted[i];
      const e2 = sorted[i + 1];
      if (getKey(e1) === getKey(e2)) continue;
      const c1 = getCentroid(e1);
      const c2 = getCentroid(e2);
      if (!c1 || !c2) continue;
      const daysDiff = (new Date(e2.event_date).getTime() - new Date(e1.event_date).getTime()) / 86400000;
      if (daysDiff > 5) continue;
      const color = SEV_COLOR[e2.severity || 1] ?? '#6b7280';
      lines.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [c1, c2] },
        properties: { color, severity: e2.severity || 1 },
      });
      dests.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: c2 },
        properties: { color },
      });
    }

    return {
      lines: { type: 'FeatureCollection' as const, features: lines },
      dests: { type: 'FeatureCollection' as const, features: dests },
    };
  }, [events]);

  const sortedEvents = useMemo(() =>
    [...events].sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime()),
    [events]
  );

  const affectedProvinces = useMemo(() =>
    new Set(events.map(e => e.p_code || e.province)).size,
    [events]
  );

  const onMapClick = useCallback((e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (f) {
      const prov = f.properties?.province as string | undefined;
      if (prov) {
        const match = sortedEvents.find(ev => ev.province === prov || ev.p_code === prov);
        if (match) setSelectedId(match.external_id);
      }
    }
  }, [sortedEvents]);

  const selectedEvent = selectedId ? events.find(e => e.external_id === selectedId) ?? null : null;

  return (
    <div className="flex h-full">

      {/* ── Left Sidebar ──────────────────────────────────────── */}
      <div className="w-80 shrink-0 border-r border-cc-700 flex flex-col bg-cc-900 overflow-hidden">

        {/* Header */}
        <div className="px-4 pt-3 pb-2.5 border-b border-cc-700 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚔️</span>
              <div>
                <div className="text-white font-bold text-sm leading-tight">Surveillance Conflits</div>
                <div className="text-cc-500 text-[10px] font-mono uppercase tracking-wider">Agent 9 — SINAUR-RDC</div>
              </div>
            </div>
            <span className="text-[9px] bg-red-900/70 text-red-300 border border-red-700 px-1.5 py-0.5 rounded font-mono font-bold shrink-0">
              🔒 RESTREINT
            </span>
          </div>
        </div>

        {/* Timeline filter */}
        <div className="px-3 py-2.5 border-b border-cc-700 shrink-0">
          <div className="text-[10px] font-mono text-cc-500 mb-2 uppercase tracking-wider">Fenêtre temporelle</div>
          <div className="flex gap-1.5">
            {([7, 14, 30] as HorizonDays[]).map(d => (
              <button
                key={d}
                onClick={() => setHorizon(d)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-mono font-bold transition-colors border ${
                  horizon === d
                    ? 'bg-red-900/80 border-red-700 text-red-200'
                    : 'bg-cc-800 border-cc-700 text-cc-400 hover:text-gray-300 hover:border-cc-600'
                }`}
              >
                {d}j
              </button>
            ))}
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 divide-x divide-cc-700 border-b border-cc-700 shrink-0">
          {[
            { label: 'Incidents', value: events.length, color: 'text-red-400' },
            { label: 'Provinces', value: affectedProvinces, color: 'text-orange-400' },
            { label: 'Prédictions', value: predictions.length, color: 'text-yellow-400' },
          ].map(s => (
            <div key={s.label} className="px-2 py-2 text-center">
              <div className={`text-xl font-bold font-mono ${s.color}`}>{s.value}</div>
              <div className="text-[9px] text-cc-500 font-mono leading-tight">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Map layer toggles */}
        <div className="px-3 py-2 border-b border-cc-700 shrink-0 flex items-center gap-2">
          <button
            onClick={() => setShowCorridors(v => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-mono border transition-colors ${
              showCorridors
                ? 'bg-cc-700 border-cc-500 text-gray-200'
                : 'border-cc-700 text-cc-500 hover:text-gray-300 hover:border-cc-600'
            }`}
          >
            <span className="w-4 h-px border-t border-dashed border-current inline-block" />
            Corridors
          </button>
          <span className="text-[10px] text-cc-600 font-mono">
            {showCorridors ? `${corridorData.lines.features.length} tracés` : ''}
          </span>
        </div>

        {/* Displacement predictions */}
        {predictions.length > 0 && (
          <div className="px-3 py-2.5 border-b border-cc-700 shrink-0">
            <div className="text-[10px] font-mono text-orange-500 uppercase tracking-wider mb-2">
              🏃 Prédictions de déplacement
            </div>
            <div className="space-y-1.5">
              {predictions
                .sort((a, b) => b.displaced_estimate_high - a.displaced_estimate_high)
                .slice(0, 4)
                .map(p => (
                  <div key={p.prediction_id} className="bg-cc-800/80 rounded-lg px-2.5 py-1.5">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[11px] text-gray-200 font-medium">{p.province}</span>
                      <span className={`text-[9px] font-mono ${p.confidence >= 0.7 ? 'text-yellow-400' : 'text-cc-500'}`}>
                        {Math.round(p.confidence * 100)}%
                      </span>
                    </div>
                    <div className="text-[10px] text-cc-400 font-mono">
                      {(p.displaced_estimate_low / 1000).toFixed(0)}k–{(p.displaced_estimate_high / 1000).toFixed(0)}k personnes
                    </div>
                    {/* Confidence bar */}
                    <div className="mt-1 h-0.5 bg-cc-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-orange-500 rounded-full"
                        style={{ width: `${p.confidence * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Event list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-cc-600 text-xs font-mono">
              <span className="animate-pulse">Chargement des données…</span>
            </div>
          ) : sortedEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-cc-600 font-mono text-xs space-y-2">
              <span className="text-2xl opacity-30">⚔️</span>
              <span>Aucun incident enregistré</span>
              <span className="text-[10px] text-cc-700">sur les {horizon} derniers jours</span>
            </div>
          ) : (
            <div className="divide-y divide-cc-800/70">
              {sortedEvents.map((e, i) => {
                const color = SEV_COLOR[e.severity || 1] ?? '#6b7280';
                const isSelected = selectedId === e.external_id;
                return (
                  <div
                    key={e.external_id || i}
                    className={`px-3 py-2 cursor-pointer transition-colors ${
                      isSelected ? 'bg-cc-800' : 'hover:bg-cc-800/50'
                    }`}
                    onClick={() => setSelectedId(isSelected ? null : (e.external_id || null))}
                  >
                    <div className="flex items-start gap-2">
                      <span className="w-2 h-2 rounded-full shrink-0 mt-1" style={{ backgroundColor: color }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] text-gray-200 font-medium truncate">
                          {e.province || e.p_code || 'Province inconnue'}
                          {e.territoire ? ` · ${e.territoire}` : ''}
                        </div>
                        <div className="text-[10px] text-cc-400 font-mono">
                          {EVENT_TYPE_FR[e.event_type] ?? e.event_type}
                          {e.fatalities_reported != null && e.fatalities_reported > 0
                            ? ` · ${e.fatalities_reported} victime${e.fatalities_reported > 1 ? 's' : ''}`
                            : ''}
                        </div>
                        <div className="text-[9px] text-cc-600 font-mono mt-0.5">
                          {formatDistanceToNow(new Date(e.event_date), { addSuffix: true, locale: fr })}
                        </div>
                      </div>
                      <div className="text-[10px] font-bold font-mono shrink-0 mt-0.5" style={{ color }}>
                        S{e.severity}
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isSelected && (
                      <div className="mt-2 space-y-1.5 border-t border-cc-700 pt-2">
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className="text-cc-500">Risque déplacement :</span>
                          <span className="font-mono text-orange-400">{Math.round(e.displacement_risk * 100)}%</span>
                        </div>
                        {e.raw_notes && (
                          <div className="text-[10px] text-cc-400 leading-relaxed">
                            {e.raw_notes.slice(0, 240)}{e.raw_notes.length > 240 ? '…' : ''}
                          </div>
                        )}
                        {e.source_url && (
                          <a
                            href={e.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-sinaur-400 hover:text-sinaur-300 font-mono block truncate"
                            onClick={ev => ev.stopPropagation()}
                          >
                            🔗 Source
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Disclaimer */}
        <div className="px-3 py-2 border-t border-cc-700 shrink-0 bg-red-950/20">
          <div className="text-[9px] text-red-400/60 font-mono leading-relaxed">
            Sources : ACLED · OCHA · MONUSCO · ICG<br />
            Usage humanitaire opérationnel uniquement
          </div>
        </div>
      </div>

      {/* ── Map ───────────────────────────────────────────────── */}
      <div className="flex-1 relative">
        {/* Province scope banner */}
        {provinceName && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 bg-amber-900/90 border border-amber-700 text-amber-200 text-[10px] font-mono px-3 py-1 rounded-lg backdrop-blur-sm pointer-events-none whitespace-nowrap">
            🏛️ Vue provinciale — {provinceName}
          </div>
        )}

        {/* Reset view button */}
        <button
          onClick={resetView}
          title={provinceBounds ? `Recentrer sur ${provinceName}` : 'Vue complète RDC'}
          className="absolute top-2 right-2 z-20 px-2.5 py-1 rounded-lg text-[10px] font-mono border border-cc-700 bg-cc-900/92 text-cc-400 hover:text-white hover:border-cc-500 transition-colors backdrop-blur-sm"
        >
          {provinceBounds ? `🏛️ ${provinceName}` : '🌍 Vue RDC'}
        </button>

        <MapGL
          ref={mapRef}
          initialViewState={{
            bounds: provinceBounds ?? DRC_BOUNDS_C,
            fitBoundsOptions: { padding: 40 },
          }}
          style={{ width: '100%', height: '100%' }}
          mapStyle={MAP_STYLE}
          interactiveLayerIds={['province-circles', 'province-halo']}
          onClick={onMapClick}
        >
          {/* Movement corridor lines */}
          {showCorridors && corridorData.lines.features.length > 0 && (
            <>
              <Source id="corridors" type="geojson" data={corridorData.lines}>
                <Layer
                  id="corridor-lines"
                  type="line"
                  paint={{
                    'line-color': ['get', 'color'],
                    'line-width': 1.5,
                    'line-opacity': 0.55,
                    'line-dasharray': [4, 3],
                  }}
                />
              </Source>
              {/* Direction indicators at destination */}
              <Source id="corridor-dests" type="geojson" data={corridorData.dests}>
                <Layer
                  id="corridor-dest-pts"
                  type="circle"
                  paint={{
                    'circle-radius': 5,
                    'circle-color': ['get', 'color'],
                    'circle-opacity': 0.9,
                    'circle-stroke-color': '#1e293b',
                    'circle-stroke-width': 1.5,
                  }}
                />
              </Source>
            </>
          )}

          {/* Province tension circles */}
          {provinceGeoJSON.features.length > 0 && (
            <Source id="prov-conflit" type="geojson" data={provinceGeoJSON}>
              {/* Outer glow */}
              <Layer
                id="province-halo"
                type="circle"
                paint={{
                  'circle-radius': ['interpolate', ['linear'], ['get', 'eventCount'], 1, 32, 5, 46, 10, 62],
                  'circle-color': ['get', 'color'],
                  'circle-opacity': 0.08,
                }}
              />
              {/* Main circle */}
              <Layer
                id="province-circles"
                type="circle"
                paint={{
                  'circle-radius': ['interpolate', ['linear'], ['get', 'eventCount'], 1, 18, 5, 28, 10, 38],
                  'circle-color': ['get', 'color'],
                  'circle-opacity': 0.82,
                  'circle-stroke-color': '#ffffff',
                  'circle-stroke-width': 1.5,
                }}
              />
              {/* Event count label */}
              <Layer
                id="province-counts"
                type="symbol"
                layout={{
                  'text-field': ['to-string', ['get', 'eventCount']],
                  'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                  'text-size': 11,
                  'text-allow-overlap': true,
                }}
                paint={{ 'text-color': '#ffffff' }}
              />
              {/* Province name below */}
              <Layer
                id="province-labels"
                type="symbol"
                layout={{
                  'text-field': ['get', 'province'],
                  'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
                  'text-size': 9,
                  'text-offset': [0, 3.2],
                  'text-anchor': 'top',
                  'text-allow-overlap': false,
                }}
                paint={{
                  'text-color': '#d1d5db',
                  'text-halo-color': '#0d1b2a',
                  'text-halo-width': 1.5,
                }}
              />
            </Source>
          )}
        </MapGL>

        {/* Top stats bar */}
        <div className="absolute top-3 left-3 flex gap-2 flex-wrap">
          {events.length > 0 && (
            <div className="bg-red-900/90 border border-red-700 rounded-lg px-3 py-1.5 text-xs backdrop-blur-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse shrink-0" />
              <span className="font-mono font-bold text-red-200">{events.length}</span>
              <span className="text-red-300">incidents / {horizon}j</span>
            </div>
          )}
          {predictions.length > 0 && (
            <div className="bg-orange-900/90 border border-orange-700 rounded-lg px-3 py-1.5 text-xs backdrop-blur-sm flex items-center gap-2">
              <span className="text-orange-200">🏃</span>
              <span className="font-mono font-bold text-orange-200">{predictions.length}</span>
              <span className="text-orange-300">prédictions déplacement</span>
            </div>
          )}
          {corridorData.lines.features.length > 0 && showCorridors && (
            <div className="bg-cc-900/90 border border-cc-700 rounded-lg px-3 py-1.5 text-xs backdrop-blur-sm text-cc-400 font-mono">
              {corridorData.lines.features.length} corridor{corridorData.lines.features.length > 1 ? 's' : ''} détecté{corridorData.lines.features.length > 1 ? 's' : ''}
            </div>
          )}
        </div>

        {/* Event detail card (map overlay) */}
        {selectedEvent && (
          <div className="absolute top-16 right-3 w-64 bg-cc-950/97 border border-red-900 rounded-xl shadow-2xl overflow-hidden backdrop-blur-sm z-20">
            <div className="px-3 pt-3 pb-2 border-b border-cc-800">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-white text-sm font-bold leading-tight">
                    {selectedEvent.province || selectedEvent.p_code}
                  </div>
                  {selectedEvent.territoire && (
                    <div className="text-[10px] text-cc-400 font-mono">{selectedEvent.territoire}</div>
                  )}
                </div>
                <button
                  onClick={() => setSelectedId(null)}
                  className="w-5 h-5 rounded-full bg-cc-800 text-cc-400 hover:text-white text-xs flex items-center justify-center shrink-0"
                >×</button>
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                  style={{
                    borderColor: (SEV_COLOR[selectedEvent.severity] ?? '#6b7280') + '80',
                    color: SEV_COLOR[selectedEvent.severity] ?? '#6b7280',
                    background: (SEV_COLOR[selectedEvent.severity] ?? '#6b7280') + '22',
                  }}
                >
                  S{selectedEvent.severity} — {SEV_LABEL[selectedEvent.severity] ?? ''}
                </span>
              </div>
            </div>
            <div className="px-3 py-2.5 space-y-1.5 text-xs">
              <div className="flex items-center gap-2 text-gray-400">
                <span className="text-cc-500 w-16 shrink-0 font-mono text-[10px]">Type :</span>
                <span>{EVENT_TYPE_FR[selectedEvent.event_type] ?? selectedEvent.event_type}</span>
              </div>
              {selectedEvent.fatalities_reported != null && selectedEvent.fatalities_reported > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-cc-500 w-16 shrink-0 font-mono text-[10px]">Victimes :</span>
                  <span className="text-red-400 font-bold">{selectedEvent.fatalities_reported}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-cc-500 w-16 shrink-0 font-mono text-[10px]">Déplacement :</span>
                <span className="text-orange-400 font-mono">{Math.round(selectedEvent.displacement_risk * 100)}%</span>
              </div>
              <div className="flex items-center gap-2 text-cc-400 font-mono text-[10px]">
                <span className="w-16 shrink-0">Date :</span>
                <span>{new Date(selectedEvent.event_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              </div>
              {selectedEvent.raw_notes && (
                <div className="border-t border-cc-800 pt-1.5 text-[10px] text-cc-400 leading-relaxed">
                  {selectedEvent.raw_notes.slice(0, 160)}{selectedEvent.raw_notes.length > 160 ? '…' : ''}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Severity legend */}
        <div className="absolute bottom-4 left-3 bg-cc-900/95 border border-cc-700 rounded-lg px-3 py-2 backdrop-blur-sm">
          <div className="text-[10px] font-mono text-cc-500 mb-2 uppercase tracking-wider">Sévérité (1–5)</div>
          <div className="space-y-1">
            {([5, 4, 3, 2, 1] as const).map(s => (
              <div key={s} className="flex items-center gap-2 text-[10px] text-gray-300">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: SEV_COLOR[s] }} />
                {SEV_LABEL[s]}
              </div>
            ))}
          </div>
          {showCorridors && (
            <div className="border-t border-cc-700 mt-2 pt-1.5 flex items-center gap-2 text-[10px] text-cc-500">
              <span className="w-6 border-t border-dashed border-cc-500" />
              Corridor mouvement
            </div>
          )}
        </div>

        {/* RESTRICTED disclaimer */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-red-900/80 border border-red-800 text-red-300 text-[9px] font-mono px-4 py-1.5 rounded-lg backdrop-blur-sm whitespace-nowrap">
          Classification RESTREINT — Usage humanitaire opérationnel uniquement
        </div>
      </div>
    </div>
  );
}
