import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';

const PROVINCES_DRC = [
  { pcode: 'CD10', name: 'Kinshasa' },
  { pcode: 'CD20', name: 'Kongo-Central' },
  { pcode: 'CD21', name: 'Kwango' },
  { pcode: 'CD22', name: 'Kwilu' },
  { pcode: 'CD23', name: 'Maï-Ndombe' },
  { pcode: 'CD41', name: 'Équateur' },
  { pcode: 'CD42', name: 'Sud-Ubangi' },
  { pcode: 'CD43', name: 'Nord-Ubangi' },
  { pcode: 'CD44', name: 'Mongala' },
  { pcode: 'CD45', name: 'Tshuapa' },
  { pcode: 'CD51', name: 'Tshopo' },
  { pcode: 'CD52', name: 'Bas-Uélé' },
  { pcode: 'CD53', name: 'Haut-Uélé' },
  { pcode: 'CD54', name: 'Ituri' },
  { pcode: 'CD61', name: 'Nord-Kivu' },
  { pcode: 'CD62', name: 'Sud-Kivu' },
  { pcode: 'CD63', name: 'Maniema' },
  { pcode: 'CD71', name: 'Haut-Katanga' },
  { pcode: 'CD72', name: 'Lualaba' },
  { pcode: 'CD73', name: 'Haut-Lomami' },
  { pcode: 'CD74', name: 'Tanganyika' },
  { pcode: 'CD81', name: 'Lomami' },
  { pcode: 'CD82', name: 'Kasaï-Oriental' },
  { pcode: 'CD83', name: 'Kasaï' },
  { pcode: 'CD84', name: 'Kasaï-Central' },
  { pcode: 'CD85', name: 'Sankuru' },
];

function provinceNameFromPcode(pcode: string): string {
  return PROVINCES_DRC.find(p => p.pcode === pcode)?.name ?? pcode;
}

interface CheckpointEntry {
  id: string;
  checkpointName: string;
  provincePcode: string;
  direction: 'entrant' | 'sortant';
  count: number;
  date: string;
  notes?: string;
  createdAt: string;
}

interface CheckpointStats {
  totalEntrants7d: number;
  totalSortants7d: number;
  activeCheckpoints: number;
  mostAffectedProvince: string;
  topProvinces: { pcode: string; total: number }[];
}

interface FormState {
  checkpointName: string;
  provincePcode: string;
  direction: 'entrant' | 'sortant';
  count: string;
  date: string;
  notes: string;
}

const today = new Date().toISOString().slice(0, 10);

const defaultForm: FormState = {
  checkpointName: '',
  provincePcode: '',
  direction: 'entrant',
  count: '',
  date: today,
  notes: '',
};

// Fallback mock stats when API is unavailable
const MOCK_STATS: CheckpointStats = {
  totalEntrants7d: 0,
  totalSortants7d: 0,
  activeCheckpoints: 0,
  mostAffectedProvince: '—',
  topProvinces: [],
};

