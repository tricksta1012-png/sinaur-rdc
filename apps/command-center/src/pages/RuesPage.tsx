import { useState, useCallback, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import MapGL, { Source, Layer, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { apiClient } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';

interface RueItem {
  id: number;
  nom: string;
  type_voie: string | null;
  commune_pcode: string | null;
  quartier_pcode: string | null;
  source: string;
  statut_validation: 'PROPOSE' | 'VALIDE' | 'REJETE';
  cree_par: string | null;
  cree_le: string;
  valide_par: string | null;
  valide_le: string | null;
  geojson: GeoJSON.Geometry | null;
  lng: number | null;
  lat: number | null;
}

interface FormState { nom: string; type_voie: string; commune_pcode: string; quartier_pcode: string; motif: string; }
type DrawMode = 'idle' | 'line' | 'point';
type TabMode  = 'search' | 'valider';

const WRITE_ROLES    = ['field_agent','local_validator','territory_admin','provincial_coordinator','national_decision_maker','system_admin'];
const VALIDATE_ROLES = ['local_validator','territory_admin','provincial_coordinator','national_decision_maker','system_admin'];
const DELETE_ROLES   = ['territory_admin','provincial_coordinator','national_decision_maker','system_admin'];
const TYPE_VOIE_OPTIONS = ['avenue','rue','boulevard','ruelle','piste','chemin'];
const BLANK_FORM: FormState = { nom: '', type_voie: '', commune_pcode: '', quartier_pcode: '', motif: '' };

const MAP_STYLE = {
  version: 8 as const,
  sources: { osm: { type: 'raster' as const, tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' } },
  layers: [
    { id: 'bg',  type: 'background' as const, paint: { 'background-color': '#0d1b2a' } },
    { id: 'osm', type: 'raster' as const, source: 'osm', paint: { 'raster-saturation': -1, 'raster-brightness-max': 0.30, 'raster-opacity': 0.80, 'raster-contrast': 0.05 } },
  ],
};

const STATUT_BADGE: Record<string, string> = {
  VALIDE:  'bg-green-900/60 text-green-300 border-green-700',
  PROPOSE: 'bg-yellow-900/60 text-yellow-300 border-yellow-700',
  REJETE:  'bg-red-900/60 text-red-300 border-red-700',
};

function getRueBounds(rue: RueItem): [[number,number],[number,number]] | null {
  if (rue.geojson?.type !== 'LineString') return null;
  const coords = (rue.geojson as GeoJSON.LineString).coordinates;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of coords) { if (x<w) w=x; if (x>e) e=x; if (y<s) s=y; if (y>n) n=y; }
  return isFinite(w) ? [[w, s], [e, n]] : null;
}

function buildLinesGeoJson(rues: RueItem[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rues
      .filter(r => r.geojson?.type === 'LineString')
      .map(r => ({ type: 'Feature' as const, geometry: r.geojson as GeoJSON.LineString, properties: { id: r.id, nom: r.nom, statut: r.statut_validation } })),
  };
}

function buildCentroidsGeoJson(rues: RueItem[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rues
      .filter(r => !r.geojson && r.lng != null && r.lat != null)
      .map(r => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [r.lng!, r.lat!] }, properties: { id: r.id, nom: r.nom, statut: r.statut_validation } })),
  };
}

function buildDrawGeoJson(pts: [number,number][], pending: [number,number] | null, trace: GeoJSON.LineString | null): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [
    ...pts.map(p => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: p }, properties: { type: 'point' } })),
    ...(pts.length >= 2 ? [{ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: pts }, properties: { type: 'line' } }] : []),
    ...(pending ? [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: pending }, properties: { type: 'pending' } }] : []),
    ...(trace   ? [{ type: 'Feature' as const, geometry: trace, properties: { type: 'trace-done' } }] : []),
  ];
  return { type: 'FeatureCollection', features };
}

