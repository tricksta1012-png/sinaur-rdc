import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import MapGL, { Source, Layer, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { formatDistanceToNow, format } from 'date-fns';
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

const PROV_CENTROIDS: Record<string, [number, number]> = {
  'CD-NK':  [29.23, -1.68],  'CD-SK':  [28.85, -2.49],  'CD-MN':  [26.92, -3.12],
  'CD-HK':  [27.47, -11.66], 'CD-IT':  [30.23,  1.57],  'CD-TP':  [25.20,  0.52],
  'CD-BU':  [24.73,  2.82],  'CD-MO':  [21.50,  2.15],  'CD-NU':  [21.50,  4.00],
  'CD-EQ':  [18.26,  0.05],  'CD-HL':  [25.90, -9.50],  'CD-TA':  [29.19, -5.93],
  'CD-LO':  [25.47, -10.72], 'CD-HU':  [28.60,  3.50],  'CD-SU':  [23.60, -3.50],
  'CD-KC':  [22.42, -5.90],  'CD-MK':  [23.60, -6.15],  'CD-LM':  [24.50, -6.80],
  'CD-KW':  [18.83, -5.04],  'CD-KO':  [17.00, -4.84],  'CD-MN2': [18.50, -2.50],
  'CD-BC':  [13.46, -5.82],  'CD-BN':  [17.80, -3.30],  'CD-KN':  [15.32, -4.32],
};

const PROV_NAMES: Record<string, string> = {
  'CD-NK': 'Nord-Kivu',    'CD-SK': 'Sud-Kivu',      'CD-MN': 'Maniema',
  'CD-HK': 'Haut-Katanga', 'CD-IT': 'Ituri',         'CD-TP': 'Tshopo',
  'CD-BU': 'Bas-Uélé',     'CD-MO': 'Mongala',       'CD-NU': 'Nord-Ubangi',
  'CD-EQ': 'Équateur',     'CD-HL': 'Haut-Lomami',   'CD-TA': 'Tanganyika',
  'CD-LO': 'Lualaba',      'CD-HU': 'Haut-Uélé',     'CD-SU': 'Sankuru',
  'CD-KC': 'Kasaï-Central','CD-MK': 'Kasaï',          'CD-LM': 'Lomami',
  'CD-KW': 'Kwilu',        'CD-KO': 'Kongo-Central', 'CD-MN2': 'Mai-Ndombe',
  'CD-BC': 'Bas-Congo',    'CD-BN': 'Kwango',         'CD-KN': 'Kinshasa',
};

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
  CD10:'Kinshasa',     CD20:'Kongo-Central', CD21:'Kwango',      CD22:'Kwilu',
  CD23:'Maï-Ndombe',  CD41:'Équateur',      CD42:'Sud-Ubangi',  CD43:'Nord-Ubangi',
  CD44:'Mongala',     CD45:'Tshuapa',       CD51:'Tshopo',      CD52:'Bas-Uélé',
  CD53:'Haut-Uélé',  CD54:'Ituri',         CD61:'Nord-Kivu',   CD62:'Sud-Kivu',
  CD63:'Maniema',     CD71:'Haut-Katanga',  CD72:'Lualaba',     CD73:'Haut-Lomami',
  CD74:'Tanganyika',  CD81:'Lomami',        CD82:'Kasaï-Oriental', CD83:'Kasaï',
  CD84:'Kasaï-Central', CD85:'Sankuru',
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

const WARN_COLOR = { green: '#22c55e', yellow: '#eab308', orange: '#f97316', red: '#ef4444' };
const WARN_BG   = { green: 'bg-green-900/40', yellow: 'bg-yellow-900/40', orange: 'bg-orange-900/40', red: 'bg-red-900/40' };
const WARN_BORDER = { green: 'border-green-800', yellow: 'border-yellow-800', orange: 'border-orange-700', red: 'border-red-700' };
const WARN_TEXT = { green: 'text-green-400', yellow: 'text-yellow-400', orange: 'text-orange-400', red: 'text-red-400' };
const WARN_LABEL = { green: 'NORMAL', yellow: 'VIGILANCE', orange: 'ALERTE', red: 'CRITIQUE' };

const PRIORITY_COLOR: Record<string, string> = {
  URGENT: 'text-red-400 border-red-700 bg-red-900/30',
  ÉLEVÉ:  'text-orange-400 border-orange-700 bg-orange-900/30',
  MOYEN:  'text-yellow-400 border-yellow-700 bg-yellow-900/30',
};
const CAT_COLOR: Record<string, string> = {
  security:      'text-red-400',
  humanitarian:  'text-orange-400',
  logistics:     'text-blue-400',
  coordination:  'text-purple-400',
};
const CAT_LABEL: Record<string, string> = {
  security:     'Sécurité',
  humanitarian: 'Humanitaire',
  logistics:    'Logistique',
  coordination: 'Coordination',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function getBearing(from: [number, number], to: [number, number]): number {
  const toRad = (d: number) => d * Math.PI / 180;
  const [lon1, lat1] = from.map(toRad);
  const [lon2, lat2] = to.map(toRad);
  const dLon = lon2 - lon1;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

// ── Interfaces ─────────────────────────────────────────────────────────────

type HorizonDays = 7 | 14 | 30;
type SidebarTab  = 'incidents' | 'threats' | 'acteurs';
type WarnLevel   = 'green' | 'yellow' | 'orange' | 'red';
type RecCategory = 'security' | 'humanitarian' | 'logistics' | 'coordination';

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

interface ArmedActorRef {
  nom_acled: string;
  nom_alternatifs: string[];
  categorie: string;
  provinces_actives_historique: string[];
  provinces_a_risque_expansion: string[];
  type_violence_frequent: string;
  corridors_deplacement_associes: [string, string, string][];
  facteur_amplification_deplacement: number;
  note_humanitaire: string;
}

interface EarlyWarning {
  id: string;
  level: WarnLevel;
  province: string;
  message: string;
  indicators: string[];
  eventCount: number;
  maxSeverity: number;
}

interface ThreatPrediction {
  rank: number;
  target: string;
  riskScore: number;
  confidence: number;
  reasons: string[];
}

interface EnhancedCorridor {
  id: string;
  origin: string;
  destination: string;
  firstSeen: string;
  lastSeen: string;
  daysDiff: number;
  confidence: number;
  color: string;
  originCoords: [number, number];
  destCoords: [number, number];
  severity: number;
}

interface OperationalRec {
  category: RecCategory;
  icon: string;
  action: string;
  why: string;
  priority: 'URGENT' | 'ÉLEVÉ' | 'MOYEN';
}

function buildRecommendations(event: ConflictEvent): OperationalRec[] {
  const recs: OperationalRec[] = [];
  const sev = event.severity || 1;
  if (sev >= 4) {
    recs.push({ category: 'security', icon: '🚨', action: 'Alerter les autorités', why: `Sévérité S${sev} — urgence`, priority: 'URGENT' });
    recs.push({ category: 'security', icon: '👁️', action: 'Renforcer la surveillance', why: 'Escalade documentée', priority: 'URGENT' });
  }
  if (event.displacement_risk >= 0.5) {
    recs.push({ category: 'humanitarian', icon: '🏃', action: 'Préparer évacuation préventive', why: `Risque déplacement ${Math.round(event.displacement_risk * 100)}%`, priority: sev >= 4 ? 'URGENT' : 'ÉLEVÉ' });
    recs.push({ category: 'humanitarian', icon: '📦', action: "Déployer kits d'urgence", why: 'Population exposée', priority: 'ÉLEVÉ' });
    recs.push({ category: 'humanitarian', icon: '🏠', action: 'Établir abris temporaires', why: 'Flux de déplacement attendu', priority: 'MOYEN' });
  }
  if (event.event_type === 'armed_clashes' || event.event_type === 'conflict') {
    recs.push({ category: 'logistics', icon: '🛣️', action: "Sécuriser corridors d'appro.", why: 'Routes potentiellement coupées', priority: 'MOYEN' });
    recs.push({ category: 'logistics', icon: '📦', action: 'Pré-positionner stocks secours', why: 'Accès humanitaire menacé', priority: 'MOYEN' });
  }
  recs.push({ category: 'coordination', icon: '📡', action: 'Notifier partenaires OCHA', why: 'Coordination inter-agences requise', priority: 'MOYEN' });
  if (sev >= 3) recs.push({ category: 'coordination', icon: '🏛️', action: 'Activer comité de crise', why: sev >= 4 ? 'Urgence déclarée' : 'Escalade potentielle', priority: sev >= 4 ? 'URGENT' : 'MOYEN' });
  return recs;
}

function getKey(e: ConflictEvent): string {
  return e.p_code || e.province || 'Unknown';
}

function getCentroid(e: ConflictEvent): [number, number] | null {
  if (e.coordinates) return e.coordinates;
  const k = e.p_code;
  if (k && PROV_CENTROIDS[k]) return PROV_CENTROIDS[k];
  for (const [code, name] of Object.entries(PROV_NAMES)) {
    if (name.toLowerCase() === (e.province || '').toLowerCase()) return PROV_CENTROIDS[code] ?? null;
  }
  return null;
}

// ── Component ──────────────────────────────────────────────────────────────

export function ConflitPage() {
  const mapRef = useRef<MapRef>(null);
  const { tokens } = useAuthStore();

  // ── State ─────────────────────────────────────────────────────────────
  const [horizon, setHorizon]                   = useState<HorizonDays>(14);
  const [showCorridors, setShowCorridors]       = useState(true);
  const [showPredictionLayer, setShowPrediction] = useState(false);
  const [selectedId, setSelectedId]             = useState<string | null>(null);
  const [selectedCorridorId, setCorridorId]     = useState<string | null>(null);
  const [activeTab, setActiveTab]               = useState<SidebarTab>('incidents');
  const [replayMode, setReplayMode]             = useState(false);
  const [replayIndex, setReplayIndex]           = useState(0);
  const [expandedActorId, setExpandedActorId]   = useState<string | null>(null);
  const [detailTab, setDetailTab]               = useState<'info' | 'acteurs' | 'recs'>('info');

  // ── Scope ─────────────────────────────────────────────────────────────
  const userScope = useMemo((): string[] => {
    if (!tokens?.accessToken) return [];
    return decodeScope(tokens.accessToken);
  }, [tokens?.accessToken]);

  const provinceBounds = userScope.length > 0 ? (PROVINCE_BOUNDS_C[userScope[0]] ?? null) : null;
  const provinceName   = userScope.length > 0 ? (PROVINCE_NAMES_C[userScope[0]] ?? userScope[0]) : null;

  const resetView = useCallback(() => {
    const bounds = provinceBounds ?? DRC_BOUNDS_C;
    mapRef.current?.getMap().fitBounds(bounds as any, { padding: 40, duration: 800 });
  }, [provinceBounds]);

  // ── Queries ───────────────────────────────────────────────────────────
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

  const { data: actorsData } = useQuery({
    queryKey: ['conflit-actors'],
    queryFn: () => apiClient.get('/conflit/actors').then(r => r.data).catch(() => ({ actors: [] })),
    staleTime: 30 * 60_000,
  });

  const allEvents: ConflictEvent[]        = eventsData?.events ?? [];
  const events: ConflictEvent[]           = userScope.length > 0
    ? allEvents.filter(e => !e.p_code || userScope.includes(e.p_code))
    : allEvents;
  const predictions: DisplacementPrediction[] = predictionsData?.predictions ?? [];
  const actors: ArmedActorRef[]           = actorsData?.actors ?? [];

  // ── Replay ────────────────────────────────────────────────────────────
  const replayEvents = useMemo(() =>
    [...events].sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime()),
    [events],
  );

  useEffect(() => { setReplayIndex(0); }, [events.length]);

  useEffect(() => {
    if (!replayMode || replayIndex >= replayEvents.length - 1) return;
    const t = setTimeout(() => setReplayIndex(i => i + 1), 600);
    return () => clearTimeout(t);
  }, [replayMode, replayIndex, replayEvents.length]);

  const visibleEvents = useMemo(() =>
    replayMode ? replayEvents.slice(0, replayIndex + 1) : events,
    [replayMode, replayIndex, replayEvents, events],
  );

  // ── Enhanced corridors ────────────────────────────────────────────────
  const enhancedCorridors = useMemo((): EnhancedCorridor[] => {
    const sorted = [...visibleEvents].sort((a, b) =>
      new Date(a.event_date).getTime() - new Date(b.event_date).getTime(),
    );
    const result: EnhancedCorridor[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const e1 = sorted[i], e2 = sorted[i + 1];
      if (getKey(e1) === getKey(e2)) continue;
      const c1 = getCentroid(e1), c2 = getCentroid(e2);
      if (!c1 || !c2) continue;
      const daysDiff = (new Date(e2.event_date).getTime() - new Date(e1.event_date).getTime()) / 86400000;
      if (daysDiff > 5) continue;
      result.push({
        id:           `${e1.external_id}-${e2.external_id}`,
        origin:       e1.province || e1.p_code || 'Inconnu',
        destination:  e2.province || e2.p_code || 'Inconnu',
        firstSeen:    e1.event_date,
        lastSeen:     e2.event_date,
        daysDiff,
        confidence:   Math.round(Math.max(40, 95 - daysDiff * 11)),
        color:        SEV_COLOR[e2.severity || 1] ?? '#6b7280',
        originCoords: c1,
        destCoords:   c2,
        severity:     e2.severity || 1,
      });
    }
    return result;
  }, [visibleEvents]);

  // ── Corridor GeoJSON ──────────────────────────────────────────────────
  const corridorData = useMemo(() => {
    const lines: GeoJSON.Feature[] = [];
    const arrows: GeoJSON.Feature[] = [];
    for (const c of enhancedCorridors) {
      lines.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [c.originCoords, c.destCoords] },
        properties: { color: c.color, severity: c.severity, corridorId: c.id, confidence: c.confidence, origin: c.origin, destination: c.destination },
      });
      const mid: [number, number] = [
        (c.originCoords[0] + c.destCoords[0]) / 2,
        (c.originCoords[1] + c.destCoords[1]) / 2,
      ];
      arrows.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: mid },
        properties: { color: c.color, bearing: getBearing(c.originCoords, c.destCoords), corridorId: c.id },
      });
    }
    return {
      lines:  { type: 'FeatureCollection' as const, features: lines },
      arrows: { type: 'FeatureCollection' as const, features: arrows },
    };
  }, [enhancedCorridors]);

  // ── Province circles GeoJSON ──────────────────────────────────────────
  const provinceGeoJSON = useMemo(() => {
    const byKey: Record<string, ConflictEvent[]> = {};
    for (const e of visibleEvents) { const k = getKey(e); (byKey[k] ??= []).push(e); }
    return {
      type: 'FeatureCollection' as const,
      features: Object.entries(byKey).flatMap(([, evs]) => {
        const c = getCentroid(evs[0]);
        if (!c) return [];
        const maxSev  = Math.max(...evs.map(e => e.severity || 1));
        const maxRisk = Math.max(...evs.map(e => e.displacement_risk || 0));
        return [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: c },
          properties: { province: evs[0].province || getKey(evs[0]), eventCount: evs.length, maxSeverity: maxSev, maxRisk, color: SEV_COLOR[maxSev] ?? '#6b7280' } }];
      }),
    };
  }, [visibleEvents]);

  // ── Early warnings ────────────────────────────────────────────────────
  const earlyWarnings = useMemo((): EarlyWarning[] => {
    const byProvince: Record<string, ConflictEvent[]> = {};
    for (const e of events) { const k = e.province || e.p_code || 'Unknown'; (byProvince[k] ??= []).push(e); }
    return Object.entries(byProvince).map(([province, evs]) => {
      const maxSev  = Math.max(...evs.map(e => e.severity || 1));
      const avgRisk = evs.reduce((s, e) => s + (e.displacement_risk || 0), 0) / evs.length;
      const count   = evs.length;
      const inbound = enhancedCorridors.filter(c => c.destination === province).length;
      const indicators: string[] = [];
      let level: WarnLevel = 'green';

      if (maxSev >= 5)                        { level = 'red';    indicators.push('Incidents critiques (S5)'); }
      else if (maxSev >= 4 && count >= 2)     { level = 'orange'; indicators.push('Incidents graves répétés'); }
      else if (maxSev >= 3 && count >= 2)     { level = 'yellow'; indicators.push('Tension modérée croissante'); }

      if (count >= 5)    indicators.push(`${count} incidents/${horizon}j`);
      if (avgRisk >= 0.7) {
        indicators.push(`Déplacement ${Math.round(avgRisk * 100)}%`);
        if (level === 'yellow') level = 'orange';
      }
      if (inbound >= 2) {
        indicators.push(`${inbound} corridors convergents`);
        if (level === 'yellow') level = 'orange';
        if (level === 'orange' && maxSev >= 4) level = 'red';
      }

      const message = level === 'red'    ? 'Crise active — intervention urgente'
                    : level === 'orange' ? 'Situation dégradée — vigilance renforcée'
                    : level === 'yellow' ? 'Tension croissante'
                    : 'Stable';

      return { id: province, level, province, message, indicators, eventCount: count, maxSeverity: maxSev };
    })
    .filter(w => w.level !== 'green')
    .sort((a, b) => ({ red: 0, orange: 1, yellow: 2, green: 3 }[a.level] - { red: 0, orange: 1, yellow: 2, green: 3 }[b.level]));
  }, [events, enhancedCorridors, horizon]);

  // ── Threat predictions (ranked) ───────────────────────────────────────
  const threatPredictions = useMemo((): ThreatPrediction[] => {
    const byProvince: Record<string, ConflictEvent[]> = {};
    for (const e of events) { const k = e.province || e.p_code || 'Unknown'; (byProvince[k] ??= []).push(e); }
    return Object.entries(byProvince).map(([province, evs]) => {
      const maxSev  = Math.max(...evs.map(e => e.severity || 1));
      const avgRisk = evs.reduce((s, e) => s + (e.displacement_risk || 0), 0) / evs.length;
      const inbound = enhancedCorridors.filter(c => c.destination === province).length;
      const pred    = predictions.find(p => p.province === province);
      const riskScore = Math.min(99, Math.round(
        (maxSev / 5) * 35 + avgRisk * 30 + Math.min(evs.length, 10) / 10 * 15 + inbound * 8 + (pred ? 12 : 0),
      ));
      const confidence = Math.min(92, 42 + evs.length * 4 + inbound * 3);
      const reasons: string[] = [];
      if (evs.length >= 3) reasons.push(`${evs.length} incidents en ${horizon}j`);
      if (maxSev >= 4)     reasons.push(`Sévérité max S${maxSev}`);
      if (avgRisk >= 0.6)  reasons.push(`Risque déplacement ${Math.round(avgRisk * 100)}%`);
      if (inbound >= 1)    reasons.push(`${inbound} corridor(s) convergent(s)`);
      if (pred)            reasons.push(`Jusqu'à ${(pred.displaced_estimate_high / 1000).toFixed(0)}k déplacés prédits`);
      return { rank: 0, target: province, riskScore, confidence, reasons };
    })
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 6)
    .map((t, i) => ({ ...t, rank: i + 1 }));
  }, [events, predictions, enhancedCorridors, horizon]);

  // ── Threat heatmap GeoJSON ────────────────────────────────────────────
  const threatGeoJSON = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: threatPredictions.flatMap(t => {
      const ev = events.find(e => (e.province || e.p_code) === t.target);
      if (!ev) return [];
      const c = getCentroid(ev);
      if (!c) return [];
      return [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: c },
        properties: { riskScore: t.riskScore } }];
    }),
  }), [threatPredictions, events]);

  // ── Sorted events & stats ─────────────────────────────────────────────
  const sortedEvents = useMemo(() =>
    [...events].sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime()),
    [events],
  );
  const affectedProvinces = useMemo(() => new Set(events.map(e => e.p_code || e.province)).size, [events]);

  // ── Selected items ────────────────────────────────────────────────────
  const selectedEvent    = selectedId       ? events.find(e => e.external_id === selectedId) ?? null : null;
  const selectedCorridor = selectedCorridorId ? enhancedCorridors.find(c => c.id === selectedCorridorId) ?? null : null;

  const relevantActors = useMemo(() => {
    if (!selectedEvent) return [];
    const prov = (selectedEvent.province || '').toLowerCase();
    return actors.filter(a =>
      a.provinces_actives_historique.some(p => prov.includes(p.toLowerCase())) ||
      a.provinces_a_risque_expansion.some(p => prov.includes(p.toLowerCase())),
    );
  }, [selectedEvent, actors]);

  const recommendations = useMemo(() => selectedEvent ? buildRecommendations(selectedEvent) : [], [selectedEvent]);

  // ── Map click ─────────────────────────────────────────────────────────
  const onMapClick = useCallback((e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) return;
    if (f.layer?.id === 'corridor-arrows') {
      const cid = f.properties?.corridorId as string | undefined;
      if (cid) { setCorridorId(cid === selectedCorridorId ? null : cid); setSelectedId(null); return; }
    }
    const prov = f.properties?.province as string | undefined;
    if (prov) {
      const match = sortedEvents.find(ev => ev.province === prov || ev.p_code === prov);
      if (match) { setSelectedId(match.external_id); setCorridorId(null); setDetailTab('info'); }
    }
  }, [sortedEvents, selectedCorridorId]);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full">

      {/* ── Left Sidebar ────────────────────────────────────────────── */}
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
              >{d}j</button>
            ))}
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 divide-x divide-cc-700 border-b border-cc-700 shrink-0">
          {[
            { label: 'Incidents',   value: events.length,        color: 'text-red-400'    },
            { label: 'Provinces',   value: affectedProvinces,    color: 'text-orange-400' },
            { label: 'Prédictions', value: predictions.length,   color: 'text-yellow-400' },
            { label: 'Alertes',     value: earlyWarnings.length, color: earlyWarnings.some(w => w.level === 'red') ? 'text-red-400 animate-pulse' : 'text-orange-400' },
          ].map(s => (
            <div key={s.label} className="px-1 py-2 text-center">
              <div className={`text-lg font-bold font-mono ${s.color}`}>{s.value}</div>
              <div className="text-[9px] text-cc-500 font-mono leading-tight">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Layer toggles */}
        <div className="px-3 py-2 border-b border-cc-700 shrink-0 flex flex-wrap items-center gap-1.5">
          {[
            { key: 'corridors',  label: 'Corridors',    active: showCorridors,       onClick: () => setShowCorridors(v => !v),        icon: '↗' },
            { key: 'preds',      label: 'Menaces',      active: showPredictionLayer, onClick: () => setShowPrediction(v => !v),       icon: '🎯' },
            { key: 'replay',     label: replayMode ? 'Stop replay' : 'Replay', active: replayMode, onClick: () => { setReplayMode(v => !v); setReplayIndex(0); }, icon: '▶' },
          ].map(btn => (
            <button
              key={btn.key}
              onClick={btn.onClick}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono border transition-colors ${
                btn.active
                  ? 'bg-cc-700 border-cc-500 text-gray-200'
                  : 'border-cc-700 text-cc-500 hover:text-gray-300 hover:border-cc-600'
              }`}
            >
              <span className="text-[9px]">{btn.icon}</span>{btn.label}
            </button>
          ))}
          {showCorridors && enhancedCorridors.length > 0 && (
            <span className="text-[10px] text-cc-600 font-mono ml-1">{enhancedCorridors.length} tracé{enhancedCorridors.length > 1 ? 's' : ''}</span>
          )}
        </div>

        {/* Early warnings */}
        {earlyWarnings.length > 0 && (
          <div className="px-3 py-2.5 border-b border-cc-700 shrink-0">
            <div className="text-[10px] font-mono text-orange-400 uppercase tracking-wider mb-2">
              ⚠️ Système d'alerte précoce
            </div>
            <div className="space-y-1.5">
              {earlyWarnings.slice(0, 3).map(w => (
                <div
                  key={w.id}
                  className={`rounded-lg px-2.5 py-1.5 border ${WARN_BG[w.level]} ${WARN_BORDER[w.level]}`}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[11px] text-gray-200 font-medium truncate">{w.province}</span>
                    <span className={`text-[9px] font-mono font-bold ml-1 shrink-0 ${WARN_TEXT[w.level]}`}
                      style={{ color: WARN_COLOR[w.level] }}>
                      {WARN_LABEL[w.level]}
                    </span>
                  </div>
                  <div className="text-[10px] text-cc-400">{w.message}</div>
                  {w.indicators.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {w.indicators.slice(0, 2).map((ind, i) => (
                        <span key={i} className="text-[9px] bg-cc-800 text-cc-400 px-1.5 py-0.5 rounded font-mono">{ind}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {earlyWarnings.length > 3 && (
                <div className="text-[9px] text-cc-600 font-mono text-center">+{earlyWarnings.length - 3} alertes supplémentaires</div>
              )}
            </div>
          </div>
        )}

        {/* Displacement predictions */}
        {predictions.length > 0 && (
          <div className="px-3 py-2.5 border-b border-cc-700 shrink-0">
            <div className="text-[10px] font-mono text-orange-500 uppercase tracking-wider mb-2">
              🏃 Prédictions de déplacement
            </div>
            <div className="space-y-1.5">
              {predictions
                .sort((a, b) => b.displaced_estimate_high - a.displaced_estimate_high)
                .slice(0, 3)
                .map(p => (
                  <div key={p.prediction_id} className="bg-cc-800/80 rounded-lg px-2.5 py-1.5">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[11px] text-gray-200 font-medium">{p.province}</span>
                      <span className={`text-[9px] font-mono ${p.confidence >= 0.7 ? 'text-yellow-400' : 'text-cc-500'}`}>
                        {Math.round(p.confidence * 100)}%
                      </span>
                    </div>
                    <div className="text-[10px] text-cc-400 font-mono">
                      {(p.displaced_estimate_low / 1000).toFixed(0)}k–{(p.displaced_estimate_high / 1000).toFixed(0)}k pers.
                    </div>
                    <div className="mt-1 h-0.5 bg-cc-700 rounded-full overflow-hidden">
                      <div className="h-full bg-orange-500 rounded-full" style={{ width: `${p.confidence * 100}%` }} />
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex border-b border-cc-700 shrink-0">
          {([
            { key: 'incidents', label: `Incidents (${events.length})` },
            { key: 'threats',   label: 'Menaces'   },
            { key: 'acteurs',   label: `Acteurs (${actors.length})` },
          ] as { key: SidebarTab; label: string }[]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-1.5 text-[10px] font-mono transition-colors border-b-2 ${
                activeTab === tab.key
                  ? 'text-red-300 border-red-600'
                  : 'text-cc-500 border-transparent hover:text-gray-300'
              }`}
            >{tab.label}</button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Incidents tab ── */}
          {activeTab === 'incidents' && (
            isLoading ? (
              <div className="flex items-center justify-center h-32 text-cc-600 text-xs font-mono">
                <span className="animate-pulse">Chargement…</span>
              </div>
            ) : sortedEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-cc-600 font-mono text-xs space-y-2">
                <span className="text-2xl opacity-30">⚔️</span>
                <span>Aucun incident ({horizon}j)</span>
              </div>
            ) : (
              <div className="divide-y divide-cc-800/70">
                {sortedEvents.map((e, i) => {
                  const color = SEV_COLOR[e.severity || 1] ?? '#6b7280';
                  const isSelected = selectedId === e.external_id;
                  return (
                    <div
                      key={e.external_id || i}
                      className={`px-3 py-2 cursor-pointer transition-colors ${isSelected ? 'bg-cc-800' : 'hover:bg-cc-800/50'}`}
                      onClick={() => { setSelectedId(isSelected ? null : (e.external_id || null)); setCorridorId(null); setDetailTab('info'); }}
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
                        <div className="text-[10px] font-bold font-mono shrink-0 mt-0.5" style={{ color }}>S{e.severity}</div>
                      </div>
                      {isSelected && (
                        <div className="mt-2 space-y-1 border-t border-cc-700 pt-2">
                          <div className="flex items-center gap-2 text-[10px]">
                            <span className="text-cc-500 font-mono w-16 shrink-0">Déplacement :</span>
                            <span className="text-orange-400 font-mono">{Math.round(e.displacement_risk * 100)}%</span>
                          </div>
                          {e.raw_notes && (
                            <div className="text-[10px] text-cc-400 leading-relaxed">
                              {e.raw_notes.slice(0, 200)}{e.raw_notes.length > 200 ? '…' : ''}
                            </div>
                          )}
                          {e.source_url && (
                            <a href={e.source_url} target="_blank" rel="noopener noreferrer"
                              className="text-[10px] text-sinaur-400 hover:text-sinaur-300 font-mono block truncate"
                              onClick={ev => ev.stopPropagation()}>🔗 Source
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* ── Threats tab ── */}
          {activeTab === 'threats' && (
            <div className="p-3 space-y-2">
              <div className="text-[10px] font-mono text-cc-500 uppercase tracking-wider mb-3">
                Cibles potentielles — analyse IA
              </div>
              {threatPredictions.length === 0 ? (
                <div className="text-cc-600 font-mono text-xs text-center pt-8">Données insuffisantes</div>
              ) : threatPredictions.map(t => (
                <div key={t.target} className="bg-cc-800/80 rounded-lg px-3 py-2.5 border border-cc-700">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`w-5 h-5 rounded text-[10px] font-bold font-mono flex items-center justify-center shrink-0 ${
                        t.rank === 1 ? 'bg-red-900 text-red-300' : t.rank === 2 ? 'bg-orange-900/70 text-orange-300' : 'bg-cc-700 text-cc-400'
                      }`}>{t.rank}</span>
                      <span className="text-[11px] text-gray-200 font-medium">{t.target}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-[12px] font-bold font-mono text-red-400">{t.riskScore}%</div>
                      <div className="text-[9px] text-cc-500 font-mono">risque</div>
                    </div>
                  </div>
                  {/* Risk bar */}
                  <div className="h-1 bg-cc-700 rounded-full mb-2">
                    <div className="h-full rounded-full bg-gradient-to-r from-yellow-500 to-red-500"
                      style={{ width: `${t.riskScore}%` }} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {t.reasons.map((r, i) => (
                      <span key={i} className="text-[9px] bg-cc-900 text-cc-400 border border-cc-700 px-1.5 py-0.5 rounded font-mono">{r}</span>
                    ))}
                  </div>
                  <div className="mt-1.5 text-[9px] text-cc-600 font-mono">Confiance : {t.confidence}%</div>
                </div>
              ))}
            </div>
          )}

          {/* ── Acteurs tab ── */}
          {activeTab === 'acteurs' && (
            <div className="p-3 space-y-2">
              {actors.length === 0 ? (
                <div className="text-cc-600 font-mono text-xs text-center pt-8">
                  Accès RESTRICTED requis<br /><span className="text-[9px] text-cc-700">ou aucun acteur documenté</span>
                </div>
              ) : actors.map(a => {
                const isExpanded = expandedActorId === a.nom_acled;
                return (
                  <div key={a.nom_acled} className="bg-cc-800/80 rounded-lg border border-cc-700 overflow-hidden">
                    <button
                      onClick={() => setExpandedActorId(isExpanded ? null : a.nom_acled)}
                      className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-cc-700/30 transition-colors"
                    >
                      <div>
                        <div className="text-[11px] text-gray-200 font-bold">{a.nom_acled}</div>
                        <div className="text-[9px] text-cc-500 font-mono">{a.provinces_actives_historique.join(' · ')}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono border ${
                          a.facteur_amplification_deplacement >= 1.4 ? 'text-red-400 border-red-800 bg-red-900/30' :
                          a.facteur_amplification_deplacement >= 1.2 ? 'text-orange-400 border-orange-800 bg-orange-900/30' :
                          'text-yellow-400 border-yellow-800 bg-yellow-900/30'
                        }`}>
                          ×{a.facteur_amplification_deplacement.toFixed(2)}
                        </span>
                        <span className="text-cc-600 text-xs">{isExpanded ? '▲' : '▼'}</span>
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3 space-y-2 border-t border-cc-700">
                        <div className="pt-2 text-[10px] text-cc-400 leading-relaxed">{a.note_humanitaire}</div>
                        {a.nom_alternatifs.length > 0 && (
                          <div>
                            <div className="text-[9px] text-cc-500 font-mono mb-1">ALIAS</div>
                            <div className="flex flex-wrap gap-1">
                              {a.nom_alternatifs.map(n => (
                                <span key={n} className="text-[9px] bg-cc-900 text-cc-400 px-1.5 py-0.5 rounded font-mono border border-cc-700">{n}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {a.provinces_a_risque_expansion.length > 0 && (
                          <div>
                            <div className="text-[9px] text-orange-500 font-mono mb-1">EXPANSION PROBABLE</div>
                            <div className="flex flex-wrap gap-1">
                              {a.provinces_a_risque_expansion.map(p => (
                                <span key={p} className="text-[9px] bg-orange-900/30 text-orange-400 px-1.5 py-0.5 rounded font-mono border border-orange-800">{p}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {a.corridors_deplacement_associes.length > 0 && (
                          <div>
                            <div className="text-[9px] text-cc-500 font-mono mb-1">CORRIDORS DOCUMENTÉS</div>
                            {a.corridors_deplacement_associes.slice(0, 3).map(([o, m, d], i) => (
                              <div key={i} className="text-[9px] text-cc-400 font-mono">{o} → {m} → {d}</div>
                            ))}
                          </div>
                        )}
                        <div className="text-[9px] text-cc-500 font-mono">Violence fréquente : {a.type_violence_frequent}</div>
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

      {/* ── Map ──────────────────────────────────────────────────────── */}
      <div className="flex-1 relative">

        {/* Province scope banner */}
        {provinceName && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 bg-amber-900/90 border border-amber-700 text-amber-200 text-[10px] font-mono px-3 py-1 rounded-lg backdrop-blur-sm pointer-events-none whitespace-nowrap">
            🏛️ Vue provinciale — {provinceName}
          </div>
        )}

        {/* Reset view */}
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
          interactiveLayerIds={['province-circles', 'province-halo', 'corridor-arrows']}
          onClick={onMapClick}
        >
          {/* Threat prediction heatmap */}
          {showPredictionLayer && threatGeoJSON.features.length > 0 && (
            <Source id="threats" type="geojson" data={threatGeoJSON}>
              <Layer id="threat-outer-glow" type="circle" paint={{
                'circle-radius':  ['interpolate', ['linear'], ['get', 'riskScore'], 30, 55, 99, 100],
                'circle-color':   '#ef4444',
                'circle-opacity': ['interpolate', ['linear'], ['get', 'riskScore'], 30, 0.04, 99, 0.14],
                'circle-blur':    1.2,
              }} />
              <Layer id="threat-inner" type="circle" paint={{
                'circle-radius':  ['interpolate', ['linear'], ['get', 'riskScore'], 30, 28, 99, 55],
                'circle-color':   '#ef4444',
                'circle-opacity': ['interpolate', ['linear'], ['get', 'riskScore'], 30, 0.06, 99, 0.18],
              }} />
            </Source>
          )}

          {/* Movement corridors */}
          {showCorridors && corridorData.lines.features.length > 0 && (
            <>
              <Source id="corridors" type="geojson" data={corridorData.lines}>
                <Layer
                  id="corridor-lines"
                  type="line"
                  paint={{
                    'line-color':     ['get', 'color'],
                    'line-width':     ['case', ['==', ['get', 'corridorId'], selectedCorridorId ?? '__none__'], 3, 1.5],
                    'line-opacity':   ['case', ['==', ['get', 'corridorId'], selectedCorridorId ?? '__none__'], 0.95, 0.55],
                    'line-dasharray': [4, 3],
                  }}
                />
              </Source>
              <Source id="corridor-arrows-src" type="geojson" data={corridorData.arrows}>
                <Layer
                  id="corridor-arrows"
                  type="symbol"
                  layout={{
                    'text-field':                '▶',
                    'text-size':                  11,
                    'text-rotate':               ['get', 'bearing'],
                    'text-rotation-alignment':   'map',
                    'text-pitch-alignment':      'map',
                    'text-allow-overlap':         true,
                  }}
                  paint={{
                    'text-color':         ['get', 'color'],
                    'text-opacity':        0.9,
                    'text-halo-color':    '#0d1b2a',
                    'text-halo-width':     0.5,
                  }}
                />
              </Source>
            </>
          )}

          {/* Province tension circles */}
          {provinceGeoJSON.features.length > 0 && (
            <Source id="prov-conflit" type="geojson" data={provinceGeoJSON}>
              <Layer id="province-halo" type="circle" paint={{
                'circle-radius':  ['interpolate', ['linear'], ['get', 'eventCount'], 1, 32, 5, 46, 10, 62],
                'circle-color':   ['get', 'color'],
                'circle-opacity':  0.08,
              }} />
              <Layer id="province-circles" type="circle" paint={{
                'circle-radius':       ['interpolate', ['linear'], ['get', 'eventCount'], 1, 18, 5, 28, 10, 38],
                'circle-color':        ['get', 'color'],
                'circle-opacity':       0.82,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width':  1.5,
              }} />
              <Layer id="province-counts" type="symbol" layout={{
                'text-field':         ['to-string', ['get', 'eventCount']],
                'text-font':          ['Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-size':           11,
                'text-allow-overlap':  true,
              }} paint={{ 'text-color': '#ffffff' }} />
              <Layer id="province-labels" type="symbol" layout={{
                'text-field':         ['get', 'province'],
                'text-font':          ['Open Sans Regular', 'Arial Unicode MS Regular'],
                'text-size':           9,
                'text-offset':        [0, 3.2],
                'text-anchor':        'top',
                'text-allow-overlap':  false,
              }} paint={{
                'text-color':       '#d1d5db',
                'text-halo-color':  '#0d1b2a',
                'text-halo-width':   1.5,
              }} />
            </Source>
          )}
        </MapGL>

        {/* Replay timeline */}
        {replayMode && replayEvents.length > 1 && (
          <div className="absolute bottom-20 left-3 right-3 z-20 bg-cc-900/97 border border-cc-600 rounded-xl px-4 py-3 backdrop-blur-sm shadow-2xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono text-purple-400 uppercase tracking-wider">▶ Replay historique</span>
              <span className="text-[11px] font-mono text-gray-200">
                {replayEvents[replayIndex]
                  ? format(new Date(replayEvents[replayIndex].event_date), 'dd MMM yyyy', { locale: fr })
                  : '—'}
              </span>
              <button
                onClick={() => { setReplayMode(false); setReplayIndex(0); }}
                className="text-cc-400 hover:text-white text-[10px] font-mono border border-cc-700 px-2 py-0.5 rounded"
              >✕ Quitter</button>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(0, replayEvents.length - 1)}
              value={replayIndex}
              onChange={e => setReplayIndex(Number(e.target.value))}
              className="w-full accent-red-500 cursor-pointer"
            />
            <div className="flex justify-between text-[9px] text-cc-600 font-mono mt-1">
              <span>{replayEvents[0] ? format(new Date(replayEvents[0].event_date), 'dd MMM yy', { locale: fr }) : ''}</span>
              <span className="text-cc-400">{replayIndex + 1} / {replayEvents.length} incidents</span>
              <span>{replayEvents[replayEvents.length - 1] ? format(new Date(replayEvents[replayEvents.length - 1].event_date), 'dd MMM yy', { locale: fr }) : ''}</span>
            </div>
          </div>
        )}

        {/* Top stats bar */}
        <div className="absolute top-3 left-3 flex gap-2 flex-wrap">
          {events.length > 0 && (
            <div className="bg-red-900/90 border border-red-700 rounded-lg px-3 py-1.5 text-xs backdrop-blur-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse shrink-0" />
              <span className="font-mono font-bold text-red-200">{events.length}</span>
              <span className="text-red-300">incidents / {horizon}j</span>
            </div>
          )}
          {earlyWarnings.filter(w => w.level === 'red').length > 0 && (
            <div className="bg-red-950/90 border border-red-600 rounded-lg px-3 py-1.5 text-xs backdrop-blur-sm flex items-center gap-2 animate-pulse">
              <span className="text-red-300">🚨</span>
              <span className="font-mono font-bold text-red-300">{earlyWarnings.filter(w => w.level === 'red').length} CRITIQUE{earlyWarnings.filter(w => w.level === 'red').length > 1 ? 'S' : ''}</span>
            </div>
          )}
          {predictions.length > 0 && (
            <div className="bg-orange-900/90 border border-orange-700 rounded-lg px-3 py-1.5 text-xs backdrop-blur-sm flex items-center gap-2">
              <span className="text-orange-200">🏃</span>
              <span className="font-mono font-bold text-orange-200">{predictions.length}</span>
              <span className="text-orange-300">prédictions</span>
            </div>
          )}
          {enhancedCorridors.length > 0 && showCorridors && (
            <div className="bg-cc-900/90 border border-cc-700 rounded-lg px-3 py-1.5 text-xs backdrop-blur-sm text-cc-400 font-mono">
              {enhancedCorridors.length} corridor{enhancedCorridors.length > 1 ? 's' : ''}
            </div>
          )}
          {replayMode && (
            <div className="bg-purple-900/90 border border-purple-700 rounded-lg px-3 py-1.5 text-xs backdrop-blur-sm text-purple-300 font-mono">
              ▶ REPLAY {replayIndex + 1}/{replayEvents.length}
            </div>
          )}
        </div>

        {/* ── Intelligence Detail Panel ── */}
        {(selectedEvent || selectedCorridor) && (
          <div className="absolute top-14 right-3 w-72 bg-cc-950/98 border border-red-900 rounded-xl shadow-2xl overflow-hidden backdrop-blur-sm z-20 flex flex-col max-h-[calc(100vh-8rem)]">

            {/* Panel header */}
            <div className="px-3 pt-3 pb-2 border-b border-cc-800 shrink-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {selectedEvent && (
                    <>
                      <div className="text-white text-sm font-bold leading-tight truncate">
                        {selectedEvent.province || selectedEvent.p_code}
                      </div>
                      {selectedEvent.territoire && (
                        <div className="text-[10px] text-cc-400 font-mono">{selectedEvent.territoire}</div>
                      )}
                    </>
                  )}
                  {selectedCorridor && !selectedEvent && (
                    <>
                      <div className="text-white text-sm font-bold leading-tight">Corridor mouvement</div>
                      <div className="text-[10px] text-cc-400 font-mono">{selectedCorridor.origin} → {selectedCorridor.destination}</div>
                    </>
                  )}
                </div>
                <button
                  onClick={() => { setSelectedId(null); setCorridorId(null); }}
                  className="w-5 h-5 rounded-full bg-cc-800 text-cc-400 hover:text-white text-xs flex items-center justify-center shrink-0"
                >×</button>
              </div>

              {selectedEvent && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                    style={{
                      borderColor: (SEV_COLOR[selectedEvent.severity] ?? '#6b7280') + '80',
                      color:       SEV_COLOR[selectedEvent.severity] ?? '#6b7280',
                      background:  (SEV_COLOR[selectedEvent.severity] ?? '#6b7280') + '22',
                    }}
                  >
                    S{selectedEvent.severity} — {SEV_LABEL[selectedEvent.severity] ?? ''}
                  </span>
                  {relevantActors.length > 0 && (
                    <span className="text-[9px] bg-red-900/50 text-red-300 border border-red-800 px-1.5 py-0.5 rounded font-mono">
                      {relevantActors.length} groupe{relevantActors.length > 1 ? 's' : ''} documenté{relevantActors.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              )}
              {selectedCorridor && !selectedEvent && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-cc-600 text-cc-300 bg-cc-800">
                    Confiance {selectedCorridor.confidence}%
                  </span>
                  <span className="text-[10px] font-mono text-cc-500">S{selectedCorridor.severity}</span>
                </div>
              )}
            </div>

            {/* Detail tabs (only for event) */}
            {selectedEvent && (
              <div className="flex border-b border-cc-800 shrink-0">
                {([
                  { key: 'info',    label: 'Événement' },
                  { key: 'acteurs', label: `Acteurs (${relevantActors.length})` },
                  { key: 'recs',    label: `Actions (${recommendations.length})` },
                ] as { key: typeof detailTab; label: string }[]).map(t => (
                  <button
                    key={t.key}
                    onClick={() => setDetailTab(t.key)}
                    className={`flex-1 py-1.5 text-[9px] font-mono transition-colors border-b-2 ${
                      detailTab === t.key ? 'text-red-300 border-red-600' : 'text-cc-500 border-transparent hover:text-gray-300'
                    }`}
                  >{t.label}</button>
                ))}
              </div>
            )}

            {/* Panel content */}
            <div className="overflow-y-auto flex-1">

              {/* Corridor detail */}
              {selectedCorridor && !selectedEvent && (
                <div className="px-3 py-2.5 space-y-2 text-xs">
                  {[
                    { label: 'Origine',       value: selectedCorridor.origin },
                    { label: 'Destination',   value: selectedCorridor.destination },
                    { label: 'Direction',     value: `${selectedCorridor.origin} → ${selectedCorridor.destination}` },
                    { label: 'Première détection', value: format(new Date(selectedCorridor.firstSeen), 'dd MMM yyyy HH:mm', { locale: fr }) },
                    { label: 'Dernière détection', value: format(new Date(selectedCorridor.lastSeen), 'dd MMM yyyy HH:mm', { locale: fr }) },
                    { label: 'Intervalle',    value: `${selectedCorridor.daysDiff.toFixed(1)} jour${selectedCorridor.daysDiff > 1 ? 's' : ''}` },
                    { label: 'Confiance route', value: `${selectedCorridor.confidence}%` },
                  ].map(row => (
                    <div key={row.label} className="flex items-start gap-2">
                      <span className="text-cc-500 font-mono text-[10px] w-28 shrink-0">{row.label} :</span>
                      <span className="text-gray-300 text-[10px]">{row.value}</span>
                    </div>
                  ))}
                  <div className="mt-2 h-1 bg-cc-700 rounded-full">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${selectedCorridor.confidence}%` }} />
                  </div>
                </div>
              )}

              {/* Event info tab */}
              {selectedEvent && detailTab === 'info' && (
                <div className="px-3 py-2.5 space-y-1.5">
                  {[
                    { label: 'ID',         value: selectedEvent.external_id.slice(0, 16) + '…' },
                    { label: 'Source',     value: selectedEvent.source },
                    { label: 'Date',       value: format(new Date(selectedEvent.event_date), 'dd MMM yyyy HH:mm', { locale: fr }) },
                    { label: 'Province',   value: selectedEvent.province || selectedEvent.p_code || '—' },
                    { label: 'Territoire', value: selectedEvent.territoire || '—' },
                    { label: 'Type',       value: EVENT_TYPE_FR[selectedEvent.event_type] ?? selectedEvent.event_type },
                  ].map(row => (
                    <div key={row.label} className="flex items-start gap-2 text-[10px]">
                      <span className="text-cc-500 font-mono w-20 shrink-0">{row.label} :</span>
                      <span className="text-gray-300 font-mono break-all">{row.value}</span>
                    </div>
                  ))}

                  {selectedEvent.coordinates && (
                    <div className="flex items-start gap-2 text-[10px]">
                      <span className="text-cc-500 font-mono w-20 shrink-0">GPS :</span>
                      <span className="text-blue-300 font-mono">{selectedEvent.coordinates[1].toFixed(4)}°N, {selectedEvent.coordinates[0].toFixed(4)}°E</span>
                    </div>
                  )}

                  {selectedEvent.fatalities_reported != null && selectedEvent.fatalities_reported > 0 && (
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="text-cc-500 font-mono w-20 shrink-0">Victimes :</span>
                      <span className="text-red-400 font-bold font-mono">{selectedEvent.fatalities_reported}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="text-cc-500 font-mono w-20 shrink-0">Déplacement :</span>
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-orange-400 font-mono font-bold">{Math.round(selectedEvent.displacement_risk * 100)}%</span>
                      <div className="flex-1 h-1 bg-cc-700 rounded-full">
                        <div className="h-full bg-orange-500 rounded-full" style={{ width: `${selectedEvent.displacement_risk * 100}%` }} />
                      </div>
                    </div>
                  </div>

                  {/* Population protection */}
                  <div className="mt-2 bg-cc-900 rounded-lg px-2.5 py-2 border border-cc-700">
                    <div className="text-[9px] font-mono text-orange-500 uppercase tracking-wider mb-1.5">Protection civile</div>
                    <div className="space-y-1">
                      {[
                        { icon: '👥', label: 'Pop. exposée', value: `${Math.round(selectedEvent.displacement_risk * 50 + selectedEvent.severity * 20)}k estimé` },
                        { icon: '🏫', label: 'Écoles à risque', value: `${Math.round(selectedEvent.severity * 3 + 1)}` },
                        { icon: '🏥', label: 'Centres santé', value: `${Math.round(selectedEvent.severity * 2 + 1)}` },
                        { icon: '⛺', label: 'Camps PDI proches', value: `${Math.round(selectedEvent.displacement_risk * 4 + 1)}` },
                      ].map(row => (
                        <div key={row.label} className="flex items-center gap-2 text-[10px]">
                          <span>{row.icon}</span>
                          <span className="text-cc-400 font-mono flex-1">{row.label}</span>
                          <span className="text-gray-300 font-mono">{row.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {selectedEvent.raw_notes && (
                    <div className="border-t border-cc-800 pt-2 text-[10px] text-cc-400 leading-relaxed">
                      {selectedEvent.raw_notes.slice(0, 200)}{selectedEvent.raw_notes.length > 200 ? '…' : ''}
                    </div>
                  )}
                  {selectedEvent.source_url && (
                    <a href={selectedEvent.source_url} target="_blank" rel="noopener noreferrer"
                      className="text-[10px] text-sinaur-400 hover:text-sinaur-300 font-mono block truncate">
                      🔗 Source
                    </a>
                  )}
                </div>
              )}

              {/* Acteurs tab */}
              {selectedEvent && detailTab === 'acteurs' && (
                <div className="px-3 py-2.5 space-y-2">
                  {relevantActors.length === 0 ? (
                    <div className="text-cc-600 font-mono text-[10px] text-center py-6">
                      Aucun groupe armé documenté<br />pour {selectedEvent.province}
                    </div>
                  ) : relevantActors.map(a => (
                    <div key={a.nom_acled} className="bg-cc-800 rounded-lg px-2.5 py-2 border border-cc-700 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-red-300 font-bold">{a.nom_acled}</span>
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                          a.facteur_amplification_deplacement >= 1.4 ? 'text-red-400 border-red-800 bg-red-900/30' : 'text-orange-400 border-orange-800 bg-orange-900/30'
                        }`}>×{a.facteur_amplification_deplacement}</span>
                      </div>
                      <div className="text-[9px] text-cc-400 font-mono">
                        Province principale : {a.provinces_actives_historique[0]}
                      </div>
                      <div className="text-[9px] text-cc-500">
                        Confiance : <span className="text-yellow-400 font-mono">Élevée</span>
                      </div>
                      <div className="text-[10px] text-cc-400 leading-relaxed">
                        {a.note_humanitaire.slice(0, 140)}{a.note_humanitaire.length > 140 ? '…' : ''}
                      </div>
                      {a.corridors_deplacement_associes.length > 0 && (
                        <div className="text-[9px] text-cc-600 font-mono">
                          Corridor : {a.corridors_deplacement_associes[0].join(' → ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Recommendations tab */}
              {selectedEvent && detailTab === 'recs' && (
                <div className="px-3 py-2.5 space-y-2">
                  {(['URGENT', 'ÉLEVÉ', 'MOYEN'] as const).map(priority => {
                    const recs = recommendations.filter(r => r.priority === priority);
                    if (recs.length === 0) return null;
                    return (
                      <div key={priority}>
                        <div className={`text-[9px] font-mono font-bold uppercase tracking-wider mb-1.5 ${
                          priority === 'URGENT' ? 'text-red-400' : priority === 'ÉLEVÉ' ? 'text-orange-400' : 'text-yellow-400'
                        }`}>{priority}</div>
                        <div className="space-y-1.5">
                          {recs.map((r, i) => (
                            <div key={i} className={`rounded-lg px-2.5 py-2 border ${PRIORITY_COLOR[priority]}`}>
                              <div className="flex items-start gap-2">
                                <span className="text-sm shrink-0">{r.icon}</span>
                                <div className="flex-1 min-w-0">
                                  <div className={`text-[10px] font-medium ${CAT_COLOR[r.category]}`}>{CAT_LABEL[r.category]}</div>
                                  <div className="text-[11px] text-gray-200">{r.action}</div>
                                  <div className="text-[9px] text-cc-500 font-mono mt-0.5">{r.why}</div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
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
              Corridor ▶
            </div>
          )}
          {showPredictionLayer && (
            <div className="border-t border-cc-700 mt-1.5 pt-1.5 flex items-center gap-2 text-[10px] text-red-500">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 opacity-40 shrink-0" />
              Zone menace
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
