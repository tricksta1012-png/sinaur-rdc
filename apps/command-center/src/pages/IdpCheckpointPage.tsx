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

const CAUSES_DEPLACEMENT = [
  { value: 'conflict',  label: 'Conflit armé' },
  { value: 'flood',     label: 'Inondation' },
  { value: 'eruption',  label: 'Éruption volcanique' },
  { value: 'epidemic',  label: 'Épidémie' },
  { value: 'drought',   label: 'Sécheresse' },
  { value: 'other',     label: 'Autre' },
];

function provinceName(pcode: string): string {
  return PROVINCES_DRC.find(p => p.pcode === pcode)?.name ?? pcode;
}

interface Flow {
  id: string;
  checkpoint_name: string;
  province_pcode: string;
  direction: 'entrant' | 'sortant';
  count: number;
  flow_date: string;
  origin_province?: string;
  destination?: string;
  notes?: string;
  created_at: string;
}

interface RawStats {
  total_entrant: number;
  total_sortant: number;
  net_displacement: number;
  active_checkpoints: number;
  by_province: { province_pcode: string; total_count: number }[];
}

interface FormState {
  checkpointName: string;
  provincePcode: string;
  direction: 'entrant' | 'sortant';
  count: string;
  flowDate: string;
  originProvince: string;
  destination: string;
  cause: string;
  notes: string;
}

const today = new Date().toISOString().slice(0, 10);

const defaultForm: FormState = {
  checkpointName: '',
  provincePcode: '',
  direction: 'entrant',
  count: '',
  flowDate: today,
  originProvince: '',
  destination: '',
  cause: '',
  notes: '',
};

