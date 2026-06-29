import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';
import { useNavigate } from 'react-router-dom';

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

const PROVINCES_DRC = [
  { pcode: 'CD10', name: 'Kinshasa' }, { pcode: 'CD20', name: 'Kongo-Central' },
  { pcode: 'CD21', name: 'Kwango' },   { pcode: 'CD22', name: 'Kwilu' },
  { pcode: 'CD23', name: 'Maï-Ndombe' }, { pcode: 'CD41', name: 'Équateur' },
  { pcode: 'CD42', name: 'Sud-Ubangi' }, { pcode: 'CD43', name: 'Nord-Ubangi' },
  { pcode: 'CD44', name: 'Mongala' },  { pcode: 'CD45', name: 'Tshuapa' },
  { pcode: 'CD51', name: 'Tshopo' },   { pcode: 'CD52', name: 'Bas-Uélé' },
  { pcode: 'CD53', name: 'Haut-Uélé' }, { pcode: 'CD54', name: 'Ituri' },
  { pcode: 'CD61', name: 'Nord-Kivu' }, { pcode: 'CD62', name: 'Sud-Kivu' },
  { pcode: 'CD63', name: 'Maniema' },  { pcode: 'CD71', name: 'Haut-Katanga' },
  { pcode: 'CD72', name: 'Lualaba' },  { pcode: 'CD73', name: 'Haut-Lomami' },
  { pcode: 'CD74', name: 'Tanganyika' }, { pcode: 'CD81', name: 'Lomami' },
  { pcode: 'CD82', name: 'Kasaï-Oriental' }, { pcode: 'CD83', name: 'Kasaï' },
  { pcode: 'CD84', name: 'Kasaï-Central' }, { pcode: 'CD85', name: 'Sankuru' },
];

interface CreateForm {
  title: string; hazardType: string; severity: string;
  startDate: string; locationPcode: string;
  affectedCount: string; displacedCount: string; deathsCount: string;
  responseLead: string; description: string;
}

const today = new Date().toISOString().slice(0, 10);

const EMPTY_FORM: CreateForm = {
  title: '', hazardType: 'flood', severity: 'Severe',
  startDate: today, locationPcode: '', affectedCount: '',
  displacedCount: '', deathsCount: '', responseLead: '', description: '',
};

