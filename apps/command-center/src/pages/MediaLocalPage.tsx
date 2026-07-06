import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';
import { FraicheurBadge } from '../components/FraicheurBadge.js';
import { useAuthStore } from '../stores/auth.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface MediaLocal {
  id: number;
  nom: string;
  typeMedia: string;
  provincePcode: string | null;
  territoirePcode: string | null;
  collectif: string | null;
  url: string | null;
  typeAcces: string;
  fiabilite: number;
  notesFiabilite: string | null;
  statut: 'ACTIF' | 'SUSPENDU' | 'DETRUIT' | 'COMPROMIS' | 'INCONNU';
  langue: string;
  contact: string | null;
  notes: string | null;
  ajoutePar: string | null;
  creeLe: string;
  misAJourLe: string;
}

interface MediaForm {
  nom: string;
  typeMedia: string;
  provincePcode: string;
  territoirePcode: string;
  collectif: string;
  url: string;
  typeAcces: string;
  fiabilite: number;
  notesFiabilite: string;
  statut: string;
  langue: string;
  contact: string;
  notes: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const PROVINCE_NAMES: Record<string, string> = {
  CD10: 'Kinshasa',      CD20: 'Kongo-Central',  CD21: 'Kwango',        CD22: 'Kwilu',
  CD23: 'Maï-Ndombe',   CD41: 'Équateur',        CD42: 'Sud-Ubangi',    CD43: 'Nord-Ubangi',
  CD44: 'Mongala',       CD45: 'Tshuapa',         CD51: 'Tshopo',        CD52: 'Bas-Uélé',
  CD53: 'Haut-Uélé',    CD54: 'Ituri',           CD61: 'Nord-Kivu',     CD62: 'Sud-Kivu',
  CD63: 'Maniema',       CD71: 'Haut-Katanga',    CD72: 'Lualaba',       CD73: 'Haut-Lomami',
  CD74: 'Tanganyika',    CD81: 'Lomami',          CD82: 'Kasaï-Oriental',CD83: 'Kasaï',
  CD84: 'Kasaï-Central', CD85: 'Sankuru',
};
const PROVINCES = Object.entries(PROVINCE_NAMES).map(([pcode, name]) => ({ pcode, name })).sort((a, b) => a.name.localeCompare(b.name));

const TYPE_MEDIA_LABEL: Record<string, string> = {
  radio: 'Radio', tv: 'Télévision', journal: 'Journal/Presse',
  web: 'Web/En ligne', agence: 'Agence de presse', autre: 'Autre',
};

const ACCES_LABEL: Record<string, string> = {
  rss: 'RSS', web: 'Web', facebook: 'Facebook', telegram: 'Telegram', manuel: 'Manuel',
};

const STATUT_COLOR: Record<string, string> = {
  ACTIF:     'bg-green-900/40 text-green-400 border-green-800',
  SUSPENDU:  'bg-yellow-900/40 text-yellow-400 border-yellow-800',
  DETRUIT:   'bg-slate-800 text-slate-500 border-slate-700',
  COMPROMIS: 'bg-red-900/50 text-red-400 border-red-700',
  INCONNU:   'bg-slate-800 text-slate-400 border-slate-600',
};

const STATUT_LABEL: Record<string, string> = {
  ACTIF: 'Actif', SUSPENDU: 'Suspendu', DETRUIT: 'Détruit',
  COMPROMIS: 'Compromis ⚠', INCONNU: 'Inconnu',
};

const COLLECTIFS = ['FRPC', 'ARCO', 'CORACON', 'RATECO', 'CJI', 'AEJIK', 'AFEMEK', 'PAMOJA'];

const EMPTY_FORM: MediaForm = {
  nom: '', typeMedia: 'radio', provincePcode: '', territoirePcode: '',
  collectif: '', url: '', typeAcces: 'web', fiabilite: 0.60,
  notesFiabilite: '', statut: 'ACTIF', langue: 'fr', contact: '', notes: '',
};

const WRITE_ROLES = new Set(['system_admin', 'national_decision_maker', 'provincial_coordinator']);

// ── Helpers ──────────────────────────────────────────────────────────────────

function fiabColor(f: number) {
  return f >= 0.80 ? 'bg-green-500' : f >= 0.65 ? 'bg-yellow-500' : f >= 0.45 ? 'bg-orange-500' : 'bg-red-500';
}

function FiabBar({ f }: { f: number }) {
  const pct = Math.round(f * 100);
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full ${fiabColor(f)} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-slate-400 w-7 text-right">{pct}%</span>
    </div>
  );
}

