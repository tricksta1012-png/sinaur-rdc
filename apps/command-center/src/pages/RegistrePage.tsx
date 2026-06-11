import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';

const ROLE_CAN_SEE_PII = ['national_decision_maker', 'system_admin', 'territory_admin'];

function maskName(name: string, canSee: boolean): string {
  if (canSee || !name) return name;
  const parts = name.split(' ');
  return parts.map((p, i) => i === 0 ? p : p[0] + '***').join(' ');
}

const VULNERABILITY_LABEL: Record<string, string> = {
  none: 'Aucune', elderly: 'Personne âgée', disabled: 'Handicap',
  pregnant: 'Grossesse', child_under_5: 'Enfant < 5 ans',
  unaccompanied_minor: 'Mineur non accompagné', chronic_illness: 'Maladie chronique',
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  active:    { label: 'Actif',    color: 'bg-green-900/60 text-green-300 border-green-700' },
  displaced: { label: 'Déplacé', color: 'bg-yellow-900/60 text-yellow-300 border-yellow-700' },
  evacuated: { label: 'Évacué',  color: 'bg-blue-900/60 text-blue-300 border-blue-700'     },
  deceased:  { label: 'Décédé',  color: 'bg-red-900/60 text-red-300 border-red-700'         },
  returned:  { label: 'Retourné', color: 'bg-cc-800 text-gray-400 border-cc-700'            },
};

function getTokenRole(accessToken: string | undefined): string {
  if (!accessToken) return '';
  try { return JSON.parse(atob(accessToken.split('.')[1])).role ?? ''; } catch { return ''; }
}