function EditPanel({ mode, form, setForm, drawMode, drawPoints, pendingPoint, traceGeometry, onStartLine, onStartPoint, onClearTrace, onFinalizeLine, onSubmit, onCancel, isPending, error }: {
  mode: 'add' | 'edit'; form: FormState; setForm: React.Dispatch<React.SetStateAction<FormState>>;
  drawMode: DrawMode; drawPoints: [number,number][]; pendingPoint: [number,number] | null; traceGeometry: GeoJSON.LineString | null;
  onStartLine: () => void; onStartPoint: () => void; onClearTrace: () => void; onFinalizeLine: () => void;
  onSubmit: () => void; onCancel: () => void; isPending: boolean; error: string;
}) {
  const inp = 'w-full bg-cc-800 border border-cc-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-sinaur-600';
  const lbl = 'block text-[9px] font-mono text-cc-500 uppercase tracking-wider mb-0.5';
  const f   = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(s => ({ ...s, [k]: e.target.value }));

  return (
    <div className="border-t border-cc-700 bg-cc-900 px-3 py-3 space-y-2 shrink-0">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-cc-500 uppercase">{mode === 'add' ? 'Nouvelle rue' : 'Modifier'}</span>
        <button onClick={onCancel} className="text-cc-600 hover:text-gray-300 text-[10px]">✕</button>
      </div>
      <div><label className={lbl}>Nom *</label><input className={inp} value={form.nom} onChange={f('nom')} placeholder="Ex: Avenue du Peuple" /></div>
      <div>
        <label className={lbl}>Type de voie</label>
        <select className={inp} value={form.type_voie} onChange={f('type_voie')}>
          <option value="">— sélectionner —</option>
          {TYPE_VOIE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className={lbl}>Commune</label><input className={inp + ' font-mono'} value={form.commune_pcode} onChange={f('commune_pcode')} placeholder="CD…" /></div>
        <div><label className={lbl}>Quartier</label><input className={inp + ' font-mono'} value={form.quartier_pcode} onChange={f('quartier_pcode')} placeholder="CD…" /></div>
      </div>
      <div><label className={lbl}>Motif</label><input className={inp} value={form.motif} onChange={f('motif')} placeholder="Source ou contexte" /></div>
      <div className="space-y-1.5">
        <div className="text-[9px] font-mono text-cc-500 uppercase tracking-wider">Géolocalisation</div>
        <div className="flex gap-1.5 flex-wrap">
          <button type="button" onClick={onStartLine} disabled={drawMode !== 'idle'}
            className={`text-[10px] px-2 py-1 rounded border font-mono transition-colors disabled:opacity-50 ${drawMode === 'line' ? 'bg-amber-900/60 border-amber-700 text-amber-300' : 'bg-cc-800 border-cc-700 text-cc-400 hover:text-gray-200'}`}>
            Tracer la rue
          </button>
          <button type="button" onClick={onStartPoint} disabled={drawMode !== 'idle'}
            className={`text-[10px] px-2 py-1 rounded border font-mono transition-colors disabled:opacity-50 ${drawMode === 'point' ? 'bg-amber-900/60 border-amber-700 text-amber-300' : 'bg-cc-800 border-cc-700 text-cc-400 hover:text-gray-200'}`}>
            Point approximatif
          </button>
        </div>
        {drawMode === 'line' && drawPoints.length >= 2 && (
          <button type="button" onClick={onFinalizeLine}
            className="text-[10px] px-2 py-1 rounded border bg-green-900/60 border-green-700 text-green-300 font-mono">
            Terminer le tracé ({drawPoints.length} pts)
          </button>
        )}
        {traceGeometry && <p className="text-[10px] text-green-400 font-mono">Tracé : {traceGeometry.coordinates.length} points</p>}
        {pendingPoint   && <p className="text-[10px] text-green-400 font-mono">Point : {pendingPoint[1].toFixed(5)}, {pendingPoint[0].toFixed(5)}</p>}
        {(traceGeometry || pendingPoint) && (
          <button type="button" onClick={onClearTrace}
            className="text-[10px] px-2 py-1 rounded border bg-cc-800 border-cc-700 text-cc-500 hover:text-red-300 font-mono">
            Effacer le tracé
          </button>
        )}
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onCancel}
          className="flex-1 text-[10px] py-1.5 rounded-lg border border-cc-700 text-cc-500 hover:text-gray-300 font-mono">
          Annuler
        </button>
        <button onClick={onSubmit} disabled={isPending || !form.nom.trim()}
          className="flex-1 text-[10px] py-1.5 rounded-lg bg-sinaur-700 hover:bg-sinaur-600 text-white font-mono disabled:opacity-50">
          {isPending ? 'Enregistrement…' : mode === 'add' ? 'Ajouter' : 'Mettre à jour'}
        </button>
      </div>
    </div>
  );
}

