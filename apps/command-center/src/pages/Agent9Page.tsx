import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import MapGL, { Source, Layer, Popup, type MapLayerMouseEvent } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { apiClient } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';
import { useRealtimeFeed } from '../hooks/useRealtimeFeed.js';

// ── Types ──────────────────────────────────────────────────────────────────────

interface RiskScore {
  id:              string;
  pcode:           string;
  zoneName:        string;
  score:           number;
  level:           'FAIBLE' | 'MOYEN' | 'ELEVE' | 'CRITIQUE';
  confidence:      'FAIBLE' | 'MODEREE' | 'FORTE';
  uncertaintyLow:  number;
  uncertaintyHigh: number;
  topFactors:      Array<{ factor: string; contribution: number }>;
  horizonDays:     number;
  modelVersion:    string;
  computedAt:      string;
}

interface Alert {
  id:                   string;
  pcode:                string;
  zoneName:             string;
  level:                'FAIBLE' | 'MOYEN' | 'ELEVE' | 'CRITIQUE';
  statut:               string;
  createdAt:            string;
  validatedAt:          string | null;
  analystNote:          string | null;
  analystModifiedLevel: string | null;
  analystName:          string | null;
  score:                number;
  confidence:           string;
  topFactors:           Array<{ factor: string; contribution: number }>;
  recommendedActions:   Array<{ code: string; priority: number; description: string }>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const LEVEL_COLORS: Record<string, string> = {
  CRITIQUE: 'bg-red-900/60 text-red-300 border border-red-700',
  ELEVE:    'bg-orange-900/60 text-orange-300 border border-orange-700',
  MOYEN:    'bg-yellow-900/60 text-yellow-300 border border-yellow-700',
  FAIBLE:   'bg-green-900/60 text-green-300 border border-green-700',
}

const FACTOR_LABELS: Record<string, string> = {
  historique_violences:         'Historique violences',
  evolution_recente_incidents:  'Évolution récente',
  importance_economique:        'Importance économique',
  ressources_naturelles:        'Ressources naturelles',
  importance_geographique:      'Position géographique',
  signaux_declarations_publics: 'Signaux publics',
  vulnerabilite_populations:    'Vulnérabilité pop.',
}

const CONFIDENCE_LABELS: Record<string, string> = {
  FORTE:   'Forte',
  MODEREE: 'Modérée',
  FAIBLE:  'Faible',
}

function ScoreBar({ score, level }: { score: number; level: string }) {
  const colors: Record<string, string> = {
    CRITIQUE: 'bg-red-500',
    ELEVE:    'bg-orange-500',
    MOYEN:    'bg-yellow-500',
    FAIBLE:   'bg-green-500',
  }
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-cc-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${colors[level] ?? 'bg-gray-500'}`}
          style={{ width: `${Math.min(100, score)}%` }}
        />
      </div>
      <span className="text-xs font-mono text-gray-300 w-8 text-right">{score.toFixed(0)}</span>
    </div>
  )
}

// ── Modal de validation ───────────────────────────────────────────────────────

function ValidationModal({
  alert,
  onClose,
}: {
  alert: Alert;
  onClose: () => void;
}) {
  const queryClient = useQueryClient()
  const [action, setAction] = useState<'VALIDATED' | 'REJECTED' | 'MODIFIED'>('VALIDATED')
  const [note, setNote] = useState('')
  const [modifiedLevel, setModifiedLevel] = useState<string>('')

  const mutation = useMutation({
    mutationFn: (body: { action: string; analyst_note: string; modified_level?: string }) =>
      apiClient.post(`/agent9/alerts/${alert.id}/validate`, body).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent9-alerts'] })
      onClose()
    },
  })

  const handleSubmit = () => {
    if (!note.trim()) return
    mutation.mutate({
      action,
      analyst_note:   note.trim(),
      modified_level: action === 'MODIFIED' ? modifiedLevel : undefined,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-cc-900 border border-cc-700 rounded-xl p-6 w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">Validation alerte — {alert.zoneName}</h3>
          <button onClick={onClose} className="text-cc-600 hover:text-gray-300 text-lg">✕</button>
        </div>

        <div className="mb-4 p-3 bg-cc-800 rounded-lg space-y-1">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-mono px-2 py-0.5 rounded ${LEVEL_COLORS[alert.level]}`}>{alert.level}</span>
            <span className="text-xs text-cc-500 font-mono">Score {alert.score?.toFixed(1)}</span>
          </div>
          {alert.recommendedActions?.slice(0, 2).map(a => (
            <p key={a.code} className="text-xs text-gray-400">{a.description}</p>
          ))}
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-cc-500 font-mono block mb-1">Décision</label>
            <div className="flex gap-2">
              {(['VALIDATED', 'MODIFIED', 'REJECTED'] as const).map(a => (
                <button
                  key={a}
                  onClick={() => setAction(a)}
                  className={`flex-1 text-xs py-1.5 rounded font-mono transition-colors ${
                    action === a
                      ? a === 'REJECTED'
                        ? 'bg-red-700 text-white'
                        : a === 'MODIFIED'
                          ? 'bg-yellow-700 text-white'
                          : 'bg-green-700 text-white'
                      : 'bg-cc-700 text-cc-500 hover:text-gray-300'
                  }`}
                >
                  {a === 'VALIDATED' ? 'Valider' : a === 'MODIFIED' ? 'Modifier' : 'Rejeter'}
                </button>
              ))}
            </div>
          </div>