export function IdpCheckpointPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(defaultForm);
  const [submitMsg, setSubmitMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [localEntries, setLocalEntries] = useState<Flow[]>([]);

  const { data: flowsData } = useQuery<Flow[]>({
    queryKey: ['idp-flows'],
    queryFn: () => apiClient.get('/idp-checkpoints/flows?limit=20').then(r => r.data.data ?? []),
    retry: 1,
    staleTime: 30_000,
  });

  const { data: rawStats } = useQuery<RawStats>({
    queryKey: ['idp-checkpoints-stats'],
    queryFn: () => apiClient.get('/idp-checkpoints/stats').then(r => r.data.data),
    retry: 1,
    staleTime: 30_000,
  });

  const flows: Flow[] = [...(flowsData ?? []), ...localEntries]
    .sort((a, b) => new Date(b.created_at ?? b.flow_date).getTime() - new Date(a.created_at ?? a.flow_date).getTime())
    .slice(0, 20);

  const totalEntrant    = rawStats?.total_entrant ?? 0;
  const totalSortant    = rawStats?.total_sortant ?? 0;
  const netDisplacement = rawStats?.net_displacement ?? 0;
  const activeCheckpoints = rawStats?.active_checkpoints ?? 0;
  const topProvinces    = rawStats?.by_province ?? [];
  const mostAffected    = topProvinces[0]?.province_pcode ?? null;
  const maxProv         = Math.max(1, ...topProvinces.map(p => Number(p.total_count)));

  const createMutation = useMutation({
    mutationFn: (body: object) => apiClient.post('/idp-checkpoints/flows', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['idp-flows'] });
      qc.invalidateQueries({ queryKey: ['idp-checkpoints-stats'] });
      setSubmitMsg({ type: 'success', text: 'Flux enregistré avec succès.' });
      setForm(defaultForm);
      setTimeout(() => setSubmitMsg(null), 4000);
    },
    onError: () => {
      const optimistic: Flow = {
        id: crypto.randomUUID(),
        checkpoint_name: form.checkpointName,
        province_pcode: form.provincePcode,
        direction: form.direction,
        count: parseInt(form.count, 10),
        flow_date: form.flowDate,
        origin_province: form.originProvince || undefined,
        destination: form.destination || undefined,
        notes: form.notes || undefined,
        created_at: new Date().toISOString(),
      };
      setLocalEntries(prev => [optimistic, ...prev]);
      setSubmitMsg({ type: 'success', text: 'Enregistré localement (API non disponible).' });
      setForm(defaultForm);
      setTimeout(() => setSubmitMsg(null), 4000);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.checkpointName || !form.provincePcode || !form.count || !form.flowDate) return;
    const notes = [
      form.cause ? `Cause : ${CAUSES_DEPLACEMENT.find(c => c.value === form.cause)?.label ?? form.cause}` : '',
      form.notes,
    ].filter(Boolean).join(' — ') || undefined;

    createMutation.mutate({
      checkpointName:  form.checkpointName,
      provincePcode:   form.provincePcode,
      direction:       form.direction,
      count:           parseInt(form.count, 10),
      flowDate:        form.flowDate,
      originProvince:  form.originProvince || undefined,
      destination:     form.destination    || undefined,
      notes,
    });
  }

  const netColor = netDisplacement > 0 ? 'text-red-400' : netDisplacement < 0 ? 'text-green-400' : 'text-gray-400';

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">🏕️ Suivi des Déplacés</h1>
          <p className="text-sm text-cc-600 mt-0.5">Enregistrement des flux IDP aux points de contrôle</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Panneau gauche ── */}
        <div className="space-y-4">

          {/* Formulaire */}
          <div className="cc-card p-5">
            <div className="text-xs font-mono text-cc-500 uppercase tracking-wider mb-4">
              Enregistrer un déplacement
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">

              {/* Checkpoint */}
              <div>
                <label className="idp-label">Nom du checkpoint / site *</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Checkpoint RN2 Km47, Site Bulengo…"
                  className="idp-input"
                  value={form.checkpointName}
                  onChange={e => setForm(f => ({ ...f, checkpointName: e.target.value }))}
                />
              </div>

              {/* Province de passage */}
              <div>
                <label className="idp-label">Province (lieu d'observation) *</label>
                <select
                  required
                  className="idp-input"
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
                <label className="idp-label">Direction *</label>
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

              {/* Nombre + Date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="idp-label">Nombre de personnes *</label>
                  <input
                    type="number"
                    required
                    min="1"
                    placeholder="0"
                    className="idp-input"
                    value={form.count}
                    onChange={e => setForm(f => ({ ...f, count: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="idp-label">Date d'observation *</label>
                  <input
                    type="date"
                    required
                    className="idp-input"
                    value={form.flowDate}
                    onChange={e => setForm(f => ({ ...f, flowDate: e.target.value }))}
                  />
                </div>
              </div>

              {/* Cause */}
              <div>
                <label className="idp-label">Cause du déplacement</label>
                <select
                  className="idp-input"
                  value={form.cause}
                  onChange={e => setForm(f => ({ ...f, cause: e.target.value }))}
                >
                  <option value="">— Non précisée —</option>
                  {CAUSES_DEPLACEMENT.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              {/* Province d'origine + Destination */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="idp-label">Province d'origine</label>
                  <select
                    className="idp-input"
                    value={form.originProvince}
                    onChange={e => setForm(f => ({ ...f, originProvince: e.target.value }))}
                  >
                    <option value="">— Inconnue —</option>
                    {PROVINCES_DRC.map(p => (
                      <option key={p.pcode} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="idp-label">Destination / site d'accueil</label>
                  <input
                    type="text"
                    placeholder="ex: Camp Mugunga, Goma…"
                    className="idp-input"
                    value={form.destination}
                    onChange={e => setForm(f => ({ ...f, destination: e.target.value }))}
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="idp-label">Observations complémentaires</label>
                <textarea
                  rows={2}
                  placeholder="Conditions, besoins observés, groupes vulnérables…"
                  className="idp-input resize-none"
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>

              <button
                type="submit"
                disabled={createMutation.isPending}
                className="w-full bg-sinaur-700 hover:bg-sinaur-600 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-60"
              >
                {createMutation.isPending ? 'Enregistrement…' : '✓ Enregistrer le déplacement'}
              </button>

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

          {/* Entrées récentes */}
          <div className="cc-card p-5">
            <div className="text-xs font-mono text-cc-500 uppercase tracking-wider mb-3">
              Enregistrements récents
            </div>
            {flows.length === 0 ? (
              <div className="text-center text-cc-600 text-xs py-6">Aucun enregistrement</div>
            ) : (
              <div className="space-y-2">
                {flows.map(f => (
                  <div key={f.id} className="flex items-start gap-3 py-2.5 border-b border-cc-800 last:border-0">
                    <span className={`mt-0.5 text-xs font-bold shrink-0 ${
                      f.direction === 'entrant' ? 'text-green-400' : 'text-orange-400'
                    }`}>
                      {f.direction === 'entrant' ? '▶' : '◀'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-gray-200 font-medium truncate">{f.checkpoint_name}</div>
                      <div className="text-[10px] text-cc-600 mt-0.5 font-mono">
                        {provinceName(f.province_pcode)} · {f.flow_date}
                      </div>
                      {(f.origin_province || f.destination) && (
                        <div className="text-[10px] text-cc-600 mt-0.5">
                          {f.origin_province && <span>De : {f.origin_province}</span>}
                          {f.origin_province && f.destination && <span> → </span>}
                          {f.destination && <span>Vers : {f.destination}</span>}
                        </div>
                      )}
                      {f.notes && (
                        <div className="text-[10px] text-cc-700 mt-0.5 italic truncate">{f.notes}</div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold font-mono text-white">
                        {f.count.toLocaleString('fr')}
                      </div>
                      <div className="text-[10px] text-cc-600">personnes</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Panneau droit — statistiques ── */}
        <div className="space-y-4">

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3">
            <div className="cc-card p-4 border-l-4 border-l-green-600">
              <div className="text-2xl font-bold font-mono text-white leading-none">
                {totalEntrant.toLocaleString('fr')}
              </div>
              <div className="text-xs text-gray-400 mt-1.5 font-medium">Total entrants (7j)</div>
            </div>
            <div className="cc-card p-4 border-l-4 border-l-orange-600">
              <div className="text-2xl font-bold font-mono text-white leading-none">
                {totalSortant.toLocaleString('fr')}
              </div>
              <div className="text-xs text-gray-400 mt-1.5 font-medium">Total sortants (7j)</div>
            </div>
            <div className="cc-card p-4 border-l-4 border-l-blue-600">
              <div className="text-2xl font-bold font-mono text-white leading-none">
                {activeCheckpoints}
              </div>
              <div className="text-xs text-gray-400 mt-1.5 font-medium">Checkpoints actifs</div>
            </div>
            <div className="cc-card p-4 border-l-4 border-l-red-600">
              <div className={`text-xl font-bold font-mono leading-none ${netColor}`}>
                {netDisplacement > 0 ? '+' : ''}{netDisplacement.toLocaleString('fr')}
              </div>
              <div className="text-xs text-gray-400 mt-1.5 font-medium">Solde net (7j)</div>
            </div>
          </div>

          {/* Province la plus touchée */}
          {mostAffected && (
            <div className="cc-card p-4 flex items-center gap-3">
              <span className="text-2xl">📍</span>
              <div>
                <div className="text-sm font-bold text-white">{provinceName(mostAffected)}</div>
                <div className="text-xs text-cc-600 mt-0.5">Province la plus touchée (7j)</div>
              </div>
            </div>
          )}

          {/* Bar chart */}
          <div className="cc-card p-5">
            <div className="text-xs font-mono text-cc-500 uppercase tracking-wider mb-4">
              Top provinces — flux total (7j)
            </div>
            {topProvinces.length === 0 ? (
              <div className="text-center text-cc-600 text-xs py-8">Aucune donnée disponible</div>
            ) : (
              <div className="space-y-3">
                {topProvinces.slice(0, 7).map(p => {
                  const pct = Math.round((Number(p.total_count) / maxProv) * 100);
                  return (
                    <div key={p.province_pcode}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-300">{provinceName(p.province_pcode)}</span>
                        <span className="text-xs font-mono text-gray-400">
                          {Number(p.total_count).toLocaleString('fr')}
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
            <div className="text-xs font-mono text-cc-500 uppercase tracking-wider mb-2">À propos</div>
            <p className="text-xs text-cc-600 leading-relaxed">
              Ce module enregistre les flux de déplacés internes (IDP) aux points de contrôle.
              Les données incluent l'origine, la destination, la cause et le nombre de personnes
              observées. Elles alimentent les SitReps et le tableau de bord national.
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

      <style>{`
        .idp-label { display:block; font-size:.7rem; color:#475569; font-family:monospace; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.25rem; }
        .idp-input { width:100%; background:#1e293b; border:1px solid #334155; border-radius:.5rem; padding:.5rem .75rem; font-size:.875rem; color:#f1f5f9; outline:none; }
        .idp-input:focus { border-color:#7c3aed; }
        .idp-input::placeholder { color:#475569; }
      `}</style>
    </div>
  );
}
