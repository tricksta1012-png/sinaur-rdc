import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';
import { useRealtimeFeed } from '../hooks/useRealtimeFeed.js';

const AID_TYPE_FR: Record<string, string> = {
  food: 'Vivres', water: 'Eau potable', medicine: 'Médicaments',
  shelter_kit: 'Kit abri', nfi: 'NFI', hygiene_kit: 'Kit hygiène',
  cash_transfer: 'Transfert cash', protection: 'Protection',
  education: 'Éducation', other: 'Autre',
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  planned:    { label: 'Planifiée',   color: 'bg-blue-900/60 text-blue-300 border-blue-700'     },
  ongoing:    { label: 'En cours',    color: 'bg-yellow-900/60 text-yellow-300 border-yellow-700' },
  completed:  { label: 'Complétée',  color: 'bg-green-900/60 text-green-300 border-green-700'   },
  cancelled:  { label: 'Annulée',    color: 'bg-red-900/60 text-red-300 border-red-700'          },
};

export function DistributionsPage() {
  const { connected } = useRealtimeFeed();
  const qc = useQueryClient();
  const [page, setPage]       = useState(1);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: '', aidType: 'food', locationPcode: '',
    beneficiaryCount: '', plannedDate: '',
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['distributions', page, typeFilter, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (typeFilter)   params.set('aidType', typeFilter);
      if (statusFilter) params.set('status', statusFilter);
      return apiClient.get(`/aids?${params}`).then(r => r.data);
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { data: statsData } = useQuery({
    queryKey: ['distributions-stats'],
    queryFn: () => apiClient.get('/dashboard/stats').then(r => r.data.data),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post('/aids', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['distributions'] });
      setShowForm(false);
      setForm({ title: '', aidType: 'food', locationPcode: '', beneficiaryCount: '', plannedDate: '' });
    },
  });

  const rows       = data?.data ?? [];
  const pagination = data?.pagination ?? { total: 0, pages: 1 };
  const demandStats = statsData?.demandStats ?? {};

  // Total beneficiaries across completed distributions
  const totalBeneficiaries = rows.reduce((s: number, r: any) => s + (Number(r.beneficiaryCount) || 0), 0);

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Distributions d'aide</h1>
          <p className="text-sm text-cc-600 mt-0.5">
            Suivi des distributions humanitaires ·{' '}
            {connected ? <span className="text-green-400">● En direct</span> : <span className="text-cc-600">○ Hors ligne</span>}
          </p>
        </div>
        <button onClick={() => setShowForm(true)} className="cc-btn-primary flex items-center gap-2">
          <span>+</span> Planifier
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'En attente',  value: demandStats.pendingDemands   ?? '…', color: '#ca8a04' },
          { label: 'Approuvées',  value: demandStats.approvedDemands  ?? '…', color: '#2563eb' },
          { label: 'Complétées', value: demandStats.fulfilledDemands ?? '…', color: '#16a34a' },
          { label: 'Bénéficiaires (page)', value: totalBeneficiaries, color: '#7c3aed' },
        ].map(k => (
          <div key={k.label} className="cc-card p-3 border-l-4" style={{ borderLeftColor: k.color }}>
            <div className="text-xl font-bold font-mono text-white">
              {typeof k.value === 'number' ? k.value.toLocaleString('fr') : k.value}
            </div>
            <div className="text-xs text-gray-400 mt-1">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select
          value={typeFilter}
          onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
          className="bg-cc-800 border border-cc-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-sinaur-600"
        >
          <option value="">Tous les types</option>
          {Object.entries(AID_TYPE_FR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="bg-cc-800 border border-cc-700 rounded-lg px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-sinaur-600"
        >
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <div className="ml-auto text-xs text-cc-600 self-center font-mono">
          {pagination.total.toLocaleString('fr')} distribution{pagination.total !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 cc-card animate-pulse" />)}
        </div>
      ) : isError ? (
        <div className="cc-card p-10 text-center">
          <p className="text-sm text-red-400">Impossible de charger les distributions.</p>
          <p className="text-xs text-cc-600 mt-1">Vérifiez que le service API est disponible.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="cc-card p-12 text-center">
          <div className="text-4xl mb-3">📤</div>
          <p className="text-sm text-gray-300 font-medium">
            {typeFilter || statusFilter ? 'Aucune distribution ne correspond aux filtres' : 'Aucune distribution enregistrée'}
          </p>
          <p className="text-xs text-cc-600 mt-1.5">
            {typeFilter || statusFilter
              ? 'Modifiez les filtres pour voir plus de résultats.'
              : 'Planifiez la première distribution humanitaire pour ce module.'}
          </p>
          {!typeFilter && !statusFilter && (
            <button onClick={() => setShowForm(true)} className="cc-btn-primary mt-4 text-xs px-4 py-2">
              + Planifier une distribution
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="cc-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-cc-700">
                <tr className="text-xs text-cc-600 font-mono uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Distribution</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Type</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Province</th>
                  <th className="text-left px-4 py-3">Statut</th>
                  <th className="text-right px-4 py-3 hidden lg:table-cell">Bénéficiaires</th>
                  <th className="text-right px-4 py-3 hidden xl:table-cell">Date planifiée</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cc-800">
                {rows.map((r: any) => {
                  const sm = STATUS_META[r.status] ?? STATUS_META.planned;
                  return (
                    <tr key={r.id} className="hover:bg-cc-800/40 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-200 text-sm">{r.title ?? r.description ?? 'Distribution'}</div>
                        {r.responsibleOrg && <div className="text-[11px] text-cc-600 mt-0.5">{r.responsibleOrg}</div>}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-xs text-gray-400">
                        {AID_TYPE_FR[r.aidType ?? r.type] ?? r.aidType ?? '—'}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-xs font-mono text-gray-400">
                        {r.locationPcode ?? r.pcode ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`cc-badge border ${sm.color}`}>{sm.label}</span>
                      </td>
                      <td className="px-4 py-3 text-right hidden lg:table-cell text-xs font-mono text-gray-300">
                        {r.beneficiaryCount != null ? Number(r.beneficiaryCount).toLocaleString('fr') : '—'}
                      </td>
                      <td className="px-4 py-3 text-right hidden xl:table-cell text-xs text-cc-600">
                        {r.plannedDate ? new Date(r.plannedDate).toLocaleDateString('fr') : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {pagination.pages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="cc-btn-ghost text-xs px-3 py-1.5 disabled:opacity-40">← Préc.</button>
              <span className="text-xs text-cc-600">Page {page} / {pagination.pages}</span>
              <button disabled={page >= pagination.pages} onClick={() => setPage(p => p + 1)} className="cc-btn-ghost text-xs px-3 py-1.5 disabled:opacity-40">Suiv. →</button>
            </div>
          )}
        </>
      )}

      {/* Modal création */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-cc-900 border border-cc-700 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-cc-700">
              <h2 className="text-white font-semibold">Planifier une distribution</h2>
              <button onClick={() => setShowForm(false)} className="text-cc-600 hover:text-gray-300 text-xl leading-none">×</button>
            </div>
            <form
              onSubmit={e => {
                e.preventDefault();
                createMutation.mutate({
                  title: form.title,
                  aidType: form.aidType,
                  locationPcode: form.locationPcode || undefined,
                  beneficiaryCount: form.beneficiaryCount ? parseInt(form.beneficiaryCount) : undefined,
                  plannedDate: form.plannedDate || undefined,
                  status: 'planned',
                });
              }}
              className="px-6 py-4 space-y-3"
            >
              <div>
                <label className="dist-label">Titre / Description *</label>
                <input className="dist-input" required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Ex: Distribution vivres Goma Nord" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="dist-label">Type d'aide *</label>
                  <select className="dist-input" value={form.aidType} onChange={e => setForm(f => ({ ...f, aidType: e.target.value }))}>
                    {Object.entries(AID_TYPE_FR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="dist-label">Code province</label>
                  <input className="dist-input font-mono" maxLength={10} value={form.locationPcode} onChange={e => setForm(f => ({ ...f, locationPcode: e.target.value }))} placeholder="CD61" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="dist-label">Nb bénéficiaires</label>
                  <input className="dist-input" type="number" min="1" value={form.beneficiaryCount} onChange={e => setForm(f => ({ ...f, beneficiaryCount: e.target.value }))} />
                </div>
                <div>
                  <label className="dist-label">Date planifiée</label>
                  <input className="dist-input" type="date" value={form.plannedDate} onChange={e => setForm(f => ({ ...f, plannedDate: e.target.value }))} />
                </div>
              </div>
              {createMutation.isError && <div className="text-red-400 text-xs bg-red-950 px-3 py-2 rounded-lg">Erreur lors de la création.</div>}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="cc-btn-ghost">Annuler</button>
                <button type="submit" disabled={createMutation.isPending} className="cc-btn-primary">
                  {createMutation.isPending ? 'Création…' : 'Planifier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        .dist-label { display:block; font-size:.7rem; color:#475569; font-family:monospace; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.25rem; }
        .dist-input  { width:100%; background:#1e293b; border:1px solid #334155; border-radius:.5rem; padding:.5rem .75rem; font-size:.875rem; color:#f1f5f9; }
        .dist-input:focus { outline:none; border-color:#3b82f6; }
      `}</style>
    </div>
  );
}
