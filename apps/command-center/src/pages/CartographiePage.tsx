import { useState, useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import MapGL, { Source, Layer, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { apiClient } from '../lib/api.js';

// ── TYPES ─────────────────────────────────────────────────────────────────────

interface EntityProps {
  pcode: string;
  name: string;
  level: number;
  parent_pcode: string | null;
  population: number | null;
  responsable_nom: string | null;
  responsable_titre: string | null;
  responsable_contact: string | null;
  statut: 'NORMAL' | 'VIGILANCE' | 'ALERTE' | 'CRISE';
  nb_incidents: number;
}

type ColorMode = 'statut' | 'sinistres';

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

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

const NIVEAU_LABELS: Record<number, string> = {
  0: 'Pays',
  1: 'Province',
  2: 'Territoire / Ville',
  3: 'Commune · Secteur · Chefferie',
  4: 'Groupement',
  5: 'Village',
};

const NIVEAU_ENFANTS: Record<number, string> = {
  1: 'les territoires',
  2: 'les communes/secteurs',
  3: 'les groupements',
};

const ETD_LEVELS = new Set([3]); // niveau 3 = ETD (personnalité juridique)

const STATUT_STYLE: Record<string, { cls: string; dot: string }> = {
  NORMAL:    { cls: 'bg-green-900/60 text-green-300 border-green-700',  dot: 'bg-green-400'  },
  VIGILANCE: { cls: 'bg-yellow-900/60 text-yellow-300 border-yellow-700', dot: 'bg-yellow-400' },
  ALERTE:    { cls: 'bg-orange-900/60 text-orange-300 border-orange-700', dot: 'bg-orange-400' },
  CRISE:     { cls: 'bg-red-900/60 text-red-300 border-red-700',          dot: 'bg-red-500 animate-pulse' },
};

// ── MAP STYLE (dark theme, same as EpidemicPage) ──────────────────────────────

const MAP_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap',
    },
  },
  layers: [
    { id: 'bg',  type: 'background' as const, paint: { 'background-color': '#0d1b2a' } },
    { id: 'osm', type: 'raster'     as const, source: 'osm', paint: {
      'raster-saturation': -1, 'raster-brightness-max': 0.30,
      'raster-opacity': 0.80,  'raster-contrast': 0.05,
    }},
  ],
};

// ── SIDE PANEL ────────────────────────────────────────────────────────────────

