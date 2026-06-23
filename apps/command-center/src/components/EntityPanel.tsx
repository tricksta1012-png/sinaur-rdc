/**
 * Panneau latéral enrichi — sélection d'entité sur la carte.
 * 4 onglets : Infos · Responsable · ETD Analyse · Flux
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';

// ── Types partagés ────────────────────────────────────────────────────────────

export interface EntityProps {
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
  _is_point?: boolean;
}

interface HistoryEntry {
  id: number;
  pcode: string;
  entity_name: string;
  ancien_nom: string | null;
  ancien_titre: string | null;
  nouveau_nom: string | null;
  nouveau_titre: string | null;
  modifie_par: string;
  modifie_le: string;
  source_info: string | null;
  action: string;
}

interface AnalyseETD {
  etd_pcode: string;
  periode_jours: number;
  total_signalements: number;
  par_type: Record<string, number>;
  tendance: { sens: 'HAUSSE' | 'BAISSE' | 'STABLE'; pct_variation: number };
  zones_critiques: { pcode: string; name_fr: string; count: number }[];
}

interface SeuilItem {
  indicateur: string;
  label: string;
  valeur_actuelle: number;
  seuil: number;
  depasse: boolean;
  gravite: string;
}

interface SeuilsResponse {
  seuils: SeuilItem[];
  nb_depasses: number;
  alerte_active: boolean;
}

interface FluxMessage {
  id: string;
  type_flux: string;
  direction: 'ASCENDANT' | 'DESCENDANT';
  contenu: Record<string, unknown>;
  priorite: number;
  statut: string;
  accuse_reception_le: string | null;
  execute_le: string | null;
  created_at: string;
  entite_origine_pcode: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const NIVEAU_LABELS: Record<number, string> = {
  0: 'Pays',
  1: 'Province',
  2: 'Territoire / Ville',
  3: 'Commune · Secteur · Chefferie',
  4: 'Groupement',
  5: 'Village',
};

export const NIVEAU_ENFANTS: Record<number, string> = {
  1: 'les territoires',
  2: 'les communes/secteurs',
  3: 'les groupements',
};

export const ETD_LEVELS = new Set([3]);

export const STATUT_STYLE: Record<string, { cls: string; dot: string }> = {
  NORMAL:    { cls: 'bg-green-900/60 text-green-300 border-green-700',    dot: 'bg-green-400'             },
  VIGILANCE: { cls: 'bg-yellow-900/60 text-yellow-300 border-yellow-700', dot: 'bg-yellow-400'            },
  ALERTE:    { cls: 'bg-orange-900/60 text-orange-300 border-orange-700', dot: 'bg-orange-400'            },
  CRISE:     { cls: 'bg-red-900/60 text-red-300 border-red-700',          dot: 'bg-red-500 animate-pulse' },
};

const STATUT_OPTIONS = ['NORMAL', 'VIGILANCE', 'ALERTE', 'CRISE'] as const;

const FLUX_TYPES = ['SIGNALEMENT', 'ALERTE', 'RAPPORT', 'DIRECTIVE', 'RESSOURCE'] as const;

const FLUX_ICONS: Record<string, string> = {
  SIGNALEMENT: '📋',
  ALERTE:      '🔴',
  RAPPORT:     '📄',
  DIRECTIVE:   '⬇',
  RESSOURCE:   '📦',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  } catch { return iso; }
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function fmtAction(action: string): { label: string; cls: string } {
  switch (action) {
    case 'CREATION':     return { label: 'Création',     cls: 'text-green-400' };
    case 'MODIFICATION': return { label: 'Modification', cls: 'text-blue-400'  };
    case 'SUPPRESSION':  return { label: 'Suppression',  cls: 'text-red-400'   };
    default:             return { label: action,          cls: 'text-gray-400'  };
  }
}

type TabKey = 'infos' | 'resp' | 'etd' | 'flux';

// ── Tab: Infos ────────────────────────────────────────────────────────────────

function TabInfos({
  entity,
  onDrillDown,
}: {
  entity: EntityProps;
  onDrillDown: (e: EntityProps) => void;
}) {
  const canDrillDown = entity.level in NIVEAU_ENFANTS;
  const isEtd = ETD_LEVELS.has(entity.level);

  return (
    <div className="divide-y divide-cc-700">
      {/* Qui gère */}
      <div className="px-4 py-3">
        <div className="text-[9px] font-mono text-cc-500 uppercase mb-2 tracking-wider">Qui gère cette zone</div>
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

      {/* Type */}
      <div className="px-4 py-2.5">
        <div className={`text-[9px] px-2 py-1 rounded border inline-block font-mono ${
          isEtd
            ? 'bg-blue-950/60 text-blue-300 border-blue-800'
            : 'bg-cc-800 text-cc-500 border-cc-700'
        }`}>
          {isEtd ? 'ETD · Entité Territoriale Décentralisée' : 'Entité déconcentrée'}
        </div>
      </div>

      {/* Stats */}
      <div className="px-4 py-3 space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-cc-500 font-mono">Population</span>
          <span className="text-gray-300 font-bold">
            {entity.population != null ? entity.population.toLocaleString('fr-FR') + ' hab.' : '—'}
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
      {canDrillDown && (
        <div className="px-4 py-3">
          <button
            onClick={() => onDrillDown(entity)}
            className="w-full text-left text-xs bg-sinaur-900/60 hover:bg-sinaur-800 border border-sinaur-700 text-sinaur-300 rounded-lg px-3 py-2 font-mono transition-colors"
          >
            Voir {NIVEAU_ENFANTS[entity.level]} →
          </button>
        </div>
      )}
    </div>
  );
}