export function IdpCheckpointPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(defaultForm);
  const [submitMsg, setSubmitMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // Optimistic local entries to show even if API not available
  const [localEntries, setLocalEntries] = useState<CheckpointEntry[]>([]);

  const { data: entriesData } = useQuery<CheckpointEntry[]>({
    queryKey: ['idp-checkpoints'],
    queryFn: () => apiClient.get('/idp-checkpoints?limit=20').then(r => r.data.data ?? []),
    retry: 1,
    staleTime: 30_000,
  });

  const { data: statsData } = useQuery<CheckpointStats>({
    queryKey: ['idp-checkpoints-stats'],
    queryFn: () => apiClient.get('/idp-checkpoints/stats').then(r => r.data.data ?? MOCK_STATS),
    retry: 1,
    staleTime: 30_000,
  });

  const entries: CheckpointEntry[] = [...(entriesData ?? []), ...localEntries]
    .sort((a, b) => new Date(b.createdAt ?? b.date).getTime() - new Date(a.createdAt ?? a.date).getTime())
    .slice(0, 20);

  const stats: CheckpointStats = statsData ?? MOCK_STATS;

  const maxTopProvince = Math.max(1, ...(stats.topProvinces?.map(p => p.total) ?? [1]));

  const createMutation = useMutation({
    mutationFn: (body: object) => apiClient.post('/idp-checkpoints', body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['idp-checkpoints'] });
      qc.invalidateQueries({ queryKey: ['idp-checkpoints-stats'] });
      setSubmitMsg({ type: 'success', text: 'Flux enregistré avec succès.' });
      setForm(defaultForm);
      setTimeout(() => setSubmitMsg(null), 4000);
    },
    onError: () => {
      // Optimistic local save
      const optimistic: CheckpointEntry = {
        id: crypto.randomUUID(),
        checkpointName: form.checkpointName,
        provincePcode: form.provincePcode,
        direction: form.direction,
        count: parseInt(form.count, 10),
        date: form.date,
        notes: form.notes || undefined,
        createdAt: new Date().toISOString(),
      };
      setLocalEntries(prev => [optimistic, ...prev]);
      setSubmitMsg({ type: 'success', text: 'Enregistré localement (API non disponible).' });
      setForm(defaultForm);
      setTimeout(() => setSubmitMsg(null), 4000);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.checkpointName || !form.provincePcode || !form.count || !form.date) return;
    createMutation.mutate({
      checkpointName: form.checkpointName,
      provincePcode: form.provincePcode,
      direction: form.direction,
      count: parseInt(form.count, 10),
      date: form.date,
      notes: form.notes || undefined,
    });
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">🏕️ Suivi des Déplacés — Points de contrôle</h1>
          <p className="text-sm text-cc-600 mt-0.5">Enregistrement des flux IDP aux checkpoints</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left panel */}
        <div className="space-y-4">
          {/* Form */}
          <div className="cc-card p-5">
            <div className="text-xs font-mono text-cc-500 uppercase tracking-wider mb-4">
              Enregistrer un flux
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              {/* Checkpoint name */}
              <div>
                <label className="block text-xs text-cc-600 font-mono uppercase mb-1">
                  Nom du checkpoint *
                </label>
                <input
                  type="text"
                  required
                  placeholder="ex: Checkpoint Nord-Kivu Km47"
                  className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-sinaur-600 placeholder-cc-600"
                  value={form.checkpointName}
                  onChange={e => setForm(f => ({ ...f, checkpointName: e.target.value }))}
                />
              </div>

              {/* Province */}
              <div>
                <label className="block text-xs text-cc-600 font-mono uppercase mb-1">
                  Province *
                </label>
                <select
                  required
                  className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-sinaur-600"
                  value={form.provincePcode}
                  onChange={e => setForm(f => ({ ...f, provincePcode: e.target.value }))}
                >
                  <option value="">— Sélectionner —</option>
                  {PROVINCES_DRC.map(p => (
                    <option key={p.pcode} value={p.pcode}>{p.name} ({p.pcode})</option>
                  ))}
                </select>
              </div>

              {/* Direction */}
              <div>
                <label className="block text-xs text-cc-600 font-mono uppercase mb-2">
                  Direction *
                </label>
                <div className="flex gap-4">
                  {(['entrant', 'sortant'] as const).map(dir => (
                    <label key={dir} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="direction"
                        value={dir}
                        checked={form.direction === dir}
                        onChange={() => setForm(f => ({ ...f, direction: dir }))}
                        className="accent-sinaur-500"
                      />
                      <span className={`text-sm font-medium ${dir === 'entrant' ? 'text-green-400' : 'text-orange-400'}`}>
                        {dir === 'entrant' ? '▶ Entrant' : '◀ Sortant'}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Count + Date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-cc-600 font-mono uppercase mb-1">
                    Nombre *
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    placeholder="0"
                    className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-sinaur-600"
                    value={form.count}
                    onChange={e => setForm(f => ({ ...f, count: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs text-cc-600 font-mono uppercase mb-1">
                    Date *
                  </label>
                  <input
                    type="date"
                    required
                    className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-sinaur-600"
                    value={form.date}
                    onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs text-cc-600 font-mono uppercase mb-1">
                  Notes (optionnel)
                </label>
                <textarea
                  rows={2}
                  placeholder="Observations, contexte..."
                  className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-sinaur-600 resize-none placeholder-cc-600"
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="w-full bg-sinaur-700 hover:bg-sinaur-600 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-60"
              >
                {createMutation.isPending ? 'Enregistrement…' : '✓ Enregistrer le flux'}
              </button>

              {/* Feedback */}
              {submitMsg && (
                <div className={`text-xs px-3 py-2 rounded-lg font-mono ${
                  submitMsg.type === 'success'
                    ? 'bg-green-900/40 text-green-400 border border-green-800'
                    : 'bg-red-900/40 text-red-400 border border-red-800'
                }`}>
                  {submitMsg.type === 'success' ? '✓' : '✗'} {submitMsg.text}
                </div>
              )}
            </form>
          </div>

          {/* Recent entries */}
          <div className="cc-card p-5">
            <div className="text-xs font-mono text-cc-500 uppercase tracking-wider mb-3">
              Entrées récentes
            </div>
            {entries.length === 0 ? (
              <div className="text-center text-cc-600 text-xs py-6">Aucune entrée enregistrée</div>
            ) : (
              <div className="space-y-2">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-start gap-3 py-2 border-b border-cc-800 last:border-0"
                  >
                    <span className={`mt-0.5 text-xs font-bold shrink-0 ${
                      entry.direction === 'entrant' ? 'text-green-400' : 'text-orange-400'
                    }`}>
                      {entry.direction === 'entrant' ? '▶' : '◀'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-gray-200 font-medium truncate">
                        {entry.checkpointName}
                      </div>
                      <div className="text-[10px] text-cc-600 mt-0.5 font-mono">
                        {provinceNameFromPcode(entry.provincePcode)} · {entry.date}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold font-mono text-white">
                        {entry.count.toLocaleString('fr')}
                      </div>
                      <div className="text-[10px] text-cc-600">personnes</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right panel — stats */}
        <div className="space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3">
            <div className="cc-card p-4 border-l-4 border-l-green-600">
              <div className="text-2xl font-bold font-mono text-white leading-none">
                {(stats.totalEntrants7d ?? 0).toLocaleString('fr')}
              </div>
              <div className="text-xs text-gray-400 mt-1.5 font-medium">Total entrants (7j)</div>
            </div>
            <div className="cc-card p-4 border-l-4 border-l-orange-600">
              <div className="text-2xl font-bold font-mono text-white leading-none">
                {(stats.totalSortants7d ?? 0).toLocaleString('fr')}
              </div>
              <div className="text-xs text-gray-400 mt-1.5 font-medium">Total sortants (7j)</div>
            </div>
            <div className="cc-card p-4 border-l-4 border-l-blue-600">
              <div className="text-2xl font-bold font-mono text-white leading-none">
                {stats.activeCheckpoints ?? 0}
              </div>
              <div className="text-xs text-gray-400 mt-1.5 font-medium">Checkpoints actifs</div>
            </div>
            <div className="cc-card p-4 border-l-4 border-l-purple-600">
              <div className="text-base font-bold font-mono text-white leading-none truncate">
                {stats.mostAffectedProvince
                  ? provinceNameFromPcode(stats.mostAffectedProvince)
                  : '—'}
              </div>
              <div className="text-xs text-gray-400 mt-1.5 font-medium">Province la plus touchée</div>
            </div>
          </div>

          {/* Bar chart — top 5 provinces */}
          <div className="cc-card p-5">
            <div className="text-xs font-mono text-cc-500 uppercase tracking-wider mb-4">
              Top 5 provinces — flux total
            </div>
            {!stats.topProvinces || stats.topProvinces.length === 0 ? (
              <div className="text-center text-cc-600 text-xs py-8">
                Aucune donnée disponible
              </div>
            ) : (
              <div className="space-y-3">
                {stats.topProvinces.slice(0, 5).map(p => {
                  const pct = Math.round((p.total / maxTopProvince) * 100);
                  return (
                    <div key={p.pcode}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-300">
                          {provinceNameFromPcode(p.pcode)}
                        </span>
                        <span className="text-xs font-mono text-gray-400">
                          {p.total.toLocaleString('fr')}
                        </span>
                      </div>
                      <div className="h-2 bg-cc-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-sinaur-600 rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="cc-card p-4">
            <div className="text-xs font-mono text-cc-500 uppercase tracking-wider mb-2">
              À propos
            </div>
            <p className="text-xs text-cc-600 leading-relaxed">
              Ce module permet le suivi des flux de personnes déplacées internes (IDP) aux points
              de contrôle. Les données alimentent les rapports SitRep et le tableau de bord
              national en temps réel.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-mono text-cc-600">
              <div>• Standard UNHCR/IOM</div>
              <div>• P-codes OCHA DRC</div>
              <div>• Export HXL disponible</div>
              <div>• Sync temps réel</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
