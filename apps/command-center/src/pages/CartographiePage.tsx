import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import MapGL, { Source, Layer, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { apiClient } from '../lib/api.js';
import { whenMapReady } from '../lib/mapReady.js';
import { useAuthStore } from '../stores/auth.js';
import { EntityPanel, type EntityProps, NIVEAU_LABELS, STATUT_STYLE } from '../components/EntityPanel.js';

// ── TYPES ─────────────────────────────────────────────────────────────────────

type ColorMode = 'statut' | 'sinistres' | 'responsable';
type FondType = 'plan' | 'satellite' | 'hybride';

interface CouvertureRow {
  level: number;
  total: number;
  avec_responsable: number;
  sans_responsable: number;
}

interface BreadcrumbItem {
  pcode: string | null;
  name: string;
  level: number;
}

interface EntityBounds {
  pcode: string;
  name: string;
  level: number;
  bounds: [[number, number], [number, number]] | null;
  center: [number, number];
}

interface SearchResult {
  pcode: string;
  name: string;
  level: number;
  parentPcode: string | null;
  population: number | null;
}

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

// Full RDC bounds [west, south, east, north]
const RDC_BOUNDS: [[number, number], [number, number]] = [[11.8, -13.5], [31.3, 5.4]];

// ── FONDS DE CARTE ────────────────────────────────────────────────────────────

// Glyphs requis par MapLibre pour les couches symbol (labels texte)
const GLYPHS = 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf';

const FONDS_CARTE: Record<FondType, {
  label: string;
  icon: string;
  darkText: boolean;  // true = halo sombre (sur fond clair/plan), false = halo blanc (sur fond sombre/sat)
  style: object;
}> = {
  plan: {
    label: 'Plan',
    icon: '🗺',
    darkText: true,
    style: {
      version: 8,
      glyphs: GLYPHS,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenStreetMap',
        },
      },
      layers: [
        { id: 'osm', type: 'raster', source: 'osm' },
      ],
    },
  },
  satellite: {
    label: 'Satellite',
    icon: '🛰',
    darkText: false,
    style: {
      version: 8,
      glyphs: GLYPHS,
      sources: {
        'esri-sat': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          maxzoom: 19,
          attribution: '© Esri World Imagery',
        },
      },
      layers: [
        { id: 'bg',  type: 'background', paint: { 'background-color': '#1a1a2e' } },
        { id: 'sat', type: 'raster', source: 'esri-sat' },
      ],
    },
  },
  hybride: {
    label: 'Hybride',
    icon: '📍',
    darkText: false,
    style: {
      version: 8,
      glyphs: GLYPHS,
      sources: {
        'esri-sat': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          maxzoom: 19,
          attribution: '© Esri World Imagery',
        },
        'carto-labels': {
          type: 'raster',
          tiles: ['https://a.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© Carto',
        },
      },
      layers: [
        { id: 'bg',     type: 'background', paint: { 'background-color': '#1a1a2e' } },
        { id: 'sat',    type: 'raster', source: 'esri-sat' },
        { id: 'labels', type: 'raster', source: 'carto-labels', paint: { 'raster-opacity': 0.85 } },
      ],
    },
  },
};

// ── UTILITIES ─────────────────────────────────────────────────────────────────

function getFeatureBounds(feature: GeoJSON.Feature): [[number, number], [number, number]] | null {
  const geom = feature.geometry as any;
  if (!geom?.coordinates) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  function scan(c: any): void {
    if (typeof c[0] === 'number') {
      if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
    } else { (c as any[]).forEach(scan); }
  }
  scan(geom.coordinates);
  return isFinite(w) ? [[w, s], [e, n]] : null;
}

function unionBounds(features: GeoJSON.Feature[]): [[number, number], [number, number]] | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const f of features) {
    const b = getFeatureBounds(f);
    if (!b) continue;
    if (b[0][0] < w) w = b[0][0]; if (b[1][0] > e) e = b[1][0];
    if (b[0][1] < s) s = b[0][1]; if (b[1][1] > n) n = b[1][1];
  }
  return isFinite(w) ? [[w, s], [e, n]] : null;
}

function boundsValides(bounds: [[number, number], [number, number]] | null | undefined): bounds is [[number, number], [number, number]] {
  if (!bounds || !Array.isArray(bounds) || bounds.length !== 2) return false;
  const [[ouest, sud], [est, nord]] = bounds;
  if (![ouest, sud, est, nord].every(n => Number.isFinite(n))) return false;
  if (ouest >= est || sud >= nord) return false;
  return true;
}

// ── ZOOM CONTROLS ─────────────────────────────────────────────────────────────

function ZoomControls({
  onRDC, onMyZone, onCrises, onSurveillance, onBack,
  hasCrises, survMode, hasScope, canBack, survIndex, crisisCount,
}: {
  onRDC:          () => void;
  onMyZone:       () => void;
  onCrises:       () => void;
  onSurveillance: () => void;
  onBack:         () => void;
  hasCrises:    boolean;
  survMode:     boolean;
  hasScope:     boolean;
  canBack:      boolean;
  survIndex:    number;
  crisisCount:  number;
}) {
  const btn = 'w-9 h-9 flex items-center justify-center rounded-lg border text-sm transition-colors bg-cc-900/90 border-cc-700 hover:bg-cc-800 backdrop-blur-sm cursor-pointer select-none';
  return (
    <div className="absolute top-3 right-3 flex flex-col gap-1.5 z-10">
      <button onClick={onRDC} className={btn} title="Vue nationale RDC">🌍</button>
      {hasScope && (
        <button onClick={onMyZone} className={btn} title="Ma zone de responsabilité">📍</button>
      )}
      {hasCrises && (
        <>
          <button
            onClick={onCrises}
            className={`${btn} border-red-800 text-red-400 hover:bg-red-900/60`}
            title="Zoomer sur toutes les crises/alertes"
          >
            🚨
          </button>
          <button
            onClick={onSurveillance}
            className={`${btn} ${survMode ? 'bg-red-900/80 border-red-700 text-red-300' : 'text-cc-400'}`}
            title={survMode
              ? `Surveillance ${survIndex + 1}/${crisisCount} — cliquer pour stopper`
              : 'Mode surveillance automatique (cycle 8s)'}
          >
            {survMode ? '⏸' : '▶'}
          </button>
        </>
      )}
      {canBack && (
        <button onClick={onBack} className={btn} title="Remonter d'un niveau">⬆</button>
      )}
    </div>
  );
}

// ── COUVERTURE PANEL ──────────────────────────────────────────────────────────