export function CrisesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab]   = useState<string | null>(null); // null = all
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);

  const validateMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/crises/${id}/validate`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crises'] }),
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/crises/${id}/reject`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crises'] }),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['crises', tab],
    queryFn: () => apiClient.get(`/crises${tab ? `?status=${tab}` : ''}`).then(r => r.data.data),
    staleTime: 30_000,
    refetchInterval: 30_000,
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
      startDate:      form.startDate      || undefined,
      locationPcode:  form.locationPcode  || undefined,
      affectedCount:  form.affectedCount  ? parseInt(form.affectedCount)  : undefined,
      displacedCount: form.displacedCount ? parseInt(form.displacedCount) : undefined,
      deathsCount:    form.deathsCount    ? parseInt(form.deathsCount)    : undefined,
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
                <th className="text-left px-4 py-3 hidden lg:table-cell">Source</th>
                <th className="text-right px-4 py-3 hidden lg:table-cell">Affectés</th>
                <th className="text-right px-4 py-3 hidden xl:table-cell">Tâches</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cc-800">
              {data.map((c: any) => {
                const sm = STATUS_META[c.status] ?? STATUS_META.active;
                const isAgentAuto = c.createdBy === 'AGENT_AUTO' || c.pendingValidation;
                return (
                  <tr key={c.id} className={`hover:bg-cc-800/50 transition-colors ${isAgentAuto ? 'border-l-2 border-yellow-600' : ''}`}>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-yellow-400">{c.glideNumber}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-medium text-gray-200 text-sm truncate max-w-[180px]">{c.title}</span>
                        {isAgentAuto && (
                          <span className="text-[9px] font-bold px-1.5 py-px rounded bg-yellow-900/70 text-yellow-300 border border-yellow-700 shrink-0 animate-pulse">
                            🤖 AGENT_AUTO
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {c.locationName && <span className="text-xs text-cc-600">📍 {c.locationName}</span>}
                        {c.confidenceScore != null && (
                          <span className="text-[10px] font-mono text-yellow-600">{Math.round(c.confidenceScore * 100)}%</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-gray-400 text-xs">
                      {HAZARD_FR[c.hazardType] ?? c.hazardType}
                    </td>
                    <td className="px-4 py-3">
                      {c.pendingValidation ? (
                        <span className="cc-badge border bg-yellow-900/50 text-yellow-300 border-yellow-700">En attente</span>
                      ) : (
                        <span className={`cc-badge border ${sm.color}`}>{sm.label}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {isAgentAuto ? (
                        <span className="text-[10px] text-yellow-600 font-mono">IA — veille auto</span>
                      ) : (
                        <span className="text-[10px] text-cc-600">Manuel</span>
                      )}
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
                        {c.pendingValidation ? (
                          <>
                            <button
                              onClick={() => validateMutation.mutate(c.id)}
                              disabled={validateMutation.isPending}
                              className="text-[10px] px-2 py-1 rounded bg-green-800 text-green-200 hover:bg-green-700 transition-colors"
                            >
                              ✓
                            </button>
                            <button
                              onClick={() => rejectMutation.mutate(c.id)}
                              disabled={rejectMutation.isPending}
                              className="text-[10px] px-2 py-1 rounded bg-red-900/60 text-red-300 hover:bg-red-800 transition-colors"
                            >
                              ✕
                            </button>
                          </>
                        ) : (
                          <>
                            {c.status === 'active' && (
                              <button
                                onClick={() => updateStatus.mutate({ id: c.id, status: 'contained' })}
                                className="cc-btn-ghost text-xs px-2 py-1"
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
                          </>
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
            <form onSubmit={handleCreate} className="px-6 py-5 space-y-4 max-h-[75vh] overflow-y-auto">
              {/* Titre */}
              <div>
                <label className="cc-label">Titre de la crise *</label>
                <input className="cc-input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required placeholder="Ex: Épidémie Mpox Nord-Kivu, Inondations Kinshasa Ouest…" />
              </div>

              {/* Type + Sévérité */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="cc-label">Type de crise *</label>
                  <select className="cc-input" value={form.hazardType} onChange={e => setForm(f => ({ ...f, hazardType: e.target.value }))}>
                    {HAZARD_CODES.map(c => <option key={c} value={c}>{HAZARD_FR[c]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="cc-label">Sévérité</label>
                  <select className="cc-input" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
                    <option value="Extreme">Extrême</option>
                    <option value="Severe">Sévère</option>
                    <option value="Moderate">Modérée</option>
                    <option value="Minor">Mineure</option>
                    <option value="Unknown">Inconnue</option>
                  </select>
                </div>
              </div>

              {/* Alerte épidémie */}
              {form.hazardType === 'health_epidemic' && (
                <div className="bg-red-950/40 border border-red-800/60 rounded-lg px-3 py-2 text-xs text-red-300">
                  🦠 Épidémie — Précisez la maladie dans le titre et la description (ex : Mpox, Ebola, Choléra, Rougeole…)
                </div>
              )}

              {/* Date début + Province */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="cc-label">Date de début</label>
                  <input className="cc-input" type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
                </div>
                <div>
                  <label className="cc-label">Province concernée</label>
                  <select className="cc-input" value={form.locationPcode} onChange={e => setForm(f => ({ ...f, locationPcode: e.target.value }))}>
                    <option value="">— Nationale / Inconnue —</option>
                    {PROVINCES_DRC.map(p => <option key={p.pcode} value={p.pcode}>{p.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Chiffres clés */}
              <div>
                <div className="text-xs font-mono text-cc-500 uppercase tracking-wider mb-2">Chiffres clés (estimations)</div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="cc-label">Personnes affectées</label>
                    <input className="cc-input" type="number" min="0" placeholder="0" value={form.affectedCount} onChange={e => setForm(f => ({ ...f, affectedCount: e.target.value }))} />
                  </div>
                  <div>
                    <label className="cc-label">Personnes déplacées</label>
                    <input className="cc-input" type="number" min="0" placeholder="0" value={form.displacedCount} onChange={e => setForm(f => ({ ...f, displacedCount: e.target.value }))} />
                  </div>
                  <div>
                    <label className="cc-label">Décès confirmés</label>
                    <input className="cc-input" type="number" min="0" placeholder="0" value={form.deathsCount} onChange={e => setForm(f => ({ ...f, deathsCount: e.target.value }))} />
                  </div>
                </div>
              </div>

              {/* Agence cheffe de file */}
              <div>
                <label className="cc-label">Agence cheffe de file</label>
                <input className="cc-input" value={form.responseLead} onChange={e => setForm(f => ({ ...f, responseLead: e.target.value }))} placeholder="OCHA, UNHCR, MSF, OMS, UNICEF…" />
              </div>

              {/* Description */}
              <div>
                <label className="cc-label">Description / contexte</label>
                <textarea className="cc-input h-24 resize-none" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Décrivez la situation, les causes, les populations touchées, les besoins prioritaires…" />
              </div>

              {createMutation.error && (
                <div className="text-red-400 text-xs bg-red-950 px-3 py-2 rounded-lg">Erreur lors de la création. Vérifiez les champs obligatoires.</div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }} className="cc-btn-ghost">Annuler</button>
                <button type="submit" disabled={createMutation.isPending} className="cc-btn-primary">
                  {createMutation.isPending ? 'Création…' : 'Ouvrir la crise'}
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