export function RuesPage() {
  const mapRef = useRef<MapRef>(null);
  const qc     = useQueryClient();
  const user   = useAuthStore(s => s.user);

  const canWrite    = !!user && WRITE_ROLES.includes(user.role);
  const canValidate = !!user && VALIDATE_ROLES.includes(user.role);
  const canDelete   = !!user && DELETE_ROLES.includes(user.role);

  const [tab, setTab]                 = useState<TabMode>('search');
  const [editMode, setEditMode]       = useState<'add' | 'edit' | null>(null);
  const [selectedRue, setSelectedRue] = useState<RueItem | null>(null);
  const [form, setForm]               = useState<FormState>(BLANK_FORM);
  const [editId, setEditId]           = useState<number | null>(null);
  const [mutError, setMutError]       = useState('');

  const [searchQ, setSearchQ]               = useState('');
  const [searchCommune, setSearchCommune]   = useState('');
  const [searchStatut, setSearchStatut]     = useState<'all' | 'VALIDE' | 'PROPOSE'>('all');
  const [activeSearch, setActiveSearch]     = useState({ q: '', commune: '', statut: 'all' as 'all' | 'VALIDE' | 'PROPOSE' });

  const [drawMode, setDrawMode]             = useState<DrawMode>('idle');
  const [drawPoints, setDrawPoints]         = useState<[number,number][]>([]);
  const [pendingPoint, setPendingPoint]     = useState<[number,number] | null>(null);
  const [traceGeometry, setTraceGeometry]   = useState<GeoJSON.LineString | null>(null);

  const { data: rues = [], isLoading: ruesLoading } = useQuery({
    queryKey: ['rues', activeSearch],
    queryFn: () => {
      const p = new URLSearchParams({ limit: '200' });
      if (activeSearch.q)                  p.set('q', activeSearch.q);
      if (activeSearch.commune)            p.set('commune_pcode', activeSearch.commune);
      if (activeSearch.statut !== 'all')   p.set('statut', activeSearch.statut);
      return apiClient.get<{ success: boolean; data: RueItem[] }>(`/rues?${p}`).then(r => r.data.data ?? []);
    },
    staleTime: 60_000,
  });

  const { data: validerRues = [], isLoading: validerLoading } = useQuery({
    queryKey: ['rues-a-valider'],
    queryFn: () => apiClient.get<{ success: boolean; data: RueItem[] }>('/rues/a-valider').then(r => r.data.data ?? []),
    enabled: canValidate,
    staleTime: 30_000,
  });

  const linesGeoJson     = useMemo(() => buildLinesGeoJson(rues), [rues]);
  const centroidsGeoJson = useMemo(() => buildCentroidsGeoJson(rues), [rues]);
  const drawGeoJson      = useMemo(() => buildDrawGeoJson(drawPoints, pendingPoint, traceGeometry), [drawPoints, pendingPoint, traceGeometry]);

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post('/rues', body).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rues'] }); resetEditState(); },
    onError: (e: any) => setMutError(e?.response?.data?.error?.message ?? 'Erreur lors de la création'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => apiClient.put(`/rues/${id}`, body).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rues'] }); resetEditState(); },
    onError: (e: any) => setMutError(e?.response?.data?.error?.message ?? 'Erreur lors de la mise à jour'),
  });

  const validerMutation = useMutation({
    mutationFn: ({ id, decision, motif }: { id: number; decision: 'VALIDE' | 'REJETE'; motif?: string }) =>
      apiClient.put(`/rues/${id}/valider`, { decision, motif }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rues-a-valider'] });
      qc.invalidateQueries({ queryKey: ['rues'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/rues/${id}`).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rues'] }); setSelectedRue(null); },
  });

  function resetDrawState() { setDrawMode('idle'); setDrawPoints([]); setPendingPoint(null); setTraceGeometry(null); }
  function resetEditState() { setEditMode(null); setEditId(null); setForm(BLANK_FORM); setMutError(''); resetDrawState(); }

  function zoomToRue(rue: RueItem) {
    const bounds = getRueBounds(rue);
    if (bounds) mapRef.current?.fitBounds(bounds, { padding: 60, duration: 800, maxZoom: 16 });
    else if (rue.lng != null && rue.lat != null)
      (mapRef.current as any)?.flyTo({ center: [rue.lng, rue.lat], zoom: 15, duration: 800 });
  }

  const openAdd = useCallback(() => {
    setEditMode('add'); setEditId(null); setForm(BLANK_FORM); setMutError(''); resetDrawState();
  }, []);

  const openEdit = useCallback((rue: RueItem) => {
    setEditMode('edit'); setEditId(rue.id);
    setForm({ nom: rue.nom, type_voie: rue.type_voie ?? '', commune_pcode: rue.commune_pcode ?? '', quartier_pcode: rue.quartier_pcode ?? '', motif: '' });
    setMutError(''); resetDrawState(); setSelectedRue(rue); zoomToRue(rue);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onMapClick = useCallback((e: MapLayerMouseEvent) => {
    if (drawMode === 'line') {
      const { lng, lat } = e.lngLat;
      setDrawPoints(prev => [...prev, [lng, lat]]);
      return;
    }
    if (drawMode === 'point') {
      const { lng, lat } = e.lngLat;
      setPendingPoint([lng, lat]);
      setDrawMode('idle');
      return;
    }
    const f = e.features?.[0];
    const id = f?.properties?.id as number | undefined;
    if (id != null) {
      const rue = rues.find(r => r.id === id);
      if (rue) { setSelectedRue(rue); zoomToRue(rue); }
    } else {
      setSelectedRue(null);
    }
  }, [drawMode, rues]); // eslint-disable-line react-hooks/exhaustive-deps

  function onSubmit() {
    setMutError('');
    const body: Record<string, unknown> = { nom: form.nom.trim() };
    if (form.type_voie)      body.type_voie      = form.type_voie;
    if (form.commune_pcode)  body.commune_pcode  = form.commune_pcode.trim();
    if (form.quartier_pcode) body.quartier_pcode = form.quartier_pcode.trim();
    if (form.motif)          body.motif          = form.motif.trim();
    if (traceGeometry)       body.geometry       = traceGeometry;
    else if (pendingPoint)   body.point          = pendingPoint;
    if (editMode === 'add') createMutation.mutate(body);
    else if (editMode === 'edit' && editId != null) updateMutation.mutate({ id: editId, body });
  }

  const interactiveLayerIds = drawMode === 'idle'
    ? ['rues-line-valide', 'rues-line-propose', 'rues-points']
    : [];

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Header */}
      <div className="bg-cc-900 border-b border-cc-700 px-4 py-2.5 flex items-center gap-3 shrink-0">
        <span className="text-lg">🏙️</span>
        <div className="flex-1 min-w-0">
          <div className="text-white font-bold text-sm">Rues &amp; Voies</div>
          <div className="text-cc-500 text-[10px] font-mono">Catalogue des voies — terrain + OSM</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex rounded-lg overflow-hidden border border-cc-700">
            <button
              onClick={() => setTab('search')}
              className={`px-3 py-1 text-[10px] font-mono transition-colors ${tab === 'search' ? 'bg-sinaur-700 text-white' : 'text-cc-500 hover:text-gray-300 bg-cc-800'}`}
            >
              Recherche
            </button>
            {canValidate && (
              <button
                onClick={() => setTab('valider')}
                className={`px-3 py-1 text-[10px] font-mono flex items-center gap-1 transition-colors ${tab === 'valider' ? 'bg-sinaur-700 text-white' : 'text-cc-500 hover:text-gray-300 bg-cc-800'}`}
              >
                À valider
                {validerRues.length > 0 && (
                  <span className="bg-yellow-600 text-white text-[8px] rounded-full px-1 min-w-[14px] text-center leading-[14px]">
                    {validerRues.length}
                  </span>
                )}
              </button>
            )}
          </div>
          {canWrite && (
            <button
              onClick={editMode ? resetEditState : openAdd}
              className={`text-[10px] font-mono px-2.5 py-1 rounded-lg border transition-colors ${editMode ? 'bg-cc-800 border-cc-700 text-cc-500' : 'bg-sinaur-700 hover:bg-sinaur-600 border-sinaur-600 text-white'}`}
            >
              {editMode ? 'Annuler édition' : '✏️ Édition'}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* Left panel */}
        <div className="w-72 shrink-0 flex flex-col bg-cc-900 border-r border-cc-700 overflow-hidden">
          {tab === 'search' ? (
            <>
              {/* Search form */}
              <div className="px-3 py-2.5 border-b border-cc-700 space-y-2 shrink-0">
                <input
                  className="w-full bg-cc-800 border border-cc-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-sinaur-600"
                  placeholder="Nom de la rue…"
                  value={searchQ}
                  onChange={e => setSearchQ(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && setActiveSearch({ q: searchQ, commune: searchCommune, statut: searchStatut })}
                />
                <input
                  className="w-full bg-cc-800 border border-cc-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-sinaur-600"
                  placeholder="Commune pcode (CD…)"
                  value={searchCommune}
                  onChange={e => setSearchCommune(e.target.value)}
                />
                <div className="flex gap-1">
                  {(['all', 'VALIDE', 'PROPOSE'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setSearchStatut(s)}
                      className={`flex-1 text-[9px] font-mono py-1 rounded border transition-colors ${searchStatut === s ? 'bg-sinaur-700 border-sinaur-600 text-white' : 'bg-cc-800 border-cc-700 text-cc-500 hover:text-gray-300'}`}
                    >
                      {s === 'all' ? 'Tous' : s}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setActiveSearch({ q: searchQ, commune: searchCommune, statut: searchStatut })}
                  className="w-full text-[10px] font-mono py-1.5 rounded-lg bg-sinaur-700 hover:bg-sinaur-600 text-white transition-colors"
                >
                  Rechercher
                </button>
              </div>

              {/* Results */}
              <div className="flex-1 overflow-y-auto">
                {ruesLoading ? (
                  <div className="p-3 space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="h-14 bg-cc-800 rounded-lg animate-pulse" />
                    ))}
                  </div>
                ) : rues.length === 0 ? (
                  <div className="p-6 text-center">
                    <div className="text-cc-600 text-xs font-mono italic">Aucune rue trouvée</div>
                    {canWrite && (
                      <button onClick={openAdd} className="mt-3 text-[10px] text-sinaur-400 hover:text-sinaur-300 font-mono">
                        + Ajouter la première rue
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="divide-y divide-cc-800/60">
                    {rues.map(r => (
                      <div
                        key={r.id}
                        onClick={() => { setSelectedRue(r); zoomToRue(r); }}
                        className={`px-3 py-2.5 cursor-pointer transition-colors ${selectedRue?.id === r.id ? 'bg-sinaur-900/40' : 'hover:bg-cc-800/60'}`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs text-gray-200 font-medium truncate">{r.nom}</div>
                            {r.type_voie     && <div className="text-[9px] text-cc-500 font-mono">{r.type_voie}</div>}
                            {r.commune_pcode && <div className="text-[9px] text-cc-600 font-mono">{r.commune_pcode}</div>}
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className={`text-[8px] font-bold px-1.5 py-px rounded border ${STATUT_BADGE[r.statut_validation] ?? ''}`}>
                              {r.statut_validation}
                            </span>
                            <div className="flex gap-1">
                              {canWrite  && <button onClick={e => { e.stopPropagation(); openEdit(r); }} className="text-[9px] text-cc-500 hover:text-sinaur-300 font-mono">édit</button>}
                              {canDelete && (
                                <button
                                  onClick={e => { e.stopPropagation(); if (window.confirm(`Supprimer "${r.nom}" ?`)) deleteMutation.mutate(r.id); }}
                                  className="text-[9px] text-cc-500 hover:text-red-400 font-mono"
                                >del</button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {canWrite && !editMode && (
                <div className="px-3 py-2.5 border-t border-cc-700 shrink-0">
                  <button
                    onClick={openAdd}
                    className="w-full text-[10px] font-mono py-1.5 rounded-lg bg-cc-800 hover:bg-cc-700 border border-cc-700 text-cc-400 hover:text-gray-200 transition-colors"
                  >
                    + Ajouter une rue
                  </button>
                </div>
              )}
            </>
          ) : (
            /* Validation queue */
            <div className="flex-1 overflow-y-auto">
              {validerLoading ? (
                <div className="p-3 space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 bg-cc-800 rounded-lg animate-pulse" />)}
                </div>
              ) : validerRues.length === 0 ? (
                <div className="p-6 text-center text-cc-600 text-[10px] font-mono italic">
                  Aucune rue à valider
                </div>
              ) : (
                <div className="p-2 space-y-2">
                  {validerRues.map(r => (
                    <div key={r.id} className="bg-cc-800 rounded-lg p-2.5 border border-cc-700">
                      <div className="text-xs text-gray-200 font-medium">{r.nom}</div>
                      {r.type_voie     && <div className="text-[9px] text-cc-500 font-mono">{r.type_voie}</div>}
                      {r.commune_pcode && <div className="text-[9px] text-cc-600 font-mono">{r.commune_pcode}</div>}
                      <div className="text-[9px] text-cc-600 mt-0.5">
                        {r.cree_par ?? '—'} · {new Date(r.cree_le).toLocaleDateString('fr-FR')}
                        {r.geojson ? ' · avec tracé' : r.lng != null ? ' · point' : ''}
                      </div>
                      <div className="flex gap-1.5 mt-2">
                        <button
                          onClick={() => { setSelectedRue(r); zoomToRue(r); setTab('search'); }}
                          className="text-[9px] font-mono py-1 px-1.5 rounded border bg-cc-700 border-cc-600 text-cc-300 hover:text-white"
                        >
                          Voir
                        </button>
                        <button
                          onClick={() => validerMutation.mutate({ id: r.id, decision: 'VALIDE' })}
                          disabled={validerMutation.isPending}
                          className="flex-1 text-[9px] font-mono py-1 rounded border bg-green-900/60 border-green-700 text-green-300 hover:bg-green-800 disabled:opacity-50"
                        >
                          Valider
                        </button>
                        <button
                          onClick={() => validerMutation.mutate({ id: r.id, decision: 'REJETE' })}
                          disabled={validerMutation.isPending}
                          className="flex-1 text-[9px] font-mono py-1 rounded border bg-red-900/60 border-red-700 text-red-300 hover:bg-red-800 disabled:opacity-50"
                        >
                          Rejeter
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Edit panel — appended to left panel */}
          {editMode && (
            <EditPanel
              mode={editMode} form={form} setForm={setForm}
              drawMode={drawMode} drawPoints={drawPoints} pendingPoint={pendingPoint} traceGeometry={traceGeometry}
              onStartLine={() => setDrawMode('line')}
              onStartPoint={() => setDrawMode('point')}
              onClearTrace={() => { setTraceGeometry(null); setPendingPoint(null); setDrawPoints([]); }}
              onFinalizeLine={() => {
                if (drawPoints.length >= 2) {
                  setTraceGeometry({ type: 'LineString', coordinates: [...drawPoints] });
                  setDrawMode('idle');
                  setDrawPoints([]);
                }
              }}
              onSubmit={onSubmit}
              onCancel={resetEditState}
              isPending={createMutation.isPending || updateMutation.isPending}
              error={mutError}
            />
          )}
        </div>

        {/* Map */}
        <div className="flex-1 relative" style={drawMode !== 'idle' ? { cursor: 'crosshair' } : undefined}>
          <MapGL
            ref={mapRef}
            mapStyle={MAP_STYLE}
            initialViewState={{ longitude: 24.5, latitude: -3.0, zoom: 4.5 }}
            onClick={onMapClick}
            interactiveLayerIds={interactiveLayerIds}
            style={{ width: '100%', height: '100%' }}
          >
            <Source id="rues-lines" type="geojson" data={linesGeoJson}>
              <Layer id="rues-line-valide" type="line"
                filter={['==', ['get', 'statut'], 'VALIDE']}
                paint={{ 'line-color': '#22c55e', 'line-width': ['case', ['==', ['get', 'id'], selectedRue?.id ?? -1], 4, 2] as any, 'line-opacity': 0.9 }} />
              <Layer id="rues-line-propose" type="line"
                filter={['==', ['get', 'statut'], 'PROPOSE']}
                paint={{ 'line-color': '#eab308', 'line-width': ['case', ['==', ['get', 'id'], selectedRue?.id ?? -1], 4, 2] as any, 'line-opacity': 0.9, 'line-dasharray': [4, 3] }} />
              <Layer id="rues-line-other" type="line"
                filter={['!', ['in', ['get', 'statut'], ['literal', ['VALIDE', 'PROPOSE']]]]}
                paint={{ 'line-color': '#64748b', 'line-width': 2, 'line-opacity': 0.7 }} />
            </Source>

            <Source id="rues-centroids" type="geojson" data={centroidsGeoJson}>
              <Layer id="rues-points" type="circle"
                paint={{ 'circle-radius': 6, 'circle-color': ['case', ['==', ['get', 'statut'], 'VALIDE'], '#22c55e', '#eab308'] as any, 'circle-stroke-color': '#0d1b2a', 'circle-stroke-width': 1.5 }} />
            </Source>

            {(drawPoints.length > 0 || pendingPoint != null || traceGeometry != null) && (
              <Source id="draw-overlay" type="geojson" data={drawGeoJson}>
                <Layer id="draw-line" type="line"
                  filter={['in', ['get', 'type'], ['literal', ['line', 'trace-done']]]}
                  paint={{ 'line-color': '#f59e0b', 'line-width': 3, 'line-dasharray': [6, 3] }} />
                <Layer id="draw-pts" type="circle"
                  filter={['in', ['get', 'type'], ['literal', ['point', 'pending']]]}
                  paint={{ 'circle-radius': 5, 'circle-color': '#f59e0b', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 }} />
              </Source>
            )}
          </MapGL>

          {/* Zoom to RDC */}
          <div className="absolute top-3 right-3 z-10">
            <button
              onClick={() => mapRef.current?.fitBounds([[11.8, -13.5], [31.3, 5.4]], { padding: 40, duration: 1000 })}
              className="w-9 h-9 flex items-center justify-center rounded-lg border text-sm bg-cc-900/90 border-cc-700 hover:bg-cc-800 backdrop-blur-sm cursor-pointer"
              title="Vue nationale RDC"
            >🌍</button>
          </div>

          {/* Draw mode banner */}
          {drawMode !== 'idle' && (
            <div className="absolute top-3 left-3 bg-amber-900/90 border border-amber-700 rounded-lg px-3 py-1.5 text-[10px] font-mono text-amber-300 backdrop-blur-sm z-10 flex items-center gap-2">
              <span>
                {drawMode === 'line'
                  ? `Mode tracé — ${drawPoints.length} pt${drawPoints.length !== 1 ? 's' : ''} — cliquer pour ajouter`
                  : 'Mode point — cliquer sur la carte'}
              </span>
              <button onClick={resetDrawState} className="text-amber-500 hover:text-amber-200 font-bold">✕</button>
            </div>
          )}

          {/* Legend */}
          <div className="absolute bottom-4 left-4 bg-cc-900/90 border border-cc-700 rounded-lg p-2.5 space-y-1.5 backdrop-blur-sm">
            <div className="text-[9px] font-mono text-cc-500 uppercase mb-1">Légende</div>
            {[
              { color: '#22c55e', label: 'Validée' },
              { color: '#eab308', label: 'Proposée (pointillé)' },
              { color: '#64748b', label: 'Autre' },
            ].map(l => (
              <div key={l.label} className="flex items-center gap-2">
                <div className="w-4 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: l.color }} />
                <span className="text-[9px] text-gray-400">{l.label}</span>
              </div>
            ))}
          </div>

          {/* Selected rue info */}
          {selectedRue && drawMode === 'idle' && (
            <div className="absolute bottom-4 right-4 bg-cc-900/90 border border-cc-700 rounded-lg p-2.5 max-w-[200px] backdrop-blur-sm">
              <div className="text-xs font-semibold text-white truncate">{selectedRue.nom}</div>
              {selectedRue.type_voie && <div className="text-[9px] text-cc-500 font-mono">{selectedRue.type_voie}</div>}
              <span className={`text-[8px] font-bold px-1.5 py-px rounded border mt-1 inline-block ${STATUT_BADGE[selectedRue.statut_validation] ?? ''}`}>
                {selectedRue.statut_validation}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