function EntityPanel({
  entity,
  onClose,
  onDrillDown,
}: {
  entity: EntityProps;
  onClose: () => void;
  onDrillDown: (entity: EntityProps) => void;
}) {
  const statut = STATUT_STYLE[entity.statut] ?? STATUT_STYLE['NORMAL']!;
  const isEtd = ETD_LEVELS.has(entity.level);
  const canDrillDown = entity.level in NIVEAU_ENFANTS;

  return (
    <div className="w-72 shrink-0 bg-cc-900 border-l border-cc-700 flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="bg-cc-800 border-b border-cc-700 px-4 py-3 flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[9px] font-mono text-cc-500 uppercase mb-0.5">
            {NIVEAU_LABELS[entity.level] ?? `Niveau ${entity.level}`}
          </div>
          <div className="text-sm font-bold text-white leading-tight truncate">{entity.name}</div>
          <div className="text-[9px] font-mono text-cc-600 mt-0.5">{entity.pcode}</div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className={`text-[9px] font-bold px-1.5 py-px rounded border ${statut.cls}`}>
            {entity.statut}
          </span>
          <button onClick={onClose} className="text-cc-600 hover:text-white text-[10px]">✕</button>
        </div>
      </div>

      {/* QUI GÈRE */}
      <div className="px-4 py-3 border-b border-cc-700">
        <div className="text-[9px] font-mono text-cc-500 uppercase mb-2 tracking-wider">
          Qui gère cette zone
        </div>
        <div className="space-y-1.5">
          <div className="flex items-start gap-2">
            <span className="text-sm shrink-0 mt-0.5">👤</span>
            <div className="min-w-0">
              {entity.responsable_titre && (
                <div className="text-[10px] text-cc-500 font-mono">{entity.responsable_titre}</div>
              )}
              <div className={`text-xs font-semibold ${entity.responsable_nom ? 'text-white' : 'text-cc-600 italic'}`}>
                {entity.responsable_nom ?? 'Non assigné'}
              </div>
              {entity.responsable_contact && (
                <a
                  href={`mailto:${entity.responsable_contact}`}
                  className="text-[10px] text-sinaur-400 hover:text-sinaur-300 font-mono break-all"
                >
                  {entity.responsable_contact}
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Type d'entité */}
      <div className="px-4 py-2.5 border-b border-cc-700">
        <div className={`text-[9px] px-2 py-1 rounded border inline-block font-mono ${
          isEtd
            ? 'bg-blue-950/60 text-blue-300 border-blue-800'
            : 'bg-cc-800 text-cc-500 border-cc-700'
        }`}>
          {isEtd
            ? 'ETD · Entité Territoriale Décentralisée'
            : 'Entité déconcentrée'}
        </div>
      </div>

      {/* Stats */}
      <div className="px-4 py-3 border-b border-cc-700 space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-cc-500 font-mono">Population</span>
          <span className="text-gray-300 font-bold">
            {entity.population != null
              ? entity.population.toLocaleString('fr-FR') + ' hab.'
              : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-cc-500 font-mono">Incidents 30j</span>
          <span className={`font-bold ${entity.nb_incidents > 0 ? 'text-orange-300' : 'text-green-400'}`}>
            {entity.nb_incidents}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-3 space-y-2">
        {canDrillDown && (
          <button
            onClick={() => onDrillDown(entity)}
            className="w-full text-left text-xs bg-sinaur-900/60 hover:bg-sinaur-800 border border-sinaur-700 text-sinaur-300 rounded-lg px-3 py-2 font-mono transition-colors"
          >
            Voir {NIVEAU_ENFANTS[entity.level]} →
          </button>
        )}
        <button
          onClick={onClose}
          className="w-full text-[10px] text-cc-600 hover:text-gray-300 font-mono py-1 transition-colors"
        >
          ✕ Fermer
        </button>
      </div>
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
  const [level, setLevel]               = useState(1);
  const [parentPcode, setParentPcode]   = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb]     = useState<BreadcrumbItem[]>([
    { pcode: null, name: 'RDC', level: 0 },
  ]);
  const [selected, setSelected]         = useState<EntityProps | null>(null);
  const [colorMode, setColorMode]       = useState<ColorMode>('statut');
  const [showCouverture, setShowCouverture] = useState(false);

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

  // ── Derived data ───────────────────────────────────────────────────────────

  const entities: EntityProps[] = useMemo(() => {
    if (!geojson?.features) return [];
    return geojson.features
      .map(f => f.properties as EntityProps)
      .filter(Boolean);
  }, [geojson]);

  const allEntities: EntityProps[] = useMemo(() => {
    // Also include entities from rows (including those without geometry)
    // The API returns total vs withGeometry in _meta
    // For the table, we need to fetch the full list including no-geometry entries
    return entities;
  }, [entities]);

  const hasGeometry = useMemo(() => {
    if (!geojson) return false;
    return (geojson._meta?.withGeometry ?? geojson.features?.length ?? 0) > 0;
  }, [geojson]);

  // ── Fill color expression ──────────────────────────────────────────────────

  const fillColorExpr = useMemo(() => {
    if (colorMode === 'statut') {
      return ['match', ['get', 'statut'],
        'CRISE',     '#dc2626',
        'ALERTE',    '#ea580c',
        'VIGILANCE', '#eab308',
        'NORMAL',    '#16a34a',
        /* default */ '#64748b',
      ] as unknown as string;
    }
    return ['interpolate', ['linear'], ['get', 'nb_incidents'],
      0,  '#134e2a',
      5,  '#854d0e',
      15, '#7c2d12',
    ] as unknown as string;
  }, [colorMode]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const onDrillDown = useCallback((entity: EntityProps) => {
    const nextLevel = entity.level + 1;
    setLevel(nextLevel);
    setParentPcode(entity.pcode);
    setBreadcrumb(prev => [
      ...prev,
      { pcode: entity.pcode, name: entity.name, level: entity.level },
    ]);
    setSelected(null);
  }, []);

  const onBreadcrumbClick = useCallback((idx: number, item: BreadcrumbItem) => {
    // Navigate back to this breadcrumb level
    const newCrumbs = breadcrumb.slice(0, idx + 1);
    setBreadcrumb(newCrumbs);
    setLevel(item.level + 1);
    setParentPcode(item.pcode);
    setSelected(null);
  }, [breadcrumb]);

  const onMapClick = useCallback((e: MapLayerMouseEvent) => {
    const features = e.features;
    if (!features || features.length === 0) {
      setSelected(null);
      return;
    }
    const f = features[0];
    if (f.layer?.id === 'carto-fill' || f.layer?.id === 'carto-outline') {
      const props = f.properties as EntityProps;
      if (props?.pcode) {
        setSelected(props);
      }
    }
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── HEADER ── */}
      <div className="bg-cc-900 border-b border-cc-700 px-4 py-2.5 flex items-center gap-3 shrink-0">
        <span className="text-lg">🗺️</span>
        <div className="flex-1 min-w-0">
          <div className="text-white font-bold text-sm leading-tight">Cartographie Administrative</div>
          <div className="text-cc-500 text-[10px] font-mono">Qui gère quoi sur le territoire de la RDC</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Color mode toggle */}
          <div className="flex rounded-lg overflow-hidden border border-cc-700">
            {(['statut', 'sinistres'] as ColorMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setColorMode(mode)}
                className={`px-2.5 py-1 text-[10px] font-mono transition-colors ${
                  colorMode === mode
                    ? 'bg-sinaur-700 text-white'
                    : 'text-cc-500 hover:text-gray-300 bg-cc-800'
                }`}
              >
                {mode === 'statut' ? 'Statut' : 'Sinistres 30j'}
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

        {/* ── MAP + PANEL ── */}
        <div className="flex flex-1 overflow-hidden min-h-0">

          {/* Map */}
          <div className="flex-1 relative">
            {hasGeometry ? (
              <MapGL
                ref={mapRef}
                mapStyle={MAP_STYLE}
                initialViewState={{ longitude: 24.5, latitude: -3.0, zoom: 4.5 }}
                onClick={onMapClick}
                interactiveLayerIds={['carto-fill']}
                style={{ width: '100%', height: '100%' }}
              >
                {geojson && (
                  <Source id="carto" type="geojson" data={geojson}>
                    {/* Fill */}
                    <Layer
                      id="carto-fill"
                      type="fill"
                      paint={{
                        'fill-color': fillColorExpr as any,
                        'fill-opacity': [
                          'case',
                          ['==', ['get', 'pcode'], selected?.pcode ?? ''], 0.85,
                          0.65,
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
                          '#334155',
                        ] as any,
                        'line-width': [
                          'case',
                          ['==', ['get', 'pcode'], selected?.pcode ?? ''], 2.5,
                          0.8,
                        ] as any,
                        'line-opacity': 0.9,
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
                        'text-color': '#e2e8f0',
                        'text-halo-color': '#0d1b2a',
                        'text-halo-width': 1.5,
                      }}
                    />
                  </Source>
                )}
              </MapGL>
            ) : (
              /* Fallback quand pas de polygones */
              <div className="w-full h-full bg-cc-950 flex flex-col items-center justify-center gap-3">
                <span className="text-4xl opacity-30">🗺️</span>
                <div className="text-center">
                  <div className="text-cc-500 text-sm font-medium">Polygones COD-AB non disponibles</div>
                  <div className="text-cc-700 text-[10px] font-mono mt-1">Consultez la liste ci-dessous</div>
                </div>
              </div>
            )}

            {/* Legend */}
            {hasGeometry && (
              <div className="absolute bottom-4 left-4 bg-cc-900/90 border border-cc-700 rounded-lg p-3 space-y-1.5 backdrop-blur-sm">
                <div className="text-[9px] font-mono text-cc-500 uppercase mb-1.5">
                  {colorMode === 'statut' ? 'Situation' : 'Incidents 30j'}
                </div>
                {colorMode === 'statut' ? (
                  [
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
            {allEntities.length} entités — {NIVEAU_LABELS[level] ?? `Niveau ${level}`}
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
              {allEntities.map(entity => {
                const statut = STATUT_STYLE[entity.statut] ?? STATUT_STYLE['NORMAL']!;
                const isSelected = selected?.pcode === entity.pcode;
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
              {allEntities.length === 0 && !isLoading && (
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