export function RegistrePage() {
  const tokens  = useAuthStore(s => s.tokens);
  const canSee  = ROLE_CAN_SEE_PII.includes(getTokenRole(tokens?.accessToken));
  const qc      = useQueryClient();
  const [page, setPage]       = useState(1);
  const [search, setSearch]   = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ fullName: '', pcode: '', vulnerability: 'none', householdSize: '1' });

  // Debounce search
  const handleSearch = (v: string) => {
    setSearch(v);
    clearTimeout((handleSearch as any)._t);
    (handleSearch as any)._t = setTimeout(() => { setDebouncedSearch(v); setPage(1); }, 400);
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['registry', page, debouncedSearch, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (statusFilter) params.set('status', statusFilter);
      return apiClient.get(`/registry?${params}`).then(r => r.data);
    },
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post('/registry', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['registry'] }); setShowForm(false); setForm({ fullName: '', pcode: '', vulnerability: 'none', householdSize: '1' }); },
  });

  const rows       = data?.data ?? [];
  const pagination = data?.pagination ?? { total: 0, pages: 1 };

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Registre des sinistrés</h1>
          <p className="text-sm text-cc-600 mt-0.5">
            Base de données bénéficiaires · {canSee ? 'Accès complet' : 'Données partiellement masquées (RBAC)'}
          </p>
        </div>
        <button onClick={() => setShowForm(true)} className="cc-btn-primary flex items-center gap-2">
          <span>+</span> Enregistrer
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          type="text"
          placeholder="Rechercher par nom, pcode…"
          value={search}
          onChange={e => handleSearch(e.target.value)}
          className="bg-cc-800 border border-cc-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-sinaur-600 w-56"
        />
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="bg-cc-800 border border-cc-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-sinaur-600"
        >
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS_META).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <div className="ml-auto text-xs text-cc-600 self-center">
          {pagination.total.toLocaleString('fr')} bénéficiaire{pagination.total !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 cc-card animate-pulse" />)}
        </div>
      ) : isError ? (
        <div className="cc-card p-10 text-center">
          <p className="text-sm text-red-400">Erreur lors du chargement du registre.</p>
          <p className="text-xs text-cc-600 mt-1">Vérifiez que le service API est opérationnel.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="cc-card p-12 text-center">
          <div className="text-4xl mb-3">👥</div>
          <p className="text-sm text-gray-300 font-medium">
            {debouncedSearch ? `Aucun résultat pour « ${debouncedSearch} »` : 'Aucun bénéficiaire enregistré'}
          </p>
          <p className="text-xs text-cc-600 mt-1.5">
            {debouncedSearch
              ? 'Essayez un autre terme de recherche ou effacez les filtres.'
              : 'Les sinistrés enregistrés lors des interventions apparaîtront ici.'}
          </p>
          {!debouncedSearch && (
            <button onClick={() => setShowForm(true)} className="cc-btn-primary mt-4 text-xs px-4 py-2">
              + Enregistrer le premier bénéficiaire
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="cc-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-cc-700">
                <tr className="text-xs text-cc-600 font-mono uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Nom</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Province</th>
                  <th className="text-left px-4 py-3 hidden lg:table-cell">Vulnérabilité</th>
                  <th className="text-left px-4 py-3">Statut</th>
                  <th className="text-right px-4 py-3 hidden xl:table-cell">Ménage</th>
                  <th className="text-right px-4 py-3 hidden lg:table-cell">Enregistré le</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cc-800">
                {rows.map((r: any) => {
                  const sm = STATUS_META[r.status] ?? STATUS_META.active;
                  return (
                    <tr key={r.id} className="hover:bg-cc-800/40 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-200 text-sm">
                          {maskName(r.fullName ?? r.name ?? '—', canSee)}
                        </div>
                        {r.registrationNumber && (
                          <div className="text-[11px] text-cc-600 font-mono mt-0.5">{r.registrationNumber}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-400 font-mono">
                        {r.locationPcode ?? r.pcode ?? '—'}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-gray-400">
                        {VULNERABILITY_LABEL[r.vulnerability ?? 'none'] ?? r.vulnerability ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`cc-badge border ${sm.color}`}>{sm.label}</span>
                      </td>
                      <td className="px-4 py-3 text-right hidden xl:table-cell text-xs font-mono text-gray-400">
                        {r.householdSize ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right hidden lg:table-cell text-xs text-cc-600">
                        {r.createdAt ? new Date(r.createdAt).toLocaleDateString('fr') : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.pages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="cc-btn-ghost text-xs px-3 py-1.5 disabled:opacity-40"
              >← Préc.</button>
              <span className="text-xs text-cc-600">Page {page} / {pagination.pages}</span>
              <button
                disabled={page >= pagination.pages}
                onClick={() => setPage(p => p + 1)}
                className="cc-btn-ghost text-xs px-3 py-1.5 disabled:opacity-40"
              >Suiv. →</button>
            </div>
          )}
        </>
      )}

      {/* Modal création */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-cc-900 border border-cc-700 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-cc-700">
              <h2 className="text-white font-semibold">Enregistrer un bénéficiaire</h2>
              <button onClick={() => setShowForm(false)} className="text-cc-600 hover:text-gray-300 text-xl leading-none">×</button>
            </div>
            <form
              onSubmit={e => {
                e.preventDefault();
                createMutation.mutate({
                  fullName: form.fullName,
                  locationPcode: form.pcode || undefined,
                  vulnerability: form.vulnerability,
                  householdSize: parseInt(form.householdSize) || 1,
                });
              }}
              className="px-6 py-4 space-y-3"
            >
              <div>
                <label className="reg-label">Nom complet *</label>
                <input
                  className="reg-input" required
                  value={form.fullName}
                  onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
                  placeholder="Prénom Nom"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="reg-label">Code province</label>
                  <input
                    className="reg-input font-mono" maxLength={10}
                    value={form.pcode}
                    onChange={e => setForm(f => ({ ...f, pcode: e.target.value }))}
                    placeholder="CD61"
                  />
                </div>
                <div>
                  <label className="reg-label">Taille du ménage</label>
                  <input
                    className="reg-input" type="number" min="1" max="50"
                    value={form.householdSize}
                    onChange={e => setForm(f => ({ ...f, householdSize: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="reg-label">Vulnérabilité principale</label>
                <select className="reg-input" value={form.vulnerability} onChange={e => setForm(f => ({ ...f, vulnerability: e.target.value }))}>
                  {Object.entries(VULNERABILITY_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              {createMutation.isError && (
                <div className="text-red-400 text-xs bg-red-950 px-3 py-2 rounded-lg">Erreur lors de l'enregistrement.</div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="cc-btn-ghost">Annuler</button>
                <button type="submit" disabled={createMutation.isPending} className="cc-btn-primary">
                  {createMutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        .reg-label { display:block; font-size:.7rem; color:#475569; font-family:monospace; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.25rem; }
        .reg-input  { width:100%; background:#1e293b; border:1px solid #334155; border-radius:.5rem; padding:.5rem .75rem; font-size:.875rem; color:#f1f5f9; }
        .reg-input:focus { outline:none; border-color:#3b82f6; }
      `}</style>
    </div>
  );
}