          {action === 'MODIFIED' && (
            <div>
              <label className="text-xs text-cc-500 font-mono block mb-1">Niveau corrigé</label>
              <select
                value={modifiedLevel}
                onChange={e => setModifiedLevel(e.target.value)}
                className="w-full bg-cc-800 border border-cc-700 rounded px-2 py-1.5 text-sm text-gray-200"
              >
                <option value="">— choisir —</option>
                {['FAIBLE', 'MOYEN', 'ELEVE', 'CRITIQUE'].map(l => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs text-cc-500 font-mono block mb-1">Note analyste (obligatoire)</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              placeholder="Justification de la décision..."
              className="w-full bg-cc-800 border border-cc-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-cc-600 resize-none focus:outline-none focus:border-sinaur-600"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 text-sm py-2 rounded bg-cc-800 text-cc-500 hover:text-gray-300 transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleSubmit}
              disabled={!note.trim() || (action === 'MODIFIED' && !modifiedLevel) || mutation.isPending}
              className="flex-1 text-sm py-2 rounded bg-sinaur-700 text-white hover:bg-sinaur-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {mutation.isPending ? 'En cours…' : 'Confirmer'}
            </button>
          </div>
          {mutation.isError && (
            <p className="text-xs text-red-400">Erreur : {(mutation.error as any)?.message}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Carte MapLibre ────────────────────────────────────────────────────────────

const MAP_STYLE = {
  version: 8 as const,
  sources: {
    osm: { type: 'raster' as const, tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' },
  },
  layers: [
    { id: 'bg',  type: 'background' as const, paint: { 'background-color': '#0d1b2a' } },
    { id: 'osm', type: 'raster' as const, source: 'osm', paint: { 'raster-saturation': -1, 'raster-brightness-max': 0.25, 'raster-opacity': 0.70 } },
  ],
}

const LEVEL_FILL = [
  'match', ['get', 'level'],
  'CRITIQUE', '#dc2626',
  'ELEVE',    '#ea580c',
  'MOYEN',    '#ca8a04',
  'FAIBLE',   '#16a34a',
  '#1e293b',
]

interface PopupInfo {
  lng: number; lat: number;
  pcode: string; zoneName: string;
  level: string; score: number | null;
  topFactors: Array<{ factor: string; contribution: number }>;
}

function RiskMap({ horizon }: { horizon: number }) {
  const [popupInfo, setPopupInfo] = useState<PopupInfo | null>(null)

  const { data: geojson, isLoading } = useQuery({
    queryKey: ['agent9-geojson', horizon],
    queryFn:  () => apiClient
      .get<{ data: GeoJSON.FeatureCollection }>(`/agent9/scores/geojson?horizon=${horizon}`)
      .then(r => r.data.data),
    staleTime: 30 * 60 * 1000,
  })

  const handleClick = useCallback((e: MapLayerMouseEvent) => {
    const f = e.features?.[0]
    if (!f) { setPopupInfo(null); return }
    const p = f.properties as Record<string, unknown>
    setPopupInfo({
      lng:        e.lngLat.lng,
      lat:        e.lngLat.lat,
      pcode:      String(p['pcode'] ?? ''),
      zoneName:   String(p['zoneName'] ?? p['pcode'] ?? ''),
      level:      String(p['level'] ?? ''),
      score:      p['score'] != null ? Number(p['score']) : null,
      topFactors: (() => { try { return JSON.parse(String(p['topFactors'] ?? '[]')) } catch { return [] } })(),
    })
  }, [])

  if (isLoading) return <div className="flex items-center justify-center h-full text-cc-500 text-sm font-mono">Chargement des données…</div>

  return (
    <div className="relative h-full">
      <MapGL
        initialViewState={{ longitude: 24, latitude: -3, zoom: 4.5 }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={MAP_STYLE as any}
        interactiveLayerIds={['risk-fill']}
        onClick={handleClick}
      >
        {geojson && (
          <Source id="territories" type="geojson" data={geojson}>
            <Layer
              id="risk-fill"
              type="fill"
              paint={{ 'fill-color': LEVEL_FILL as any, 'fill-opacity': 0.65 }}
            />
            <Layer
              id="risk-line"
              type="line"
              paint={{ 'line-color': '#334155', 'line-width': 0.5 }}
            />
          </Source>
        )}

        {popupInfo && (
          <Popup
            longitude={popupInfo.lng}
            latitude={popupInfo.lat}
            onClose={() => setPopupInfo(null)}
            closeButton
            anchor="bottom"
            className="!bg-cc-900 !border-cc-700 !text-white"
          >
            <div className="p-2 min-w-[180px] space-y-2">
              <div>
                <div className="font-semibold text-sm text-gray-100">{popupInfo.zoneName || popupInfo.pcode}</div>
                <div className="text-[10px] text-cc-500 font-mono">{popupInfo.pcode}</div>
              </div>
              {popupInfo.level ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-mono px-2 py-0.5 rounded ${LEVEL_COLORS[popupInfo.level] ?? ''}`}>
                      {popupInfo.level}
                    </span>
                    {popupInfo.score != null && (
                      <span className="text-xs text-cc-400">Score {popupInfo.score.toFixed(1)}</span>
                    )}
                  </div>
                  {popupInfo.topFactors.slice(0, 2).map(f => (
                    <div key={f.factor} className="text-[10px] text-cc-500 flex gap-1">
                      <span className="text-orange-400">▲</span>
                      {FACTOR_LABELS[f.factor] ?? f.factor}
                    </div>
                  ))}
                </>
              ) : (
                <div className="text-xs text-cc-600">Aucune donnée</div>
              )}
            </div>
          </Popup>
        )}
      </MapGL>

      {/* Légende */}
      <div className="absolute bottom-4 left-4 bg-cc-900/90 border border-cc-700 rounded-lg p-3 space-y-1.5">
        <div className="text-[10px] text-cc-500 font-mono mb-1">NIVEAU DE RISQUE</div>
        {[
          { level: 'CRITIQUE', color: 'bg-red-600',    label: 'Critique' },
          { level: 'ELEVE',    color: 'bg-orange-600', label: 'Élevé' },
          { level: 'MOYEN',    color: 'bg-yellow-600', label: 'Moyen' },
          { level: 'FAIBLE',   color: 'bg-green-600',  label: 'Faible' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-sm ${color} opacity-80`} />
            <span className="text-xs text-gray-300">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────

export function Agent9Page() {
  const user = useAuthStore(s => s.user)
  const role = user?.role ?? ''
  const canValidate = ['system_admin', 'national_decision_maker'].includes(role)
  const queryClient = useQueryClient()

  const [horizon, setHorizon] = useState(7)
  const [tab, setTab]         = useState<'carte' | 'scores' | 'alerts'>('carte')
  const [validating, setValidating] = useState<Alert | null>(null)

  // Refetch alertes quand un AGENT9_ALERT arrive via WebSocket
  const { events } = useRealtimeFeed()
  const agent9Count = events.filter(e => e.type === 'AGENT9_ALERT').length
  useEffect(() => {
    if (agent9Count > 0) queryClient.invalidateQueries({ queryKey: ['agent9-alerts'] })
  }, [agent9Count, queryClient])

  const { data: scoresData, isLoading: scoresLoading } = useQuery({
    queryKey: ['agent9-scores', horizon],
    queryFn: () =>
      apiClient
        .get<{ data: RiskScore[] }>(`/agent9/scores?horizon=${horizon}`)
        .then(r => r.data.data ?? []),
    refetchInterval: 5 * 60 * 1000,
  })

  const { data: alertsData, isLoading: alertsLoading } = useQuery({
    queryKey: ['agent9-alerts'],
    queryFn: () =>
      apiClient
        .get<{ data: Alert[] }>('/agent9/alerts?statut=PENDING_VALIDATION')
        .then(r => r.data.data ?? []),
    enabled: canValidate,
    refetchInterval: 60 * 1000,
  })

  const scores  = scoresData ?? []
  const alerts  = alertsData ?? []

  const critique = scores.filter(s => s.level === 'CRITIQUE').length
  const eleve    = scores.filter(s => s.level === 'ELEVE').length
  const pending  = alerts.length

  return (
    <div className="p-6 space-y-6">

      {/* En-tête */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Agent 9 — Protection des Populations</h1>
          <p className="text-sm text-cc-500 mt-0.5">Prévision des risques de violence · Alerte précoce civile</p>
        </div>
        <div className="flex gap-2 text-xs font-mono">
          {(['CRITIQUE', 'ELEVE'] as const).map(l => (
            <div key={l} className={`px-3 py-1.5 rounded ${LEVEL_COLORS[l]}`}>
              {l === 'CRITIQUE' ? critique : eleve} {l}
            </div>
          ))}
          {canValidate && pending > 0 && (
            <div className="px-3 py-1.5 rounded bg-purple-900/60 text-purple-300 border border-purple-700">
              {pending} en attente
            </div>
          )}
        </div>
      </div>

      {/* Onglets */}
      <div className="flex gap-1 border-b border-cc-700">
        {[
          { key: 'carte',  label: 'Carte' },
          { key: 'scores', label: 'Scores de risque' },
          ...(canValidate ? [{ key: 'alerts', label: `File de validation${pending > 0 ? ` (${pending})` : ''}` }] : []),
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key as typeof tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === key
                ? 'border-sinaur-500 text-white'
                : 'border-transparent text-cc-500 hover:text-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Onglet Carte ───────────────────────────────────────────────────── */}
      {tab === 'carte' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-cc-500 font-mono">Horizon :</span>
            {([7, 30, 90] as const).map(h => (
              <button key={h} onClick={() => setHorizon(h)}
                className={`text-xs px-3 py-1 rounded font-mono transition-colors ${horizon === h ? 'bg-sinaur-700 text-white' : 'bg-cc-800 text-cc-500 hover:text-gray-300'}`}>
                {h}j
              </button>
            ))}
          </div>
          <div className="h-[560px] rounded-xl overflow-hidden border border-cc-700">
            <RiskMap horizon={horizon} />
          </div>
        </div>
      )}

      {/* ── Onglet Scores ──────────────────────────────────────────────────── */}
      {tab === 'scores' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-cc-500 font-mono">Horizon :</span>
            {([7, 30, 90] as const).map(h => (
              <button
                key={h}
                onClick={() => setHorizon(h)}
                className={`text-xs px-3 py-1 rounded font-mono transition-colors ${
                  horizon === h
                    ? 'bg-sinaur-700 text-white'
                    : 'bg-cc-800 text-cc-500 hover:text-gray-300'
                }`}
              >
                {h}j
              </button>
            ))}
          </div>

          {scoresLoading ? (
            <div className="text-cc-500 text-sm py-8 text-center font-mono">Chargement…</div>
          ) : scores.length === 0 ? (
            <div className="text-cc-500 text-sm py-12 text-center">
              <div className="text-4xl mb-3">📊</div>
              <p>Aucun score disponible pour l'instant.</p>
              <p className="text-xs mt-1">Les scores sont calculés automatiquement après chaque cycle d'ingestion UCDP.</p>
            </div>
          ) : (
            <div className="bg-cc-900 border border-cc-700 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-cc-700 text-cc-500 text-xs font-mono">
                    <th className="text-left px-4 py-2.5">Zone</th>
                    <th className="text-left px-4 py-2.5">Niveau</th>
                    <th className="text-left px-4 py-2.5">Score</th>
                    <th className="text-left px-4 py-2.5">Confiance</th>
                    <th className="text-left px-4 py-2.5">Facteurs dominants</th>
                    <th className="text-left px-4 py-2.5">Calculé</th>
                  </tr>
                </thead>
                <tbody>
                  {scores.map(s => (
                    <tr key={s.id} className="border-b border-cc-800 hover:bg-cc-800/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="text-gray-200 font-medium">{s.zoneName ?? s.pcode}</div>
                        <div className="text-xs text-cc-600 font-mono">{s.pcode}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-mono px-2 py-0.5 rounded ${LEVEL_COLORS[s.level]}`}>
                          {s.level}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <ScoreBar score={s.score} level={s.level} />
                        <div className="text-[10px] text-cc-600 font-mono mt-0.5">
                          [{s.uncertaintyLow?.toFixed(0)} – {s.uncertaintyHigh?.toFixed(0)}]
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-cc-500">{CONFIDENCE_LABELS[s.confidence] ?? s.confidence}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-0.5">
                          {s.topFactors?.slice(0, 2).map(f => (
                            <div key={f.factor} className="text-xs text-cc-500 flex items-center gap-1">
                              <span className="text-orange-400">▲</span>
                              {FACTOR_LABELS[f.factor] ?? f.factor}
                              <span className="text-cc-600">({f.contribution.toFixed(1)})</span>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-cc-600 font-mono">
                        {new Date(s.computedAt).toLocaleDateString('fr-FR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Onglet Alertes ─────────────────────────────────────────────────── */}
      {tab === 'alerts' && canValidate && (
        <div className="space-y-4">
          {alertsLoading ? (
            <div className="text-cc-500 text-sm py-8 text-center font-mono">Chargement…</div>
          ) : alerts.length === 0 ? (
            <div className="text-cc-500 text-sm py-12 text-center">
              <div className="text-4xl mb-3">✅</div>
              <p>Aucune alerte en attente de validation.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map(a => (
                <div
                  key={a.id}
                  className="bg-cc-900 border border-cc-700 rounded-xl p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-mono px-2 py-0.5 rounded ${LEVEL_COLORS[a.level]}`}>
                          {a.level}
                        </span>
                        <span className="text-gray-200 font-medium">{a.zoneName ?? a.pcode}</span>
                        <span className="text-xs text-cc-600 font-mono">{a.pcode}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-cc-500">
                        <span>Score : <span className="text-gray-300">{a.score?.toFixed(1)}</span></span>
                        <span>Confiance : <span className="text-gray-300">{CONFIDENCE_LABELS[a.confidence] ?? a.confidence}</span></span>
                        <span>Généré : {new Date(a.createdAt).toLocaleString('fr-FR')}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => setValidating(a)}
                      className="shrink-0 text-xs px-4 py-2 bg-sinaur-700 hover:bg-sinaur-600 text-white rounded-lg font-medium transition-colors"
                    >
                      Traiter
                    </button>
                  </div>

                  {a.recommendedActions?.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs text-cc-500 font-mono mb-1">Actions recommandées</div>
                      {a.recommendedActions.map(action => (
                        <div key={action.code} className="flex items-start gap-2 text-xs text-gray-400">
                          <span className="text-sinaur-400 mt-0.5 shrink-0">•</span>
                          <span>{action.description}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {a.topFactors?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {a.topFactors.map(f => (
                        <span key={f.factor} className="text-[10px] font-mono px-2 py-0.5 rounded bg-cc-800 text-cc-500">
                          ▲ {FACTOR_LABELS[f.factor] ?? f.factor} ({f.contribution.toFixed(1)})
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {validating && (
        <ValidationModal alert={validating} onClose={() => setValidating(null)} />
      )}
    </div>
  )
}
