/**
 * PropositionsPage — File de validation des nominations détectées par l'agent veille presse.
 * Accessible aux rôles : system_admin, national_decision_maker, provincial_coordinator, territory_admin.
 * Principe : l'agent PROPOSE, l'humain VALIDE. Rien n'est appliqué sans action explicite.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Candidat {
  pcode: string;
  name_fr: string;
  level: number;
}

interface Proposition {
  id: number;
  pcode: string | null;
  entite_nom: string | null;
  personne: string;
  fonction: string | null;
  type_acte: string | null;
  date_acte: string | null;
  interimaire: boolean;
  remplace: string | null;
  source: string | null;
  url_article: string | null;
  confiance: number | null;
  statut_rapprochement: 'CERTAIN' | 'AMBIGU' | 'ENTITE_INTROUVABLE';
  candidats: Candidat[] | null;
  statut: 'A_VALIDER' | 'VALIDE' | 'REJETE';
  detecte_le: string;
  valide_par: string | null;
  valide_le: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const NIVEAU_LABELS: Record<number, string> = {
  1: 'Province', 2: 'Territoire/Ville', 3: 'Commune', 4: 'Groupement',
};

const PROVINCE_NAMES: Record<string, string> = {
  CD10: 'Kinshasa', CD20: 'Kongo-Central', CD21: 'Kwango', CD22: 'Kwilu',
  CD23: 'Maï-Ndombe', CD41: 'Équateur', CD42: 'Sud-Ubangi', CD43: 'Nord-Ubangi',
  CD44: 'Mongala', CD45: 'Tshuapa', CD51: 'Tshopo', CD52: 'Bas-Uélé',
  CD53: 'Haut-Uélé', CD54: 'Ituri', CD61: 'Nord-Kivu', CD62: 'Sud-Kivu',
  CD63: 'Maniema', CD71: 'Haut-Katanga', CD72: 'Lualaba', CD73: 'Haut-Lomami',
  CD74: 'Tanganyika', CD81: 'Lomami', CD82: 'Kasaï-Oriental', CD83: 'Kasaï',
  CD84: 'Kasaï-Central', CD85: 'Sankuru',
};

const SOURCE_LABELS: Record<string, string> = {
  actualite_cd:   'Actualité.cd',
  radio_okapi:    'Radio Okapi',
  '7sur7_cd':     '7sur7.cd',
  politico_cd:    'Politico.cd',
  mediacongo:     'MediaCongo',
  journal_officiel: 'Journal Officiel',
  presidence:     'Présidence RDC',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

function confianceCls(c: number | null): string {
  if (c == null) return 'text-gray-500';
  if (c >= 0.85) return 'text-green-400';
  if (c >= 0.65) return 'text-yellow-400';
  return 'text-orange-400';
}

// ── Proposition Card ──────────────────────────────────────────────────────────

function PropCard({
  prop,
  onValider,
  onRejeter,
  onChoisirEntite,
  isAdmin,
  loading,
}: {
  prop: Proposition;
  onValider: (id: number) => void;
  onRejeter: (id: number) => void;
  onChoisirEntite: (id: number, pcode: string) => void;
  isAdmin: boolean;
  loading: boolean;
}) {
  const [pcodeCandidatChoisi, setPcodeCandidatChoisi] = useState(
    prop.candidats?.[0]?.pcode ?? ''
  );
  const [showCorrection, setShowCorrection] = useState(false);

  const canValider = prop.statut_rapprochement !== 'ENTITE_INTROUVABLE' && (prop.pcode || pcodeCandidatChoisi);
  const entiteLabel = prop.pcode
    ? prop.pcode
    : prop.statut_rapprochement === 'AMBIGU'
      ? `Ambigu (${prop.candidats?.length ?? 0} candidats)`
      : `"${prop.entite_nom}" introuvable`;

  const rapprochBadge = {
    CERTAIN:            { cls: 'bg-green-900/50 text-green-400 border-green-800',   label: 'Entité certaine' },
    AMBIGU:             { cls: 'bg-yellow-900/50 text-yellow-400 border-yellow-800', label: 'Entité ambiguë' },
    ENTITE_INTROUVABLE: { cls: 'bg-red-900/50 text-red-400 border-red-800',         label: 'Entité introuvable' },
  }[prop.statut_rapprochement];

  return (
    <div className={`bg-cc-900 border rounded-xl p-4 space-y-3 ${
      prop.statut_rapprochement === 'ENTITE_INTROUVABLE'
        ? 'border-red-900/60'
        : prop.statut_rapprochement === 'AMBIGU'
          ? 'border-yellow-900/60'
          : 'border-cc-700'
    }`}>
      {/* En-tête */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-semibold text-sm">{prop.personne}</span>
            {prop.interimaire && (
              <span className="text-[9px] font-mono bg-blue-900/60 text-blue-300 border border-blue-800 px-1.5 py-px rounded">
                intérimaire
              </span>
            )}
          </div>
          {prop.fonction && (
            <div className="text-xs text-gray-400 mt-0.5">{prop.fonction}</div>
          )}
        </div>
        <div className="text-right shrink-0 space-y-1">
          <span className={`text-[9px] font-mono px-1.5 py-px rounded border ${rapprochBadge.cls}`}>
            {rapprochBadge.label}
          </span>
          <div className="text-[9px] text-cc-600 font-mono">{fmtDate(prop.detecte_le)}</div>
        </div>
      </div>

      {/* Entité + source */}
      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div className="bg-cc-800 rounded p-2">
          <div className="text-cc-500 font-mono mb-0.5">Entité</div>
          <div className="text-gray-200 font-medium">{prop.entite_nom ?? '—'}</div>
          <div className="text-cc-600 font-mono">{entiteLabel}</div>
        </div>
        <div className="bg-cc-800 rounded p-2">
          <div className="text-cc-500 font-mono mb-0.5">Source</div>
          <div className="text-gray-200">{SOURCE_LABELS[prop.source ?? ''] ?? prop.source ?? '—'}</div>
          <div className={`font-mono font-medium ${confianceCls(prop.confiance)}`}>
            Confiance : {prop.confiance != null ? Math.round(prop.confiance * 100) + ' %' : '—'}
          </div>
        </div>
      </div>

      {/* Acte + remplacement */}
      {(prop.type_acte || prop.remplace) && (
        <div className="flex gap-3 text-[10px]">
          {prop.type_acte && (
            <span className="text-cc-500">📋 {prop.type_acte}{prop.date_acte ? ` du ${fmtDate(prop.date_acte)}` : ''}</span>
          )}
          {prop.remplace && (
            <span className="text-cc-500">↩ Remplace : <span className="text-gray-400">{prop.remplace}</span></span>
          )}
        </div>
      )}

      {/* Sélecteur entité si AMBIGU */}
      {prop.statut_rapprochement === 'AMBIGU' && prop.candidats && (
        <div className="bg-yellow-950/30 border border-yellow-900/50 rounded p-2.5 space-y-1.5">
          <div className="text-[10px] text-yellow-400 font-mono">
            ⚠ Plusieurs entités correspondent — choisissez la bonne :
          </div>
          <select
            value={pcodeCandidatChoisi}
            onChange={e => {
              setPcodeCandidatChoisi(e.target.value);
              onChoisirEntite(prop.id, e.target.value);
            }}
            className="w-full bg-cc-800 border border-yellow-800 rounded px-2 py-1.5 text-gray-200 text-xs focus:outline-none focus:border-yellow-600"
          >
            {prop.candidats.map(c => (
              <option key={c.pcode} value={c.pcode}>
                {c.name_fr} — {NIVEAU_LABELS[c.level] ?? `N${c.level}`} ({c.pcode})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Entité introuvable */}
      {prop.statut_rapprochement === 'ENTITE_INTROUVABLE' && (
        <div className="bg-red-950/30 border border-red-900/50 rounded p-2.5 text-[10px] text-red-400">
          ⚠ L'entité « {prop.entite_nom} » n'est pas dans la base de données.
          Contactez un administrateur pour créer l'entité avant de valider.
        </div>
      )}

      {/* Lien article */}
      {prop.url_article && (
        <a
          href={prop.url_article}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[10px] text-sinaur-400 hover:text-sinaur-300 font-mono transition-colors"
        >
          🔗 Lire l'article source
        </a>
      )}

      {/* Actions */}
      {isAdmin && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onValider(prop.id)}
            disabled={loading || !canValider}
            className="flex-1 bg-green-900/60 hover:bg-green-800 disabled:opacity-40 border border-green-700 text-green-300 text-xs font-medium py-1.5 rounded transition-colors"
          >
            ✓ Valider et appliquer
          </button>
          <button
            onClick={() => onRejeter(prop.id)}
            disabled={loading}
            className="px-3 bg-red-900/40 hover:bg-red-900/80 border border-red-900 text-red-400 text-xs py-1.5 rounded transition-colors"
          >
            ✕ Rejeter
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export function PropositionsPage() {
  const user    = useAuthStore(s => s.user);
  const qc      = useQueryClient();
  const role    = user?.role ?? '';
  const isAdmin = ['system_admin', 'national_decision_maker', 'provincial_coordinator', 'territory_admin'].includes(role);

  const [statutFilter, setStatutFilter]     = useState<'A_VALIDER' | 'VALIDE' | 'REJETE'>('A_VALIDER');
  const [provinceFilter, setProvinceFilter] = useState('');
  const [rapprochFilter, setRapprochFilter] = useState('');

  // Map prop.id → pcode choisi pour les cas AMBIGU
  const [pcodeChoisis, setPcodeChoisis] = useState<Record<number, string>>({});

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data, isLoading, isError } = useQuery({
    queryKey: ['responsables-propositions', statutFilter, provinceFilter],
    queryFn: () => {
      const p = new URLSearchParams({ statut: statutFilter, limit: '100' });
      if (provinceFilter) p.set('pcode', provinceFilter);
      return apiClient
        .get<{ data: { propositions: Proposition[]; total: number } }>(`/responsables/propositions?${p}`)
        .then(r => r.data.data);
    },
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const invaliderMutation = useMutation({
    mutationFn: (id: number) =>
      apiClient.put(`/responsables/propositions/${id}/valider`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['responsables-propositions'] }),
  });

  const rejeterMutation = useMutation({
    mutationFn: (id: number) =>
      apiClient.put(`/responsables/propositions/${id}/rejeter`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['responsables-propositions'] }),
  });

  const entiteMutation = useMutation({
    mutationFn: ({ id, pcode }: { id: number; pcode: string }) =>
      apiClient.put(`/responsables/propositions/${id}/entite`, { pcode }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['responsables-propositions'] }),
  });

  // ── Derived ───────────────────────────────────────────────────────────────

  const propositions = (data?.propositions ?? []).filter(p => {
    if (!rapprochFilter) return true;
    return p.statut_rapprochement === rapprochFilter;
  });

  const nbTotal   = data?.total ?? 0;
  const nbAmbigus = (data?.propositions ?? []).filter(p => p.statut_rapprochement === 'AMBIGU').length;
  const nbIntrouvables = (data?.propositions ?? []).filter(p => p.statut_rapprochement === 'ENTITE_INTROUVABLE').length;

  const isMutating = invaliderMutation.isPending || rejeterMutation.isPending || entiteMutation.isPending;

  return (
    <div className="p-4 space-y-4 min-h-full max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-white font-bold text-xl">Nominations détectées</h1>
          <p className="text-cc-600 text-xs mt-0.5 font-mono max-w-lg">
            Agent veille presse — Radio Okapi, Actualité.cd, 7sur7… L'agent PROPOSE, vous VALIDEZ.
            Aucun changement sans action explicite.
          </p>
        </div>
        {statutFilter === 'A_VALIDER' && nbTotal > 0 && (
          <div className="shrink-0 flex flex-col items-end gap-1">
            <span className="text-2xl font-bold text-orange-400">{nbTotal}</span>
            <span className="text-[10px] text-cc-600 font-mono">en attente</span>
          </div>
        )}
      </div>

      {/* Alertes synthèse */}
      {statutFilter === 'A_VALIDER' && (nbAmbigus > 0 || nbIntrouvables > 0) && (
        <div className="flex gap-3">
          {nbAmbigus > 0 && (
            <div className="flex-1 bg-yellow-950/30 border border-yellow-900/50 rounded-lg px-3 py-2 text-[10px] font-mono text-yellow-400">
              ⚠ {nbAmbigus} entité{nbAmbigus > 1 ? 's' : ''} ambiguë{nbAmbigus > 1 ? 's' : ''} — sélectionner manuellement
            </div>
          )}
          {nbIntrouvables > 0 && (
            <div className="flex-1 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2 text-[10px] font-mono text-red-400">
              ✗ {nbIntrouvables} entité{nbIntrouvables > 1 ? 's' : ''} introuvable{nbIntrouvables > 1 ? 's' : ''} — nécessite création manuelle
            </div>
          )}
        </div>
      )}

      {/* Filtres */}
      <div className="bg-cc-900 border border-cc-700 rounded-xl p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Statut */}
          <div>
            <label className="block text-[10px] text-gray-400 mb-1 font-mono">Statut</label>
            <div className="flex gap-1">
              {(['A_VALIDER', 'VALIDE', 'REJETE'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatutFilter(s)}
                  className={`flex-1 text-[10px] font-mono py-1.5 rounded border transition-colors ${
                    statutFilter === s
                      ? s === 'A_VALIDER' ? 'bg-orange-900/60 border-orange-700 text-orange-300'
                        : s === 'VALIDE'  ? 'bg-green-900/60 border-green-700 text-green-300'
                        : 'bg-red-900/60 border-red-700 text-red-300'
                      : 'bg-cc-800 border-cc-700 text-cc-500 hover:text-gray-300'
                  }`}
                >
                  {s === 'A_VALIDER' ? '⏳' : s === 'VALIDE' ? '✓' : '✗'} {s.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {/* Province */}
          <div>
            <label className="block text-[10px] text-gray-400 mb-1 font-mono">Province</label>
            <select
              value={provinceFilter}
              onChange={e => setProvinceFilter(e.target.value)}
              className="w-full bg-cc-800 border border-cc-700 rounded px-2 py-1.5 text-gray-200 text-xs focus:outline-none focus:border-sinaur-500"
            >
              <option value="">Toutes provinces</option>
              {Object.entries(PROVINCE_NAMES).map(([pcode, name]) => (
                <option key={pcode} value={pcode}>{name}</option>
              ))}
            </select>
          </div>

          {/* Rapprochement */}
          <div>
            <label className="block text-[10px] text-gray-400 mb-1 font-mono">Rapprochement</label>
            <select
              value={rapprochFilter}
              onChange={e => setRapprochFilter(e.target.value)}
              className="w-full bg-cc-800 border border-cc-700 rounded px-2 py-1.5 text-gray-200 text-xs focus:outline-none focus:border-sinaur-500"
            >
              <option value="">Tous</option>
              <option value="CERTAIN">Certain uniquement</option>
              <option value="AMBIGU">Ambigus à clarifier</option>
              <option value="ENTITE_INTROUVABLE">Entités introuvables</option>
            </select>
          </div>
        </div>
      </div>

      {/* Liste */}
      {isLoading && (
        <div className="text-center text-cc-600 py-10 text-sm">Chargement des propositions…</div>
      )}

      {isError && (
        <div className="bg-red-950/30 border border-red-800 rounded-xl p-4 text-red-400 text-sm">
          Erreur lors du chargement des propositions.
        </div>
      )}

      {!isLoading && !isError && propositions.length === 0 && (
        <div className="bg-cc-900 border border-cc-700 rounded-xl p-10 text-center">
          <div className="text-4xl mb-3">
            {statutFilter === 'A_VALIDER' ? '✅' : statutFilter === 'VALIDE' ? '📋' : '🗑'}
          </div>
          <div className="text-gray-400 text-sm">
            {statutFilter === 'A_VALIDER'
              ? 'Aucune nomination en attente de validation'
              : `Aucune proposition ${statutFilter.toLowerCase()}`}
          </div>
          <div className="text-cc-600 text-xs mt-1 font-mono">
            L'agent veille presse analyse Radio Okapi, Actualité.cd et d'autres sources toutes les 12h
          </div>
        </div>
      )}

      {propositions.length > 0 && (
        <div className="space-y-3">
          <div className="text-[10px] text-cc-600 font-mono px-1">
            {propositions.length} proposition{propositions.length > 1 ? 's' : ''} affichée{propositions.length > 1 ? 's' : ''}
            {rapprochFilter ? ` (filtre : ${rapprochFilter})` : ''}
          </div>
          {propositions.map(p => (
            <PropCard
              key={p.id}
              prop={{ ...p, pcode: pcodeChoisis[p.id] ?? p.pcode }}
              isAdmin={isAdmin}
              loading={isMutating}
              onValider={id => invaliderMutation.mutate(id)}
              onRejeter={id => {
                if (window.confirm(`Rejeter la nomination de "${p.personne}" ?`)) {
                  rejeterMutation.mutate(id);
                }
              }}
              onChoisirEntite={(id, pcode) => {
                setPcodeChoisis(prev => ({ ...prev, [id]: pcode }));
                entiteMutation.mutate({ id, pcode });
              }}
            />
          ))}
        </div>
      )}

      {/* Légende */}
      <div className="border-t border-cc-800 pt-4 text-[10px] text-cc-600 font-mono space-y-1">
        <div className="font-medium text-cc-500 mb-2">Niveaux de confiance de l'IA :</div>
        <div className="flex gap-4">
          <span className="text-green-400">≥ 85 % — haute confiance</span>
          <span className="text-yellow-400">65–84 % — confiance moyenne</span>
          <span className="text-orange-400">{'< 65 %'} — à vérifier</span>
        </div>
        <div className="mt-2 text-cc-700">
          Sources officielles (Journal Officiel, Présidence) : confiance ≥ 95 % — fiabilité maximale.
        </div>
      </div>
    </div>
  );
}