// ── Modal formulaire ─────────────────────────────────────────────────────────

function MediaModal({
  initial,
  onClose,
  onSave,
  saving,
}: {
  initial: MediaForm & { id?: number };
  onClose: () => void;
  onSave: (data: MediaForm) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<MediaForm>({ ...initial });
  const set = (k: keyof MediaForm, v: string | number) => setForm(f => ({ ...f, [k]: v }));
  const isEdit = !!initial.id;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-white font-semibold">{isEdit ? 'Modifier le média' : 'Ajouter un média'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg">✕</button>
        </div>

        <div className="p-4 space-y-3">
          {/* Nom */}
          <div>
            <label className="text-xs text-slate-400">Nom du média *</label>
            <input
              value={form.nom} onChange={e => set('nom', e.target.value)}
              className="mt-1 w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              placeholder="Radio Okapi, Kivu Morning Post…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Type */}
            <div>
              <label className="text-xs text-slate-400">Type</label>
              <select value={form.typeMedia} onChange={e => set('typeMedia', e.target.value)}
                className="mt-1 w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                {Object.entries(TYPE_MEDIA_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>

            {/* Province */}
            <div>
              <label className="text-xs text-slate-400">Province</label>
              <select value={form.provincePcode} onChange={e => set('provincePcode', e.target.value)}
                className="mt-1 w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                <option value="">National</option>
                {PROVINCES.map(p => <option key={p.pcode} value={p.pcode}>{p.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Collectif */}
            <div>
              <label className="text-xs text-slate-400">Collectif</label>
              <input
                list="collectifs-list"
                value={form.collectif} onChange={e => set('collectif', e.target.value)}
                className="mt-1 w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                placeholder="FRPC, CORACON…"
              />
              <datalist id="collectifs-list">
                {COLLECTIFS.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>

            {/* Langue */}
            <div>
              <label className="text-xs text-slate-400">Langue principale</label>
              <select value={form.langue} onChange={e => set('langue', e.target.value)}
                className="mt-1 w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                <option value="fr">Français</option>
                <option value="sw">Swahili</option>
                <option value="ln">Lingala</option>
                <option value="kg">Kikongo</option>
                <option value="ts">Tshiluba</option>
                <option value="fr,sw">Français + Swahili</option>
              </select>
            </div>
          </div>

          {/* URL */}
          <div>
            <label className="text-xs text-slate-400">URL / Flux</label>
            <input
              value={form.url} onChange={e => set('url', e.target.value)}
              className="mt-1 w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              placeholder="https://example.com/feed"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Type d'accès */}
            <div>
              <label className="text-xs text-slate-400">Type d'accès</label>
              <select value={form.typeAcces} onChange={e => set('typeAcces', e.target.value)}
                className="mt-1 w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                {Object.entries(ACCES_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>

            {/* Statut */}
            <div>
              <label className="text-xs text-slate-400">Statut</label>
              <select value={form.statut} onChange={e => set('statut', e.target.value)}
                className="mt-1 w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                <option value="ACTIF">Actif</option>
                <option value="INCONNU">Inconnu</option>
                <option value="SUSPENDU">Suspendu</option>
                <option value="DETRUIT">Détruit</option>
                <option value="COMPROMIS">Compromis (contrôle armé)</option>
              </select>
            </div>
          </div>

          {/* Fiabilité */}
          <div>
            <label className="text-xs text-slate-400">
              Fiabilité : <span className={`font-mono ${form.fiabilite >= 0.75 ? 'text-green-400' : form.fiabilite >= 0.50 ? 'text-yellow-400' : 'text-red-400'}`}>
                {Math.round(form.fiabilite * 100)}%
              </span>
              <span className="text-slate-600 ml-2 text-[10px]">
                {form.fiabilite >= 0.75 ? 'établi + indépendant' : form.fiabilite >= 0.50 ? 'sérieux mais limité' : form.fiabilite >= 0.30 ? 'proche d\'un acteur' : 'non fiable'}
              </span>
            </label>
            <input type="range" min={0} max={1} step={0.05}
              value={form.fiabilite}
              onChange={e => set('fiabilite', parseFloat(e.target.value))}
              className="mt-1 w-full accent-blue-500"
            />
          </div>

          {/* Notes fiabilité */}
          <div>
            <label className="text-xs text-slate-400">Justification de la fiabilité</label>
            <textarea
              value={form.notesFiabilite} onChange={e => set('notesFiabilite', e.target.value)}
              rows={2}
              className="mt-1 w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
              placeholder="Indépendant, membre FRPC, charte déontologique…"
            />
          </div>

          {/* Contact + Notes */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400">Contact</label>
              <input
                value={form.contact} onChange={e => set('contact', e.target.value)}
                className="mt-1 w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                placeholder="+243…, email@…"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Notes internes</label>
              <input
                value={form.notes} onChange={e => set('notes', e.target.value)}
                className="mt-1 w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                placeholder="Notes diverses…"
              />
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-700 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors">
            Annuler
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={!form.nom.trim() || saving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {saving ? 'Enregistrement…' : isEdit ? 'Mettre à jour' : 'Ajouter'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Card média ───────────────────────────────────────────────────────────────

function MediaCard({ media, canEdit, onEdit }: { media: MediaLocal; canEdit: boolean; onEdit: () => void }) {
  const isCompromis = media.statut === 'COMPROMIS';
  const isDetruit   = media.statut === 'DETRUIT';

  return (
    <div className={`bg-slate-800/60 border rounded-xl p-3 space-y-2 ${isCompromis ? 'border-red-800' : 'border-slate-700'} ${isDetruit ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-400">{TYPE_MEDIA_LABEL[media.typeMedia] || media.typeMedia}</span>
            {media.typeAcces && (
              <span className="text-[10px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded font-mono">
                {ACCES_LABEL[media.typeAcces] || media.typeAcces}
              </span>
            )}
          </div>
          <div className="font-semibold text-white mt-0.5 text-sm">{media.nom}</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {media.provincePcode ? PROVINCE_NAMES[media.provincePcode] ?? media.provincePcode : 'National'}
            {media.collectif && <span className="ml-2 text-slate-600">· {media.collectif}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${STATUT_COLOR[media.statut]}`}>
            {STATUT_LABEL[media.statut]}
          </span>
          {canEdit && (
            <button onClick={onEdit} className="text-[10px] text-slate-500 hover:text-blue-400 transition-colors">
              Modifier
            </button>
          )}
        </div>
      </div>

      <FiabBar f={media.fiabilite} />

      {media.notesFiabilite && (
        <p className="text-[10px] text-slate-500 italic line-clamp-2">{media.notesFiabilite}</p>
      )}

      {isCompromis && (
        <div className="text-[10px] text-red-400 bg-red-900/20 rounded px-2 py-1">
          ⚠ Média potentiellement sous contrôle armé — ne pas utiliser comme source
        </div>
      )}

      {media.url && (
        <a
          href={media.url} target="_blank" rel="noopener noreferrer"
          className="text-[10px] text-blue-400 hover:underline truncate block"
        >
          {media.url}
        </a>
      )}
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export function MediaLocalPage() {
  const user = useAuthStore(s => s.user);
  const canEdit = WRITE_ROLES.has(user?.role ?? '');
  const queryClient = useQueryClient();

  const [provinceFilter, setProvinceFilter] = useState('');
  const [typeFilter, setTypeFilter]         = useState('');
  const [statutFilter, setStatutFilter]     = useState('');
  const [collectifFilter, setCollectifFilter] = useState('');
  const [search, setSearch]                 = useState('');
  const [modalData, setModalData]           = useState<(MediaForm & { id?: number }) | null>(null);

  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['media-local', provinceFilter, typeFilter, statutFilter, collectifFilter, search],
    queryFn: () => {
      const params: Record<string, string> = { limit: '300' };
      if (provinceFilter) params.province_pcode = provinceFilter;
      if (typeFilter)     params.type_media     = typeFilter;
      if (statutFilter)   params.statut         = statutFilter;
      if (collectifFilter)params.collectif      = collectifFilter;
      if (search)         params.q              = search;
      return apiClient.get<{ data: MediaLocal[]; total: number }>('/media-local', { params }).then(r => r.data);
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const { data: statsData } = useQuery({
    queryKey: ['media-local-stats'],
    queryFn: () => apiClient.get<{ byStatutType: { statut: string; typeMedia: string; n: number }[]; byProvince: { provincePcode: string; n: number }[] }>('/media-local/stats').then(r => r.data),
    staleTime: 120_000,
  });

  const createMutation = useMutation({
    mutationFn: (body: MediaForm) => apiClient.post('/media-local', {
      ...body,
      provincePcode:   body.provincePcode   || null,
      territoirePcode: body.territoirePcode || null,
      collectif:       body.collectif       || null,
      url:             body.url             || null,
      notesFiabilite:  body.notesFiabilite  || null,
      contact:         body.contact         || null,
      notes:           body.notes           || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-local'] });
      queryClient.invalidateQueries({ queryKey: ['media-local-stats'] });
      setModalData(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: MediaForm & { id: number }) => apiClient.put(`/media-local/${id}`, {
      ...body,
      provincePcode:   body.provincePcode   || null,
      territoirePcode: body.territoirePcode || null,
      collectif:       body.collectif       || null,
      url:             body.url             || null,
      notesFiabilite:  body.notesFiabilite  || null,
      contact:         body.contact         || null,
      notes:           body.notes           || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-local'] });
      queryClient.invalidateQueries({ queryKey: ['media-local-stats'] });
      setModalData(null);
    },
  });

  const media = data?.data ?? [];
  const total = data?.total ?? 0;

  const totalActif     = statsData?.byStatutType.filter(r => r.statut === 'ACTIF').reduce((s, r) => s + r.n, 0) ?? 0;
  const totalCompromis = statsData?.byStatutType.filter(r => r.statut === 'COMPROMIS').reduce((s, r) => s + r.n, 0) ?? 0;
  const totalInconnu   = statsData?.byStatutType.filter(r => r.statut === 'INCONNU').reduce((s, r) => s + r.n, 0) ?? 0;

  function openCreate() {
    setModalData({ ...EMPTY_FORM });
  }

  function openEdit(m: MediaLocal) {
    setModalData({
      id: m.id,
      nom:             m.nom,
      typeMedia:       m.typeMedia,
      provincePcode:   m.provincePcode ?? '',
      territoirePcode: m.territoirePcode ?? '',
      collectif:       m.collectif ?? '',
      url:             m.url ?? '',
      typeAcces:       m.typeAcces,
      fiabilite:       m.fiabilite,
      notesFiabilite:  m.notesFiabilite ?? '',
      statut:          m.statut,
      langue:          m.langue,
      contact:         m.contact ?? '',
      notes:           m.notes ?? '',
    });
  }

  function handleSave(form: MediaForm) {
    if (modalData?.id) {
      updateMutation.mutate({ id: modalData.id, ...form });
    } else {
      createMutation.mutate(form);
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-4 space-y-4 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Médias provinciaux</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Registre des radios, TV et médias locaux RDC — fiabilité et statut par province
          </p>
        </div>
        <div className="flex items-center gap-3">
          <FraicheurBadge dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} isError={false} onRefresh={() => refetch()} />
          {canEdit && (
            <button onClick={openCreate}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">
              + Ajouter un média
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      {statsData && (
        <div className="flex gap-3 flex-wrap text-xs">
          <div className="bg-slate-800 rounded-lg px-3 py-1.5 text-center">
            <div className="text-white font-semibold">{total}</div>
            <div className="text-slate-500">Total</div>
          </div>
          <div className="bg-slate-800 rounded-lg px-3 py-1.5 text-center">
            <div className="text-green-400 font-semibold">{totalActif}</div>
            <div className="text-slate-500">Actifs</div>
          </div>
          {totalCompromis > 0 && (
            <div className="bg-red-900/30 border border-red-800 rounded-lg px-3 py-1.5 text-center">
              <div className="text-red-400 font-semibold">{totalCompromis}</div>
              <div className="text-slate-500">Compromis</div>
            </div>
          )}
          {totalInconnu > 0 && (
            <div className="bg-slate-800 rounded-lg px-3 py-1.5 text-center">
              <div className="text-slate-400 font-semibold">{totalInconnu}</div>
              <div className="text-slate-500">À vérifier</div>
            </div>
          )}
          {statsData.byProvince.slice(0, 4).map(p => (
            <div key={p.provincePcode} className="bg-slate-800 rounded-lg px-3 py-1.5 text-center">
              <div className="text-blue-400 font-semibold">{p.n}</div>
              <div className="text-slate-500">{PROVINCE_NAMES[p.provincePcode] ?? p.provincePcode}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filtres */}
      <div className="flex gap-2 flex-wrap">
        <input
          type="text" placeholder="Rechercher…"
          value={search} onChange={e => setSearch(e.target.value)}
          className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 flex-1 min-w-40"
        />
        <select value={provinceFilter} onChange={e => setProvinceFilter(e.target.value)}
          className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
          <option value="">Toutes provinces</option>
          <option value="">National (sans province)</option>
          {PROVINCES.map(p => <option key={p.pcode} value={p.pcode}>{p.name}</option>)}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
          <option value="">Tous types</option>
          {Object.entries(TYPE_MEDIA_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={collectifFilter} onChange={e => setCollectifFilter(e.target.value)}
          className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
          <option value="">Tous collectifs</option>
          {COLLECTIFS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={statutFilter} onChange={e => setStatutFilter(e.target.value)}
          className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
          <option value="">Tous statuts</option>
          <option value="ACTIF">Actif</option>
          <option value="COMPROMIS">Compromis</option>
          <option value="SUSPENDU">Suspendu</option>
          <option value="INCONNU">Inconnu</option>
          <option value="DETRUIT">Détruit</option>
        </select>
      </div>

      {/* Note contexte */}
      {!statutFilter && (
        <div className="text-xs text-slate-500 bg-slate-800/40 border border-slate-700 rounded-lg px-3 py-2">
          ⚠ Les médias marqués <span className="text-red-400 font-semibold">COMPROMIS</span> sont affichés en priorité.
          Dans l'Est, vérifier le statut actuel avant d'utiliser un média comme source — une radio fiable peut passer sous contrôle armé.
        </div>
      )}

      {/* Grille */}
      {isLoading ? (
        <div className="text-center text-slate-400 py-12">Chargement…</div>
      ) : media.length === 0 ? (
        <div className="text-center text-slate-500 py-12">
          Aucun média trouvé.
          {canEdit && <span className="ml-1 text-blue-400 cursor-pointer hover:underline" onClick={openCreate}>Ajouter le premier ?</span>}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {media.map(m => (
            <MediaCard key={m.id} media={m} canEdit={canEdit} onEdit={() => openEdit(m)} />
          ))}
        </div>
      )}

      {/* Modal */}
      {modalData && (
        <MediaModal
          initial={modalData}
          onClose={() => setModalData(null)}
          onSave={handleSave}
          saving={isSaving}
        />
      )}
    </div>
  );
}
