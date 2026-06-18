/**
 * ResponsablesPage — Gestion des responsables d'entités administratives.
 *
 * Permet de rechercher des entités, affecter/modifier/supprimer des responsables,
 * consulter l'historique des changements et la couverture nationale.
 */
import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';

// ── Types ──────────────────────────────────────────────────────────────────────

interface EntityResult {
  pcode: string;
  nameFr?: string;
  name_fr?: string;
  level: number;
  parent_pcode: string | null;
  responsable_nom: string | null;
  responsable_titre: string | null;
  responsable_contact: string | null;
  responsable_source: string | null;
  responsable_maj_par: string | null;
  responsable_maj_le: string | null;
  statut_situation: string;
  titre_suggere?: string;
  titreSuggere?: string;
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

interface CouvertureProvince {
  province_pcode: string;
  province_nom: string;
  level: number;
  total: number;
  avec_responsable: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const PROVINCE_NAMES: Record<string, string> = {
  CD10: 'Kinshasa',       CD20: 'Kongo-Central',  CD21: 'Kwango',
  CD22: 'Kwilu',          CD23: 'Maï-Ndombe',     CD41: 'Équateur',
  CD42: 'Sud-Ubangi',     CD43: 'Nord-Ubangi',    CD44: 'Mongala',
  CD45: 'Tshuapa',        CD51: 'Tshopo',          CD52: 'Bas-Uélé',
  CD53: 'Haut-Uélé',     CD54: 'Ituri',           CD61: 'Nord-Kivu',
  CD62: 'Sud-Kivu',       CD63: 'Maniema',         CD71: 'Haut-Katanga',
  CD72: 'Lualaba',        CD73: 'Haut-Lomami',    CD74: 'Tanganyika',
  CD81: 'Lomami',         CD82: 'Kasaï-Oriental', CD83: 'Kasaï',
  CD84: 'Kasaï-Central',  CD85: 'Sankuru',
};

const NIVEAU_LABELS: Record<number, string> = {
  0: 'Pays',
  1: 'Province',
  2: 'Territoire / Ville',
  3: 'Commune / Secteur / Chefferie',
  4: 'Groupement',
  5: 'Village',
};

const NIVEAU_BADGE: Record<number, string> = {
  1: 'bg-purple-900/60 text-purple-300 border border-purple-700',
  2: 'bg-blue-900/60 text-blue-300 border border-blue-700',
  3: 'bg-orange-900/60 text-orange-300 border border-orange-700',
  4: 'bg-gray-700/60 text-gray-300 border border-gray-600',
};

const STATUT_OPTIONS = ['NORMAL', 'VIGILANCE', 'ALERTE', 'CRISE'] as const;

const STATUT_STYLE: Record<string, string> = {
  NORMAL:    'bg-green-900/60 text-green-300 border border-green-700',
  VIGILANCE: 'bg-yellow-900/60 text-yellow-300 border border-yellow-700',
  ALERTE:    'bg-orange-900/60 text-orange-300 border border-orange-700',
  CRISE:     'bg-red-900/60 text-red-300 border border-red-700',
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  } catch {
    return iso;
  }
}

function fmtAction(action: string): { label: string; cls: string } {
  switch (action) {
    case 'CREATION':     return { label: 'Création',      cls: 'text-green-400' };
    case 'MODIFICATION': return { label: 'Modification',  cls: 'text-blue-400' };
    case 'SUPPRESSION':  return { label: 'Suppression',   cls: 'text-red-400' };
    default:             return { label: action,           cls: 'text-gray-400' };
  }
}

// ── FormModal ──────────────────────────────────────────────────────────────────

interface FormModalProps {
  entity: EntityResult;
  history: HistoryEntry[];
  userRole: string;
  onClose: () => void;
  onSave: (body: object) => void;
  onDelete: () => void;
  saving: boolean;
}

function FormModal({ entity, history, userRole, onClose, onSave, onDelete, saving }: FormModalProps) {
  const nameFr = entity.nameFr ?? entity.name_fr ?? entity.pcode;
  const titreSuggere = entity.titreSuggere ?? entity.titre_suggere ?? '';

  const [nom, setNom]         = useState(entity.responsable_nom ?? '');
  const [titre, setTitre]     = useState(entity.responsable_titre ?? '');
  const [contact, setContact] = useState(entity.responsable_contact ?? '');
  const [source, setSource]   = useState(entity.responsable_source ?? '');
  const [statut, setStatut]   = useState<string>(entity.statut_situation ?? 'NORMAL');

  const canDelete = ['system_admin', 'national_decision_maker'].includes(userRole);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nom.trim() || !titre.trim()) return;
    onSave({
      nom:     nom.trim(),
      titre:   titre.trim(),
      contact: contact.trim() || undefined,
      source:  source.trim() || undefined,
      statut,
    });
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-cc-900 border border-cc-700 rounded-xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-white font-semibold text-lg">{nameFr}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs px-2 py-0.5 rounded font-mono ${NIVEAU_BADGE[entity.level] ?? 'bg-gray-700 text-gray-300'}`}>
                {NIVEAU_LABELS[entity.level] ?? `Niveau ${entity.level}`}
              </span>
              <span className="text-cc-600 font-mono text-xs">{entity.pcode}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-cc-600 hover:text-gray-300 text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Nom */}
          <div>
            <label className="block text-xs text-gray-400 mb-1 font-medium">Nom du responsable *</label>
            <input
              type="text"
              value={nom}
              onChange={e => setNom(e.target.value)}
              required
              className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-gray-200 text-sm focus:outline-none focus:border-sinaur-500"
              placeholder="Prénom NOM"
            />
          </div>

          {/* Titre */}
          <div>
            <label className="block text-xs text-gray-400 mb-1 font-medium">Titre / Fonction *</label>
            <input
              type="text"
              value={titre}
              onChange={e => setTitre(e.target.value)}
              required
              className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-gray-200 text-sm focus:outline-none focus:border-sinaur-500"
              placeholder={titreSuggere}
            />
            {titreSuggere && (
              <p className="text-xs text-cc-600 mt-1">
                Suggestion : <button type="button" onClick={() => setTitre(titreSuggere)} className="text-sinaur-400 hover:text-sinaur-300 underline">{titreSuggere}</button>
              </p>
            )}
          </div>

          {/* Contact */}
          <div>
            <label className="block text-xs text-gray-400 mb-1 font-medium">Contact</label>
            <input
              type="text"
              value={contact}
              onChange={e => setContact(e.target.value)}
              className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-gray-200 text-sm focus:outline-none focus:border-sinaur-500"
              placeholder="+243 ..."
            />
          </div>

          {/* Source */}
          <div>
            <label className="block text-xs text-gray-400 mb-1 font-medium">Source / Référence</label>
            <input
              type="text"
              value={source}
              onChange={e => setSource(e.target.value)}
              className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-gray-200 text-sm focus:outline-none focus:border-sinaur-500"
              placeholder="Arrêté ministériel du ..."
            />
          </div>

          {/* Statut situation */}
          <div>
            <label className="block text-xs text-gray-400 mb-1 font-medium">Statut de situation</label>
            <select
              value={statut}
              onChange={e => setStatut(e.target.value)}
              className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-gray-200 text-sm focus:outline-none focus:border-sinaur-500"
            >
              {STATUT_OPTIONS.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Boutons */}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving || !nom.trim() || !titre.trim()}
              className="flex-1 bg-sinaur-700 hover:bg-sinaur-600 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
            >
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 bg-cc-800 hover:bg-cc-700 text-gray-300 text-sm py-2 rounded-lg transition-colors"
            >
              Annuler
            </button>
          </div>

          {/* Suppression */}
          {canDelete && entity.responsable_nom && (
            <div className="pt-2 border-t border-cc-700">
              <button
                type="button"
                onClick={onDelete}
                className="w-full text-sm text-red-400 hover:text-red-300 border border-red-900 hover:border-red-700 py-2 rounded-lg transition-colors"
              >
                Supprimer le responsable
              </button>
            </div>
          )}
        </form>

        {/* Historique */}
        {history.length > 0 && (
          <details className="mt-5">
            <summary className="text-xs text-cc-600 hover:text-gray-400 cursor-pointer font-mono select-none">
              Historique ({history.length} entrée{history.length > 1 ? 's' : ''})
            </summary>
            <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
              {history.map(h => {
                const { label, cls } = fmtAction(h.action);
                return (
                  <div key={h.id} className="bg-cc-800 rounded-lg p-2.5 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className={`font-medium ${cls}`}>{label}</span>
                      <span className="text-cc-600 font-mono">{fmtDate(h.modifie_le)}</span>
                    </div>
                    {h.action !== 'SUPPRESSION' && (
                      <div className="text-gray-300">
                        <span className="text-cc-600">→ </span>
                        {h.nouveau_nom ?? '—'}{h.nouveau_titre ? ` (${h.nouveau_titre})` : ''}
                      </div>
                    )}
                    {h.ancien_nom && (
                      <div className="text-gray-500">
                        <span>Ancien : </span>{h.ancien_nom}
                      </div>
                    )}
                    <div className="text-cc-600">par {h.modifie_par}</div>
                    {h.source_info && (
                      <div className="text-cc-600 italic">{h.source_info}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

// ── Panel Couverture ───────────────────────────────────────────────────────────

interface CouvertureData {
  rows: CouvertureProvince[];
  total_avec: number;
  total: number;
}

function CouverturePanel({ data }: { data: CouvertureData }) {
  // Grouper par province
  const byProvince: Record<string, { nom: string; pcode: string; byLevel: Record<number, { total: number; avec: number }> }> = {};
  for (const row of data.rows) {
    if (!byProvince[row.province_pcode]) {
      byProvince[row.province_pcode] = { nom: row.province_nom, pcode: row.province_pcode, byLevel: {} };
    }
    byProvince[row.province_pcode].byLevel[row.level] = { total: row.total, avec: row.avec_responsable };
  }

  const provinces = Object.values(byProvince).sort((a, b) => a.nom.localeCompare(b.nom));
  const globalPct = data.total > 0 ? Math.round((data.total_avec / data.total) * 100) : 0;

  return (
    <div className="bg-cc-900 border border-cc-700 rounded-xl p-4 mb-4">
      {/* Résumé global */}
      <div className="flex items-center gap-4 mb-4">
        <div className="text-gray-200 text-sm font-medium">Couverture nationale</div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-cc-700 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${globalPct >= 75 ? 'bg-green-500' : globalPct >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`}
                style={{ width: `${globalPct}%` }}
              />
            </div>
            <span className="text-sm font-mono text-gray-300 w-12 text-right">{globalPct}%</span>
          </div>
          <div className="text-xs text-cc-600 mt-0.5">{data.total_avec} / {data.total} entités avec responsable</div>
        </div>
      </div>

      {/* Par province */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-64 overflow-y-auto">
        {provinces.map(prov => {
          const totalProv  = Object.values(prov.byLevel).reduce((a, b) => a + b.total, 0);
          const avecProv   = Object.values(prov.byLevel).reduce((a, b) => a + b.avec, 0);
          const pct        = totalProv > 0 ? Math.round((avecProv / totalProv) * 100) : 0;
          return (
            <div key={prov.pcode} className="bg-cc-800 rounded-lg p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-gray-300 truncate">{prov.nom}</span>
                <span className="text-xs font-mono text-cc-600 ml-2">{pct}%</span>
              </div>
              <div className="bg-cc-700 rounded-full h-1.5 mb-1.5">
                <div
                  className={`h-1.5 rounded-full ${pct >= 75 ? 'bg-green-500' : pct >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex gap-2">
                {Object.entries(prov.byLevel).sort((a, b) => Number(a[0]) - Number(b[0])).map(([lvl, stat]) => {
                  const lvlPct = stat.total > 0 ? Math.round((stat.avec / stat.total) * 100) : 0;
                  return (
                    <span key={lvl} className="text-[10px] text-cc-600 font-mono">
                      N{lvl}: {stat.avec}/{stat.total} ({lvlPct}%)
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function ResponsablesPage() {
  const user = useAuthStore(s => s.user);
  const qc   = useQueryClient();

  const [searchForm, setSearchForm] = useState({
    q:               '',
    niveau:          '',
    parentPcode:     '',
    sansResponsable: false,
  });
  const [searchKey,     setSearchKey]     = useState(0);
  const [selected,      setSelected]      = useState<EntityResult | null>(null);
  const [showCouverture, setShowCouverture] = useState(false);

  // Déclencher la recherche au premier render
  useEffect(() => {
    setSearchKey(1);
  }, []);

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: results, isLoading: searching } = useQuery({
    queryKey: ['responsables-search', searchKey, searchForm],
    queryFn: () => {
      const p = new URLSearchParams();
      if (searchForm.q)           p.set('q', searchForm.q);
      if (searchForm.niveau)      p.set('niveau', searchForm.niveau);
      if (searchForm.parentPcode) p.set('parentPcode', searchForm.parentPcode);
      if (searchForm.sansResponsable) p.set('sansResponsable', 'true');
      return apiClient
        .get<{ data: EntityResult[] }>(`/responsables/entities/search?${p}`)
        .then(r => r.data.data ?? []);
    },
    enabled: searchKey > 0,
    staleTime: 30 * 1000,
  });

  const { data: couvertureData } = useQuery({
    queryKey: ['responsables-couverture'],
    queryFn:  () =>
      apiClient
        .get<{ data: { rows: CouvertureProvince[]; total_avec: number; total: number } }>('/responsables/couverture')
        .then(r => r.data.data),
    enabled:   showCouverture,
    staleTime: 5 * 60 * 1000,
  });

  const { data: history } = useQuery({
    queryKey: ['responsables-history', selected?.pcode],
    queryFn:  () =>
      apiClient
        .get<{ data: HistoryEntry[] }>(`/responsables/entities/${selected!.pcode}/history`)
        .then(r => r.data.data ?? []),
    enabled:   selected !== null,
    staleTime: 0,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: ({ pcode, body }: { pcode: string; body: object }) =>
      apiClient.put(`/responsables/entities/${pcode}/responsable`, body),
    onSuccess: () => {
      setSelected(null);
      setSearchKey(k => k + 1);
      qc.invalidateQueries({ queryKey: ['responsables-couverture'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (pcode: string) =>
      apiClient.delete(`/responsables/entities/${pcode}/responsable`),
    onSuccess: () => {
      setSelected(null);
      setSearchKey(k => k + 1);
      qc.invalidateQueries({ queryKey: ['responsables-couverture'] });
    },
  });

  // ── Handlers ──────────────────────────────────────────────────────────────────

  function handleSearch() {
    setSearchKey(k => k + 1);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSearch();
  }

  const rows = results ?? [];

  return (
    <div className="p-4 space-y-4 min-h-full">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white font-bold text-xl">Gestion des responsables</h1>
          <p className="text-cc-600 text-sm mt-0.5">Entités Territoriales Décentralisées — Affectation et suivi</p>
        </div>
        <button
          onClick={() => setShowCouverture(v => !v)}
          className={`text-sm px-4 py-2 rounded-lg border transition-colors font-medium ${
            showCouverture
              ? 'bg-sinaur-800 border-sinaur-600 text-sinaur-300'
              : 'bg-cc-800 border-cc-700 text-gray-400 hover:text-gray-200 hover:border-cc-600'
          }`}
        >
          Couverture nationale
        </button>
      </div>

      {/* Panel couverture */}
      {showCouverture && couvertureData && (
        <CouverturePanel data={couvertureData} />
      )}
      {showCouverture && !couvertureData && (
        <div className="bg-cc-900 border border-cc-700 rounded-xl p-4 text-center text-cc-600 text-sm">
          Chargement de la couverture...
        </div>
      )}

      {/* Filtres */}
      <div className="bg-cc-900 border border-cc-700 rounded-xl p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Recherche texte */}
          <div className="lg:col-span-2">
            <label className="block text-xs text-gray-400 mb-1">Recherche</label>
            <input
              type="text"
              value={searchForm.q}
              onChange={e => setSearchForm(f => ({ ...f, q: e.target.value }))}
              onKeyDown={handleKeyDown}
              placeholder="Nom ou code..."
              className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-gray-200 text-sm focus:outline-none focus:border-sinaur-500"
            />
          </div>

          {/* Niveau */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Niveau</label>
            <select
              value={searchForm.niveau}
              onChange={e => setSearchForm(f => ({ ...f, niveau: e.target.value }))}
              className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-gray-200 text-sm focus:outline-none focus:border-sinaur-500"
            >
              <option value="">Tous niveaux</option>
              {[1, 2, 3, 4].map(n => (
                <option key={n} value={String(n)}>{NIVEAU_LABELS[n]}</option>
              ))}
            </select>
          </div>

          {/* Province */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Province</label>
            <select
              value={searchForm.parentPcode}
              onChange={e => setSearchForm(f => ({ ...f, parentPcode: e.target.value }))}
              className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-gray-200 text-sm focus:outline-none focus:border-sinaur-500"
            >
              <option value="">Toutes provinces</option>
              {Object.entries(PROVINCE_NAMES).map(([pcode, name]) => (
                <option key={pcode} value={pcode}>{name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Ligne filtres supplémentaires + bouton */}
        <div className="flex items-center justify-between mt-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={searchForm.sansResponsable}
              onChange={e => setSearchForm(f => ({ ...f, sansResponsable: e.target.checked }))}
              className="rounded"
            />
            <span className="text-sm text-gray-400">Sans responsable uniquement</span>
          </label>
          <button
            onClick={handleSearch}
            disabled={searching}
            className="bg-sinaur-700 hover:bg-sinaur-600 disabled:opacity-50 text-white text-sm font-medium px-6 py-2 rounded-lg transition-colors"
          >
            {searching ? 'Recherche...' : 'Rechercher'}
          </button>
        </div>
      </div>

      {/* Table des résultats */}
      <div className="bg-cc-900 border border-cc-700 rounded-xl overflow-hidden">
        {searching && (
          <div className="p-8 text-center text-cc-600 text-sm">Chargement...</div>
        )}
        {!searching && rows.length === 0 && searchKey > 0 && (
          <div className="p-8 text-center text-cc-600 text-sm">Aucune entité trouvée</div>
        )}
        {!searching && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cc-700 text-cc-600 text-xs font-mono">
                  <th className="text-left px-4 py-3">Entité / Code</th>
                  <th className="text-left px-4 py-3">Niveau</th>
                  <th className="text-left px-4 py-3">Responsable</th>
                  <th className="text-left px-4 py-3">Titre</th>
                  <th className="text-left px-4 py-3">Statut</th>
                  <th className="text-left px-4 py-3">Dernière MAJ</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-cc-800">
                {rows.map(entity => {
                  const hasResp   = !!entity.responsable_nom;
                  const nameFr    = entity.nameFr ?? entity.name_fr ?? entity.pcode;
                  const rowCls    = hasResp
                    ? 'hover:bg-cc-800/50'
                    : 'bg-yellow-950/30 border-l-2 border-l-yellow-700 hover:bg-yellow-950/50';

                  return (
                    <tr key={entity.pcode} className={`transition-colors ${rowCls}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-200">{nameFr}</div>
                        <div className="text-cc-600 font-mono text-xs">{entity.pcode}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded font-mono ${NIVEAU_BADGE[entity.level] ?? 'bg-gray-700 text-gray-300 border border-gray-600'}`}>
                          {NIVEAU_LABELS[entity.level] ?? `N${entity.level}`}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {entity.responsable_nom
                          ? <span className="text-gray-200">{entity.responsable_nom}</span>
                          : <span className="text-yellow-600 text-xs italic">Non affecté</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs max-w-40 truncate">
                        {entity.responsable_titre ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded font-mono ${STATUT_STYLE[entity.statut_situation] ?? STATUT_STYLE['NORMAL']}`}>
                          {entity.statut_situation}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {entity.responsable_maj_le
                          ? (
                            <div>
                              <div className="text-gray-300">{fmtDate(entity.responsable_maj_le)}</div>
                              {entity.responsable_maj_par && (
                                <div className="text-cc-600 truncate max-w-28">{entity.responsable_maj_par}</div>
                              )}
                            </div>
                          )
                          : <span className="text-cc-600">—</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setSelected(entity)}
                          className="text-sinaur-400 hover:text-sinaur-300 text-xs font-medium transition-colors px-2 py-1 rounded hover:bg-sinaur-900/30"
                        >
                          Modifier
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-4 py-2 border-t border-cc-800 text-xs text-cc-600 font-mono">
              {rows.length} entité{rows.length > 1 ? 's' : ''} — lignes jaunes = sans responsable
            </div>
          </div>
        )}
      </div>

      {/* Modal édition */}
      {selected && (
        <FormModal
          entity={selected}
          history={history ?? []}
          userRole={user?.role ?? ''}
          onClose={() => setSelected(null)}
          onSave={body => saveMutation.mutate({ pcode: selected.pcode, body })}
          onDelete={() => {
            if (window.confirm(`Supprimer le responsable de "${selected.nameFr ?? selected.name_fr ?? selected.pcode}" ?`)) {
              deleteMutation.mutate(selected.pcode);
            }
          }}
          saving={saveMutation.isPending}
        />
      )}
    </div>
  );
}
