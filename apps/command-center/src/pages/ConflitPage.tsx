import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import MapGL, { Source, Layer, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import type { GeoJSONSource } from 'maplibre-gl';
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
const HAZARD_FR_SHORT: Record<string, string> = {
  flood: 'Inondation', landslide: 'Glissement', mass_displacement: 'Déplacement',
  humanitarian_crisis: 'Crise hum.', health_epidemic: 'Épidémie',
  volcanic_eruption: 'Volcan', drought: 'Sécheresse', fire: 'Incendie',
  conflict: 'Conflit', earthquake: 'Séisme', other: 'Autre',
};

const EVENT_TYPE_FR: Record<string, string> = {
  conflict: 'Conflit armé', armed_clashes: 'Affrontements armés',
  violence_civilians: 'Violence contre civils', explosion_remote: 'Explosion/Mine',
  protests: 'Manifestation', abduction: 'Enlèvement', other: 'Autre',
};

const EVENT_ICONS: Record<string, string> = {
  conflict: '⚔️', armed_clashes: '💥', violence_civilians: '👥',
  explosion_remote: '💣', protests: '📢', abduction: '🔗', other: '⚠️',
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

// ── Narrative summary ──────────────────────────────────────────────────────

function generateNarrativeSummary(
  event: ConflictEvent,
  corridors: EnhancedCorridor[],
  prediction: DisplacementPrediction | null,
  actors: ArmedActorRef[],
): string {
  const loc = [event.territoire, event.province].filter(Boolean).join(', ') || event.p_code || 'zone inconnue';
  const sev = SEV_LABEL[event.severity] ?? `S${event.severity}`;
  const type = EVENT_TYPE_FR[event.event_type] ?? event.event_type;
  const ago = formatDistanceToNow(new Date(event.event_date), { addSuffix: true, locale: fr });

  let s = `Incident de type « ${type} » (${sev}) signalé ${ago} à ${loc}.`;

  if (event.fatalities_reported && event.fatalities_reported > 0)
    s += ` ${event.fatalities_reported} victime${event.fatalities_reported > 1 ? 's' : ''} rapportée${event.fatalities_reported > 1 ? 's' : ''}.`;

  if (actors.length > 0)
    s += ` Groupe documenté : ${actors[0].nom_acled}${actors.length > 1 ? ` (+${actors.length - 1})` : ''}.`;

  const inbound = corridors.filter(c => c.destination === event.province || c.destination === event.p_code).length;
  if (inbound > 0)
    s += ` ${inbound} corridor${inbound > 1 ? 's' : ''} de mouvement convergent${inbound > 1 ? 's' : ''} vers cette zone.`;

  if (prediction && prediction.displaced_estimate_high > 0) {
    const lo = (prediction.displaced_estimate_low / 1000).toFixed(0);
    const hi = (prediction.displaced_estimate_high / 1000).toFixed(0);
    s += ` IA prédit ${lo}k–${hi}k déplacés sur ${prediction.horizon_days}j (conf. ${Math.round(prediction.confidence * 100)}%).`;
  } else if (event.displacement_risk >= 0.6) {
    s += ` Risque élevé de déplacement (${Math.round(event.displacement_risk * 100)}%).`;
  }

  return s;
}

// ── SitRep PDF ─────────────────────────────────────────────────────────────

function printSitRep(
  events: ConflictEvent[],
  earlyWarnings: EarlyWarning[],
  threatPredictions: ThreatPrediction[],
  predictions: DisplacementPrediction[],
  corridors: EnhancedCorridor[],
  horizon: number,
): void {
  const win = window.open('', '_blank', 'width=820,height=700');
  if (!win) return;
  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const provincesCount = new Set(events.map(e => e.p_code || e.province)).size;

  const warningRows = earlyWarnings.map(w => `
    <tr>
      <td>${w.province}</td>
      <td class="lvl-${w.level}">${({ red:'CRITIQUE', orange:'ALERTE', yellow:'VIGILANCE', green:'NORMAL' } as Record<string,string>)[w.level]}</td>
      <td>${w.message}</td>
      <td style="font-size:9pt;color:#555">${w.indicators.join(' · ')}</td>
    </tr>`).join('');

  const threatRows = threatPredictions.map(t => `
    <tr>
      <td style="text-align:center;font-weight:bold">${t.rank}</td>
      <td>${t.target}</td>
      <td style="font-weight:bold;color:#dc2626">${t.riskScore}%</td>
      <td>${t.confidence}%</td>
      <td style="font-size:9pt;color:#555">${t.reasons.slice(0, 2).join(' · ')}</td>
    </tr>`).join('');

  const predRows = [...predictions]
    .sort((a, b) => b.displaced_estimate_high - a.displaced_estimate_high)
    .map(p => `
    <tr>
      <td>${p.province}</td>
      <td>${Math.round(p.displaced_estimate_low / 1000)}k – ${Math.round(p.displaced_estimate_high / 1000)}k</td>
      <td>${p.horizon_days}j</td>
      <td>${Math.round(p.confidence * 100)}%</td>
    </tr>`).join('');

  const corrRows = corridors.slice(0, 8).map(c => `
    <tr>
      <td>${c.origin}</td>
      <td>${c.destination}</td>
      <td>S${c.severity}</td>
      <td>${c.confidence}%</td>
      <td>${c.daysDiff.toFixed(1)}j</td>
    </tr>`).join('');

  win.document.write(`<!DOCTYPE html><html lang="fr"><head>
<meta charset="UTF-8">
<title>SitRep Conflits — ${dateStr}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:11pt;color:#111;max-width:800px;margin:0 auto;padding:24px}
  h1{font-size:17pt;margin:4px 0}
  h2{font-size:12pt;border-bottom:2px solid #dc2626;padding-bottom:4px;margin:22px 0 8px;color:#111}
  .badge{display:inline-block;background:#dc2626;color:#fff;padding:3px 10px;border-radius:4px;font-size:9pt;font-weight:bold;letter-spacing:.05em}
  .meta{font-size:9pt;color:#555;margin-top:6px}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}
  .stat{background:#f8f8f8;border:1px solid #e5e5e5;border-radius:8px;padding:12px;text-align:center}
  .stat-val{font-size:26pt;font-weight:bold;color:#dc2626;line-height:1}
  .stat-label{font-size:8pt;color:#777;text-transform:uppercase;margin-top:4px}
  table{width:100%;border-collapse:collapse;margin-top:6px;font-size:10pt}
  th{background:#f0f0f0;text-align:left;padding:6px 8px;font-size:9pt;border:1px solid #ddd}
  td{padding:5px 8px;border-bottom:1px solid #eee;vertical-align:top}
  .lvl-red{color:#dc2626;font-weight:bold}
  .lvl-orange{color:#ea580c;font-weight:bold}
  .lvl-yellow{color:#ca8a04;font-weight:bold}
  .footer{margin-top:32px;font-size:8pt;color:#aaa;border-top:1px solid #eee;padding-top:10px;text-align:center}
  @media print{body{padding:10px}button{display:none}}
</style>
</head><body>
<div style="display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #dc2626;padding-bottom:12px;margin-bottom:18px">
  <div>
    <div class="badge">🔒 RESTREINT — USAGE HUMANITAIRE OPÉRATIONNEL</div>
    <h1>⚔️ Rapport de Situation — Surveillance Conflits RDC</h1>
    <div class="meta">SINAUR-RDC · Agent 9 · ${dateStr} à ${timeStr} · Fenêtre : ${horizon} jours</div>
    <div class="meta" style="margin-top:2px">Sources : ACLED · OCHA · MONUSCO · ICG</div>
  </div>
  <button onclick="window.print()" style="background:#dc2626;color:#fff;border:none;padding:10px 18px;border-radius:6px;font-size:11pt;cursor:pointer;font-weight:bold">🖨 Imprimer</button>
</div>

<div class="stats">
  <div class="stat"><div class="stat-val">${events.length}</div><div class="stat-label">Incidents</div></div>
  <div class="stat"><div class="stat-val">${provincesCount}</div><div class="stat-label">Provinces</div></div>
  <div class="stat"><div class="stat-val">${corridors.length}</div><div class="stat-label">Corridors</div></div>
  <div class="stat" style="border-color:${earlyWarnings.filter(w=>w.level==='red').length>0?'#dc2626':'#e5e5e5'}">
    <div class="stat-val" style="color:${earlyWarnings.filter(w=>w.level==='red').length>0?'#dc2626':'#f97316'}">${earlyWarnings.filter(w => w.level === 'red').length}</div>
    <div class="stat-label">CRITIQUE</div>
  </div>
</div>

${earlyWarnings.length > 0 ? `<h2>⚠️ Alertes précoces actives (${earlyWarnings.length})</h2>
<table><tr><th>Province</th><th>Niveau</th><th>Message</th><th>Indicateurs</th></tr>${warningRows}</table>` : ''}

${threatPredictions.length > 0 ? `<h2>🎯 Zones de menace prioritaires (IA)</h2>
<table><tr><th>#</th><th>Province</th><th>Score risque</th><th>Confiance</th><th>Facteurs déterminants</th></tr>${threatRows}</table>` : ''}

${predictions.length > 0 ? `<h2>🏃 Prédictions de déplacement</h2>
<table><tr><th>Province</th><th>Population à risque</th><th>Horizon</th><th>Confiance</th></tr>${predRows}</table>` : ''}

${corridors.length > 0 ? `<h2>🗺 Corridors de mouvement actifs (${corridors.length})</h2>
<table><tr><th>Origine</th><th>Destination</th><th>Sévérité</th><th>Confiance</th><th>Intervalle</th></tr>${corrRows}</table>` : ''}

<div class="footer">
  Document classifié RESTREINT — Ne pas diffuser sans autorisation du coordinateur national<br>
  Généré automatiquement par SINAUR-RDC · Système National d'Alerte et de Réponse aux Sinistres
</div>
</body></html>`);
  win.document.close();
  win.focus();
}

// ── Helpers ────────────────────────────────────────────────────────────────

function lngLatToTile(lng: number, lat: number, z: number) {
  const n = Math.pow(2, z);
  const x = Math.floor((lng + 180) / 360 * n);
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x, y };
}

const esriTile = (z: number, y: number, x: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

function SatelliteMosaic({ lng, lat, zoom = 11 }: { lng: number; lat: number; zoom?: number }) {
  const { x, y } = lngLatToTile(lng, lat, zoom);
  return (
    <div className="relative w-full h-36 overflow-hidden bg-cc-900 shrink-0">
      <div className="grid grid-cols-3 absolute inset-0" style={{ gridTemplateRows: 'repeat(3,1fr)' }}>
        {[-1, 0, 1].flatMap(dy =>
          [-1, 0, 1].map(dx => (
            <img
              key={`${dx},${dy}`}
              src={esriTile(zoom, y + dy, x + dx)}
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
          <div className="w-5 h-5 rounded-full border-2 border-red-400 shadow-lg" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-px h-8 bg-red-400/80" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-px w-8 bg-red-400/80" />
        </div>
      </div>
      <div className="absolute bottom-1 right-1 text-[8px] text-white/50 font-mono bg-black/50 px-1 rounded">
        © Esri Satellite
      </div>
    </div>
  );
}

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
  // Corroboration inter-sources
  sources_count?: number;
  sources_list?: string[];
  corroboration_score?: number;
  corroboration_detail?: string;
  needs_corroboration?: boolean;
  contradictions?: string[];
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
  steps?: string[];
  actors?: string[];
  delay?: string;
  resources?: string[];
  indicators?: string[];
}

function buildRecommendations(event: ConflictEvent): OperationalRec[] {
  const recs: OperationalRec[] = [];
  const sev = event.severity || 1;
  const risk = Math.round((event.displacement_risk || 0) * 100);
  const loc  = event.territoire ? `${event.territoire}, ${event.province}` : (event.province || event.p_code || 'zone');

  if (sev >= 4) {
    recs.push({
      category: 'security', icon: '🚨', action: 'Alerter les autorités',
      why: `Sévérité S${sev} — situation d'urgence à ${loc}`, priority: 'URGENT',
      delay: 'Immédiat (< 2h)',
      steps: [
        `Contacter le gouverneur de ${event.province || 'province'} via canal sécurisé`,
        'Notifier FARDC/PNC avec coordonnées GPS de l\'incident',
        'Activer la cellule de crise provinciale (protocole SINAUR P1)',
        'Émettre un FLASH REPORT vers le Centre de commandement national',
        'Documenter l\'heure d\'activation pour le suivi',
      ],
      actors: ['Gouverneur de province', 'FARDC', 'PNC', 'MONUSCO Force', 'Centre de commandement SINAUR'],
      resources: ['Réseau radio sécurisé (HF/VHF)', 'Annuaire d\'urgence pré-établi', 'Formulaire FLASH REPORT'],
      indicators: ['Accusé de réception des autorités < 1h', 'Cellule de crise activée confirmée', 'Personnel déployé sur site'],
    });
    recs.push({
      category: 'security', icon: '👁️', action: 'Renforcer la surveillance',
      why: 'Escalade documentée — risque de propagation', priority: 'URGENT',
      delay: '2–6h',
      steps: [
        'Déployer équipes d\'observation aux points névralgiques',
        'Activer les réseaux de sources communautaires',
        'Fréquence de rapport : toutes les 3h minimum',
        'Cartographier les axes de repli potentiels',
        'Coordonner avec MONUSCO pour couverture aérienne si disponible',
      ],
      actors: ['Agents SINAUR terrain', 'Réseau communautaire', 'MONUSCO UNPOL', 'ONG locales partenaires'],
      resources: ['Téléphones satellites', 'Fiches de rapport terrain', 'Véhicules tout-terrain'],
      indicators: ['Rapports terrain reçus toutes les 3h', 'Carte de situation mise à jour', 'Aucune zone aveugle'],
    });
  }

  if (event.displacement_risk >= 0.5) {
    recs.push({
      category: 'humanitarian', icon: '🏃', action: 'Préparer évacuation préventive',
      why: `Risque déplacement ${risk}% — population de ${loc} exposée`,
      priority: sev >= 4 ? 'URGENT' : 'ÉLEVÉ',
      delay: sev >= 4 ? 'Immédiat' : '6–12h',
      steps: [
        'Identifier les sites d\'accueil préalablement validés (capacité, eau, sécurité)',
        'Activer les équipes de protection (femmes, enfants, personnes âgées en priorité)',
        'Mettre en place des corridors d\'évacuation balisés avec escorte',
        'Préparer les listes d\'enregistrement pour le Registre des sinistrés SINAUR',
        'Coordonner avec les autorités locales pour l\'ordre d\'évacuation officiel',
        'Communiquer les points de rassemblement via radio communautaire',
      ],
      actors: ['Protection civile', 'UNHCR', 'OIM', 'Croix-Rouge RDC', 'Autorités locales'],
      resources: ['Bus et véhicules transport', 'Carburant réserve', 'Mégaphones', 'Listes d\'enregistrement'],
      indicators: [`${risk >= 70 ? 'Évacuation lancée' : 'Pré-positionnement vérifié'}`, 'Sites d\'accueil ouverts', 'Enregistrement démarré'],
    });
    recs.push({
      category: 'humanitarian', icon: '📦', action: "Déployer kits d'urgence",
      why: 'Population exposée — besoins immédiats NFI et nourriture', priority: 'ÉLEVÉ',
      delay: '12–24h',
      steps: [
        'Évaluation rapide des besoins (RRM/RRR) dans les zones affectées',
        'Activer les stocks pré-positionnés au dépôt provincial',
        'Priorité : NFI (Non-Food Items), eau potable, abris d\'urgence',
        'Cibler les ménages les plus vulnérables (femmes enceintes, enfants < 5 ans)',
        'Distribuer via points fixes sécurisés avec contrôle biométrique SINAUR',
      ],
      actors: ['PAM', 'UNICEF', 'OCHA', 'ONG terrain (MSF, IRC, NRC)'],
      resources: ['Stocks NFI pré-positionnés', 'Véhicules de distribution', 'Agents terrain', 'Système biométrique SINAUR'],
      indicators: ['Évaluation RRM complétée < 6h', 'Distribution lancée < 24h', 'Taux de couverture ≥ 80% ménages cibles'],
    });
    recs.push({
      category: 'humanitarian', icon: '🏠', action: 'Établir abris temporaires',
      why: 'Flux de déplacement attendu — capacité d\'accueil à anticiper', priority: 'MOYEN',
      delay: '24–72h',
      steps: [
        'Sélectionner 2–3 sites selon critères SPHERE (distance conflict, eau, sol)',
        'Installer bâches/tentes d\'urgence pour familles déplacées',
        'Mettre en place points d\'eau (200L/jour/personne minimum)',
        'Installer latrines (1 pour 20 personnes)',
        'Créer espace sûr pour femmes et enfants (protection GBV)',
      ],
      actors: ['UNHCR', 'Croix-Rouge RDC', 'ACTED', 'Protection civile'],
      resources: ['Bâches UNHCR', 'Matériel WASH', 'Équipes NFI'],
      indicators: ['Sites opérationnels < 48h', 'Normes SPHERE respectées', 'Enregistrement IDP lancé'],
    });
  }

  if (event.event_type === 'armed_clashes' || event.event_type === 'conflict') {
    recs.push({
      category: 'logistics', icon: '🛣️', action: "Sécuriser les corridors d'approvisionnement",
      why: 'Routes potentiellement coupées — accès humanitaire compromis', priority: 'MOYEN',
      delay: '6–24h',
      steps: [
        'Vérifier l\'état de praticabilité des axes principaux (RN1, RN2, RN4…)',
        'Identifier les itinéraires alternatifs avec distances et temps de passage',
        'Négocier avec les parties un corridor humanitaire (droit international)',
        'Organiser convois escortés si nécessaire (MONUSCO/FARDC)',
        'Mettre en place système de tracking des convois en temps réel',
      ],
      actors: ['Logisticiens OCHA', 'FARDC/escorte', 'Transporteurs locaux', 'Cluster Logistique'],
      resources: ['Cartes SIG des axes routiers', 'GPS trackers', 'Protocoles corridors humanitaires'],
      indicators: ['Axes principaux évalués < 12h', 'Premier convoi passé', 'Aucun incident de convoi'],
    });
    recs.push({
      category: 'logistics', icon: '📦', action: 'Pré-positionner stocks de secours',
      why: 'Accès humanitaire menacé — anticipation des ruptures', priority: 'MOYEN',
      delay: '24–48h',
      steps: [
        'Inventorier les stocks disponibles dans les dépôts à < 100km',
        'Calculer les besoins pour 30 jours (scénario accès coupé)',
        'Lancer commandes d\'urgence pour combler les déficits identifiés',
        'Transporter par voie aérienne si routes fermées (UNHAS)',
        'Documenter les stocks positionnés dans le système SINAUR Stocks',
      ],
      actors: ['Cluster Logistique', 'UNHAS', 'PAM Supply Chain', 'Fournisseurs locaux'],
      resources: ['Budget d\'urgence', 'Capacité de stockage sécurisée', 'UNHAS si disponible'],
      indicators: ['Stocks 30j confirmés < 48h', 'Commandes lancées', 'Positionnement documenté'],
    });
  }

  recs.push({
    category: 'coordination', icon: '📡', action: 'Notifier les partenaires OCHA',
    why: 'Coordination inter-agences requise — incident à impact multi-sectoriel', priority: 'MOYEN',
    delay: '< 6h',
    steps: [
      'Envoyer SITREP initial via le portail OCHA (format standard 5W)',
      'Notifier les clusters concernés (Protection, Abris, WASH, Nutrition)',
      'Convoquer une réunion de coordination inter-agences d\'urgence',
      'Partager les données SINAUR (incidents, déplacés) avec tous les acteurs',
      'Établir un point de contact unique pour la réponse coordonnée',
    ],
    actors: ['OCHA RDC', 'Clusters humanitaires', 'ONG partenaires', 'Agences ONU'],
    resources: ['Portail OCHA RDC', 'Liste de diffusion clusters', 'Modèle SITREP 5W'],
    indicators: ['SITREP envoyé < 6h', 'Réunion de coordination tenue < 24h', 'Plan de réponse commun adopté'],
  });

  if (sev >= 3) {
    recs.push({
      category: 'coordination', icon: '🏛️', action: 'Activer le comité de crise',
      why: sev >= 4 ? 'Urgence déclarée — protocole SINAUR niveau ROUGE' : 'Escalade potentielle — protocole niveau ORANGE',
      priority: sev >= 4 ? 'URGENT' : 'MOYEN',
      delay: sev >= 4 ? 'Immédiat' : '< 12h',
      steps: [
        `Déclencher protocole ${sev >= 4 ? 'ROUGE' : 'ORANGE'} selon manuel SINAUR`,
        'Convoquer les membres du comité (gouverneur, sécurité, humanitaire, technique)',
        'Établir une salle de crise avec flux d\'information en temps réel',
        'Désigner un coordinateur de crise et un porte-parole officiel',
        'Planifier des points de situation toutes les 6h minimum',
        'Préparer la communication publique pour éviter les mouvements de panique',
      ],
      actors: ['Gouverneur de province', 'Ministère de l\'Intérieur', 'FARDC', 'Coordination humanitaire', 'SINAUR Centre national'],
      resources: ['Salle de crise SINAUR', 'Tableau de bord temps réel', 'Plan de crise provincial', 'Budget d\'urgence déclenché'],
      indicators: ['Comité réuni < 2h', 'Salle de crise opérationnelle', 'Premier point de situation diffusé', 'Porte-parole désigné'],
    });
  }

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

// ── RecsList ───────────────────────────────────────────────────────────────

function RecsList({ recommendations }: { recommendations: OperationalRec[] }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  return (
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
              {recs.map((r, i) => {
                const key      = `${priority}-${i}`;
                const isOpen   = expandedKey === key;
                const hasDetail = !!(r.steps?.length || r.actors?.length || r.delay || r.indicators?.length);
                return (
                  <div key={key} className={`rounded-lg border overflow-hidden transition-all ${PRIORITY_COLOR[priority]}`}>
                    {/* Header — always visible, clickable */}
                    <button
                      className="w-full px-2.5 py-2 flex items-start gap-2 text-left hover:bg-white/5 transition-colors"
                      onClick={() => hasDetail && setExpandedKey(isOpen ? null : key)}
                    >
                      <span className="text-sm shrink-0 mt-px">{r.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className={`text-[10px] font-medium ${CAT_COLOR[r.category]}`}>{CAT_LABEL[r.category]}</div>
                        <div className="text-[11px] text-gray-200 font-semibold leading-tight">{r.action}</div>
                        <div className="text-[9px] text-cc-500 font-mono mt-0.5 leading-relaxed">{r.why}</div>
                        {r.delay && (
                          <div className="text-[8px] font-mono mt-1 flex items-center gap-1">
                            <span className="text-cc-600">⏱</span>
                            <span className={priority === 'URGENT' ? 'text-red-400' : priority === 'ÉLEVÉ' ? 'text-orange-400' : 'text-yellow-500'}>
                              {r.delay}
                            </span>
                          </div>
                        )}
                      </div>
                      {hasDetail && (
                        <span className="text-cc-600 text-[9px] shrink-0 mt-1">{isOpen ? '▲' : '▼'}</span>
                      )}
                    </button>

                    {/* Expanded detail */}
                    {isOpen && hasDetail && (
                      <div className="px-3 pb-3 pt-1 border-t border-white/10 space-y-2.5">

                        {/* Steps */}
                        {r.steps && r.steps.length > 0 && (
                          <div>
                            <div className="text-[8px] font-mono text-cc-500 uppercase tracking-wider mb-1.5">Étapes d'exécution</div>
                            <ol className="space-y-1">
                              {r.steps.map((s, si) => (
                                <li key={si} className="flex items-start gap-2 text-[9px] text-cc-300 leading-relaxed">
                                  <span className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold font-mono mt-0.5 ${
                                    priority === 'URGENT' ? 'bg-red-900/60 text-red-300' :
                                    priority === 'ÉLEVÉ'  ? 'bg-orange-900/60 text-orange-300' :
                                    'bg-yellow-900/40 text-yellow-400'
                                  }`}>{si + 1}</span>
                                  {s}
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}

                        {/* Actors */}
                        {r.actors && r.actors.length > 0 && (
                          <div>
                            <div className="text-[8px] font-mono text-cc-500 uppercase tracking-wider mb-1">Acteurs responsables</div>
                            <div className="flex flex-wrap gap-1">
                              {r.actors.map((a, ai) => (
                                <span key={ai} className="text-[8px] font-mono px-1.5 py-0.5 bg-cc-900/60 text-cc-300 border border-cc-700 rounded">
                                  {a}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Resources */}
                        {r.resources && r.resources.length > 0 && (
                          <div>
                            <div className="text-[8px] font-mono text-cc-500 uppercase tracking-wider mb-1">Ressources nécessaires</div>
                            <ul className="space-y-0.5">
                              {r.resources.map((res, ri) => (
                                <li key={ri} className="text-[9px] text-cc-400 font-mono flex items-center gap-1.5">
                                  <span className="text-cc-700">◦</span>{res}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Indicators */}
                        {r.indicators && r.indicators.length > 0 && (
                          <div>
                            <div className="text-[8px] font-mono text-cc-500 uppercase tracking-wider mb-1">Indicateurs de succès</div>
                            <ul className="space-y-0.5">
                              {r.indicators.map((ind, ii) => (
                                <li key={ii} className="text-[9px] text-green-400/80 font-mono flex items-center gap-1.5">
                                  <span className="text-green-700">✓</span>{ind}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── CorroborationBadge ─────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  acled:                  'ACLED',
  ucdp_ged:               'UCDP GED',
  gdelt:                  'GDELT',
  kivu_security_tracker:  'KST',
  ocha_drc:               'OCHA',
  ocha_hdx:               'HDX',
  ohchr:                  'OHCHR',
  unhcr:                  'UNHCR',
  iom_dtm:                'IOM DTM',
  monusco:                'MONUSCO',
  reliefweb:              'ReliefWeb',
  reliefweb_conflict:     'ReliefWeb',
  radio_okapi:            'Radio Okapi',
  sinaur_agents:          'Agents SINAUR',
  api:                    'Base SINAUR',
  veille:                 'Veille auto',
};

function CorroborationBadge({ event }: { event: ConflictEvent }) {
  const n     = event.sources_count ?? 1;
  const score = event.corroboration_score ?? 0;
  const list  = event.sources_list ?? [event.source];
  const needs = event.needs_corroboration ?? false;
  const contrs= event.contradictions ?? [];

  const level = n >= 4 ? 'maximale' : n >= 3 ? 'élevée' : n >= 2 ? 'confirmée' : 'à vérifier';
  const colors: Record<string, string> = {
    maximale:   'border-green-700 bg-green-950/40 text-green-300',
    élevée:     'border-emerald-700 bg-emerald-950/30 text-emerald-300',
    confirmée:  'border-blue-700 bg-blue-950/30 text-blue-300',
    'à vérifier': needs ? 'border-yellow-700 bg-yellow-950/30 text-yellow-300' : 'border-cc-700 bg-cc-900/20 text-cc-400',
  };

  const hasAcled = list.includes('acled');
  const hasUcdp  = list.includes('ucdp_ged');

  return (
    <div className={`rounded-lg border px-2.5 py-2 text-[9px] font-mono space-y-1 ${colors[level]}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold uppercase tracking-wider">
          🔍 Fiabilité {level}
        </span>
        <span className="text-[10px] font-bold">{Math.round(Math.min(1, 0.5 + score) * 100)}%</span>
      </div>

      <div className="flex flex-wrap gap-1">
        {list.map(src => (
          <span key={src}
            className="px-1 py-0.5 rounded bg-cc-800/60 border border-cc-700 text-cc-300 text-[8px]">
            {SOURCE_LABELS[src] ?? src}
          </span>
        ))}
      </div>

      {hasAcled && hasUcdp && (
        <div className="text-green-400 text-[8px]">✓ ACLED + UCDP concordent — donnée de référence</div>
      )}

      {needs && (
        <div className="text-yellow-400 text-[8px]">⚠ Signal précoce — à corroborer avant décision</div>
      )}

      {contrs.length > 0 && (
        <div className="text-orange-400 text-[8px]">⚠ {contrs[0]}</div>
      )}
    </div>
  );
}

// ── ConflictPopup ──────────────────────────────────────────────────────────

interface ConflictPopupProps {
  event: ConflictEvent;
  pixel: { x: number; y: number };
  prediction: DisplacementPrediction | null;
  relatedCorridors: EnhancedCorridor[];
  actors: ArmedActorRef[];
  onClose: () => void;
  onOpenPanel: () => void;
}

function ConflictPopup({ event, pixel, prediction, relatedCorridors, actors, onClose, onOpenPanel }: ConflictPopupProps) {
  const narrative = generateNarrativeSummary(event, relatedCorridors, prediction, actors);
  const color     = SEV_COLOR[event.severity] ?? '#6b7280';
  const icon      = EVENT_ICONS[event.event_type] ?? '⚠️';
  const typeLabel = EVENT_TYPE_FR[event.event_type] ?? event.event_type;
  const flipX     = pixel.x > (window.innerWidth - 320) * 0.5;
  const flipY     = pixel.y > window.innerHeight * 0.60;

  return (
    <div
      className="absolute z-40 w-72 bg-cc-950/99 border rounded-xl shadow-2xl backdrop-blur-md overflow-hidden pointer-events-auto"
      style={{
        left:        pixel.x,
        top:         pixel.y,
        borderColor: color + '60',
        transform:   `translate(${flipX ? 'calc(-100% - 10px)' : '12px'}, ${flipY ? 'calc(-100% + 10px)' : '-20px'})`,
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="px-3 pt-2.5 pb-2 border-b" style={{ borderColor: color + '40', background: color + '12' }}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base shrink-0">{icon}</span>
            <div className="min-w-0">
              <div className="text-white text-[12px] font-bold leading-tight truncate">
                {event.territoire ? `${event.territoire} · ` : ''}{event.province || event.p_code}
              </div>
              <div className="text-[10px] font-mono mt-0.5" style={{ color }}>
                S{event.severity} — {SEV_LABEL[event.severity] ?? ''} · {typeLabel}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-5 h-5 rounded-full bg-cc-800/80 text-cc-400 hover:text-white text-xs flex items-center justify-center shrink-0 mt-0.5"
          >×</button>
        </div>
      </div>

      {/* Narrative */}
      <div className="px-3 py-2.5 border-b border-cc-800">
        <p className="text-[10px] text-cc-300 leading-relaxed">{narrative}</p>
      </div>

      {/* Corroboration */}
      <div className="px-3 py-2 border-b border-cc-800">
        <CorroborationBadge event={event} />
      </div>

      {/* Actors */}
      {actors.length > 0 && (
        <div className="px-3 py-2 border-b border-cc-800">
          <div className="text-[9px] font-mono text-red-400 uppercase tracking-wider mb-1.5">Groupes armés documentés</div>
          <div className="space-y-1">
            {actors.slice(0, 2).map(a => (
              <div key={a.nom_acled} className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-red-300 font-bold truncate">{a.nom_acled}</span>
                <span className={`text-[8px] font-mono px-1 py-0.5 rounded border shrink-0 ${
                  a.facteur_amplification_deplacement >= 1.4 ? 'text-red-400 border-red-800 bg-red-900/30' : 'text-orange-400 border-orange-800 bg-orange-900/30'
                }`}>×{a.facteur_amplification_deplacement.toFixed(2)}</span>
              </div>
            ))}
            {actors.length > 2 && (
              <div className="text-[9px] text-cc-600 font-mono">+{actors.length - 2} groupe{actors.length - 2 > 1 ? 's' : ''}</div>
            )}
          </div>
        </div>
      )}

      {/* Corridor visual */}
      {relatedCorridors.length > 0 && (
        <div className="px-3 py-2 border-b border-cc-800">
          <div className="text-[9px] font-mono text-blue-400 uppercase tracking-wider mb-1.5">Corridor de mouvement</div>
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className="text-cc-300 truncate max-w-[5rem]">{relatedCorridors[0].origin}</span>
            <span className="text-cc-500 shrink-0">——▶</span>
            <span className="text-gray-200 font-bold truncate flex-1">{relatedCorridors[0].destination}</span>
            <span className="text-cc-500 font-mono ml-auto shrink-0 text-[9px]">{relatedCorridors[0].confidence}%</span>
          </div>
          {relatedCorridors.length > 1 && (
            <div className="text-[9px] text-cc-600 font-mono mt-0.5">+{relatedCorridors.length - 1} autre{relatedCorridors.length - 1 > 1 ? 's' : ''}</div>
          )}
        </div>
      )}

      {/* Displacement prediction */}
      {prediction && (
        <div className="px-3 py-2 border-b border-cc-800">
          <div className="text-[9px] font-mono text-orange-400 uppercase tracking-wider mb-1.5">
            Prédiction déplacement — {prediction.horizon_days}j
          </div>
          <div className="flex items-center justify-between text-[10px] mb-1">
            <span className="text-orange-300 font-bold font-mono">
              {(prediction.displaced_estimate_low / 1000).toFixed(0)}k – {(prediction.displaced_estimate_high / 1000).toFixed(0)}k pers.
            </span>
            <span className="text-cc-500 font-mono text-[9px]">{Math.round(prediction.confidence * 100)}% conf.</span>
          </div>
          <div className="h-0.5 bg-cc-700 rounded-full">
            <div className="h-full bg-orange-500 rounded-full" style={{ width: `${prediction.confidence * 100}%` }} />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="px-3 py-2 flex gap-2">
        <button
          onClick={onOpenPanel}
          className="flex-1 py-1.5 bg-cc-800 hover:bg-cc-700 border border-cc-600 text-gray-200 text-[10px] font-mono font-bold rounded-lg transition-colors"
        >
          Voir détail →
        </button>
        <a
          href={`/crises/new?type=conflict&event_id=${encodeURIComponent(event.external_id)}`}
          className="flex-1 py-1.5 bg-red-900/70 hover:bg-red-800 border border-red-700 text-red-100 text-[10px] font-mono font-bold rounded-lg transition-colors text-center"
          onClick={e => e.stopPropagation()}
        >
          + Créer crise
        </a>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getGeoBounds(geometry: GeoJSON.Geometry): [[number, number], [number, number]] | null {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const walk = (c: any) => {
    if (typeof c[0] === 'number') {
      if (c[0] < minLng) minLng = c[0]; if (c[0] > maxLng) maxLng = c[0];
      if (c[1] < minLat) minLat = c[1]; if (c[1] > maxLat) maxLat = c[1];
    } else { c.forEach(walk); }
  };
  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') walk((geometry as any).coordinates);
  else return null;
  return isFinite(minLng) ? [[minLng, minLat], [maxLng, maxLat]] : null;
}

// ── Component ──────────────────────────────────────────────────────────────

export function ConflitPage() {
  const mapRef = useRef<MapRef>(null);
  const { tokens } = useAuthStore();

  // ── State ─────────────────────────────────────────────────────────────
  const [horizon, setHorizon]                   = useState<HorizonDays>(30);
  const [showCorridors, setShowCorridors]       = useState(true);
  const [showPredictionLayer, setShowPrediction] = useState(false);
  const [selectedId, setSelectedId]             = useState<string | null>(null);
  const [selectedCorridorId, setCorridorId]     = useState<string | null>(null);
  const [activeTab, setActiveTab]               = useState<SidebarTab>('incidents');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [warnOpen, setWarnOpen]                 = useState(true);
  const [predOpen, setPredOpen]                 = useState(false);
  const [replayMode, setReplayMode]             = useState(false);
  const [replayIndex, setReplayIndex]           = useState(0);
  const [expandedActorId, setExpandedActorId]   = useState<string | null>(null);
  const [detailTab, setDetailTab]               = useState<'info' | 'acteurs' | 'recs'>('info');
  const [panelVisible, setPanelVisible]         = useState(false);
  const [corridorTooltip, setCorridorTooltip]   = useState<{
    x: number; y: number; origin: string; destination: string; confidence: number; daysDiff: number;
  } | null>(null);
  const [popupPixel, setPopupPixel]             = useState<{ x: number; y: number } | null>(null);
  const [listFilter, setListFilter]             = useState('');
  const [sevFilter, setSevFilter]               = useState<number | null>(null);
  const [minSourcesFilter, setMinSourcesFilter] = useState<1 | 2 | 3>(1);
  const [provincePinned, setProvincePinned]     = useState<{ pcode: string; name: string } | null>(null);
  const [hoveredProvince, setHoveredProvince]   = useState<{ pcode: string; name: string; x: number; y: number } | null>(null);
  const selectedItemRef                         = useRef<HTMLDivElement | null>(null);

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
    refetchInterval: 10 * 60_000,
  });

  const { data: actorsData } = useQuery({
    queryKey: ['conflit-actors'],
    queryFn: () => apiClient.get('/conflit/actors').then(r => r.data).catch(() => ({ actors: [] })),
    staleTime: 30 * 60_000,
  });

  const { data: corrData } = useQuery({
    queryKey: ['corr-events', selectedId],
    queryFn: () => {
      const ev = allEvents.find(e => e.external_id === selectedId);
      const pcode = ev?.p_code || '';
      if (!pcode) return Promise.resolve({ data: [] });
      const params = new URLSearchParams({ province: pcode, limit: '6',
        dateFrom: new Date(Date.now() - 30 * 86400000).toISOString() });
      return apiClient.get(`/events?${params}`).then(r => r.data).catch(() => ({ data: [] }));
    },
    enabled: !!selectedId,
    staleTime: 10 * 60_000,
  });

  const { data: divisionsGeo = [] } = useQuery({
    queryKey: ['cc-divisions-geo'],
    queryFn: () => apiClient.get('/geo/divisions?level=1&withGeometry=true').then(r => r.data.data),
    staleTime: 60 * 60_000,
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

  useEffect(() => {
    if (!selectedId && !selectedCorridorId) {
      setPanelVisible(false);
      return;
    }
    const t = setTimeout(() => setPanelVisible(true), 10);
    return () => clearTimeout(t);
  }, [selectedId, selectedCorridorId]);

  useEffect(() => {
    const h = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      if (popupPixel) { setPopupPixel(null); return; }
      setSelectedId(null);
      setCorridorId(null);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [popupPixel]);

  useEffect(() => {
    if (selectedId && selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedId]);

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
    const origins: GeoJSON.Feature[] = [];
    const destinations: GeoJSON.Feature[] = [];
    for (const c of enhancedCorridors) {
      lines.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [c.originCoords, c.destCoords] },
        properties: { color: c.color, severity: c.severity, corridorId: c.id, confidence: c.confidence, origin: c.origin, destination: c.destination, daysDiff: c.daysDiff },
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
      origins.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: c.originCoords },
        properties: { label: c.origin, color: c.color, corridorId: c.id },
      });
      destinations.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: c.destCoords },
        properties: { label: c.destination, color: c.color, corridorId: c.id },
      });
    }
    return {
      lines:        { type: 'FeatureCollection' as const, features: lines },
      arrows:       { type: 'FeatureCollection' as const, features: arrows },
      origins:      { type: 'FeatureCollection' as const, features: origins },
      destinations: { type: 'FeatureCollection' as const, features: destinations },
    };
  }, [enhancedCorridors]);

  // ── Province fill GeoJSON (colored by conflict density) ─────────────
  const provinceFillGeoJSON = useMemo(() => {
    const countByPcode = new Map<string, { count: number; maxSev: number }>();
    for (const e of events) {
      const p = e.p_code || '';
      if (!p) continue;
      const cur = countByPcode.get(p) ?? { count: 0, maxSev: 0 };
      countByPcode.set(p, { count: cur.count + 1, maxSev: Math.max(cur.maxSev, e.severity || 1) });
    }
    return {
      type: 'FeatureCollection' as const,
      features: (divisionsGeo as any[]).filter(d => d.geometry).map(d => ({
        type: 'Feature' as const, geometry: d.geometry,
        properties: {
          pcode:       d.pcode,
          name:        d.name,
          eventCount:  countByPcode.get(d.pcode)?.count ?? 0,
          maxSeverity: countByPcode.get(d.pcode)?.maxSev ?? 0,
        },
      })),
    };
  }, [divisionsGeo, events]);

  // ── Events GeoJSON (individual points, clustered by MapLibre) ────────
  const eventsGeoJSON = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: visibleEvents.flatMap(ev => {
      const c = getCentroid(ev);
      if (!c) return [];
      return [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: c },
        properties: {
          id:               ev.external_id,
          province:         ev.province || ev.p_code || '',
          severity:         ev.severity || 1,
          color:            SEV_COLOR[ev.severity || 1] ?? '#6b7280',
          displacement_risk: ev.displacement_risk || 0,
        } }];
    }),
  }), [visibleEvents]);

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
        properties: { riskScore: t.riskScore, province: t.target, rank: t.rank } }];
    }),
  }), [threatPredictions, events]);

  // ── Sorted events & stats ─────────────────────────────────────────────
  const sortedEvents = useMemo(() =>
    [...events].sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime()),
    [events],
  );

  const filteredSortedEvents = useMemo(() => {
    let res = sortedEvents;
    if (provincePinned) res = res.filter(e => e.p_code === provincePinned.pcode);
    if (sevFilter !== null) res = res.filter(e => (e.severity || 1) === sevFilter);
    if (minSourcesFilter >= 2) {
      res = res.filter(e => {
        const n = e.sources_count ?? 1;
        if (n < minSourcesFilter) return false;
        if (minSourcesFilter >= 3 && e.needs_corroboration) return false;
        return true;
      });
    }
    if (listFilter.trim()) {
      const q = listFilter.toLowerCase();
      res = res.filter(e =>
        (e.province ?? '').toLowerCase().includes(q) ||
        (e.territoire ?? '').toLowerCase().includes(q) ||
        (EVENT_TYPE_FR[e.event_type] ?? e.event_type ?? '').toLowerCase().includes(q) ||
        (e.p_code ?? '').toLowerCase().includes(q),
      );
    }
    return res;
  }, [sortedEvents, listFilter, sevFilter, provincePinned, minSourcesFilter]);

  const affectedProvinces = useMemo(() => new Set(events.map(e => e.p_code || e.province)).size, [events]);

  // ── Timeline histogram (incidents per day bucket) ─────────────────────
  const timelineHistogram = useMemo(() => {
    const now = Date.now();
    const buckets: { label: string; count: number; maxSev: number }[] = [];
    const step = horizon <= 7 ? 1 : horizon <= 14 ? 1 : 3;
    for (let d = horizon; d > 0; d -= step) {
      const from = now - d * 86400000;
      const to   = now - (d - step) * 86400000;
      const bucket = events.filter(e => {
        const t = new Date(e.event_date).getTime();
        return t >= from && t < to;
      });
      buckets.push({
        label:  format(new Date(from), d > 3 ? 'dd/MM' : 'dd', { locale: fr }),
        count:  bucket.length,
        maxSev: bucket.length > 0 ? Math.max(...bucket.map(e => e.severity || 1)) : 0,
      });
    }
    return buckets;
  }, [events, horizon]);

  // ── Province pinned stats ─────────────────────────────────────────────
  const provincePinnedStats = useMemo(() => {
    if (!provincePinned) return null;
    const provEvents = events.filter(e => e.p_code === provincePinned.pcode);
    if (provEvents.length === 0) return null;
    const maxSev  = Math.max(...provEvents.map(e => e.severity || 1));
    const avgRisk = provEvents.reduce((s, e) => s + (e.displacement_risk || 0), 0) / provEvents.length;
    const pLower  = provincePinned.name.toLowerCase();
    const provActors = actors.filter(a =>
      a.provinces_actives_historique.some(p => pLower.includes(p.toLowerCase())),
    ).length;
    const provCorridors = enhancedCorridors.filter(c =>
      c.origin === provincePinned.name || c.destination === provincePinned.name ||
      provEvents.some(e => c.origin === (e.province || e.p_code) || c.destination === (e.province || e.p_code)),
    ).length;
    return { count: provEvents.length, maxSev, avgRisk, actors: provActors, corridors: provCorridors };
  }, [provincePinned, events, actors, enhancedCorridors]);

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

  const selectedPrediction = useMemo(() => {
    if (!selectedEvent) return null;
    const prov = selectedEvent.province || selectedEvent.p_code || '';
    return predictions.find(p => p.province === prov || p.province === selectedEvent.p_code) ?? null;
  }, [selectedEvent, predictions]);

  const relatedCorridors = useMemo(() => {
    if (!selectedEvent) return [];
    const prov = selectedEvent.province || selectedEvent.p_code || '';
    return enhancedCorridors.filter(c => c.origin === prov || c.destination === prov).slice(0, 3);
  }, [selectedEvent, enhancedCorridors]);

  const corrEvents: any[] = corrData?.data ?? [];

  // ── CSV export ────────────────────────────────────────────────────────
  const exportCSV = useCallback(() => {
    const headers = ['ID', 'Date', 'Province', 'Territoire', 'Type', 'Sévérité', 'Victimes', 'Risque déplacement', 'Lat', 'Lng'];
    const rows = filteredSortedEvents.map(e => {
      const c = getCentroid(e);
      return [
        e.external_id ?? '',
        format(new Date(e.event_date), 'yyyy-MM-dd HH:mm', { locale: fr }),
        e.province ?? '',
        e.territoire ?? '',
        EVENT_TYPE_FR[e.event_type] ?? e.event_type ?? '',
        e.severity ?? '',
        e.fatalities_reported ?? '',
        e.displacement_risk != null ? Math.round(e.displacement_risk * 100) + '%' : '',
        c ? c[1].toFixed(4) : '',
        c ? c[0].toFixed(4) : '',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });
    const csv  = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `sinaur-conflits-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredSortedEvents]);

  // ── Map click ─────────────────────────────────────────────────────────
  const onMapClick = useCallback((e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) { setSelectedId(null); setCorridorId(null); setPopupPixel(null); return; }

    // Cluster click → zoom to expansion zoom
    if (f.properties?.point_count !== undefined) {
      const map = mapRef.current?.getMap();
      const src = map?.getSource('events') as GeoJSONSource | undefined;
      if (src) {
        src.getClusterExpansionZoom(f.properties.cluster_id as number).then(zoom => {
          map?.easeTo({
            center: (f.geometry as GeoJSON.Point).coordinates as [number, number],
            zoom: zoom + 0.5,
            duration: 500,
          });
        }).catch(() => {/* ignore */});
      }
      return;
    }

    // Corridor arrow or endpoint clicked
    const corridorId = f.properties?.corridorId as string | undefined;
    if (corridorId) {
      setCorridorId(corridorId === selectedCorridorId ? null : corridorId);
      setSelectedId(null);
      setPopupPixel(null);
      return;
    }

    // Individual unclustered event clicked → show floating popup
    const eventId = f.properties?.id as string | undefined;
    if (eventId) {
      const match = sortedEvents.find(ev => ev.external_id === eventId);
      if (match) {
        if (eventId === selectedId) {
          setSelectedId(null);
          setPopupPixel(null);
        } else {
          setSelectedId(eventId);
          setPopupPixel({ x: e.point.x, y: e.point.y });
          setCorridorId(null);
          setDetailTab('info');
          const c = getCentroid(match);
          const currentZoom = mapRef.current?.getMap().getZoom() ?? 6;
          if (c) mapRef.current?.getMap().flyTo({ center: c, zoom: Math.max(currentZoom, 8), duration: 500 });
        }
      }
      return;
    }

    // Province polygon clicked → zoom to it + pin province filter
    if (f.layer?.id === 'province-fill') {
      const pcode = String(f.properties?.pcode ?? '');
      const name  = String(f.properties?.name  ?? pcode);
      if (pcode) {
        if (provincePinned?.pcode === pcode) {
          setProvincePinned(null);
        } else {
          setProvincePinned({ pcode, name });
          setSelectedId(null);
          setPopupPixel(null);
          setActiveTab('incidents');
          const bounds = getGeoBounds(f.geometry as GeoJSON.Geometry);
          if (bounds) mapRef.current?.getMap().fitBounds(bounds as any, { padding: 60, duration: 700 });
        }
      }
      return;
    }

    // Corridor line / label fallback
    const prov = f.properties?.province as string | undefined;
    if (prov) {
      const match = sortedEvents.find(ev => ev.province === prov || ev.p_code === prov);
      if (match) {
        setSelectedId(match.external_id);
        setCorridorId(null);
        setPopupPixel(null);
        setDetailTab('info');
        const c = getCentroid(match);
        if (c) mapRef.current?.getMap().flyTo({ center: c, zoom: 7, duration: 700, offset: [-160, 0] });
      }
    }
  }, [sortedEvents, selectedCorridorId, selectedId, provincePinned]);

  const onMouseMove = useCallback((e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    const map = mapRef.current?.getMap();
    if (!map) return;
    const canvas = map.getCanvas();
    if (!f) {
      canvas.style.cursor = '';
      setCorridorTooltip(null);
      setHoveredProvince(null);
      return;
    }
    if (f.layer?.id === 'corridor-lines') {
      canvas.style.cursor = 'crosshair';
      setCorridorTooltip({
        x:           e.point.x,
        y:           e.point.y,
        origin:      String(f.properties?.origin ?? ''),
        destination: String(f.properties?.destination ?? ''),
        confidence:  Number(f.properties?.confidence ?? 0),
        daysDiff:    Number(f.properties?.daysDiff ?? 0),
      });
      setHoveredProvince(null);
    } else if (f.layer?.id === 'province-fill') {
      canvas.style.cursor = 'default';
      setCorridorTooltip(null);
      const pcode = String(f.properties?.pcode ?? '');
      const name  = String(f.properties?.name  ?? pcode);
      setHoveredProvince({ pcode, name, x: e.point.x, y: e.point.y });
    } else {
      canvas.style.cursor = 'pointer';
      setCorridorTooltip(null);
      setHoveredProvince(null);
    }
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full relative">

      {/* ── Left Sidebar ────────────────────────────────────────────── */}
      <div className={`shrink-0 border-r border-cc-700 flex flex-col bg-cc-900 overflow-hidden transition-[width] duration-200 ${sidebarCollapsed ? 'w-0 border-r-0' : 'w-80'}`}>

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

        {/* Timeline histogram */}
        {timelineHistogram.length > 0 && events.length > 0 && (
          <div className="px-3 pt-2 pb-1.5 border-b border-cc-700 shrink-0">
            <div className="text-[9px] font-mono text-cc-500 uppercase tracking-wider mb-1.5">Activité / {horizon}j</div>
            <div className="flex items-end gap-px h-10">
              {(() => {
                const maxCount = Math.max(1, ...timelineHistogram.map(b => b.count));
                return timelineHistogram.map((b, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-px group relative">
                    <div
                      className="w-full rounded-sm min-h-[2px] transition-opacity group-hover:opacity-80"
                      style={{
                        height: `${Math.max(4, (b.count / maxCount) * 36)}px`,
                        backgroundColor: b.count === 0 ? '#1e293b' : (SEV_COLOR[b.maxSev] ?? '#6b7280'),
                        opacity: b.count === 0 ? 0.3 : 0.85,
                      }}
                    />
                    {/* Tooltip on hover */}
                    <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-cc-900 border border-cc-600 rounded px-1.5 py-0.5 text-[8px] font-mono text-gray-200 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10 shadow-lg">
                      {b.label} · {b.count} inc.{b.maxSev > 0 ? ` · S${b.maxSev}` : ''}
                    </div>
                  </div>
                ));
              })()}
            </div>
            <div className="flex justify-between text-[8px] text-cc-700 font-mono mt-0.5">
              <span>−{horizon}j</span>
              <span>Auj.</span>
            </div>
          </div>
        )}

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

        {/* ── ZONE 2 — Alertes + Prédictions (défile si trop long) ── */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* Alertes précoces — pliable */}
          {earlyWarnings.length > 0 && (
            <div className="border-b border-cc-700">
              <button
                onClick={() => setWarnOpen(v => !v)}
                className="w-full px-3 py-2 flex items-center justify-between hover:bg-cc-800/50 transition-colors"
              >
                <span className="text-[10px] font-mono text-orange-400 uppercase tracking-wider flex items-center gap-1.5">
                  ⚠️ Alerte précoce
                  <span className="bg-orange-900/60 border border-orange-800 px-1.5 py-px rounded text-[9px] text-orange-300 font-bold">
                    {earlyWarnings.length}
                  </span>
                </span>
                <span className={`text-cc-500 text-[9px] transition-transform duration-150 ${warnOpen ? 'rotate-90' : ''}`}>▶</span>
              </button>
              {warnOpen && (
                <div className="px-3 pb-2.5 space-y-1.5">
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
                    <div className="text-[9px] text-cc-600 font-mono text-center">+{earlyWarnings.length - 3} alertes</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Prédictions déplacement — pliable */}
          {predictions.length > 0 && (
            <div className="border-b border-cc-700">
              <button
                onClick={() => setPredOpen(v => !v)}
                className="w-full px-3 py-2 flex items-center justify-between hover:bg-cc-800/50 transition-colors"
              >
                <span className="text-[10px] font-mono text-orange-500 uppercase tracking-wider flex items-center gap-1.5">
                  🏃 Prédictions déplacement
                  <span className="bg-cc-800 border border-cc-700 px-1.5 py-px rounded text-[9px] text-cc-400 font-bold">
                    {predictions.length}
                  </span>
                </span>
                <span className={`text-cc-500 text-[9px] transition-transform duration-150 ${predOpen ? 'rotate-90' : ''}`}>▶</span>
              </button>
              {predOpen && (
                <div className="px-3 pb-2.5 space-y-1.5">
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
              )}
            </div>
          )}

        </div>
        {/* ── FIN ZONE 2 ── */}

        {/* ── ZONE 3 — Onglets ancrés en bas avec défilement propre ── */}
        <div className="flex flex-col border-t border-cc-700" style={{ maxHeight: '42vh', minHeight: '160px' }}>

          {/* Tab bar — plus grand, avec badges */}
          <div className="flex shrink-0 bg-cc-900">
            {([
              { key: 'incidents', label: 'Incidents',  count: events.length             },
              { key: 'threats',   label: 'Menaces',    count: threatPredictions.length  },
              { key: 'acteurs',   label: 'Acteurs',    count: actors.length             },
            ] as { key: SidebarTab; label: string; count: number }[]).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 py-2.5 text-[10px] font-mono transition-colors border-b-2 flex items-center justify-center gap-1.5 ${
                  activeTab === tab.key
                    ? 'text-red-300 border-red-600 bg-red-950/20'
                    : 'text-cc-500 border-transparent hover:text-gray-300 hover:bg-cc-800/40'
                }`}
              >
                {tab.label}
                <span className={`text-[9px] px-1.5 py-px rounded-full font-bold leading-none ${
                  activeTab === tab.key ? 'bg-red-600 text-white' : 'bg-cc-700 text-cc-400'
                }`}>{tab.count}</span>
              </button>
            ))}
          </div>

          {/* Tab content — défile dans la zone */}
          <div className="flex-1 overflow-y-auto min-h-0 flex flex-col">

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
              <>
                {/* Province pinned banner + stats */}
                {provincePinned && (
                  <>
                    <div className="px-2.5 py-1.5 border-b border-amber-800/60 bg-amber-950/40 shrink-0 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[9px] text-amber-400">🏛️</span>
                        <span className="text-[10px] font-mono text-amber-300 font-bold truncate">{provincePinned.name}</span>
                        <span className="text-[9px] text-amber-600 font-mono shrink-0">
                          ({filteredSortedEvents.length} incident{filteredSortedEvents.length !== 1 ? 's' : ''})
                        </span>
                      </div>
                      <button
                        onClick={() => setProvincePinned(null)}
                        className="text-amber-600 hover:text-amber-300 text-[10px] font-mono shrink-0"
                        title="Effacer le filtre province"
                      >✕ effacer</button>
                    </div>
                    {provincePinnedStats && (
                      <div className="grid grid-cols-4 divide-x divide-amber-900/40 border-b border-amber-900/40 bg-amber-950/20 shrink-0">
                        {[
                          { label: 'Sév. max', value: `S${provincePinnedStats.maxSev}`,
                            color: SEV_COLOR[provincePinnedStats.maxSev] ?? '#6b7280' },
                          { label: 'Dépl. moy.', value: `${Math.round(provincePinnedStats.avgRisk * 100)}%`,
                            color: provincePinnedStats.avgRisk >= 0.7 ? '#f97316' : provincePinnedStats.avgRisk >= 0.5 ? '#eab308' : '#60a5fa' },
                          { label: 'Groupes', value: String(provincePinnedStats.actors),  color: '#f87171' },
                          { label: 'Corridors', value: String(provincePinnedStats.corridors), color: '#60a5fa' },
                        ].map(s => (
                          <div key={s.label} className="px-1 py-1.5 text-center">
                            <div className="text-[11px] font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
                            <div className="text-[8px] text-amber-700 font-mono leading-tight">{s.label}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {/* Search filter */}
                <div className="px-2.5 py-2 border-b border-cc-800 shrink-0">
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-cc-500 text-[10px] pointer-events-none">🔍</span>
                    <input
                      type="text"
                      value={listFilter}
                      onChange={e => setListFilter(e.target.value)}
                      placeholder="Filtrer par province, type…"
                      className="w-full pl-6 pr-6 py-1 bg-cc-800 border border-cc-700 rounded text-[10px] font-mono text-gray-200 placeholder-cc-600 focus:outline-none focus:border-cc-500"
                    />
                    {listFilter && (
                      <button
                        onClick={() => setListFilter('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-cc-500 hover:text-gray-300 text-[10px]"
                      >×</button>
                    )}
                  </div>

                  {/* Severity chips */}
                  <div className="flex gap-1 mt-1.5">
                    <button
                      onClick={() => setSevFilter(null)}
                      className={`flex-1 py-0.5 rounded text-[9px] font-mono font-bold border transition-colors ${
                        sevFilter === null
                          ? 'bg-cc-600 border-cc-500 text-white'
                          : 'border-cc-700 text-cc-500 hover:text-gray-300'
                      }`}
                    >Tous</button>
                    {[1, 2, 3, 4, 5].map(s => (
                      <button
                        key={s}
                        onClick={() => setSevFilter(sevFilter === s ? null : s)}
                        className={`flex-1 py-0.5 rounded text-[9px] font-mono font-bold border transition-colors ${
                          sevFilter === s
                            ? 'text-white border-transparent'
                            : 'border-cc-700 text-cc-500 hover:text-gray-300'
                        }`}
                        style={sevFilter === s ? { backgroundColor: SEV_COLOR[s], borderColor: SEV_COLOR[s] } : {}}
                      >S{s}</button>
                    ))}
                  </div>

                  {/* Filtres corroboration */}
                  <div className="mt-1.5 grid grid-cols-3 gap-0.5">
                    {([
                      { v: 1 as const, label: 'Toutes',           title: 'Afficher tous les événements' },
                      { v: 2 as const, label: '≥ 2 sources',      title: 'Événements confirmés par ≥ 2 sources distinctes' },
                      { v: 3 as const, label: '≥ 3 fiables',      title: 'Haute fiabilité : ≥ 3 sources, sans contradiction' },
                    ] as const).map(({ v, label, title }) => (
                      <button
                        key={v}
                        title={title}
                        onClick={() => setMinSourcesFilter(v)}
                        className={`py-0.5 rounded text-[8px] font-mono font-bold border transition-colors ${
                          minSourcesFilter === v
                            ? 'bg-blue-900/60 border-blue-600 text-blue-300'
                            : 'border-cc-700 text-cc-500 hover:text-gray-300 hover:border-cc-500'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center justify-between mt-1.5">
                    {(listFilter || sevFilter !== null || provincePinned || minSourcesFilter > 1) ? (
                      <div className="text-[9px] text-cc-600 font-mono">
                        {filteredSortedEvents.length} / {sortedEvents.length} résultat{filteredSortedEvents.length !== 1 ? 's' : ''}
                      </div>
                    ) : <div />}
                    <button
                      onClick={exportCSV}
                      disabled={filteredSortedEvents.length === 0}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono border border-cc-700 text-cc-500 hover:text-gray-200 hover:border-cc-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Exporter la liste filtrée en CSV"
                    >⬇ CSV</button>
                  </div>
                </div>
              <div className="divide-y divide-cc-800/60">
                {filteredSortedEvents.map((e, i) => {
                  const color      = SEV_COLOR[e.severity || 1] ?? '#6b7280';
                  const isSelected = selectedId === e.external_id;
                  const evIcon     = EVENT_ICONS[e.event_type] ?? '⚠️';
                  const pLower     = (e.province || '').toLowerCase();
                  const evActors   = actors.filter(a =>
                    a.provinces_actives_historique.some(p => pLower.includes(p.toLowerCase())),
                  );
                  const evProv     = e.province || e.p_code || '';
                  const evCorridor = enhancedCorridors.find(c => c.origin === evProv || c.destination === evProv);
                  return (
                    <div
                      key={e.external_id || i}
                      ref={isSelected ? (el => { selectedItemRef.current = el; }) : undefined}
                      className={`flex cursor-pointer transition-colors ${isSelected ? 'bg-cc-800' : 'hover:bg-cc-800/50'}`}
                      onClick={() => {
                        if (isSelected) { setSelectedId(null); setPopupPixel(null); return; }
                        setSelectedId(e.external_id || null);
                        setCorridorId(null);
                        setPopupPixel(null);
                        setDetailTab('info');
                        const c = getCentroid(e);
                        if (c) mapRef.current?.getMap().flyTo({ center: c, zoom: 7, duration: 700, offset: [-160, 0] });
                      }}
                    >
                      {/* Severity stripe */}
                      <div className="w-1 shrink-0 rounded-l" style={{ backgroundColor: color }} />

                      <div className="px-2.5 py-2 flex-1 min-w-0">
                        {/* Row 1: icon + location + severity */}
                        <div className="flex items-start justify-between gap-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs shrink-0 leading-none mt-px">{evIcon}</span>
                            <div className="min-w-0">
                              <div className="text-[11px] text-gray-200 font-semibold truncate leading-tight">
                                {e.territoire || e.province || e.p_code || 'Inconnu'}
                              </div>
                              {e.territoire && (
                                <div className="text-[9px] text-cc-500 font-mono truncate">{e.province || e.p_code}</div>
                              )}
                            </div>
                          </div>
                          <span className="text-[9px] font-bold font-mono shrink-0 mt-px" style={{ color }}>S{e.severity}</span>
                        </div>

                        {/* Row 2: type + relative date */}
                        <div className="flex items-center justify-between mt-0.5 gap-1">
                          <span className="text-[9px] text-cc-400 font-mono truncate">
                            {EVENT_TYPE_FR[e.event_type] ?? e.event_type}
                            {e.fatalities_reported != null && e.fatalities_reported > 0
                              ? ` · ${e.fatalities_reported}†`
                              : ''}
                          </span>
                          <span className="text-[9px] text-cc-600 font-mono shrink-0">
                            {formatDistanceToNow(new Date(e.event_date), { addSuffix: false, locale: fr })}
                          </span>
                        </div>

                        {/* Row 3: first actor if any */}
                        {evActors.length > 0 && (
                          <div className="mt-1 text-[9px] text-red-400/80 font-mono truncate">
                            👥 {evActors[0].nom_acled}{evActors.length > 1 ? ` +${evActors.length - 1}` : ''}
                          </div>
                        )}

                        {/* Row 4: corridor if any */}
                        {evCorridor && (
                          <div className="mt-0.5 text-[9px] text-blue-400/70 font-mono truncate">
                            ↗ {evCorridor.origin} → {evCorridor.destination}
                          </div>
                        )}

                        {/* Displacement risk bar */}
                        {e.displacement_risk > 0 && (
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <div className="flex-1 h-0.5 bg-cc-700 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${e.displacement_risk * 100}%`,
                                  backgroundColor: e.displacement_risk >= 0.7 ? '#f97316' : e.displacement_risk >= 0.5 ? '#eab308' : '#3b82f6',
                                }}
                              />
                            </div>
                            <span className="text-[8px] text-cc-600 font-mono shrink-0">{Math.round(e.displacement_risk * 100)}%</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              </>
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
          {/* ── FIN tab content ── */}
        </div>
        {/* ── FIN ZONE 3 ── */}

        {/* Disclaimer */}
        <div className="px-3 py-2 border-t border-cc-700 shrink-0 bg-red-950/20">
          <div className="text-[9px] text-red-400/60 font-mono leading-relaxed">
            Sources : ACLED · OCHA · MONUSCO · ICG<br />
            Usage humanitaire opérationnel uniquement
          </div>
        </div>
      </div>

      {/* ── Toggle panneau ── */}
      <button
        onClick={() => setSidebarCollapsed(v => !v)}
        title={sidebarCollapsed ? 'Afficher le panneau' : 'Masquer le panneau'}
        className="absolute z-20 top-1/2 -translate-y-1/2 bg-cc-800 hover:bg-cc-700 border border-cc-600 text-cc-400 hover:text-gray-200 transition-all duration-200 rounded-r px-1 py-4 text-[10px] font-mono"
        style={{ left: sidebarCollapsed ? 0 : '320px' }}
      >
        {sidebarCollapsed ? '▶' : '◀'}
      </button>

      {/* ── Map ──────────────────────────────────────────────────────── */}
      <div className="flex-1 relative">

        {/* Province scope banner */}
        {provinceName && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 bg-amber-900/90 border border-amber-700 text-amber-200 text-[10px] font-mono px-3 py-1 rounded-lg backdrop-blur-sm pointer-events-none whitespace-nowrap">
            🏛️ Vue provinciale — {provinceName}
          </div>
        )}

        {/* Reset view */}
        <div className="absolute top-2 right-2 z-20 flex gap-1.5">
          <button
            onClick={() => printSitRep(events, earlyWarnings, threatPredictions, predictions, enhancedCorridors, horizon)}
            title="Générer un rapport de situation (SitRep)"
            className="px-3 py-1.5 rounded-lg text-[11px] font-mono font-bold border border-orange-700 bg-orange-950/90 text-orange-200 hover:text-white hover:bg-orange-900 transition-colors backdrop-blur-sm shadow-lg"
          >
            📄 SitRep
          </button>
          <button
            onClick={resetView}
            title={provinceBounds ? `Recentrer sur ${provinceName}` : 'Recentrer — vue complète RDC'}
            className="px-3 py-1.5 rounded-lg text-[11px] font-mono font-bold border border-cc-500 bg-cc-800/95 text-gray-200 hover:text-white hover:bg-cc-700 hover:border-cc-400 transition-colors backdrop-blur-sm shadow-lg"
          >
            {provinceBounds ? `🏛️ ${provinceName}` : '🌍 Vue RDC'}
          </button>
        </div>

        <MapGL
          ref={mapRef}
          initialViewState={{
            bounds: provinceBounds ?? DRC_BOUNDS_C,
            fitBoundsOptions: { padding: 40 },
          }}
          style={{ width: '100%', height: '100%' }}
          mapStyle={MAP_STYLE}
          interactiveLayerIds={['province-fill', 'cluster-circle', 'cluster-count', 'event-unclustered', 'corridor-lines', 'corridor-arrows', 'corridor-origins', 'corridor-dests', 'threat-labels']}
          onClick={onMapClick}
          onMouseMove={onMouseMove}
          onMouseLeave={() => {
            setCorridorTooltip(null);
            setHoveredProvince(null);
            const map = mapRef.current?.getMap();
            if (map) map.getCanvas().style.cursor = '';
          }}
        >
          {/* Province fills colored by conflict density */}
          {provinceFillGeoJSON.features.length > 0 && (
            <Source id="provinces" type="geojson" data={provinceFillGeoJSON}>
              <Layer id="province-fill" type="fill" paint={{
                'fill-color': ['interpolate', ['linear'], ['get', 'eventCount'],
                  0, 'rgba(37,99,235,0.20)',
                  1, 'rgba(202,138,4,0.40)',
                  3, 'rgba(234,88,12,0.54)',
                  6, 'rgba(220,38,38,0.65)'],
                'fill-opacity': 1,
              }} />
              {/* Outer dark halo for border contrast */}
              <Layer id="province-border-shadow" type="line" paint={{ 'line-color': '#071420', 'line-width': 3, 'line-blur': 1 }} />
              {/* Inner bright border */}
              <Layer id="province-border" type="line" paint={{ 'line-color': '#7eb4d4', 'line-width': 1.5 }} />
              {/* Hover highlight */}
              <Layer id="province-hover-fill" type="fill" paint={{
                'fill-color': '#ffffff',
                'fill-opacity': ['case', ['==', ['get', 'pcode'], hoveredProvince?.pcode ?? '__none__'], 0.08, 0],
              }} />
              {/* Selected event province highlight */}
              <Layer id="province-selected-fill" type="fill" paint={{
                'fill-color': '#ef4444',
                'fill-opacity': ['case', ['==', ['get', 'pcode'], selectedEvent?.p_code ?? '__none__'], 0.12, 0],
              }} />
              <Layer id="province-selected-border" type="line" paint={{
                'line-color': '#ef4444',
                'line-width': ['case', ['==', ['get', 'pcode'], selectedEvent?.p_code ?? '__none__'], 2.5, 0],
                'line-opacity': ['case', ['==', ['get', 'pcode'], selectedEvent?.p_code ?? '__none__'], 0.85, 0],
              }} />
              <Layer id="province-name" type="symbol" minzoom={4} layout={{
                'text-field': ['get', 'name'],
                'text-size': 11,
                'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
                'text-allow-overlap': false,
                'text-max-width': 8,
              }} paint={{ 'text-color': '#e2e8f0', 'text-halo-color': '#071420', 'text-halo-width': 2 }} />
            </Source>
          )}

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
              <Layer id="threat-labels" type="symbol" layout={{
                'text-field': ['concat', ['to-string', ['get', 'riskScore']], '% · ', ['get', 'province']],
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-size': 11,
                'text-anchor': 'top',
                'text-offset': [0, 1.2],
                'text-allow-overlap': true,
              }} paint={{
                'text-color': '#fca5a5',
                'text-halo-color': '#1a0505',
                'text-halo-width': 1.5,
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
              {/* Corridor origin — small hollow circle */}
              <Source id="corridor-origins-src" type="geojson" data={corridorData.origins}>
                <Layer id="corridor-origins" type="circle" paint={{
                  'circle-radius': 5,
                  'circle-color': '#0d1b2a',
                  'circle-stroke-color': ['get', 'color'],
                  'circle-stroke-width': 2,
                  'circle-opacity': 0.9,
                }} />
                <Layer id="corridor-origin-labels" type="symbol" layout={{
                  'text-field': ['get', 'label'],
                  'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
                  'text-size': 9,
                  'text-anchor': 'right',
                  'text-offset': [-1.0, 0],
                  'text-allow-overlap': false,
                }} paint={{
                  'text-color': ['get', 'color'],
                  'text-halo-color': '#0d1b2a',
                  'text-halo-width': 1.5,
                }} />
              </Source>
              {/* Corridor destination — filled circle with arrowhead */}
              <Source id="corridor-dests-src" type="geojson" data={corridorData.destinations}>
                <Layer id="corridor-dests" type="circle" paint={{
                  'circle-radius': 6,
                  'circle-color': ['get', 'color'],
                  'circle-stroke-color': '#ffffff',
                  'circle-stroke-width': 1.5,
                  'circle-opacity': 0.95,
                }} />
                <Layer id="corridor-dest-labels" type="symbol" layout={{
                  'text-field': ['concat', '▶ ', ['get', 'label']],
                  'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                  'text-size': 9,
                  'text-anchor': 'left',
                  'text-offset': [1.0, 0],
                  'text-allow-overlap': false,
                }} paint={{
                  'text-color': ['get', 'color'],
                  'text-halo-color': '#0d1b2a',
                  'text-halo-width': 1.5,
                }} />
              </Source>
            </>
          )}

          {/* Event clusters */}
          <Source
            id="events"
            type="geojson"
            data={eventsGeoJSON}
            cluster={true}
            clusterMaxZoom={7}
            clusterRadius={50}
          >
            {/* Cluster outer glow */}
            <Layer id="cluster-glow" type="circle" filter={['has', 'point_count']} paint={{
              'circle-radius':  ['step', ['get', 'point_count'], 34, 5, 44, 20, 58],
              'circle-color':   '#ef4444',
              'circle-opacity':  0.10,
              'circle-blur':     1,
            }} />
            {/* Cluster fill */}
            <Layer id="cluster-circle" type="circle" filter={['has', 'point_count']} paint={{
              'circle-radius':       ['step', ['get', 'point_count'], 18, 5, 26, 20, 34],
              'circle-color':        ['step', ['get', 'point_count'], '#f97316', 5, '#ef4444', 20, '#b91c1c'],
              'circle-opacity':       0.90,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width':  1.5,
            }} />
            {/* Cluster count label */}
            <Layer id="cluster-count" type="symbol" filter={['has', 'point_count']} layout={{
              'text-field':        '{point_count_abbreviated}',
              'text-font':         ['Open Sans Bold', 'Arial Unicode MS Bold'],
              'text-size':          12,
              'text-allow-overlap': true,
            }} paint={{ 'text-color': '#ffffff' }} />
            {/* Individual unclustered events */}
            <Layer id="event-unclustered" type="circle" filter={['!', ['has', 'point_count']]} paint={{
              'circle-radius': ['case', ['==', ['get', 'id'], selectedId ?? '__none__'], 14, 10],
              'circle-color':  ['get', 'color'],
              'circle-opacity': 0.90,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': ['case', ['==', ['get', 'id'], selectedId ?? '__none__'], 3, 1.5],
            }} />
            {/* Province name below unclustered event */}
            <Layer id="event-labels" type="symbol" filter={['!', ['has', 'point_count']]} layout={{
              'text-field':        ['get', 'province'],
              'text-font':         ['Open Sans Regular', 'Arial Unicode MS Regular'],
              'text-size':          9,
              'text-offset':       [0, 1.8],
              'text-anchor':       'top',
              'text-allow-overlap': false,
            }} paint={{
              'text-color':       '#d1d5db',
              'text-halo-color':  '#0d1b2a',
              'text-halo-width':   1.5,
            }} />
          </Source>
        </MapGL>

        {/* Floating ConflictPopup — appears near map click point */}
        {popupPixel && selectedEvent && (
          <ConflictPopup
            event={selectedEvent}
            pixel={popupPixel}
            prediction={selectedPrediction}
            relatedCorridors={relatedCorridors}
            actors={relevantActors}
            onClose={() => { setPopupPixel(null); setSelectedId(null); }}
            onOpenPanel={() => setPopupPixel(null)}
          />
        )}

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

        {/* Corridor hover tooltip */}
        {corridorTooltip && (
          <div
            className="absolute pointer-events-none z-30 bg-cc-900/97 border border-cc-600 rounded-lg px-3 py-2 text-xs font-mono shadow-xl"
            style={{ left: corridorTooltip.x + 14, top: corridorTooltip.y - 60 }}
          >
            <div className="text-gray-200 font-bold mb-0.5">
              {corridorTooltip.origin} <span className="text-cc-500">→</span> {corridorTooltip.destination}
            </div>
            <div className="text-cc-400 text-[10px]">
              Corridor · Δ{corridorTooltip.daysDiff.toFixed(1)}j · Conf. {corridorTooltip.confidence}%
            </div>
          </div>
        )}

        {/* Province hover tooltip */}
        {hoveredProvince && !corridorTooltip && (
          <div
            className="absolute pointer-events-none z-30 bg-cc-900/95 border border-cc-600 rounded-lg px-2.5 py-1.5 text-xs font-mono shadow-xl"
            style={{ left: hoveredProvince.x + 12, top: hoveredProvince.y - 44 }}
          >
            <div className="text-gray-200 font-bold text-[11px]">{hoveredProvince.name}</div>
            <div className="text-cc-500 text-[9px] mt-0.5">
              {(() => {
                const cnt = events.filter(e => e.p_code === hoveredProvince.pcode).length;
                return cnt > 0 ? `${cnt} incident${cnt > 1 ? 's' : ''} / ${horizon}j` : 'Aucun incident';
              })()}
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

        {/* ── Intelligence Detail Panel (hidden when popup is open) ── */}
        {!popupPixel && (selectedEvent || selectedCorridor) && (() => {
          const satCoords: [number, number] | null =
            selectedEvent
              ? (selectedEvent.coordinates ?? getCentroid(selectedEvent))
              : (selectedCorridor ? selectedCorridor.originCoords : null);
          return (
          <div className={`absolute top-2 right-3 w-80 bg-cc-950/98 border border-red-900 rounded-xl shadow-2xl overflow-hidden backdrop-blur-sm z-20 flex flex-col max-h-[calc(100vh-2rem)] transition-all duration-300 ease-out ${panelVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4'}`}>

            {/* Satellite mosaic */}
            {satCoords && (
              <div className="relative shrink-0">
                <SatelliteMosaic lng={satCoords[0]} lat={satCoords[1]} zoom={11} />
                {/* Overlay gradient */}
                <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-cc-950 to-transparent pointer-events-none" />
                {/* Close button over satellite */}
                <button
                  onClick={() => { setSelectedId(null); setCorridorId(null); }}
                  className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 text-white/80 hover:text-white flex items-center justify-center text-sm font-bold leading-none"
                >×</button>
                {/* Coord badge */}
                <div className="absolute top-2 left-2 text-[8px] font-mono bg-black/60 text-white/70 px-1.5 py-0.5 rounded">
                  {satCoords[1].toFixed(3)}°N {satCoords[0].toFixed(3)}°E
                </div>
              </div>
            )}

            {/* Panel header */}
            <div className={`px-3 pt-2.5 pb-2 border-b border-cc-800 shrink-0 ${!satCoords ? 'pt-3' : ''}`}>
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
                {!satCoords && (
                  <button
                    onClick={() => { setSelectedId(null); setCorridorId(null); }}
                    className="w-5 h-5 rounded-full bg-cc-800 text-cc-400 hover:text-white text-xs flex items-center justify-center shrink-0"
                  >×</button>
                )}
              </div>

              {selectedEvent && (
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
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
                  <span className="text-[9px] text-cc-500 font-mono">
                    {EVENT_TYPE_FR[selectedEvent.event_type] ?? selectedEvent.event_type}
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
                  <span className="text-[10px] font-mono text-cc-500">{selectedCorridor.daysDiff.toFixed(1)}j</span>
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

                  {/* Displacement prediction */}
                  {selectedPrediction && (
                    <div className="border-t border-cc-800 pt-2.5 mt-1">
                      <div className="text-[9px] font-mono text-orange-500 uppercase tracking-wider mb-2">📊 Prédiction IA · déplacement</div>
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className="text-cc-500 font-mono w-20 shrink-0">Pop. à risque :</span>
                          <span className="text-orange-300 font-mono font-bold">
                            {(selectedPrediction.displaced_estimate_low / 1000).toFixed(0)}k – {(selectedPrediction.displaced_estimate_high / 1000).toFixed(0)}k
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className="text-cc-500 font-mono w-20 shrink-0">Horizon :</span>
                          <span className="text-gray-300 font-mono">{selectedPrediction.horizon_days} jours</span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className="text-cc-500 font-mono w-20 shrink-0">Confiance :</span>
                          <div className="flex items-center gap-2 flex-1">
                            <span className="text-yellow-400 font-mono">{Math.round(selectedPrediction.confidence * 100)}%</span>
                            <div className="flex-1 h-1 bg-cc-700 rounded-full">
                              <div className="h-full bg-yellow-500 rounded-full" style={{ width: `${selectedPrediction.confidence * 100}%` }} />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Related corridors */}
                  {relatedCorridors.length > 0 && (
                    <div className="border-t border-cc-800 pt-2.5 mt-1">
                      <div className="text-[9px] font-mono text-blue-400 uppercase tracking-wider mb-2">🗺 Corridors de mouvement</div>
                      <div className="space-y-1.5">
                        {relatedCorridors.map(c => {
                          const role = c.origin === (selectedEvent.province || selectedEvent.p_code) ? 'ORIGINE' : 'DEST.';
                          return (
                            <div key={c.id} className="bg-cc-900 rounded-lg px-2.5 py-2 border border-cc-700">
                              <div className="flex items-center gap-1 text-[10px] mb-1">
                                <span className={`text-[8px] font-mono font-bold px-1 rounded shrink-0 ${role === 'ORIGINE' ? 'text-blue-400 bg-blue-900/40' : 'text-green-400 bg-green-900/40'}`}>{role}</span>
                                <span className="text-cc-500 truncate">{c.origin}</span>
                                <span className="text-cc-700 shrink-0">→</span>
                                <span className="text-gray-300 truncate">{c.destination}</span>
                              </div>
                              <div className="flex items-center gap-3 text-[9px] text-cc-600 font-mono">
                                <span>Conf. {c.confidence}%</span>
                                <span>Δ{c.daysDiff.toFixed(1)}j</span>
                                <span style={{ color: c.color }}>S{c.severity}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Cross-module correlation — humanitarian events in same province */}
                  {corrEvents.length > 0 && (
                    <div className="border-t border-cc-800 pt-2.5 mt-1">
                      <div className="text-[9px] font-mono text-purple-400 uppercase tracking-wider mb-2">
                        🔗 Événements humanitaires liés ({corrEvents.length})
                      </div>
                      <div className="space-y-1">
                        {corrEvents.slice(0, 4).map((ev: any) => (
                          <div key={ev.id} className="flex items-center gap-2 text-[10px] bg-cc-900 rounded px-2 py-1.5 border border-cc-700">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{
                              backgroundColor: SEV_COLOR[({ Minor: 2, Moderate: 3, Severe: 4, Extreme: 5 } as Record<string, number>)[ev.severity as string] ?? 1] ?? '#6b7280',
                            }} />
                            <span className="text-purple-400/80 font-mono shrink-0 text-[9px]">{HAZARD_FR_SHORT[ev.hazardType as string] ?? ev.hazardType}</span>
                            <span className="text-gray-300 flex-1 truncate text-[9px]">{ev.locationName}</span>
                          </div>
                        ))}
                        {corrEvents.length > 4 && (
                          <a href="/operations" className="text-[9px] text-purple-400/70 font-mono hover:text-purple-300 block text-right">
                            +{corrEvents.length - 4} autres → Salle d'opérations
                          </a>
                        )}
                      </div>
                    </div>
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
                <RecsList recommendations={recommendations} />
              )}
            </div>

            {/* Action buttons */}
            {selectedEvent && (
              <div className="px-3 py-2.5 border-t border-cc-800 bg-cc-950/80 shrink-0 flex flex-col gap-1.5">
                <a
                  href={`/crises/new?type=conflict&event_id=${encodeURIComponent(selectedEvent.external_id)}`}
                  className="block w-full text-center py-2 bg-red-900/70 hover:bg-red-800 text-red-100 border border-red-800 rounded-lg text-[11px] font-mono font-bold transition-colors"
                >
                  ⚔️ Créer une crise depuis cet incident
                </a>
                <button
                  onClick={() => navigator.clipboard.writeText(selectedEvent.external_id)}
                  className="w-full text-center py-1.5 bg-cc-800 hover:bg-cc-700 text-cc-300 border border-cc-700 rounded-lg text-[10px] font-mono transition-colors"
                >
                  📋 Copier la référence incident
                </button>
              </div>
            )}
          </div>
          );
        })()}

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