// ── Tab: Responsable ──────────────────────────────────────────────────────────

function TabResponsable({
  entity,
  history,
  historyLoading,
  isAdmin,
  canWrite,
}: {
  entity: EntityProps;
  history: HistoryEntry[];
  historyLoading: boolean;
  isAdmin: boolean;
  canWrite: boolean;
}) {
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);

  const [editing, setEditing] = useState(false);
  const [nom, setNom]         = useState(entity.responsable_nom ?? '');
  const [titre, setTitre]     = useState(entity.responsable_titre ?? '');
  const [contact, setContact] = useState(entity.responsable_contact ?? '');
  const [source, setSource]   = useState('');
  const [statut, setStatut]   = useState<string>(entity.statut ?? 'NORMAL');

  const saveMutation = useMutation({
    mutationFn: (body: object) =>
      apiClient.put(`/responsables/entities/${entity.pcode}/responsable`, body),
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['cartographie'] });
      qc.invalidateQueries({ queryKey: ['resp-history', entity.pcode] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.delete(`/responsables/entities/${entity.pcode}/responsable`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cartographie'] });
    },
  });

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!nom.trim() || !titre.trim()) return;
    saveMutation.mutate({ nom: nom.trim(), titre: titre.trim(), contact: contact.trim() || undefined, source: source.trim() || undefined, statut });
  }

  const hasResp = !!entity.responsable_nom;
  const userEmail = user?.email ?? '';

  return (
    <div className="divide-y divide-cc-700">
      {editing ? (
        /* ── Formulaire d'édition ── */
        <form onSubmit={handleSave} className="px-4 py-3 space-y-3">
          <div className="text-[9px] font-mono text-cc-500 uppercase tracking-wider mb-1">
            {hasResp ? 'Modifier le responsable' : 'Affecter un responsable'}
          </div>

          <div>
            <label className="block text-[10px] text-gray-400 mb-1">Nom *</label>
            <input
              type="text"
              value={nom}
              onChange={e => setNom(e.target.value)}
              required
              className="w-full bg-cc-800 border border-cc-700 rounded px-2.5 py-1.5 text-gray-200 text-xs focus:outline-none focus:border-sinaur-500"
              placeholder="Prénom NOM"
            />
          </div>

          <div>
            <label className="block text-[10px] text-gray-400 mb-1">Titre / Fonction *</label>
            <input
              type="text"
              value={titre}
              onChange={e => setTitre(e.target.value)}
              required
              className="w-full bg-cc-800 border border-cc-700 rounded px-2.5 py-1.5 text-gray-200 text-xs focus:outline-none focus:border-sinaur-500"
              placeholder="Bourgmestre / Gouverneur …"
            />
          </div>

          <div>
            <label className="block text-[10px] text-gray-400 mb-1">Contact</label>
            <input
              type="text"
              value={contact}
              onChange={e => setContact(e.target.value)}
              className="w-full bg-cc-800 border border-cc-700 rounded px-2.5 py-1.5 text-gray-200 text-xs focus:outline-none focus:border-sinaur-500"
              placeholder="+243 …"
            />
          </div>

          <div>
            <label className="block text-[10px] text-gray-400 mb-1">Source / Référence</label>
            <input
              type="text"
              value={source}
              onChange={e => setSource(e.target.value)}
              className="w-full bg-cc-800 border border-cc-700 rounded px-2.5 py-1.5 text-gray-200 text-xs focus:outline-none focus:border-sinaur-500"
              placeholder="Arrêté ministériel …"
            />
          </div>

          <div>
            <label className="block text-[10px] text-gray-400 mb-1">Statut de situation</label>
            <select
              value={statut}
              onChange={e => setStatut(e.target.value)}
              className="w-full bg-cc-800 border border-cc-700 rounded px-2.5 py-1.5 text-gray-200 text-xs focus:outline-none focus:border-sinaur-500"
            >
              {STATUT_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saveMutation.isPending || !nom.trim() || !titre.trim()}
              className="flex-1 bg-sinaur-700 hover:bg-sinaur-600 disabled:opacity-50 text-white text-xs font-medium py-1.5 rounded transition-colors"
            >
              {saveMutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-3 bg-cc-800 hover:bg-cc-700 text-gray-400 text-xs py-1.5 rounded transition-colors"
            >
              Annuler
            </button>
          </div>

          {isAdmin && hasResp && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Supprimer le responsable de "${entity.name}" ?`)) {
                  deleteMutation.mutate();
                }
              }}
              disabled={deleteMutation.isPending}
              className="w-full text-xs text-red-400 hover:text-red-300 border border-red-900 hover:border-red-700 py-1.5 rounded transition-colors"
            >
              {deleteMutation.isPending ? 'Suppression…' : 'Supprimer le responsable'}
            </button>
          )}
        </form>
      ) : (
        /* ── Vue lecture ── */
        <div className="px-4 py-3 space-y-2">
          <div className="text-[9px] font-mono text-cc-500 uppercase tracking-wider mb-2">Responsable actuel</div>

          {hasResp ? (
            <div className="space-y-1.5">
              <div className="flex items-start gap-2">
                <span className="text-sm shrink-0">👤</span>
                <div className="min-w-0">
                  {entity.responsable_titre && (
                    <div className="text-[10px] text-cc-500 font-mono">{entity.responsable_titre}</div>
                  )}
                  <div className="text-xs font-semibold text-white">{entity.responsable_nom}</div>
                  {entity.responsable_contact && (
                    <div className="text-[10px] text-cc-500 font-mono break-all">{entity.responsable_contact}</div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-yellow-600 italic">Aucun responsable affecté</div>
          )}

          {canWrite && (
            <button
              onClick={() => setEditing(true)}
              className="w-full text-xs bg-sinaur-900/60 hover:bg-sinaur-800 border border-sinaur-700 text-sinaur-300 rounded px-3 py-1.5 font-mono transition-colors mt-2"
            >
              {hasResp ? '✎ Modifier' : '+ Affecter'}
            </button>
          )}
        </div>
      )}

      {/* Historique */}
      <div className="px-4 py-3">
        <div className="text-[9px] font-mono text-cc-500 uppercase tracking-wider mb-2">
          Historique {history.length > 0 ? `(${history.length})` : ''}
        </div>
        {historyLoading && <div className="text-[10px] text-cc-600">Chargement…</div>}
        {!historyLoading && history.length === 0 && (
          <div className="text-[10px] text-cc-600 italic">Aucun historique</div>
        )}
        {history.length > 0 && (
          <div className="space-y-2 max-h-52 overflow-y-auto">
            {history.map(h => {
              const { label, cls } = fmtAction(h.action);
              return (
                <div key={h.id} className="bg-cc-800 rounded p-2 text-[10px] space-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className={`font-medium ${cls}`}>{label}</span>
                    <span className="text-cc-600 font-mono">{fmtDate(h.modifie_le)}</span>
                  </div>
                  {h.action !== 'SUPPRESSION' && h.nouveau_nom && (
                    <div className="text-gray-300">→ {h.nouveau_nom}{h.nouveau_titre ? ` (${h.nouveau_titre})` : ''}</div>
                  )}
                  {h.ancien_nom && (
                    <div className="text-gray-500">Ancien : {h.ancien_nom}</div>
                  )}
                  <div className="text-cc-600">par {h.modifie_par}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: ETD Analyse ─────────────────────────────────────────────────────────

function TabEtd({
  analyseData,
  seuilsData,
  loading,
}: {
  analyseData: AnalyseETD | undefined;
  seuilsData: SeuilsResponse | undefined;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="px-4 py-6 text-center text-[10px] text-cc-600">Chargement de l'analyse…</div>
    );
  }

  if (!analyseData) {
    return (
      <div className="px-4 py-6 text-center text-[10px] text-cc-600 italic">Données ETD indisponibles</div>
    );
  }

  const { total_signalements, tendance, par_type, zones_critiques } = analyseData;

  const tendanceBadge = () => {
    if (tendance.sens === 'HAUSSE')
      return <span className="text-red-400 font-mono text-[10px]">⬆ +{tendance.pct_variation.toFixed(0)} %</span>;
    if (tendance.sens === 'BAISSE')
      return <span className="text-green-400 font-mono text-[10px]">⬇ {tendance.pct_variation.toFixed(0)} %</span>;
    return <span className="text-gray-400 font-mono text-[10px]">→ stable</span>;
  };

  const parTypeEntries = Object.entries(par_type ?? {}).sort((a, b) => b[1] - a[1]);

  const seuils = seuilsData?.seuils ?? [];
  const alerteActive = seuilsData?.alerte_active ?? false;
  const nbDepasses = seuilsData?.nb_depasses ?? 0;

  return (
    <div className="divide-y divide-cc-700">
      {/* Vue d'ensemble */}
      <div className="px-4 py-3 space-y-2">
        <div className="text-[9px] font-mono text-cc-500 uppercase tracking-wider">Signalements 7j</div>
        <div className="flex items-center justify-between">
          <span className="text-xl font-bold text-white">{total_signalements}</span>
          {tendanceBadge()}
        </div>

        {alerteActive && (
          <div className="text-[10px] font-mono px-2 py-1 bg-red-950/60 border border-red-800 text-red-400 rounded">
            ⚠ {nbDepasses} seuil{nbDepasses > 1 ? 's' : ''} dépassé{nbDepasses > 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Par type */}
      {parTypeEntries.length > 0 && (
        <div className="px-4 py-3">
          <div className="text-[9px] font-mono text-cc-500 uppercase tracking-wider mb-2">Par type</div>
          <div className="space-y-1.5">
            {parTypeEntries.map(([type, count]) => {
              const pct = total_signalements > 0 ? Math.round((count / total_signalements) * 100) : 0;
              return (
                <div key={type} className="flex items-center gap-2">
                  <div className="text-[10px] text-gray-400 w-28 truncate font-mono">{type}</div>
                  <div className="flex-1 h-1.5 bg-cc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-sinaur-600 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] text-gray-300 font-mono w-6 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Seuils */}
      {seuils.length > 0 && (
        <div className="px-4 py-3">
          <div className="text-[9px] font-mono text-cc-500 uppercase tracking-wider mb-2">Seuils d'alerte</div>
          <div className="space-y-2">
            {seuils.slice(0, 5).map(s => {
              const pct = Math.min(Math.round((s.valeur_actuelle / s.seuil) * 100), 100);
              const barColor = s.depasse ? 'bg-red-500' : pct >= 70 ? 'bg-orange-500' : 'bg-green-500';
              return (
                <div key={s.indicateur}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className={`text-[10px] font-mono ${s.depasse ? 'text-red-400' : 'text-gray-400'}`}>
                      {s.depasse ? '⚠ ' : ''}{s.label}
                    </span>
                    <span className="text-[10px] text-gray-500 font-mono">
                      {(s.valeur_actuelle * 100).toFixed(0)} / {(s.seuil * 100).toFixed(0)} %
                    </span>
                  </div>
                  <div className="h-1.5 bg-cc-800 rounded-full overflow-hidden">
                    <div className={`h-full ${barColor} rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Zones critiques */}
      {zones_critiques && zones_critiques.length > 0 && (
        <div className="px-4 py-3">
          <div className="text-[9px] font-mono text-cc-500 uppercase tracking-wider mb-2">Zones critiques</div>
          <div className="space-y-1">
            {zones_critiques.slice(0, 5).map(z => (
              <div key={z.pcode} className="flex items-center justify-between text-[10px]">
                <span className="text-gray-300 truncate">{z.name_fr}</span>
                <span className="text-orange-400 font-mono ml-2">{z.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Flux ─────────────────────────────────────────────────────────────────

function TabFlux({
  entity,
  flux,
  loading,
}: {
  entity: EntityProps;
  flux: FluxMessage[];
  loading: boolean;
}) {
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);

  const [showForm, setShowForm]   = useState(false);
  const [fluxTexte, setFluxTexte] = useState('');
  const [fluxType, setFluxType]   = useState('SIGNALEMENT');
  const [priorite, setPriorite]   = useState(1);

  const createFlux = useMutation({
    mutationFn: (body: object) => apiClient.post('/etd/flux', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['etd-flux-panel', entity.pcode] });
      setShowForm(false);
      setFluxTexte('');
    },
  });

  const accuserMutation = useMutation({
    mutationFn: (id: string) => apiClient.put(`/etd/flux/${id}/accuser`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['etd-flux-panel', entity.pcode] }),
  });

  const executerMutation = useMutation({
    mutationFn: (id: string) => apiClient.put(`/etd/flux/${id}/executer`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['etd-flux-panel', entity.pcode] }),
  });

  function handleCreateFlux() {
    if (!fluxTexte.trim()) return;
    createFlux.mutate({
      type_flux: fluxType,
      direction: 'ASCENDANT',
      niveau_origine: 6,
      niveau_destination: 2,
      entite_origine_pcode: entity.pcode,
      entite_destination_pcode: entity.pcode.slice(0, 4),
      priorite,
      contenu: { texte: fluxTexte.trim(), emetteur: user?.email },
    });
  }

  const STATUT_FLUX_CLS: Record<string, string> = {
    EN_ATTENTE: 'text-yellow-400',
    ACCUSE:     'text-blue-400',
    EXECUTE:    'text-green-400',
  };

  return (
    <div className="divide-y divide-cc-700">
      {/* Bouton nouveau flux */}
      <div className="px-4 py-3">
        <button
          onClick={() => setShowForm(v => !v)}
          className="w-full text-xs bg-orange-900/60 hover:bg-orange-800 border border-orange-700 text-orange-300 rounded px-3 py-1.5 font-mono transition-colors"
        >
          {showForm ? '✕ Annuler' : '+ Nouveau flux ascendant'}
        </button>

        {showForm && (
          <div className="mt-3 space-y-2">
            <select
              value={fluxType}
              onChange={e => setFluxType(e.target.value)}
              className="w-full bg-cc-800 border border-cc-700 rounded px-2 py-1.5 text-gray-200 text-xs focus:outline-none focus:border-sinaur-500"
            >
              {FLUX_TYPES.map(t => (
                <option key={t} value={t}>{FLUX_ICONS[t]} {t}</option>
              ))}
            </select>

            <select
              value={priorite}
              onChange={e => setPriorite(Number(e.target.value))}
              className="w-full bg-cc-800 border border-cc-700 rounded px-2 py-1.5 text-gray-200 text-xs focus:outline-none focus:border-sinaur-500"
            >
              <option value={1}>Priorité 1 — Vital</option>
              <option value={2}>Priorité 2 — Urgent</option>
              <option value={3}>Priorité 3 — Important</option>
            </select>

            <textarea
              value={fluxTexte}
              onChange={e => setFluxTexte(e.target.value)}
              rows={3}
              placeholder="Contenu du message…"
              className="w-full bg-cc-800 border border-cc-700 rounded px-2 py-1.5 text-gray-200 text-xs focus:outline-none focus:border-sinaur-500 resize-none"
            />

            <button
              onClick={handleCreateFlux}
              disabled={createFlux.isPending || !fluxTexte.trim()}
              className="w-full bg-orange-800 hover:bg-orange-700 disabled:opacity-50 text-white text-xs font-medium py-1.5 rounded transition-colors"
            >
              {createFlux.isPending ? 'Envoi…' : 'Envoyer'}
            </button>
          </div>
        )}
      </div>

      {/* Liste des flux */}
      <div className="px-4 py-3">
        <div className="text-[9px] font-mono text-cc-500 uppercase tracking-wider mb-2">
          Flux récents {flux.length > 0 ? `(${flux.length})` : ''}
        </div>

        {loading && <div className="text-[10px] text-cc-600 text-center py-2">Chargement…</div>}

        {!loading && flux.length === 0 && (
          <div className="text-[10px] text-cc-600 italic text-center py-2">Aucun flux pour cette entité</div>
        )}

        {flux.length > 0 && (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {flux.map(f => {
              const icon = FLUX_ICONS[f.type_flux] ?? '📋';
              const statutCls = STATUT_FLUX_CLS[f.statut] ?? 'text-gray-400';
              const texte = String((f.contenu as any)?.texte ?? '');

              return (
                <div key={f.id} className="bg-cc-800 rounded p-2.5 space-y-1">
                  <div className="flex items-start justify-between gap-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-sm shrink-0">{icon}</span>
                      <div className="min-w-0">
                        <div className="text-[10px] font-mono text-gray-300 font-medium">{f.type_flux}</div>
                        <div className="text-[9px] text-cc-500 font-mono">{fmtTime(f.created_at)}</div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-[9px] font-mono font-medium ${statutCls}`}>{f.statut}</div>
                      <div className="text-[9px] text-cc-600 font-mono">P{f.priorite}</div>
                    </div>
                  </div>

                  {texte && (
                    <div className="text-[10px] text-gray-400 line-clamp-2">{texte}</div>
                  )}

                  {/* Actions flux */}
                  {f.statut === 'EN_ATTENTE' && (
                    <div className="flex gap-1.5 pt-0.5">
                      <button
                        onClick={() => accuserMutation.mutate(f.id)}
                        disabled={accuserMutation.isPending}
                        className="text-[9px] text-blue-400 hover:text-blue-300 border border-blue-900 hover:border-blue-700 px-1.5 py-0.5 rounded transition-colors"
                      >
                        ✓ Accuser
                      </button>
                      <button
                        onClick={() => executerMutation.mutate(f.id)}
                        disabled={executerMutation.isPending}
                        className="text-[9px] text-green-400 hover:text-green-300 border border-green-900 hover:border-green-700 px-1.5 py-0.5 rounded transition-colors"
                      >
                        ✓ Exécuter
                      </button>
                    </div>
                  )}
                  {f.statut === 'ACCUSE' && (
                    <button
                      onClick={() => executerMutation.mutate(f.id)}
                      disabled={executerMutation.isPending}
                      className="text-[9px] text-green-400 hover:text-green-300 border border-green-900 hover:border-green-700 px-1.5 py-0.5 rounded transition-colors"
                    >
                      ✓ Marquer exécuté
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── EntityPanel principal ─────────────────────────────────────────────────────

export function EntityPanel({
  entity,
  onClose,
  onDrillDown,
}: {
  entity: EntityProps;
  onClose: () => void;
  onDrillDown: (entity: EntityProps) => void;
}) {
  const user = useAuthStore(s => s.user);
  const role = user?.role ?? '';
  const isAdmin  = ['system_admin', 'national_decision_maker'].includes(role);
  const canWrite = ['system_admin', 'national_decision_maker', 'provincial_coordinator', 'territory_admin'].includes(role);

  const showEtdTab  = entity.level >= 2 && entity.level <= 3;
  const showFluxTab = entity.level === 3;

  type ActiveTab = 'infos' | 'resp' | 'etd' | 'flux';
  const [activeTab, setActiveTab] = useState<ActiveTab>('infos');

  const tabs: { key: ActiveTab; label: string }[] = [
    { key: 'infos', label: 'Infos' },
    { key: 'resp',  label: 'Responsable' },
    ...(showEtdTab  ? [{ key: 'etd'  as ActiveTab, label: 'ETD' }]  : []),
    ...(showFluxTab ? [{ key: 'flux' as ActiveTab, label: 'Flux' }] : []),
  ];

  // Responsable history
  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['resp-history', entity.pcode],
    queryFn: () =>
      apiClient
        .get<{ data: HistoryEntry[] }>(`/responsables/entities/${entity.pcode}/history`)
        .then(r => r.data.data ?? []),
    enabled: activeTab === 'resp',
    staleTime: 0,
  });

  // ETD analyse
  const { data: analyseData, isLoading: loadingAnalyse } = useQuery({
    queryKey: ['etd-analyse', entity.pcode],
    queryFn: () =>
      apiClient
        .get<{ data: AnalyseETD }>(`/etd/${entity.pcode}/analyse?days=7`)
        .then(r => r.data.data),
    enabled: activeTab === 'etd' && showEtdTab,
    staleTime: 2 * 60 * 1000,
  });

  const { data: seuilsData } = useQuery({
    queryKey: ['etd-seuils', entity.pcode],
    queryFn: () =>
      apiClient
        .get<{ data: SeuilsResponse }>(`/etd/${entity.pcode}/seuils`)
        .then(r => r.data.data),
    enabled: activeTab === 'etd' && showEtdTab,
    staleTime: 2 * 60 * 1000,
  });

  // Flux
  const { data: fluxData, isLoading: loadingFlux } = useQuery({
    queryKey: ['etd-flux-panel', entity.pcode],
    queryFn: () =>
      apiClient
        .get<{ data: FluxMessage[] }>(`/etd/flux?pcode=${entity.pcode}&limit=20`)
        .then(r => r.data.data ?? []),
    enabled: activeTab === 'flux' && showFluxTab,
    staleTime: 30 * 1000,
  });

  const statut = STATUT_STYLE[entity.statut] ?? STATUT_STYLE['NORMAL']!;

  return (
    <div className="w-80 shrink-0 bg-cc-900 border-l border-cc-700 flex flex-col overflow-hidden">

      {/* Header */}
      <div className="bg-cc-800 border-b border-cc-700 px-4 py-3 flex items-start gap-2 shrink-0">
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

      {/* Tabs */}
      <div className="flex border-b border-cc-700 shrink-0">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 text-[10px] font-mono py-2 transition-colors ${
              activeTab === tab.key
                ? 'text-white border-b-2 border-sinaur-500 bg-cc-800'
                : 'text-cc-500 hover:text-gray-300 hover:bg-cc-800/50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'infos' && (
          <TabInfos entity={entity} onDrillDown={onDrillDown} />
        )}

        {activeTab === 'resp' && (
          <TabResponsable
            entity={entity}
            history={history ?? []}
            historyLoading={historyLoading}
            isAdmin={isAdmin}
            canWrite={canWrite}
          />
        )}

        {activeTab === 'etd' && showEtdTab && (
          <TabEtd
            analyseData={analyseData}
            seuilsData={seuilsData}
            loading={loadingAnalyse}
          />
        )}

        {activeTab === 'flux' && showFluxTab && (
          <TabFlux
            entity={entity}
            flux={fluxData ?? []}
            loading={loadingFlux}
          />
        )}
      </div>

      {/* Footer: fermer */}
      <div className="px-4 py-2 border-t border-cc-700 shrink-0">
        <button
          onClick={onClose}
          className="w-full text-[10px] text-cc-600 hover:text-gray-300 font-mono py-1 transition-colors"
        >
          ✕ Fermer le panneau
        </button>
      </div>
    </div>
  );
}
