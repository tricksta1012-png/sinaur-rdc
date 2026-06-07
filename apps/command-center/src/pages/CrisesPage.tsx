import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';

const HAZARD_FR: Record<string, string> = {
  flood: 'Inondation', conflict: 'Conflit', health_epidemic: 'Épidémie',
  mass_displacement: 'Déplacement', drought: 'Sécheresse', other: 'Autre',
};
const HAZARD_CODES = Object.keys(HAZARD_FR);

const STATUS_META: Record<string, { label: string; color: string }> = {
  active:    { label: 'Active',    color: 'bg-red-900 text-red-300 border-red-700'     },
  contained: { label: 'Maîtrisée', color: 'bg-yellow-900 text-yellow-300 border-yellow-700' },
  closed:    { label: 'Clôturée', color: 'bg-gray-800 text-gray-400 border-gray-700'  },
};

interface CreateForm {
  title: string; hazardType: string; severity: string;
  locationPcode: string; affectedCount: string;
  displacedCount: string; responseLead: string; description: string;
}

const EMPTY_FORM: CreateForm = {
  title: '', hazardType: 'flood', severity: 'Severe',
  locationPcode: '', affectedCount: '', displacedCount: '',
  responseLead: '', description: '',
};

export function CrisesPage() {
  const qc = useQueryClient();
  const [tab, setTab]   = useState<string | null>(null); // null = all
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);

  const { data, isLoading } = useQuery({
    queryKey: ['crises', tab],
    queryFn: () => apiClient.get(`/crises${tab ? `?status=${tab}` : ''}`).then(r => r.data.data),
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post('/crises', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crises'] }); setShowForm(false); setForm(EMPTY_FORM); },
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiClient.patch(`/crises/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crises'] }),
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      title:          form.title,
      hazardType:     form.hazardType,
      severity:       form.severity,
      locationPcode:  form.locationPcode || undefined,
      affectedCount:  form.affectedCount  ? parseInt(form.affectedCount)  : undefined,
      displacedCount: form.displacedCount ? parseInt(form.displacedCount) : undefined,
      responseLead:   form.responseLead   || undefined,
      description:    form.description    || undefined,
    });
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Gestion des crises</h1>
          <p className="text-sm text-cc-600 mt-0.5">Numéros GLIDE · Cycle de vie · SitReps</p>
        </div>
        <button onClick={() => setShowForm(true)} className="cc-btn-primary flex items-center gap-2">
          <span>+</span> Ouvrir une crise
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        {[
          { key: null,        label: 'Toutes' },
          { key: 'active',    label: 'Actives' },
          { key: 'contained', label: 'Maîtrisées' },
          { key: 'closed',    label: 'Clôturées' },
        ].map(t => (
          <button
            key={String(t.key)}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === t.key ? 'bg-sinaur-700 text-white' : 'bg-cc-800 text-gray-400 hover:bg-cc-700 hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 cc-card animate-pulse" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="cc-card p-12 text-center text-cc-600">
          <div className="text-3xl mb-3">🆘</div>
          <p className="text-sm">Aucune crise enregistrée</p>
        </div>
      ) : (
        <div className="cc-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-cc-700">
              <tr className="text-xs text-cc-600 font-mono uppercase tracking-wider">
                <th className="text-left px-4 py-3">GLIDE</th>
                <th className="text-left px-4 py-3">Titre</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Type</th>
                <th className="text-left px-4 py-3">Statut</th>
                <th className="text-right px-4 py-3 hidden lg:table-cell">Affectés</th>
                <th className="text-right px-4 py-3 hidden xl:table-cell">Tâches ouvertes</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cc-800">
              {data.map((c: any) => {
                const sm = STATUS_META[c.status] ?? STATUS_META.active;
                return (
                  <tr key={c.id} className="hover:bg-cc-800/50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-yellow-400">{c.glideNumber}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-200 text-sm">{c.title}</div>
                      {c.locationName && <div className="text-xs text-cc-600 mt-0.5">📍 {c.locationName}</div>}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-gray-400 text-xs">
                      {HAZARD_FR[c.hazardType] ?? c.hazardType}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`cc-badge border ${sm.color}`}>{sm.label}</span>
                    </td>
                    <td className="px-4 py-3 text-right hidden lg:table-cell text-gray-300 text-xs font-mono">
                      {c.affectedCount != null ? c.affectedCount.toLocaleString('fr') : '—'}
                    </td>
                    <td className="px-4 py-3 text-right hidden xl:table-cell">
                      {c.openTasks > 0 ? (
                        <span className="text-yellow-400 text-xs font-mono">{c.openTasks}</span>
                      ) : <span className="text-cc-600 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {c.status === 'active' && (
                          <button
                            onClick={() => updateStatus.mutate({ id: c.id, status: 'contained' })}
                            className="cc-btn-ghost text-xs px-2 py-1"
                            title="Marquer comme maîtrisée"
                          >
                            ✓ Maîtrisée
                          </button>
                        )}
                        {c.status === 'contained' && (
                          <button
                            onClick={() => updateStatus.mutate({ id: c.id, status: 'closed' })}
                            className="cc-btn-ghost text-xs px-2 py-1"
                          >
                            Clôturer
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal création */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-cc-900 border border-cc-700 rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-cc-700">
              <h2 className="text-white font-semibold">Ouvrir une nouvelle crise</h2>
              <button onClick={() => setShowForm(false)} className="text-cc-600 hover:text-gray-300 text-xl leading-none">×</button>
            </div>
            <form onSubmit={handleCreate} className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="cc-label">Titre *</label>
                  <input className="cc-input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required placeholder="Ex: Inondations Kinshasa Ouest" />
                </div>
                <div>
                  <label className="cc-label">Type de risque *</label>
                  <select className="cc-input" value={form.hazardType} onChange={e => setForm(f => ({ ...f, hazardType: e.target.value }))}>
                    {HAZARD_CODES.map(c => <option key={c} value={c}>{HAZARD_FR[c]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="cc-label">Sévérité</label>
                  <select className="cc-input" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
                    {['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="cc-label">Code province (P-code)</label>
                  <input className="cc-input font-mono" value={form.locationPcode} onChange={e => setForm(f => ({ ...f, locationPcode: e.target.value }))} placeholder="CD01" maxLength={10} />
                </div>
                <div>
                  <label className="cc-label">Agence cheffe de file</label>
                  <input className="cc-input" value={form.responseLead} onChange={e => setForm(f => ({ ...f, responseLead: e.target.value }))} placeholder="OCHA, UNHCR, MSF…" />
                </div>
                <div>
                  <label className="cc-label">Personnes affectées (estim.)</label>
                  <input className="cc-input" type="number" min="0" value={form.affectedCount} onChange={e => setForm(f => ({ ...f, affectedCount: e.target.value }))} />
                </div>
                <div>
                  <label className="cc-label">Personnes déplacées (estim.)</label>
                  <input className="cc-input" type="number" min="0" value={form.displacedCount} onChange={e => setForm(f => ({ ...f, displacedCount: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <label className="cc-label">Description</label>
                  <textarea className="cc-input h-20 resize-none" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                </div>
              </div>
              {createMutation.error && (
                <div className="text-red-400 text-xs bg-red-950 px-3 py-2 rounded-lg">Erreur lors de la création.</div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="cc-btn-ghost">Annuler</button>
                <button type="submit" disabled={createMutation.isPending} className="cc-btn-primary">
                  {createMutation.isPending ? 'Création…' : 'Créer la crise'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        .cc-label { @apply block text-xs text-cc-600 font-mono uppercase tracking-wider mb-1; display:block; font-size:.7rem; color:#475569; font-family:monospace; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.25rem; }
        .cc-input { @apply w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-sinaur-600; width:100%; background:#1e293b; border:1px solid #334155; border-radius:.5rem; padding:.5rem .75rem; font-size:.875rem; color:#f1f5f9; }
      `}</style>
    </div>
  );
}
