/**
 * EtdPage — Tableau de bord Agent ETD + Flux Bidirectionnel.
 *
 * ETD = Entité Territoriale Décentralisée : Ville, Commune, Secteur, Chefferie.
 * Affiche l'analyse locale, les seuils, les besoins, les incohérences
 * et la circulation bidirectionnelle de l'information (ascendant / descendant).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AnalyseETD {
  etd_pcode: string;
  periode_jours: number;
  total_signalements: number;
  par_type: { type: string; label: string; count: number }[];
  tendance: { recent: number; precedent: number; variation_pct: number; sens: 'HAUSSE' | 'BAISSE' | 'STABLE' };
  zones_critiques: { pcode: string; count: number }[];
}

interface SeuilItem {
  indicateur: string;
  label: string;
  valeur_actuelle: number;
  seuil: number;
  depasse: boolean;
  gravite: 'CRITIQUE' | 'ELEVEE' | 'MOYENNE' | null;
}

interface SeuilsResponse {
  seuils: SeuilItem[];
  nb_depasses: number;
  alerte_active: boolean;
}

interface Rapport {
  resume_executif: string;
  total_signalements: number;
  tendance: { variation_pct: number; sens: string };
  besoins_prioritaires: { type: string; menages_concernes: number; personnes_concernees: number; niveau: string }[];
  incoherences: { type: string; gravite: string; description: string; suggestion: string }[];
  seuils_depasses: SeuilItem[];
  nb_seuils_depasses: number;
  recommandation: string;
}

interface FluxMessage {
  id: string;
  type_flux: string;
  direction: 'ASCENDANT' | 'DESCENDANT';
  niveau_origine: number;
  niveau_destination: number;
  entite_origine_pcode: string | null;
  entite_destination_pcode: string;
  contenu: Record<string, unknown>;
  priorite: number;
  statut: string;
  accuse_reception_le: string | null;
  execute_le: string | null;
  created_at: string;
}

// ── Constantes ────────────────────────────────────────────────────────────────

const PROVINCE_NAMES: Record<string, string> = {
  CD10: 'Kinshasa', CD20: 'Kongo-Central', CD21: 'Kwango', CD22: 'Kwilu',
  CD23: 'Maï-Ndombe', CD41: 'Équateur', CD42: 'Sud-Ubangi', CD43: 'Nord-Ubangi',
  CD44: 'Mongala', CD45: 'Tshuapa', CD51: 'Tshopo', CD52: 'Bas-Uélé',
  CD53: 'Haut-Uélé', CD54: 'Ituri', CD61: 'Nord-Kivu', CD62: 'Sud-Kivu',
  CD63: 'Maniema', CD71: 'Haut-Katanga', CD72: 'Lualaba', CD73: 'Haut-Lomami',
  CD74: 'Tanganyika', CD81: 'Lomami', CD82: 'Kasaï-Oriental', CD83: 'Kasaï',
  CD84: 'Kasaï-Central', CD85: 'Sankuru',
};

const STATUT_LABELS: Record<string, string> = {
  TRANSMIS:          'Transmis',
  RECU:              'Reçu',
  ACCUSE_RECEPTION:  'Accusé réception',
  EN_COURS:          'En cours',
  EXECUTE:           'Exécuté',
};

const STATUT_COLORS: Record<string, string> = {
  TRANSMIS:         'bg-gray-700 text-gray-300',
  RECU:             'bg-blue-900 text-blue-300',
  ACCUSE_RECEPTION: 'bg-yellow-900 text-yellow-300',
  EN_COURS:         'bg-orange-900 text-orange-300',
  EXECUTE:          'bg-green-900 text-green-300',
};

const TYPE_ICONS: Record<string, string> = {
  SIGNALEMENT: '📋',
  ALERTE:      '🔴',
  RAPPORT:     '📄',
  DIRECTIVE:   '⬇',
  RESSOURCE:   '📦',
};

const GRAVITE_COLOR: Record<string, string> = {
  CRITIQUE: 'text-red-400',
  ELEVEE:   'text-orange-400',
  MOYENNE:  'text-yellow-400',
};

const NIVEAU_ICONS: Record<string, string> = {
  VITAL:     '🔴',
  URGENT:    '🟠',
  IMPORTANT: '🟡',
};

const PROVINCES = Object.entries(PROVINCE_NAMES).map(([code, name]) => ({ code, name }));

// ── Composant principal ───────────────────────────────────────────────────────

export function EtdPage() {
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);

  // Déterminer le pcode actif : scope utilisateur ou sélecteur
  const defaultPcode = user?.scope?.[0] ?? 'CD61';
  const [pcode, setPcode]   = useState(defaultPcode);
  const [showRapport, setShowRapport]   = useState(false);
  const [showNewFlux, setShowNewFlux]   = useState(false);
  const [newFluxForm, setNewFluxForm]   = useState({
    type_flux: 'SIGNALEMENT', texte: '', priorite: 1,
  });
  const [directionFilter, setDirectionFilter] = useState<'ALL' | 'ASCENDANT' | 'DESCENDANT'>('ALL');

  const isAdmin = ['system_admin', 'national_decision_maker'].includes(user?.role ?? '');
  const pcodeLabel = PROVINCE_NAMES[pcode] ?? pcode;

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: analyseData, isLoading: loadingAnalyse } = useQuery({
    queryKey: ['etd-analyse', pcode],
    queryFn: () => apiClient.get<{ success: boolean; data: AnalyseETD }>(`/etd/${pcode}/analyse?days=7`)
      .then(r => r.data.data),
    staleTime: 2 * 60 * 1000,
  });

  const { data: seuilsData, isLoading: loadingSeuils } = useQuery({
    queryKey: ['etd-seuils', pcode],
    queryFn: () => apiClient.get<{ success: boolean; data: SeuilsResponse }>(`/etd/${pcode}/seuils`)
      .then(r => r.data.data),
    staleTime: 2 * 60 * 1000,
  });

  const { data: rapportData, isFetching: loadingRapport } = useQuery({
    queryKey: ['etd-rapport', pcode],
    queryFn: () => apiClient.get<{ success: boolean; data: Rapport }>(`/etd/${pcode}/rapport`)
      .then(r => r.data.data),
    enabled: showRapport,
    staleTime: 5 * 60 * 1000,
  });

  const fluxParams = new URLSearchParams({ limit: '40' });
  if (pcode) fluxParams.set('pcode', pcode);
  if (directionFilter !== 'ALL') fluxParams.set('direction', directionFilter);

  const { data: fluxData, isLoading: loadingFlux } = useQuery({
    queryKey: ['etd-flux', pcode, directionFilter],
    queryFn: () => apiClient.get<{ data: FluxMessage[] }>(`/etd/flux?${fluxParams}`)
      .then(r => r.data.data ?? []),
    staleTime: 30 * 1000,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createFlux = useMutation({
    mutationFn: (body: object) => apiClient.post('/etd/flux', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['etd-flux'] });
      setShowNewFlux(false);
      setNewFluxForm({ type_flux: 'SIGNALEMENT', texte: '', priorite: 1 });
    },
  });

  const accuserMutation = useMutation({
    mutationFn: (id: string) => apiClient.put(`/etd/flux/${id}/accuser`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['etd-flux'] }),
  });

  const executerMutation = useMutation({
    mutationFn: (id: string) => apiClient.put(`/etd/flux/${id}/executer`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['etd-flux'] }),
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  const tendanceBadge = (sens: string, pct: number) => {
    if (sens === 'HAUSSE')  return <span className="text-red-400 font-mono text-xs">⬆ +{pct.toFixed(0)} %</span>;
    if (sens === 'BAISSE')  return <span className="text-green-400 font-mono text-xs">⬇ {pct.toFixed(0)} %</span>;
    return <span className="text-gray-400 font-mono text-xs">→ stable</span>;
  };

  const seuilBar = (valeur: number, seuil: number) => {
    const pct = Math.min(Math.round((valeur / seuil) * 100), 140);
    const color = pct >= 100 ? 'bg-red-500' : pct >= 70 ? 'bg-orange-500' : 'bg-green-500';
    return (
      <div className="flex items-center gap-1.5">
        <div className="w-20 h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <span className="text-xs font-mono text-gray-400">{(valeur * 100).toFixed(0)} %</span>
      </div>
    );
  };

  const handleCreateFlux = () => {
    createFlux.mutate({
      type_flux:                newFluxForm.type_flux,
      direction:                'ASCENDANT',
      niveau_origine:           6,
      niveau_destination:       2,
      entite_origine_pcode:     pcode,
      entite_destination_pcode: pcode.slice(0, 4),
      priorite:                 newFluxForm.priorite,
      contenu: { texte: newFluxForm.texte, emetteur: user?.email },
    });
  };

  const flux       = fluxData ?? [];
  const ascendant  = flux.filter(f => f.direction === 'ASCENDANT');
  const descendant = flux.filter(f => f.direction === 'DESCENDANT');
  const analyse    = analyseData;
  const seuils     = seuilsData;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 space-y-4 text-sm text-gray-200">

      {/* ── En-tête ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-white">Agent ETD</h1>
          <p className="text-xs text-gray-500 font-mono">Entités Territoriales Décentralisées — Intelligence locale & flux bidirectionnel</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <select
              value={pcode}
              onChange={e => setPcode(e.target.value)}
              className="bg-cc-800 border border-cc-600 rounded px-2 py-1 text-xs text-gray-200 font-mono"
            >
              {PROVINCES.map(p => (
                <option key={p.code} value={p.code}>{p.name} ({p.code})</option>
              ))}
            </select>
          )}
          {!isAdmin && (
            <span className="bg-sinaur-900 border border-sinaur-700 text-sinaur-300 text-xs font-mono px-2 py-1 rounded">
              {pcodeLabel} · {pcode}
            </span>
          )}
          <button
            onClick={() => setShowRapport(v => !v)}
            className="px-3 py-1 text-xs bg-sinaur-700 hover:bg-sinaur-600 text-white rounded font-medium transition-colors"
          >
            {loadingRapport ? '⏳' : '📄'} Rapport province
          </button>
          <button
            onClick={() => setShowNewFlux(v => !v)}
            className="px-3 py-1 text-xs bg-orange-800 hover:bg-orange-700 text-white rounded font-medium transition-colors"
          >
            ⬆ Nouveau message
          </button>
        </div>
      </div>

      {/* ── Rapport (accordéon) ────────────────────────────────────────── */}
      {showRapport && rapportData && (
        <div className="bg-cc-900 border border-sinaur-700 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sinaur-300 font-medium text-sm">Rapport de situation — {pcodeLabel}</h3>
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
              rapportData.recommandation === 'INTERVENTION_PROVINCIALE' ? 'bg-red-900 text-red-300' :
              rapportData.recommandation === 'SURVEILLANCE_RENFORCEE'  ? 'bg-orange-900 text-orange-300' :
              'bg-green-900 text-green-300'
            }`}>
              {rapportData.recommandation.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="text-gray-300 text-xs leading-relaxed border-l-2 border-sinaur-700 pl-3 italic">
            « {rapportData.resume_executif} »
          </p>
          {rapportData.besoins_prioritaires.length > 0 && (
            <div>
              <div className="text-[10px] text-gray-500 font-mono mb-1.5 uppercase tracking-wide">Besoins prioritaires</div>
              <div className="grid grid-cols-2 gap-1.5">
                {rapportData.besoins_prioritaires.map((b, i) => (
                  <div key={i} className="flex items-center gap-2 bg-cc-800 rounded px-2 py-1">
                    <span>{NIVEAU_ICONS[b.niveau] ?? '⚪'}</span>
                    <span className="font-medium text-xs">{b.type}</span>
                    <span className="text-gray-500 text-[10px] font-mono ml-auto">{b.personnes_concernees.toLocaleString()} pers.</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {rapportData.incoherences.length > 0 && (
            <div>
              <div className="text-[10px] text-gray-500 font-mono mb-1.5 uppercase tracking-wide">Incohérences à corriger</div>
              {rapportData.incoherences.map((inc, i) => (
                <div key={i} className="text-xs text-yellow-400 flex items-start gap-1.5 mb-0.5">
                  <span>⚠</span>
                  <span>{inc.description}</span>
                  <span className="text-gray-500">— {inc.suggestion}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Nouveau message (formulaire) ───────────────────────────────── */}
      {showNewFlux && (
        <div className="bg-cc-900 border border-orange-800 rounded-lg p-4 space-y-3">
          <h3 className="text-orange-300 font-medium text-sm">⬆ Nouveau message ascendant</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] text-gray-500 font-mono mb-1">Type</label>
              <select
                value={newFluxForm.type_flux}
                onChange={e => setNewFluxForm(v => ({ ...v, type_flux: e.target.value }))}
                className="w-full bg-cc-800 border border-cc-600 rounded px-2 py-1 text-xs"
              >
                {['SIGNALEMENT', 'ALERTE', 'RAPPORT', 'RESSOURCE'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 font-mono mb-1">Priorité</label>
              <select
                value={newFluxForm.priorite}
                onChange={e => setNewFluxForm(v => ({ ...v, priorite: Number(e.target.value) }))}
                className="w-full bg-cc-800 border border-cc-600 rounded px-2 py-1 text-xs"
              >
                <option value={1}>1 — Normal</option>
                <option value={2}>2 — Important</option>
                <option value={3}>3 — Urgent</option>
                <option value={4}>4 — Critique</option>
                <option value={5}>5 — Vital</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 font-mono mb-1">Destination</label>
              <div className="bg-cc-800 border border-cc-600 rounded px-2 py-1 text-xs text-gray-400 font-mono">
                Province ({pcode.slice(0, 4)})
              </div>
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 font-mono mb-1">Message</label>
            <textarea
              value={newFluxForm.texte}
              onChange={e => setNewFluxForm(v => ({ ...v, texte: e.target.value }))}
              rows={3}
              placeholder="Décrivez la situation ou la demande..."
              className="w-full bg-cc-800 border border-cc-600 rounded px-2 py-1.5 text-xs text-gray-200 resize-none"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowNewFlux(false)}
              className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200 transition-colors"
            >
              Annuler
            </button>
            <button
              disabled={!newFluxForm.texte.trim() || createFlux.isPending}
              onClick={handleCreateFlux}
              className="px-4 py-1 text-xs bg-orange-700 hover:bg-orange-600 disabled:opacity-40 text-white rounded font-medium transition-colors"
            >
              {createFlux.isPending ? '⏳ Envoi...' : '⬆ Transmettre à la province'}
            </button>
          </div>
        </div>
      )}

      {/* ── Grille principale ─────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">

        {/* ── Colonne 1 : Analyse locale ──────────────────────────────── */}
        <div className="space-y-3">

          {/* Résumé chiffres */}
          <div className="bg-cc-900 border border-cc-700 rounded-lg p-3">
            <div className="text-[10px] text-gray-500 font-mono mb-2 uppercase tracking-wide">Analyse locale — 7 jours</div>
            {loadingAnalyse ? (
              <div className="text-gray-600 text-xs">Chargement…</div>
            ) : analyse ? (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold text-white">{analyse.total_signalements}</span>
                  <span className="text-xs text-gray-500">événements</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Tendance :</span>
                  {tendanceBadge(analyse.tendance.sens, Math.abs(analyse.tendance.variation_pct))}
                </div>
                <div className="text-[10px] text-gray-600 font-mono">
                  {analyse.tendance.recent} récents · {analyse.tendance.precedent} précédents
                </div>
              </div>
            ) : (
              <div className="text-gray-600 text-xs">Aucune donnée</div>
            )}
          </div>

          {/* Par type */}
          {analyse?.par_type && analyse.par_type.length > 0 && (
            <div className="bg-cc-900 border border-cc-700 rounded-lg p-3">
              <div className="text-[10px] text-gray-500 font-mono mb-2 uppercase tracking-wide">Par type de sinistre</div>
              <div className="space-y-1.5">
                {analyse.par_type.slice(0, 6).map((t, i) => {
                  const max = analyse.par_type[0].count;
                  const pct = max > 0 ? Math.round((t.count / max) * 100) : 0;
                  return (
                    <div key={i}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-gray-300 truncate">{t.label}</span>
                        <span className="text-gray-500 font-mono">{t.count}</span>
                      </div>
                      <div className="w-full h-1 bg-cc-700 rounded-full overflow-hidden">
                        <div className="h-full bg-sinaur-600 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Zones critiques */}
          {analyse?.zones_critiques && analyse.zones_critiques.length > 0 && (
            <div className="bg-cc-900 border border-cc-700 rounded-lg p-3">
              <div className="text-[10px] text-gray-500 font-mono mb-2 uppercase tracking-wide">Zones les plus touchées</div>
              {analyse.zones_critiques.map((z, i) => (
                <div key={i} className="flex justify-between text-xs py-0.5">
                  <span className="text-gray-400 font-mono">{z.pcode || '—'}</span>
                  <span className="text-gray-300">{z.count} év.</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Colonne 2 : Seuils + Rapport ────────────────────────────── */}
        <div className="space-y-3">

          {/* Seuils d'alerte */}
          <div className="bg-cc-900 border border-cc-700 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wide">Seuils d'alerte</span>
              {seuils?.alerte_active && (
                <span className="text-[10px] bg-red-900 text-red-300 font-mono px-1.5 py-0.5 rounded">
                  {seuils.nb_depasses} dépassé{seuils.nb_depasses > 1 ? 's' : ''}
                </span>
              )}
            </div>
            {loadingSeuils ? (
              <div className="text-gray-600 text-xs">Chargement…</div>
            ) : seuils?.seuils?.length ? (
              <div className="space-y-2.5">
                {seuils.seuils.map((s, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className={s.depasse ? (GRAVITE_COLOR[s.gravite ?? ''] ?? 'text-gray-300') : 'text-gray-400'}>
                        {s.depasse ? (s.gravite === 'CRITIQUE' ? '🔴' : '🟠') : '🟢'} {s.label}
                      </span>
                      {s.depasse && (
                        <span className={`text-[10px] font-mono ${GRAVITE_COLOR[s.gravite ?? ''] ?? ''}`}>
                          {s.gravite}
                        </span>
                      )}
                    </div>
                    {seuilBar(s.valeur_actuelle, s.seuil)}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-gray-600 text-xs">Données insuffisantes</div>
            )}
          </div>

          {/* Recommandation */}
          {rapportData && (
            <div className={`rounded-lg p-3 border ${
              rapportData.recommandation === 'INTERVENTION_PROVINCIALE' ? 'bg-red-950 border-red-800' :
              rapportData.recommandation === 'SURVEILLANCE_RENFORCEE'  ? 'bg-orange-950 border-orange-800' :
              'bg-green-950 border-green-800'
            }`}>
              <div className="text-[10px] font-mono mb-1 uppercase tracking-wide opacity-60">Recommandation</div>
              <div className="text-sm font-medium">
                {rapportData.recommandation === 'INTERVENTION_PROVINCIALE' && '🚨 Intervention provinciale requise'}
                {rapportData.recommandation === 'SURVEILLANCE_RENFORCEE'  && '⚠ Surveillance renforcée'}
                {rapportData.recommandation === 'SUIVI_NORMAL'            && '✓ Suivi normal'}
              </div>
              <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">{rapportData.resume_executif}</p>
            </div>
          )}

          {/* Incohérences */}
          {rapportData?.incoherences && rapportData.incoherences.length > 0 && (
            <div className="bg-cc-900 border border-yellow-900 rounded-lg p-3">
              <div className="text-[10px] text-yellow-600 font-mono mb-2 uppercase tracking-wide">
                Incohérences à corriger ({rapportData.incoherences.length})
              </div>
              {rapportData.incoherences.map((inc, i) => (
                <div key={i} className="text-xs mb-1.5">
                  <div className="text-yellow-400 flex items-start gap-1">
                    <span className="shrink-0">⚠</span>
                    <span>{inc.description}</span>
                  </div>
                  <div className="text-gray-500 ml-4">{inc.suggestion}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Colonne 3 : Flux bidirectionnel ──────────────────────────── */}
        <div className="space-y-3">
          <div className="bg-cc-900 border border-cc-700 rounded-lg p-3 h-full flex flex-col">

            {/* Header flux */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wide">Flux bidirectionnel</span>
              <div className="flex gap-1">
                {(['ALL', 'ASCENDANT', 'DESCENDANT'] as const).map(d => (
                  <button
                    key={d}
                    onClick={() => setDirectionFilter(d)}
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors ${
                      directionFilter === d
                        ? 'bg-sinaur-700 text-white'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {d === 'ALL' ? 'Tous' : d === 'ASCENDANT' ? '⬆ Remontées' : '⬇ Directives'}
                  </button>
                ))}
              </div>
            </div>

            {/* Résumé compteurs */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-cc-800 rounded p-2 text-center">
                <div className="text-orange-400 text-lg font-bold">{ascendant.length}</div>
                <div className="text-[10px] text-gray-500 font-mono">⬆ Remontées</div>
              </div>
              <div className="bg-cc-800 rounded p-2 text-center">
                <div className="text-blue-400 text-lg font-bold">{descendant.length}</div>
                <div className="text-[10px] text-gray-500 font-mono">⬇ Directives</div>
              </div>
            </div>

            {/* Liste des messages */}
            <div className="flex-1 overflow-y-auto space-y-1.5">
              {loadingFlux ? (
                <div className="text-gray-600 text-xs text-center py-4">Chargement…</div>
              ) : flux.length === 0 ? (
                <div className="text-gray-600 text-xs text-center py-4">Aucun message de flux</div>
              ) : (
                flux.map(msg => (
                  <div key={msg.id} className={`rounded p-2 border text-xs ${
                    msg.direction === 'ASCENDANT'
                      ? 'bg-orange-950/40 border-orange-900'
                      : 'bg-blue-950/40 border-blue-900'
                  }`}>
                    <div className="flex items-start justify-between gap-1 mb-1">
                      <div className="flex items-center gap-1">
                        <span>{TYPE_ICONS[msg.type_flux] ?? '📋'}</span>
                        <span className="font-medium text-gray-200">{msg.type_flux}</span>
                        {msg.priorite >= 4 && (
                          <span className="text-[10px] bg-red-900 text-red-300 px-1 rounded font-mono">P{msg.priorite}</span>
                        )}
                      </div>
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${STATUT_COLORS[msg.statut] ?? 'bg-gray-700 text-gray-400'}`}>
                        {STATUT_LABELS[msg.statut] ?? msg.statut}
                      </span>
                    </div>
                    <div className="text-gray-400 text-[10px] font-mono mb-1">
                      {msg.direction === 'ASCENDANT'
                        ? `${msg.entite_origine_pcode ?? '?'} → ${msg.entite_destination_pcode}`
                        : `${msg.entite_origine_pcode ?? '?'} → ${msg.entite_destination_pcode}`}
                    </div>
                    {typeof msg.contenu === 'object' && msg.contenu !== null && (msg.contenu as any).texte && (
                      <div className="text-gray-300 text-[10px] line-clamp-2 mb-1">
                        {String((msg.contenu as any).texte)}
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600 text-[10px] font-mono">
                        {new Date(msg.created_at).toLocaleDateString('fr-CD', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {msg.direction === 'DESCENDANT' && msg.statut === 'TRANSMIS' && (
                        <button
                          onClick={() => accuserMutation.mutate(msg.id)}
                          disabled={accuserMutation.isPending}
                          className="text-[10px] bg-blue-900 hover:bg-blue-800 text-blue-300 px-1.5 py-0.5 rounded transition-colors"
                        >
                          Accuser réception
                        </button>
                      )}
                      {msg.direction === 'DESCENDANT' && msg.statut === 'ACCUSE_RECEPTION' && (
                        <button
                          onClick={() => executerMutation.mutate(msg.id)}
                          disabled={executerMutation.isPending}
                          className="text-[10px] bg-green-900 hover:bg-green-800 text-green-300 px-1.5 py-0.5 rounded transition-colors"
                        >
                          Marquer exécuté
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

          </div>
        </div>

      </div>

      {/* ── Légende chaîne hiérarchique ───────────────────────────────── */}
      <div className="bg-cc-900 border border-cc-700 rounded-lg p-3">
        <div className="text-[10px] text-gray-500 font-mono mb-2 uppercase tracking-wide">Chaîne de flux — RDC</div>
        <div className="flex items-center gap-1 text-[10px] font-mono text-gray-500 overflow-x-auto">
          {[
            { label: 'Village', color: 'text-gray-600' },
            { label: '→', color: 'text-gray-700' },
            { label: 'Groupement', color: 'text-gray-500' },
            { label: '→', color: 'text-gray-700' },
            { label: 'ETD', color: 'text-sinaur-400', bold: true },
            { label: '→', color: 'text-gray-700' },
            { label: 'Province', color: 'text-blue-400' },
            { label: '→', color: 'text-gray-700' },
            { label: 'Pouvoir Central', color: 'text-purple-400' },
          ].map((item, i) => (
            <span key={i} className={`${item.color} ${item.bold ? 'font-bold' : ''} shrink-0`}>
              {item.label}
            </span>
          ))}
          <span className="ml-2 text-gray-700">|</span>
          <span className="ml-2 text-orange-400 shrink-0">⬆ ASCENDANT : terrain → décideurs</span>
          <span className="mx-2 text-gray-700">|</span>
          <span className="text-blue-400 shrink-0">⬇ DESCENDANT : décisions → population</span>
        </div>
      </div>

    </div>
  );
}