function CouverturePanel({ data }: { data: CouvertureRow[] }) {
  return (
    <div className="shrink-0 border-t border-cc-700 bg-cc-900 px-4 py-3">
      <div className="text-[9px] font-mono text-cc-500 uppercase mb-3 tracking-wider">
        Couverture Administrative
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-cc-500 font-mono text-[9px] uppercase">
              <th className="text-left pb-1.5 pr-4">Niveau</th>
              <th className="text-right pb-1.5 pr-4">Total</th>
              <th className="text-right pb-1.5 pr-4">Avec resp.</th>
              <th className="text-right pb-1.5 pr-4">Manquants</th>
              <th className="text-left pb-1.5">Couverture</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cc-800">
            {data.map(row => {
              const pct = row.total > 0 ? Math.round((row.avec_responsable / row.total) * 100) : 0;
              return (
                <tr key={row.level} className="py-1.5">
                  <td className="py-1.5 pr-4 text-gray-300">
                    {NIVEAU_LABELS[row.level] ?? `Niveau ${row.level}`}
                  </td>
                  <td className="py-1.5 pr-4 text-right text-gray-300 font-mono">{row.total}</td>
                  <td className="py-1.5 pr-4 text-right text-green-400 font-mono">{row.avec_responsable}</td>
                  <td className={`py-1.5 pr-4 text-right font-mono ${row.sans_responsable > 0 ? 'text-orange-400' : 'text-green-400'}`}>
                    {row.sans_responsable}
                  </td>
                  <td className="py-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-1.5 bg-cc-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${pct === 100 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[9px] font-mono text-cc-500">{pct}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────

export function CartographiePage() {
  const mapRef = useRef<MapRef>(null);

  // Navigation state
  const [level, setLevel]             = useState(1);
  const [parentPcode, setParentPcode] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb]   = useState<BreadcrumbItem[]>([
    { pcode: null, name: 'RDC', level: 0 },
  ]);
  const [selected, setSelected]       = useState<EntityProps | null>(null);
  const [colorMode, setColorMode]     = useState<ColorMode>('statut');
  const [fondActuel, setFondActuel]   = useState<FondType>('plan');
  const [mapZoom, setMapZoom]         = useState(4.5);
  const [showCouverture, setShowCouverture] = useState(false);
  const [showIncidentsPanel, setShowIncidentsPanel] = useState(false);
  const [showNominations, setShowNominations] = useState(false);
  const [showRues, setShowRues] = useState(false);

  // Salle des opérations — couches thématiques temps réel
  const [showConflits, setShowConflits]   = useState(true);
  const [showEpidemie, setShowEpidemie]   = useState(true);
  const [showMilitaire, setShowMilitaire] = useState(true);

  // Search state
  const [searchQuery, setSearchQuery]           = useState('');
  const [debouncedSearch, setDebouncedSearch]   = useState('');
  const [searchFocused, setSearchFocused]       = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Zoom state
  const [survMode, setSurvMode]   = useState(false);
  const [survIndex, setSurvIndex] = useState(0);
  const [pulseOn, setPulseOn]     = useState(false);
  const survTimerRef              = useRef<ReturnType<typeof setInterval> | null>(null);
  const zoomEnCours               = useRef<AbortController | null>(null);

  // 7-day window (computed once at mount)
  const dateFrom7d = useMemo(() => new Date(Date.now() - 30 * 86_400_000).toISOString(), []);

  // pcode commune pour le chargement des rues (level 3 = secteur/groupement)
  const ruesPcode = useMemo(() => {
    if (level === 4 && parentPcode) return parentPcode;
    if (selected?.level === 3) return selected.pcode;
    return null;
  }, [level, parentPcode, selected]);

  // Auth
  const user     = useAuthStore(s => s.user);
  const hasScope = !!user
    && !['system_admin', 'national_decision_maker'].includes(user.role)
    && user.scope.length > 0;
  const userScopePcode = hasScope ? user!.scope[0] : null;

  const qc = useQueryClient();

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: geojson, isLoading } = useQuery({
    queryKey: ['cartographie', level, parentPcode],
    queryFn: () =>
      apiClient
        .get<GeoJSON.FeatureCollection & { _meta: { total: number; withGeometry: number } }>(
          `/geo/cartographie?level=${level}${parentPcode ? `&parentPcode=${parentPcode}` : ''}`
        )
        .then(r => r.data),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 60_000,
  });

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Close search dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node))
        setSearchFocused(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const { data: searchResults } = useQuery({
    queryKey: ['geo-search', debouncedSearch],
    queryFn: () =>
      apiClient
        .get<{ success: boolean; data: SearchResult[] }>(
          `/geo/divisions?search=${encodeURIComponent(debouncedSearch)}&withGeometry=false`
        )
        .then(r => r.data.data?.slice(0, 15) ?? []),
    enabled: debouncedSearch.length >= 2,
    staleTime: 60_000,
  });

  const { data: recentEventsRaw, dataUpdatedAt: incidentsUpdatedAt } = useQuery({
    queryKey: ['incidents-province'],
    queryFn: () => apiClient
      .get(`/events?limit=100&dateFrom=${encodeURIComponent(dateFrom7d)}`)
      .then(r => r.data.data ?? []),
    enabled: showIncidentsPanel,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const { data: propositionsRaw } = useQuery({
    queryKey: ['carto-propositions'],
    queryFn: () => apiClient
      .get('/responsables/propositions?statut=A_VALIDER&limit=30')
      .then(r => r.data.data?.propositions ?? []),
    enabled: showNominations,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: ruesRaw } = useQuery({
    queryKey: ['carto-rues', ruesPcode],
    queryFn: () => apiClient
      .get(`/rues?commune_pcode=${ruesPcode}&statut=VALIDE&limit=300`)
      .then(r => r.data.data ?? []),
    enabled: showRues && !!ruesPcode,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const { data: couvertureData } = useQuery({
    queryKey: ['geo-couverture'],
    queryFn: () =>
      apiClient
        .get<{ success: boolean; data: CouvertureRow[] }>('/geo/couverture')
        .then(r => r.data.data ?? []),
    enabled: showCouverture,
    staleTime: 10 * 60 * 1000,
  });

  // Flux commun — statuts provinces (signaux confirmés + non confirmés)
  const { data: fluxStatuts } = useQuery({
    queryKey: ['flux-statut-provinces'],
    queryFn: () =>
      apiClient
        .get<{ pcode: string; statut: string; confirmes: number; aConfirmer: number; fiabiliteMax: number }[]>(
          '/flux/statut-provinces'
        )
        .then(r => r.data),
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  // Salle des opérations — Flux conflits + renseignement (30 s)
  const isRestricted = ['humanitarian_partner', 'national_decision_maker', 'system_admin'].includes(user?.role ?? '');
  const { data: fluxOpsRaw, dataUpdatedAt: opsUpdatedAt } = useQuery({
    queryKey: ['flux-ops'],
    queryFn: () => apiClient
      .get<any[]>('/flux/evenements?depuis_jours=7&limit=300')
      .then(r => r.data),
    enabled: showConflits || showMilitaire,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  // Salle des opérations — Zones épidémiques (5 min)
  const canSeeEpidemie = ['territory_admin', 'provincial_coordinator', 'national_decision_maker', 'system_admin'].includes(user?.role ?? '');
  const { data: epidemieZonesRaw } = useQuery({
    queryKey: ['epidemie-zones-ops'],
    queryFn: () => apiClient
      .get<any[]>('/epidemie/zones')
      .then(r => r.data),
    enabled: showEpidemie && canSeeEpidemie,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  // Tous les quartiers (niveau 4) — chargés une fois quand le zoom s'approche
  const { data: quartiersGlobalRaw } = useQuery({
    queryKey: ['quartiers-global'],
    queryFn: () =>
      apiClient
        .get<GeoJSON.FeatureCollection>('/geo/cartographie?level=4')
        .then(r => r.data),
    enabled: mapZoom >= 11,
    staleTime: 30 * 60 * 1000,
  });

  // ── Derived data ───────────────────────────────────────────────────────────

  const entities: EntityProps[] = useMemo(() => {
    if (!geojson?.features) return [];
    return geojson.features.map(f => f.properties as EntityProps).filter(Boolean);
  }, [geojson]);

  const hasGeometry = useMemo(() => (geojson?.features?.length ?? 0) > 0, [geojson]);

  // Province name lookup from level-1 features
  const provinceLookup = useMemo<Record<string, string>>(() => {
    if (level !== 1 || !geojson?.features) return {};
    return Object.fromEntries(
      geojson.features.map(f => [f.properties?.pcode as string, f.properties?.name as string])
    );
  }, [geojson, level]);

  // Flux signaux non confirmés — surcouche hachurée sur la carte (uniquement level=1)
  const fluxSignauxGeoJson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (level !== 1 || !geojson?.features || !fluxStatuts?.length) {
      return { type: 'FeatureCollection', features: [] };
    }
    const byPcode = new Map(fluxStatuts.map(s => [s.pcode, s]));
    const features: GeoJSON.Feature[] = [];
    for (const f of geojson.features) {
      const pcode = f.properties?.pcode as string;
      const flux = byPcode.get(pcode);
      if (!flux || (flux.aConfirmer === 0 && flux.confirmes === 0)) continue;
      features.push({
        ...f,
        properties: {
          ...f.properties,
          flux_a_confirmer: flux.aConfirmer,
          flux_confirmes:   flux.confirmes,
          flux_statut:      flux.statut,
          flux_fiabilite:   flux.fiabiliteMax,
        },
      });
    }
    return { type: 'FeatureCollection', features };
  }, [geojson, fluxStatuts, level]);

  // Index rapide flux par pcode pour le panneau d'entité
  const fluxByPcode = useMemo(
    () => new Map((fluxStatuts ?? []).map(s => [s.pcode, s])),
    [fluxStatuts],
  );

  // Aggregate recent events by province (first 4 chars of location_pcode)
  const incidentsByProvince = useMemo(() => {
    const events: any[] = recentEventsRaw ?? [];
    const counts: Record<string, { count: number; name: string }> = {};
    for (const evt of events) {
      const pcode = (evt.locationPcode ?? evt.location_pcode ?? '') as string;
      const key = pcode.length >= 4 ? pcode.slice(0, 4) : pcode;
      if (!key) continue;
      if (!counts[key]) counts[key] = { count: 0, name: provinceLookup[key] ?? evt.locationName ?? evt.location_name ?? key };
      counts[key].count += 1;
    }
    return Object.entries(counts)
      .map(([pcode, v]) => ({ pcode, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  }, [recentEventsRaw, provinceLookup]);

  // Nominations count badge
  const propositionsCount: number = (propositionsRaw ?? []).length;

  // Rues GeoJSON — lignes et points séparés
  const ruesGeoJson = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: (ruesRaw ?? [])
      .filter((r: any) => r.geometry || r.centroid)
      .map((r: any): GeoJSON.Feature => ({
        type: 'Feature',
        geometry: r.geometry ?? r.centroid,
        properties: { id: r.id, nom: r.nom, type_voie: r.type_voie },
      })),
  }), [ruesRaw]);

  const ruesLines = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: ruesGeoJson.features.filter(
      (f: GeoJSON.Feature) => f.geometry?.type === 'LineString' || f.geometry?.type === 'MultiLineString'
    ),
  }), [ruesGeoJson]);

  const ruesPoints = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: ruesGeoJson.features.filter((f: GeoJSON.Feature) => f.geometry?.type === 'Point'),
  }), [ruesGeoJson]);

  // ── Salle des opérations — GeoJSON dérivés ───────────────────────────────

  // Centroïdes provinces depuis les features level-1
  const provinceCentroids = useMemo<Record<string, [number, number]>>(() => {
    if (!geojson?.features) return {};
    const out: Record<string, [number, number]> = {};
    for (const f of geojson.features) {
      const pcode    = f.properties?.pcode as string | undefined;
      const centroid = f.properties?.centroid as [number, number] | null | undefined;
      if (pcode && centroid) out[pcode] = centroid;
    }
    return out;
  }, [geojson]);

  // Conflit — agrège par province_pcode, crée un point par province
  const conflitsGeoJson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showConflits || !fluxOpsRaw?.length) return { type: 'FeatureCollection', features: [] };
    const byPcode: Record<string, { count: number; maxGravite: number; titres: string[] }> = {};
    for (const ev of fluxOpsRaw) {
      if (ev.type_evenement !== 'CONFLIT') continue;
      if (ev.source_agent === 'RENSEIGNEMENT') continue; // géré par la couche militaire
      const pcode = (ev.province_pcode as string | null) ?? '';
      if (!pcode) continue;
      const base4 = pcode.length > 4 ? pcode.slice(0, 4) : pcode;
      if (!byPcode[base4]) byPcode[base4] = { count: 0, maxGravite: 0, titres: [] };
      byPcode[base4].count += 1;
      byPcode[base4].maxGravite = Math.max(byPcode[base4].maxGravite, ev.gravite === 'CRITIQUE' ? 3 : ev.gravite === 'ELEVEE' ? 2 : 1);
      if (byPcode[base4].titres.length < 3) byPcode[base4].titres.push(ev.titre ?? '');
    }
    const features: GeoJSON.Feature[] = [];
    for (const [pcode, d] of Object.entries(byPcode)) {
      const coords = provinceCentroids[pcode] ?? provinceCentroids[pcode.slice(0, 4)];
      if (!coords) continue;
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: coords },
        properties: { pcode, count: d.count, maxGravite: d.maxGravite, titres: d.titres.join(' · ') } });
    }
    return { type: 'FeatureCollection', features };
  }, [showConflits, fluxOpsRaw, provinceCentroids]);

  // Militaire — événements source RENSEIGNEMENT uniquement
  const militaireGeoJson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showMilitaire || !fluxOpsRaw?.length) return { type: 'FeatureCollection', features: [] };
    const byPcode: Record<string, { count: number; maxGravite: number; titres: string[] }> = {};
    for (const ev of fluxOpsRaw) {
      if (ev.source_agent !== 'RENSEIGNEMENT') continue;
      const pcode = (ev.province_pcode as string | null) ?? '';
      if (!pcode) continue;
      const base4 = pcode.length > 4 ? pcode.slice(0, 4) : pcode;
      if (!byPcode[base4]) byPcode[base4] = { count: 0, maxGravite: 0, titres: [] };
      byPcode[base4].count += 1;
      byPcode[base4].maxGravite = Math.max(byPcode[base4].maxGravite, ev.gravite === 'CRITIQUE' ? 3 : ev.gravite === 'ELEVEE' ? 2 : 1);
      if (byPcode[base4].titres.length < 3) byPcode[base4].titres.push(ev.titre ?? '');
    }
    const features: GeoJSON.Feature[] = [];
    for (const [pcode, d] of Object.entries(byPcode)) {
      const coords = provinceCentroids[pcode] ?? provinceCentroids[pcode.slice(0, 4)];
      if (!coords) continue;
      // Décaler légèrement pour éviter la superposition avec les cercles conflit
      const shifted: [number, number] = [coords[0] + 0.18, coords[1] - 0.18];
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: shifted },
        properties: { pcode, count: d.count, maxGravite: d.maxGravite, titres: d.titres.join(' · ') } });
    }
    return { type: 'FeatureCollection', features };
  }, [showMilitaire, fluxOpsRaw, provinceCentroids]);

  // Épidémie — agrège zones par province (p_code 4 chars)
  const epidemieGeoJson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showEpidemie || !epidemieZonesRaw?.length) return { type: 'FeatureCollection', features: [] };
    const byPcode: Record<string, { zones: number; cas: number; deces: number; maladies: Set<string> }> = {};
    for (const z of epidemieZonesRaw as any[]) {
      const pcode = ((z.p_code ?? z.pCode ?? '') as string).slice(0, 4);
      if (!pcode) continue;
      if (!byPcode[pcode]) byPcode[pcode] = { zones: 0, cas: 0, deces: 0, maladies: new Set() };
      byPcode[pcode].zones += 1;
      byPcode[pcode].cas   += Number(z.casConfirmes ?? z.cas_confirmes ?? 0);
      byPcode[pcode].deces += Number(z.decesConfirmes ?? z.deces_confirmes ?? 0);
      if (z.maladie) byPcode[pcode].maladies.add(z.maladie);
    }
    const features: GeoJSON.Feature[] = [];
    for (const [pcode, d] of Object.entries(byPcode)) {
      const coords = provinceCentroids[pcode];
      if (!coords) continue;
      const shifted: [number, number] = [coords[0] - 0.18, coords[1] + 0.18];
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: shifted },
        properties: { pcode, zones: d.zones, cas: d.cas, deces: d.deces,
          maladies: [...d.maladies].join(', ') } });
    }
    return { type: 'FeatureCollection', features };
  }, [showEpidemie, epidemieZonesRaw, provinceCentroids]);

  const opsConflitsCount  = conflitsGeoJson.features.length;
  const opsMilitaireCount = militaireGeoJson.features.length;
  const opsEpidemieCount  = epidemieGeoJson.features.length;

  // Mutations nominations
  const validateNomMutation = useMutation({
    mutationFn: (id: string) => apiClient.put(`/responsables/propositions/${id}/valider`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['carto-propositions'] }),
  });
  const rejectNomMutation = useMutation({
    mutationFn: (id: string) => apiClient.put(`/responsables/propositions/${id}/rejeter`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['carto-propositions'] }),
  });

  // Mutation rafraîchissement statuts (system_admin only)
  const refreshStatutsMutation = useMutation({
    mutationFn: () => apiClient.post('/geo/refresh-statuts', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cartographie'] }),
  });

  // Split polygon features (levels 1-3) from point features (level 4 — centroid only)
  const polygonGeojson = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: geojson?.features?.filter(f => !f.properties?._is_point) ?? [],
  }), [geojson]);

  const pointGeojson = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: geojson?.features?.filter(f => f.properties?._is_point) ?? [],
  }), [geojson]);

  // Crisis/alert features for pulse — polygon only (fill layer doesn't apply to points)
  const crisisFeatures = useMemo(() =>
    geojson?.features?.filter(f =>
      ['CRISE', 'ALERTE'].includes(String(f.properties?.statut)) && !f.properties?._is_point
    ) ?? [],
    [geojson]
  );
  const crisisGeoJson = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: crisisFeatures,
  }), [crisisFeatures]);
  const hasCrises = crisisFeatures.length > 0;

  // true quand la vue courante contient des zones Voronoï approximatives
  const hasVoronoi = useMemo(() =>
    geojson?.features?.some(f => f.properties?.geometry_type === 'VORONOI_APPROX') ?? false,
    [geojson]
  );

  // Quartiers globaux (niveau 4) — polygones Voronoï + points restants séparés
  const quartiersGlobalPolygons = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: quartiersGlobalRaw?.features?.filter(f => !f.properties?._is_point) ?? [],
  }), [quartiersGlobalRaw]);
  const quartiersGlobalPoints = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: quartiersGlobalRaw?.features?.filter(f => f.properties?._is_point) ?? [],
  }), [quartiersGlobalRaw]);
  const quartiersGlobalAll = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: quartiersGlobalRaw?.features ?? [],
  }), [quartiersGlobalRaw]);

  // Afficher l'overlay global seulement quand pas déjà en drill-down niveau 4
  const showGlobalQuartiers = mapZoom >= 12 && level < 4 &&
    (quartiersGlobalPolygons.features.length > 0 || quartiersGlobalPoints.features.length > 0);

  // ── Fill color expression ──────────────────────────────────────────────────

  const fillColorExpr = useMemo(() => {
    if (colorMode === 'statut') {
      return ['match', ['get', 'statut'],
        'CRISE',     '#dc2626',
        'ALERTE',    '#ea580c',
        'VIGILANCE', '#eab308',
        'NORMAL',    '#16a34a',
        '#64748b',
      ] as unknown as string;
    }
    if (colorMode === 'responsable') {
      return ['case',
        ['all', ['has', 'responsable_nom'], ['!=', ['get', 'responsable_nom'], null]],
        '#16a34a',
        '#dc2626',
      ] as unknown as string;
    }
    return ['interpolate', ['linear'], ['get', 'nb_incidents'],
      0,  '#134e2a',
      5,  '#854d0e',
      15, '#7c2d12',
    ] as unknown as string;
  }, [colorMode]);

  // ── Label style adaptatif selon fond de carte ─────────────────────────────

  const isSatellite = fondActuel === 'satellite' || fondActuel === 'hybride';

  const labelStyle = useMemo(() => {
    if (fondActuel === 'plan') {
      return { textColor: '#1e3a5f', haloColor: '#ffffff', haloWidth: 2.0 };
    }
    return { textColor: '#ffffff', haloColor: '#000000', haloWidth: 2.0 };
  }, [fondActuel]);

  // ── Zoom functions ─────────────────────────────────────────────────────────

  // Zoom to full RDC extent
  const zoomToRDC = useCallback(() => {
    mapRef.current?.fitBounds(RDC_BOUNDS, {
      padding: { top: 40, bottom: 40, left: selected ? 310 : 40, right: 40 },
      duration: 1000,
    });
  }, [selected]);

  // Zoom to entity from the API bounds endpoint (for pcodes not in current view)
  const zoomToPcode = useCallback(async (pcode: string, leftPad = 80, signal?: AbortSignal): Promise<void> => {
    if (!mapRef.current) return;

    // Cause #1 — attendre que la carte soit prête avant tout appel fitBounds
    await whenMapReady(mapRef.current);
    if (signal?.aborted || !mapRef.current) return;

    // Cause #3 — retry pour le cold start Neon (backoff 300ms/600ms/1200ms)
    let data: EntityBounds | null = null;
    for (let i = 0; i < 3; i++) {
      try {
        const res = await apiClient.get<{ success: boolean; data: EntityBounds }>(
          `/geo/entity/${encodeURIComponent(pcode)}/bounds`
        );
        if (res.data.success) { data = res.data.data; break; }
      } catch {
        if (i < 2) await new Promise<void>(r => setTimeout(r, 300 * Math.pow(2, i)));
      }
    }

    if (signal?.aborted || !mapRef.current) return;

    // Cause #2 — ne zoomer que sur des bounds valides
    if (data && boundsValides(data.bounds)) {
      mapRef.current.fitBounds(data.bounds, {
        padding: { top: 80, bottom: 80, left: leftPad, right: 80 },
        duration: 1000,
        maxZoom: 10,
      });
    } else if (data?.center && Number.isFinite(data.center[0]) && Number.isFinite(data.center[1])) {
      // Fallback centroïde — entité sans polygone COD-AB
      const zoomParNiveau: Record<number, number> = { 1: 7, 2: 9, 3: 11, 4: 13 };
      mapRef.current.flyTo({
        center: data.center,
        zoom: zoomParNiveau[data.level] ?? 8,
        duration: 800,
      });
    } else {
      console.warn(`[zoom] Aucune position pour ${pcode}, retour vue nationale`);
      mapRef.current.fitBounds(RDC_BOUNDS, { padding: 40, duration: 800 });
    }
  }, []);

  // Zoom to a feature already in the current GeoJSON
  const zoomToFeature = useCallback(async (pcode: string) => {
    if (!mapRef.current || !geojson) return;
    const feature = geojson.features.find(f => f.properties?.pcode === pcode);
    if (!feature) return;
    const bounds = getFeatureBounds(feature);
    if (!bounds) return;
    await whenMapReady(mapRef.current);
    if (!mapRef.current) return;
    mapRef.current.fitBounds(bounds, {
      padding: { top: 80, bottom: 80, left: selected ? 310 : 80, right: 80 },
      duration: 800,
      maxZoom: 12,
    });
  }, [geojson, selected]);

  // Zoom to encompass all CRISE/ALERTE entities
  const zoomToCrises = useCallback(() => {
    if (!hasCrises || !mapRef.current) return;
    const bounds = unionBounds(crisisFeatures);
    if (!bounds) return;
    mapRef.current.fitBounds(bounds, {
      padding: { top: 80, bottom: 80, left: selected ? 310 : 80, right: 80 },
      duration: 800,
      maxZoom: 10,
    });
  }, [crisisFeatures, hasCrises, selected]);

  // Zoom avec debounce (annule le zoom précédent si un nouveau clic arrive avant la fin)
  const zoomToEntityDebounced = useCallback(async (pcode: string) => {
    if (zoomEnCours.current) zoomEnCours.current.abort();
    const ac = new AbortController();
    zoomEnCours.current = ac;
    // Le panel sera ouvert — toujours laisser 310px à gauche
    await zoomToPcode(pcode, 310, ac.signal);
  }, [zoomToPcode]);

  // ── Surveillance mode ──────────────────────────────────────────────────────

  const toggleSurveillance = useCallback(() => setSurvMode(v => !v), []);

  // Keep a ref so the interval closure always calls the latest zoomToFeature
  const zoomToFeatureRef = useRef(zoomToFeature);
  useEffect(() => { zoomToFeatureRef.current = zoomToFeature; }, [zoomToFeature]);

  useEffect(() => {
    if (!survMode || crisisFeatures.length === 0) return;
    let idx = 0;
    setSurvIndex(idx);
    const first = crisisFeatures[idx];
    if (first) zoomToFeatureRef.current(String(first.properties?.pcode ?? ''));
    const id = setInterval(() => {
      idx = (idx + 1) % crisisFeatures.length;
      setSurvIndex(idx);
      const f = crisisFeatures[idx];
      if (f) zoomToFeatureRef.current(String(f.properties?.pcode ?? ''));
    }, 8000);
    survTimerRef.current = id;
    return () => { clearInterval(id); survTimerRef.current = null; };
  }, [survMode, crisisFeatures]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-stop surveillance if crises disappear
  useEffect(() => { if (!hasCrises) setSurvMode(false); }, [hasCrises]);

  // Pulse animation for crisis layer
  useEffect(() => {
    if (!hasCrises) { setPulseOn(false); return; }
    const id = setInterval(() => setPulseOn(v => !v), 600);
    return () => clearInterval(id);
  }, [hasCrises]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const onMapLoad = useCallback(() => {
    if (userScopePcode) void zoomToPcode(userScopePcode);
  }, [userScopePcode, zoomToPcode]);

  const onDrillDown = useCallback((entity: EntityProps) => {
    const nextLevel = entity.level + 1;
    setLevel(nextLevel);
    setParentPcode(entity.pcode);
    setBreadcrumb(prev => [
      ...prev,
      { pcode: entity.pcode, name: entity.name, level: entity.level },
    ]);
    setSelected(null);
    zoomToFeature(entity.pcode);
  }, [zoomToFeature]);

  const onBreadcrumbClick = useCallback((idx: number, item: BreadcrumbItem) => {
    const newCrumbs = breadcrumb.slice(0, idx + 1);
    setBreadcrumb(newCrumbs);
    setLevel(item.level + 1);
    setParentPcode(item.pcode);
    setSelected(null);
    if (item.pcode) {
      // Zoom to the selected ancestor via API (it won't be in current geojson)
      void zoomToPcode(item.pcode, 80);
    } else {
      zoomToRDC();
    }
  }, [breadcrumb, zoomToPcode, zoomToRDC]);

  const onMapClick = useCallback((e: MapLayerMouseEvent) => {
    const features = e.features;
    if (!features || features.length === 0) {
      setSelected(null);
      return;
    }
    const f = features[0];
    if (
      f.layer?.id === 'carto-fill' || f.layer?.id === 'carto-outline' ||
      f.layer?.id === 'carto-points' || f.layer?.id === 'quartiers-globe-points' ||
      f.layer?.id === 'quartiers-globe-fill' ||
      f.layer?.id === 'crisis-pulse-layer'
    ) {
      const props = f.properties as EntityProps;
      if (props?.pcode) {
        setSelected(props);
        void zoomToEntityDebounced(props.pcode);
      }
    }
  }, [zoomToEntityDebounced]);

  const navigerVersResult = useCallback((result: SearchResult) => {
    setLevel(result.level);
    setParentPcode(result.parentPcode ?? null);
    setBreadcrumb([
      { pcode: null, name: 'RDC', level: 0 },
      { pcode: result.pcode, name: result.name, level: result.level },
    ]);
    setSelected({
      pcode: result.pcode,
      name: result.name,
      level: result.level,
      parent_pcode: result.parentPcode ?? null,
      population: result.population ?? null,
      responsable_nom: null,
      responsable_titre: null,
      responsable_contact: null,
      statut: 'NORMAL',
      nb_incidents: 0,
    });
    setSearchQuery('');
    setSearchFocused(false);
    void zoomToPcode(result.pcode, 310);
  }, [zoomToPcode]);

  const remonter = useCallback(() => {
    if (breadcrumb.length <= 1) return;
    const idx = breadcrumb.length - 2;
    const item = breadcrumb[idx]!;
    const newCrumbs = breadcrumb.slice(0, idx + 1);
    setBreadcrumb(newCrumbs);
    setLevel(item.level + 1);
    setParentPcode(item.pcode);
    setSelected(null);
    if (item.pcode) { void zoomToPcode(item.pcode, 80); } else { zoomToRDC(); }
  }, [breadcrumb, zoomToPcode, zoomToRDC]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── HEADER ── */}
      <div className="bg-cc-900 border-b border-cc-700 px-4 py-2.5 flex items-center gap-3 shrink-0">
        <span className="text-lg">🛰️</span>
        <div className="min-w-0 hidden sm:block">
          <div className="text-white font-bold text-sm leading-tight">Salle des Opérations</div>
          <div className="text-cc-500 text-[10px] font-mono">Conflits · Épidémies · Renseignement · Temps réel</div>
        </div>

        {/* ── Recherche globale ── */}
        <div ref={searchRef} className="relative flex-1 max-w-xs mx-2">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            placeholder="Rechercher une division…"
            className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-1.5 text-[11px] text-gray-200 placeholder-cc-600 font-mono focus:outline-none focus:border-sinaur-600 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setSearchFocused(false); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-cc-600 hover:text-gray-300 text-[10px]"
            >✕</button>
          )}
          {searchFocused && searchResults && searchResults.length > 0 && (
            <div className="absolute top-full left-0 mt-1 w-full min-w-[280px] bg-cc-800 border border-cc-700 rounded-lg shadow-xl z-50 overflow-hidden max-h-72 overflow-y-auto">
              {searchResults.map(r => (
                <button
                  key={r.pcode}
                  onMouseDown={() => navigerVersResult(r)}
                  className="w-full px-3 py-2 text-left hover:bg-cc-700 flex items-center gap-2 border-b border-cc-700/40 last:border-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-white font-medium truncate">{r.name}</div>
                    <div className="text-[9px] font-mono text-cc-500">
                      {NIVEAU_LABELS[r.level] ?? `Niveau ${r.level}`} · {r.pcode}
                    </div>
                  </div>
                  {r.population != null && r.population > 0 && (
                    <div className="text-[9px] font-mono text-cc-600 shrink-0">
                      {r.population >= 1000
                        ? `${Math.round(r.population / 1000)}k`
                        : r.population} hab.
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Surveillance badge */}
          {survMode && (
            <span className="flex items-center gap-1.5 bg-red-900/60 border border-red-700 rounded-lg px-2 py-1 text-[9px] font-mono text-red-300">
              <span className="animate-pulse">●</span>
              SURVEILLANCE {survIndex + 1}/{crisisFeatures.length}
            </span>
          )}
          {/* Fond de carte */}
          <div className="flex rounded-lg overflow-hidden border border-cc-700">
            {(Object.entries(FONDS_CARTE) as [FondType, typeof FONDS_CARTE[FondType]][]).map(([cle, fond]) => (
              <button
                key={cle}
                onClick={() => setFondActuel(cle)}
                title={fond.label}
                className={`px-2 py-1 text-[11px] transition-colors ${
                  fondActuel === cle
                    ? 'bg-cc-700 text-white'
                    : 'text-cc-500 hover:text-gray-300 bg-cc-800'
                }`}
              >
                {fond.icon}
              </button>
            ))}
          </div>
          {/* Color mode toggle */}
          <div className="flex rounded-lg overflow-hidden border border-cc-700">
            {(['statut', 'sinistres', 'responsable'] as ColorMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setColorMode(mode)}
                className={`px-2.5 py-1 text-[10px] font-mono transition-colors ${
                  colorMode === mode
                    ? 'bg-sinaur-700 text-white'
                    : 'text-cc-500 hover:text-gray-300 bg-cc-800'
                }`}
              >
                {mode === 'statut' ? 'Statut' : mode === 'sinistres' ? 'Sinistres' : 'Resp.'}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowCouverture(v => !v)}
            className={`text-[10px] font-mono px-2.5 py-1 rounded-lg border transition-colors ${
              showCouverture
                ? 'bg-sinaur-700 text-white border-sinaur-600'
                : 'text-cc-500 hover:text-gray-300 bg-cc-800 border-cc-700'
            }`}
          >
            Couverture
          </button>
          <button
            onClick={() => setShowIncidentsPanel(v => !v)}
            className={`text-[10px] font-mono px-2.5 py-1 rounded-lg border transition-colors flex items-center gap-1 ${
              showIncidentsPanel
                ? 'bg-orange-900/60 text-orange-300 border-orange-700'
                : 'text-cc-500 hover:text-gray-300 bg-cc-800 border-cc-700'
            }`}
          >
            {showIncidentsPanel && <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse shrink-0" />}
            Incidents
          </button>
          <button
            onClick={() => setShowNominations(v => !v)}
            className={`relative text-[10px] font-mono px-2.5 py-1 rounded-lg border transition-colors ${
              showNominations
                ? 'bg-yellow-900/60 text-yellow-300 border-yellow-700'
                : 'text-cc-500 hover:text-gray-300 bg-cc-800 border-cc-700'
            }`}
          >
            Nominations
            {propositionsCount > 0 && !showNominations && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-yellow-500 text-black text-[8px] font-bold rounded-full flex items-center justify-center">
                {propositionsCount > 9 ? '9+' : propositionsCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowRues(v => !v)}
            className={`text-[10px] font-mono px-2.5 py-1 rounded-lg border transition-colors ${
              showRues
                ? 'bg-blue-900/60 text-blue-300 border-blue-700'
                : 'text-cc-500 hover:text-gray-300 bg-cc-800 border-cc-700'
            }`}
          >
            Voies
          </button>

          {/* ── Couches opérationnelles ── */}
          <div className="w-px h-5 bg-cc-700 shrink-0" />
          <button
            onClick={() => setShowConflits(v => !v)}
            title="Événements de conflit (flux temps réel · 30 s)"
            className={`text-[10px] font-mono px-2.5 py-1 rounded-lg border transition-colors flex items-center gap-1 ${
              showConflits
                ? 'bg-red-900/60 text-red-300 border-red-700'
                : 'text-cc-500 hover:text-gray-300 bg-cc-800 border-cc-700'
            }`}
          >
            {showConflits && <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse shrink-0" />}
            Conflits {opsConflitsCount > 0 && showConflits && <span className="text-[8px] opacity-70">({opsConflitsCount})</span>}
          </button>
          <button
            onClick={() => setShowMilitaire(v => !v)}
            title="Renseignement militaire (ACLED · Okapi · KMP · 30 s)"
            className={`text-[10px] font-mono px-2.5 py-1 rounded-lg border transition-colors flex items-center gap-1 ${
              showMilitaire
                ? 'bg-yellow-900/60 text-yellow-300 border-yellow-700'
                : 'text-cc-500 hover:text-gray-300 bg-cc-800 border-cc-700'
            }`}
          >
            {showMilitaire && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse shrink-0" />}
            Militaire {opsMilitaireCount > 0 && showMilitaire && <span className="text-[8px] opacity-70">({opsMilitaireCount})</span>}
          </button>
          {canSeeEpidemie && (
            <button
              onClick={() => setShowEpidemie(v => !v)}
              title="Zones épidémiques actives (5 min)"
              className={`text-[10px] font-mono px-2.5 py-1 rounded-lg border transition-colors flex items-center gap-1 ${
                showEpidemie
                  ? 'bg-purple-900/60 text-purple-300 border-purple-700'
                  : 'text-cc-500 hover:text-gray-300 bg-cc-800 border-cc-700'
              }`}
            >
              {showEpidemie && <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse shrink-0" />}
              Épidémies {opsEpidemieCount > 0 && showEpidemie && <span className="text-[8px] opacity-70">({opsEpidemieCount})</span>}
            </button>
          )}

          {user?.role === 'system_admin' && (
            <button
              onClick={() => refreshStatutsMutation.mutate()}
              disabled={refreshStatutsMutation.isPending}
              title="Recalcule statut_situation de toutes les divisions depuis les incidents (30j)"
              className={`text-[10px] font-mono px-2.5 py-1 rounded-lg border transition-colors ${
                refreshStatutsMutation.isPending
                  ? 'bg-cc-800 text-cc-600 border-cc-700 cursor-wait'
                  : refreshStatutsMutation.isSuccess
                  ? 'bg-green-900/60 text-green-300 border-green-700'
                  : 'text-cc-500 hover:text-gray-300 bg-cc-800 border-cc-700'
              }`}
            >
              {refreshStatutsMutation.isPending ? '↻ Calcul…' : '↻ Statuts'}
            </button>
          )}
        </div>
      </div>

      {/* ── BREADCRUMB ── */}
      <div className="bg-cc-950 border-b border-cc-800 px-4 py-1.5 flex items-center gap-1 shrink-0 overflow-x-auto">
        {breadcrumb.map((item, idx) => (
          <span key={`${item.pcode}-${idx}`} className="flex items-center gap-1 shrink-0">
            {idx > 0 && <span className="text-cc-700 text-xs">›</span>}
            <button
              onClick={() => onBreadcrumbClick(idx, item)}
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors ${
                idx === breadcrumb.length - 1
                  ? 'text-white bg-cc-800 font-bold'
                  : 'text-cc-500 hover:text-gray-300 hover:bg-cc-800'
              }`}
            >
              {item.name}
            </button>
          </span>
        ))}
        {isLoading && (
          <span className="text-[9px] text-cc-600 font-mono animate-pulse ml-2">Chargement…</span>
        )}
      </div>

      {/* ── BODY ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <div className="flex flex-1 overflow-hidden min-h-0">

          {/* Map */}
          <div className="flex-1 relative">
            {/* Avertissement zones indicatives — visible uniquement au niveau quartier */}
            {level === 4 && hasVoronoi && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-amber-950/90 border border-amber-700/60 text-amber-300 text-[10px] font-mono px-3 py-1.5 rounded-full shadow backdrop-blur-sm pointer-events-none">
                <span className="inline-block w-3 h-px border-t border-dashed border-amber-400 mr-0.5" />
                Limites de quartiers indicatives (approximation Voronoï) — les communes sont officielles
              </div>
            )}
            <MapGL
              ref={mapRef}
              mapStyle={FONDS_CARTE[fondActuel].style as any}
              initialViewState={{ longitude: 24.5, latitude: -3.0, zoom: 4.5 }}
              onClick={onMapClick}
              onLoad={onMapLoad}
              onMove={e => setMapZoom(e.viewState.zoom)}
              interactiveLayerIds={[
                'carto-fill', 'carto-points',
                ...(hasCrises ? ['crisis-pulse-layer'] : []),
                ...(showGlobalQuartiers ? ['quartiers-globe-fill', 'quartiers-globe-points'] : []),
              ]}
              style={{ width: '100%', height: '100%' }}
            >
              {/* Limites officielles OCHA — toujours montées en dessous de carto */}
              <Source id="admin2" type="geojson" data="/geo/admin2.geojson">
                <Layer
                  id="territory-lines"
                  type="line"
                  maxzoom={8}
                  paint={{
                    'line-color': '#94a3b8',
                    'line-width': 0.5,
                    'line-dasharray': [4, 3],
                    'line-opacity': 0.4,
                  }}
                />
              </Source>
              <Source id="admin0" type="geojson" data="/geo/admin0.geojson">
                <Layer
                  id="country-border"
                  type="line"
                  paint={{
                    'line-color': '#475569',
                    'line-width': 1.5,
                    'line-opacity': 0.7,
                  }}
                />
              </Source>

              {/* Surcouche flux — signaux non confirmés (orange translucide + tirets) */}
              <Source id="flux-signaux" type="geojson" data={fluxSignauxGeoJson}>
                {/* Remplissage translucide — indique un signal non vérifié */}
                <Layer
                  id="flux-signaux-fill"
                  type="fill"
                  paint={{
                    'fill-color': [
                      'case',
                      ['>', ['get', 'flux_confirmes'], 0], '#ea580c',
                      '#f97316',
                    ] as any,
                    'fill-opacity': 0.12,
                  }}
                />
                {/* Bordure tiretée — distingue visuellement du statut officiel */}
                <Layer
                  id="flux-signaux-line"
                  type="line"
                  paint={{
                    'line-color': [
                      'case',
                      ['>', ['get', 'flux_confirmes'], 0], '#ea580c',
                      '#f97316',
                    ] as any,
                    'line-width': 1.5,
                    'line-dasharray': [4, 3],
                    'line-opacity': 0.7,
                  }}
                />
              </Source>

              {/* ── SALLE DES OPÉRATIONS — Couches thématiques temps réel ── */}

              {/* Conflits civils — cercles rouges par province */}
              <Source id="ops-conflits" type="geojson" data={conflitsGeoJson}>
                <Layer id="ops-conflits-halo" type="circle" paint={{
                  'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 14, 10, 28, 30, 40] as any,
                  'circle-color': ['case',
                    ['>=', ['get', 'maxGravite'], 3], '#dc2626',
                    ['>=', ['get', 'maxGravite'], 2], '#ea580c',
                    '#f97316'] as any,
                  'circle-opacity': 0.15,
                  'circle-stroke-width': 0,
                }} />
                <Layer id="ops-conflits-circle" type="circle" paint={{
                  'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 7, 10, 16, 30, 24] as any,
                  'circle-color': ['case',
                    ['>=', ['get', 'maxGravite'], 3], '#dc2626',
                    ['>=', ['get', 'maxGravite'], 2], '#ea580c',
                    '#f97316'] as any,
                  'circle-opacity': 0.85,
                  'circle-stroke-color': '#fff',
                  'circle-stroke-width': 1.5,
                }} />
                <Layer id="ops-conflits-label" type="symbol" layout={{
                  'text-field': ['to-string', ['get', 'count']] as any,
                  'text-size': 11,
                  'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                  'text-anchor': 'center',
                }} paint={{ 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 0.5 }} />
              </Source>

              {/* Renseignement militaire — losanges jaunes */}
              <Source id="ops-militaire" type="geojson" data={militaireGeoJson}>
                <Layer id="ops-militaire-halo" type="circle" paint={{
                  'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 12, 20, 26] as any,
                  'circle-color': '#eab308',
                  'circle-opacity': 0.15,
                  'circle-stroke-width': 0,
                }} />
                <Layer id="ops-militaire-circle" type="circle" paint={{
                  'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 6, 20, 14] as any,
                  'circle-color': '#eab308',
                  'circle-opacity': 0.9,
                  'circle-stroke-color': '#1c1917',
                  'circle-stroke-width': 1.5,
                }} />
                <Layer id="ops-militaire-label" type="symbol" layout={{
                  'text-field': ['to-string', ['get', 'count']] as any,
                  'text-size': 10,
                  'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                  'text-anchor': 'center',
                }} paint={{ 'text-color': '#1c1917', 'text-halo-color': '#eab308', 'text-halo-width': 0.3 }} />
              </Source>

              {/* Épidémies — cercles violets */}
              <Source id="ops-epidemie" type="geojson" data={epidemieGeoJson}>
                <Layer id="ops-epidemie-halo" type="circle" paint={{
                  'circle-radius': ['interpolate', ['linear'], ['get', 'cas'], 0, 12, 100, 28, 500, 42] as any,
                  'circle-color': '#a855f7',
                  'circle-opacity': 0.15,
                  'circle-stroke-width': 0,
                }} />
                <Layer id="ops-epidemie-circle" type="circle" paint={{
                  'circle-radius': ['interpolate', ['linear'], ['get', 'cas'], 0, 6, 100, 14, 500, 22] as any,
                  'circle-color': '#a855f7',
                  'circle-opacity': 0.88,
                  'circle-stroke-color': '#fff',
                  'circle-stroke-width': 1.5,
                }} />
                <Layer id="ops-epidemie-label" type="symbol" layout={{
                  'text-field': ['to-string', ['get', 'cas']] as any,
                  'text-size': 10,
                  'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                  'text-anchor': 'center',
                }} paint={{ 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 0.5 }} />
              </Source>

              {/* Source toujours monté pour éviter unmount/remount lors de la navigation entre niveaux */}
              <Source id="carto" type="geojson" data={polygonGeojson}>
                  {/* Fill */}
                  <Layer
                    id="carto-fill"
                    type="fill"
                    paint={{
                      'fill-color': fillColorExpr as any,
                      'fill-opacity': [
                        'case',
                        ['==', ['get', 'pcode'], selected?.pcode ?? ''],
                        isSatellite ? 0.25 : 0.85,
                        isSatellite ? 0.08 : 0.65,
                      ] as any,
                    }}
                  />
                  {/* Outline */}
                  <Layer
                    id="carto-outline"
                    type="line"
                    paint={{
                      'line-color': [
                        'case',
                        ['==', ['get', 'pcode'], selected?.pcode ?? ''], '#ffffff',
                        isSatellite ? '#60a5fa' : '#334155',
                      ] as any,
                      'line-width': [
                        'case',
                        ['==', ['get', 'pcode'], selected?.pcode ?? ''], 2.5,
                        isSatellite ? 1.5 : 0.8,
                      ] as any,
                      'line-opacity': isSatellite ? 0.7 : 0.9,
                    }}
                  />
                  {/* Surimpression pointillée — zones Voronoï indicatives */}
                  <Layer
                    id="carto-approx-dash"
                    type="line"
                    filter={['==', ['get', 'geometry_type'], 'VORONOI_APPROX']}
                    paint={{
                      'line-color': isSatellite ? '#e2e8f0' : '#94a3b8',
                      'line-width': 1,
                      'line-dasharray': [4, 3],
                      'line-opacity': 0.75,
                    }}
                  />
                  {/* Labels */}
                  <Layer
                    id="carto-labels"
                    type="symbol"
                    layout={{
                      'text-field': ['get', 'name'],
                      'text-size': 10,
                      'text-font': ['Open Sans Regular'],
                      'text-max-width': 8,
                    }}
                    paint={{
                      'text-color': labelStyle.textColor,
                      'text-halo-color': labelStyle.haloColor,
                      'text-halo-width': labelStyle.haloWidth,
                    }}
                  />
                </Source>

              {/* Crisis pulse overlay */}
              {crisisGeoJson.features.length > 0 && (
                <Source id="crisis-pulse" type="geojson" data={crisisGeoJson}>
                  <Layer
                    id="crisis-pulse-layer"
                    type="fill"
                    paint={{
                      'fill-color': '#dc2626',
                      'fill-opacity': pulseOn ? 0.45 : 0.10,
                    }}
                  />
                </Source>
              )}

              {/* Niveau 4 — quartiers comme cercles (centroïdes OSM, pas de polygones) */}
              {pointGeojson.features.length > 0 && (
                <Source id="carto-pts" type="geojson" data={pointGeojson}>
                  <Layer
                    id="carto-points"
                    type="circle"
                    paint={{
                      'circle-radius': [
                        'case',
                        ['==', ['get', 'pcode'], selected?.pcode ?? ''], 8,
                        5,
                      ] as any,
                      'circle-color': fillColorExpr as any,
                      'circle-opacity': 0.9,
                      'circle-stroke-color': [
                        'case',
                        ['==', ['get', 'pcode'], selected?.pcode ?? ''], '#ffffff',
                        '#334155',
                      ] as any,
                      'circle-stroke-width': [
                        'case',
                        ['==', ['get', 'pcode'], selected?.pcode ?? ''], 2,
                        1,
                      ] as any,
                    }}
                  />
                  <Layer
                    id="carto-points-labels"
                    type="symbol"
                    layout={{
                      'text-field': ['get', 'name'],
                      'text-size': 11,
                      'text-font': ['Open Sans Regular'],
                      'text-offset': [0, 1.2],
                      'text-anchor': 'top',
                      'text-max-width': 8,
                      'text-allow-overlap': false,
                      'text-optional': true,
                    }}
                    paint={{
                      'text-color': labelStyle.textColor,
                      'text-halo-color': labelStyle.haloColor,
                      'text-halo-width': labelStyle.haloWidth,
                    }}
                  />
                </Source>
              )}

              {/* Overlay quartiers globaux — visible à zoom ≥ 12, indépendant du drill-down */}
              {showGlobalQuartiers && (
                <Source id="quartiers-globe" type="geojson" data={quartiersGlobalAll}>
                  {/* Zones Voronoï — polygones colorés par statut */}
                  <Layer
                    id="quartiers-globe-fill"
                    type="fill"
                    filter={['!=', '$type', 'Point']}
                    paint={{
                      'fill-color': ['match', ['get', 'statut'],
                        'CRISE',     '#dc2626',
                        'ALERTE',    '#ea580c',
                        'VIGILANCE', '#eab308',
                        'NORMAL',    '#16a34a',
                        '#64748b',
                      ],
                      'fill-opacity': isSatellite ? 0.25 : 0.40,
                    }}
                  />
                  <Layer
                    id="quartiers-globe-dashes"
                    type="line"
                    filter={['!=', '$type', 'Point']}
                    paint={{
                      'line-color': isSatellite ? '#e2e8f0' : '#94a3b8',
                      'line-width': 0.8,
                      'line-dasharray': [4, 3],
                      'line-opacity': 0.6,
                    }}
                  />
                  {/* Points — quartiers sans commune (pas de Voronoï possible) */}
                  <Layer
                    id="quartiers-globe-points"
                    type="circle"
                    filter={['==', '$type', 'Point']}
                    paint={{
                      'circle-radius': 5,
                      'circle-color': '#2d7dd2',
                      'circle-stroke-width': 1.5,
                      'circle-stroke-color': '#ffffff',
                      'circle-opacity': 0.85,
                    }}
                  />
                  <Layer
                    id="quartiers-globe-labels"
                    type="symbol"
                    layout={{
                      'text-field': ['get', 'name'],
                      'text-size': 11,
                      'text-font': ['Open Sans Regular'],
                      'text-offset': [0, 1.0],
                      'text-anchor': 'top',
                      'text-allow-overlap': false,
                      'text-optional': true,
                    }}
                    paint={{
                      'text-color': labelStyle.textColor,
                      'text-halo-color': labelStyle.haloColor,
                      'text-halo-width': labelStyle.haloWidth,
                    }}
                  />
                </Source>
              )}
              {/* Voies / rues — lignes et points */}
              {showRues && ruesLines.features.length > 0 && (
                <Source id="rues-lines" type="geojson" data={ruesLines}>
                  <Layer
                    id="rues-lines-layer"
                    type="line"
                    paint={{ 'line-color': '#60a5fa', 'line-width': 2, 'line-opacity': 0.85 }}
                  />
                  <Layer
                    id="rues-lines-labels"
                    type="symbol"
                    layout={{
                      'text-field': ['get', 'nom'],
                      'text-size': 10,
                      'text-font': ['Open Sans Regular'],
                      'symbol-placement': 'line',
                      'text-keep-upright': true,
                      'text-max-angle': 45,
                      'text-offset': [0, -0.6],
                    }}
                    paint={{ 'text-color': '#93c5fd', 'text-halo-color': '#000', 'text-halo-width': 1.5 }}
                  />
                </Source>
              )}
              {showRues && ruesPoints.features.length > 0 && (
                <Source id="rues-points" type="geojson" data={ruesPoints}>
                  <Layer
                    id="rues-points-layer"
                    type="circle"
                    paint={{ 'circle-radius': 4, 'circle-color': '#60a5fa', 'circle-opacity': 0.75, 'circle-stroke-color': '#1e40af', 'circle-stroke-width': 1 }}
                  />
                </Source>
              )}
            </MapGL>

            {/* No-geometry notice — overlay on top of the map, never replaces it */}
            {!hasGeometry && !isLoading && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-cc-900/85 backdrop-blur-sm rounded-xl px-5 py-4 text-center border border-cc-700">
                  <div className="text-cc-500 text-sm font-medium">Polygones COD-AB non disponibles</div>
                  <div className="text-cc-700 text-[10px] font-mono mt-1">Consultez la liste ci-dessous</div>
                </div>
              </div>
            )}

            {/* Zoom controls overlay */}
            <ZoomControls
              onRDC={zoomToRDC}
              onMyZone={() => userScopePcode && void zoomToPcode(userScopePcode, selected ? 310 : 80)}
              onCrises={zoomToCrises}
              onSurveillance={toggleSurveillance}
              onBack={remonter}
              hasCrises={hasCrises}
              survMode={survMode}
              hasScope={hasScope}
              canBack={breadcrumb.length > 1}
              survIndex={survIndex}
              crisisCount={crisisFeatures.length}
            />

            {/* Nominations détectées par l'IA */}
            {showNominations && (
              <div className="absolute top-3 left-3 w-72 bg-cc-900/95 border border-yellow-800/70 rounded-xl shadow-xl backdrop-blur-sm z-20 overflow-hidden">
                <div className="px-3 py-2 border-b border-yellow-800/40 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-yellow-400 text-sm">🔔</span>
                    <span className="text-[9px] font-mono text-yellow-300 uppercase tracking-wider">Nominations détectées</span>
                    {propositionsCount > 0 && (
                      <span className="bg-yellow-500 text-black text-[8px] font-bold px-1.5 py-px rounded-full">{propositionsCount}</span>
                    )}
                  </div>
                </div>
                <div className="max-h-80 overflow-y-auto p-2 space-y-2">
                  {(!propositionsRaw || propositionsRaw.length === 0) ? (
                    <div className="text-center text-cc-600 text-[9px] py-4 font-mono italic">
                      {!propositionsRaw ? 'Chargement…' : 'Aucune nomination en attente'}
                    </div>
                  ) : (
                    (propositionsRaw as any[]).slice(0, 10).map((p: any) => (
                      <div key={p.id} className="bg-cc-800/60 border border-cc-700 rounded-lg px-2.5 py-2">
                        <div className="flex items-start gap-2 mb-1.5">
                          <div className="flex-1 min-w-0">
                            <div className="text-[10px] text-white font-semibold truncate">{p.personne ?? '—'}</div>
                            <div className="text-[9px] text-yellow-400 font-mono truncate">{p.fonction ?? '—'}</div>
                            <div className="text-[8px] text-cc-500 font-mono mt-0.5">{p.entite_nom ?? p.pcode ?? '—'}</div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-[8px] font-mono font-bold" style={{
                              color: (p.confiance ?? 0.7) >= 0.85 ? '#22c55e' : (p.confiance ?? 0.7) >= 0.65 ? '#eab308' : '#f97316',
                            }}>
                              {Math.round((p.confiance ?? 0.7) * 100)}%
                            </div>
                            {p.statut_rapprochement === 'AMBIGU' && (
                              <span className="text-[7px] text-orange-400 font-mono">AMBIGU</span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => validateNomMutation.mutate(p.id)}
                            disabled={validateNomMutation.isPending || p.statut_rapprochement === 'ENTITE_INTROUVABLE'}
                            className="flex-1 py-0.5 bg-green-900/60 hover:bg-green-800 border border-green-700 text-green-300 text-[8px] font-mono rounded transition-colors disabled:opacity-40"
                          >✓ Valider</button>
                          <button
                            onClick={() => rejectNomMutation.mutate(p.id)}
                            disabled={rejectNomMutation.isPending}
                            className="flex-1 py-0.5 bg-red-900/60 hover:bg-red-800 border border-red-700 text-red-300 text-[8px] font-mono rounded transition-colors disabled:opacity-40"
                          >✕ Rejeter</button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {propositionsRaw && (propositionsRaw as any[]).length > 10 && (
                  <div className="px-3 py-1.5 border-t border-cc-800 text-[8px] font-mono text-cc-600 text-center">
                    +{(propositionsRaw as any[]).length - 10} autres · voir page Propositions
                  </div>
                )}
              </div>
            )}

            {/* Real-time incidents by province */}
            {showIncidentsPanel && (
              <div
                className="absolute top-3 w-56 bg-cc-900/95 border border-cc-700 rounded-xl shadow-xl backdrop-blur-sm z-10 overflow-hidden"
                style={{ left: showNominations ? '308px' : '12px' }}
              >
                <div className="px-3 py-2 border-b border-cc-700 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse shrink-0" />
                    <span className="text-[9px] font-mono text-cc-400 uppercase tracking-wider">Incidents 7j / province</span>
                  </div>
                  {incidentsUpdatedAt > 0 && (
                    <span className="text-[8px] font-mono text-cc-600">
                      {new Date(incidentsUpdatedAt).toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
                <div className="p-2 space-y-1.5 max-h-72 overflow-y-auto">
                  {incidentsByProvince.length === 0 ? (
                    <div className="text-center text-cc-600 text-[9px] py-4 font-mono italic">
                      {!recentEventsRaw ? 'Chargement…' : 'Aucun incident récent'}
                    </div>
                  ) : (
                    incidentsByProvince.map((item, idx) => {
                      const max = incidentsByProvince[0]?.count ?? 1;
                      const pct = Math.round((item.count / max) * 100);
                      return (
                        <div
                          key={item.pcode}
                          className="cursor-pointer group"
                          onClick={() => void zoomToPcode(item.pcode, 80)}
                        >
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[9px] text-gray-300 truncate max-w-[130px] group-hover:text-white transition-colors">
                              <span className="text-cc-700 font-mono mr-1">{idx + 1}.</span>
                              {item.name}
                            </span>
                            <span className="text-[9px] font-bold text-orange-400 font-mono shrink-0">{item.count}</span>
                          </div>
                          <div className="h-1 bg-cc-800 rounded-full overflow-hidden">
                            <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="px-3 py-1.5 border-t border-cc-800 text-[8px] font-mono text-cc-700 text-center">
                  Actualisation auto · 30 s
                </div>
              </div>
            )}

            {/* Legend */}
            {hasGeometry && (
              <div className="absolute bottom-4 left-4 bg-cc-900/90 border border-cc-700 rounded-lg p-3 space-y-1.5 backdrop-blur-sm">
                <div className="text-[9px] font-mono text-cc-500 uppercase mb-1.5">
                  {colorMode === 'statut' ? 'Situation' : colorMode === 'sinistres' ? 'Incidents 30j' : 'Responsable'}
                </div>
                {colorMode === 'statut' ? (
                  <>
                    {[
                      { color: '#dc2626', label: 'CRISE'     },
                      { color: '#ea580c', label: 'ALERTE'    },
                      { color: '#eab308', label: 'VIGILANCE' },
                      { color: '#16a34a', label: 'NORMAL'    },
                      { color: '#64748b', label: 'Inconnu'   },
                    ].map(l => (
                      <div key={l.label} className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm shrink-0" style={{ backgroundColor: l.color }} />
                        <span className="text-[9px] text-gray-400">{l.label}</span>
                      </div>
                    ))}
                    {/* Légende flux signaux non confirmés */}
                    {fluxSignauxGeoJson.features.length > 0 && (
                      <div className="flex items-center gap-2 mt-1 pt-1 border-t border-cc-700">
                        <div className="w-3.5 h-3.5 rounded-sm shrink-0 border-2 border-dashed border-orange-500 opacity-70" />
                        <span className="text-[9px] text-orange-400">Signaux non confirmés</span>
                      </div>
                    )}
                  </>
                ) : colorMode === 'responsable' ? (
                  [
                    { color: '#16a34a', label: 'Responsable nommé' },
                    { color: '#dc2626', label: 'Sans responsable'  },
                  ].map(l => (
                    <div key={l.label} className="flex items-center gap-2">
                      <div className="w-3.5 h-3.5 rounded-sm shrink-0" style={{ backgroundColor: l.color }} />
                      <span className="text-[9px] text-gray-400">{l.label}</span>
                    </div>
                  ))
                ) : (
                  [
                    { color: '#7c2d12', label: '≥ 15 incidents' },
                    { color: '#854d0e', label: '5 – 14 incidents' },
                    { color: '#134e2a', label: '0 – 4 incidents' },
                  ].map(l => (
                    <div key={l.label} className="flex items-center gap-2">
                      <div className="w-3.5 h-3.5 rounded-sm shrink-0" style={{ backgroundColor: l.color }} />
                      <span className="text-[9px] text-gray-400">{l.label}</span>
                    </div>
                  ))
                )}
                {showRues && ruesGeoJson.features.length > 0 && (
                  <div className="mt-1 pt-1.5 border-t border-cc-700 flex items-center gap-2">
                    <div className="w-3.5 h-1 rounded-full bg-blue-400 shrink-0" />
                    <span className="text-[9px] text-gray-400">Voies ({ruesGeoJson.features.length})</span>
                  </div>
                )}
                {showRues && !ruesPcode && (
                  <div className="mt-1 pt-1.5 border-t border-cc-700 text-[8px] text-blue-400 font-mono italic">
                    Voies : naviguez au<br />niveau Secteur/Groupement
                  </div>
                )}

                {/* Légende couches opérationnelles */}
                {(showConflits || showMilitaire || showEpidemie) && (
                  <div className="mt-1.5 pt-1.5 border-t border-cc-700 space-y-1">
                    <div className="text-[8px] font-mono text-cc-600 uppercase mb-1">Salle des ops</div>
                    {showConflits && (
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-full bg-red-500 shrink-0 opacity-85" />
                        <span className="text-[9px] text-red-300">Conflits ({opsConflitsCount} prov.)</span>
                      </div>
                    )}
                    {showMilitaire && (
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-full bg-yellow-500 shrink-0 opacity-90" />
                        <span className="text-[9px] text-yellow-300">Renseignement ({opsMilitaireCount} prov.)</span>
                      </div>
                    )}
                    {showEpidemie && (
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-full bg-purple-500 shrink-0 opacity-88" />
                        <span className="text-[9px] text-purple-300">Épidémies ({opsEpidemieCount} prov.)</span>
                      </div>
                    )}
                    {opsUpdatedAt > 0 && (
                      <div className="text-[8px] font-mono text-cc-700">
                        ↻ {new Date(opsUpdatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Meta info */}
            {geojson?._meta && (
              <div className="absolute bottom-4 right-4 text-[8px] text-cc-700 font-mono">
                {geojson._meta.total} entités · {geojson._meta.withGeometry} avec géométrie
              </div>
            )}
          </div>

          {/* Side panel */}
          {selected && (
            <EntityPanel
              entity={selected}
              onClose={() => setSelected(null)}
              onDrillDown={onDrillDown}
            />
          )}
        </div>
      </div>

      {/* ── ENTITIES TABLE ── */}
      <div className="shrink-0 border-t border-cc-700 bg-cc-900">
        <div className="px-4 py-1.5 border-b border-cc-800 flex items-center gap-2">
          <span className="text-[9px] font-mono text-cc-500 uppercase">
            {entities.length} entités — {NIVEAU_LABELS[level] ?? `Niveau ${level}`}
          </span>
        </div>
        <div className="max-h-52 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-cc-900 z-10">
              <tr className="text-cc-500 font-mono text-[9px] uppercase border-b border-cc-800">
                <th className="text-left px-3 py-1.5">Pcode</th>
                <th className="text-left px-3 py-1.5">Nom</th>
                <th className="text-left px-3 py-1.5">Responsable</th>
                <th className="text-left px-3 py-1.5">Statut</th>
                <th className="text-right px-3 py-1.5">Pop.</th>
                <th className="text-right px-3 py-1.5">Incidents</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cc-800/50">
              {entities.map(entity => {
                const statut = STATUT_STYLE[entity.statut] ?? STATUT_STYLE['NORMAL']!;
                const isSelected = selected?.pcode === entity.pcode;
                const fluxSig = level === 1 ? fluxByPcode.get(entity.pcode as string) : undefined;
                return (
                  <tr
                    key={entity.pcode}
                    onClick={() => setSelected(entity)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-sinaur-900/40' : 'hover:bg-cc-800/60'
                    }`}
                  >
                    <td className="px-3 py-1.5 font-mono text-cc-600">{entity.pcode}</td>
                    <td className="px-3 py-1.5 text-gray-200 font-medium max-w-[160px] truncate">{entity.name}</td>
                    <td className="px-3 py-1.5 max-w-[140px]">
                      {entity.responsable_nom ? (
                        <span className="text-gray-300 truncate block">{entity.responsable_nom}</span>
                      ) : (
                        <span className="text-cc-700 italic">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className={`text-[8px] px-1.5 py-px rounded border font-bold ${statut.cls}`}>
                        {entity.statut}
                      </span>
                      {fluxSig && fluxSig.aConfirmer > 0 && (
                        <span
                          className="ml-1 text-[8px] px-1 py-px rounded border border-orange-600 text-orange-400 font-mono"
                          title={`${fluxSig.aConfirmer} signal(s) non confirmé(s) · ${fluxSig.confirmes} confirmé(s)`}
                        >
                          ~{fluxSig.aConfirmer}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-cc-500">
                      {entity.population != null ? entity.population.toLocaleString('fr-FR') : '—'}
                    </td>
                    <td className={`px-3 py-1.5 text-right font-mono font-bold ${
                      entity.nb_incidents > 0 ? 'text-orange-400' : 'text-green-500'
                    }`}>
                      {entity.nb_incidents}
                    </td>
                  </tr>
                );
              })}
              {entities.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-cc-600 text-[10px] font-mono italic">
                    Aucune entité trouvée pour ce niveau
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── COUVERTURE PANEL ── */}
      {showCouverture && couvertureData && couvertureData.length > 0 && (
        <CouverturePanel data={couvertureData} />
      )}
    </div>
  );
}
