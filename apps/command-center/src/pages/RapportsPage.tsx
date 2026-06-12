import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { apiClient } from '../lib/api.js';

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft:     { label: 'Brouillon', color: 'bg-cc-700 text-gray-300 border-cc-600' },
  final:     { label: 'Final',     color: 'bg-blue-900 text-blue-300 border-blue-700' },
  published: { label: 'Publié',    color: 'bg-green-900 text-green-300 border-green-700' },
};

interface SitRepContent {
  overview?: string; needs?: string; response?: string;
  figures?: { affected?: number; displaced?: number; injured?: number; deaths?: number };
  priorities?: string; funding?: string;
}

function PrintableSitRep({ sitrep, crisis }: { sitrep: any; crisis: any }) {
  const c: SitRepContent = sitrep.content ?? {};
  const today = format(new Date(), 'dd MMMM yyyy', { locale: fr });

  return (
    <div className="print-container hidden print:block">
      <div style={{ fontFamily: 'Arial, sans-serif', color: '#111', lineHeight: '1.6' }}>
        {/* En-tête OCHA */}
        <div style={{ borderBottom: '3px solid #CE1020', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#CE1020' }}>SINAUR-RDC</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>Rapport de Situation N°{sitrep.reportNumber}</div>
              <div style={{ fontSize: '0.9rem', color: '#555' }}>{sitrep.title}</div>
            </div>
            <div style={{ textAlign: 'right', fontSize: '0.8rem', color: '#555' }}>
              <div><strong>GLIDE :</strong> {crisis?.glideNumber}</div>
              <div><strong>Période :</strong> {sitrep.periodFrom} — {sitrep.periodTo}</div>
              <div><strong>Produit le :</strong> {today}</div>
              <div><strong>Préparé par :</strong> {sitrep.preparedByName ?? 'SINAUR-RDC'}</div>
            </div>
          </div>
        </div>

        {/* Chiffres clés */}
        {c.figures && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
            {Object.entries({ 'Personnes affectées': c.figures.affected, 'Déplacées': c.figures.displaced, 'Blessées': c.figures.injured, 'Décès': c.figures.deaths })
              .filter(([, v]) => v != null)
              .map(([label, value]) => (
                <div key={label} style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '0.75rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#CE1020' }}>{value?.toLocaleString('fr')}</div>
                  <div style={{ fontSize: '0.75rem', color: '#555', textTransform: 'uppercase' }}>{label}</div>
                </div>
              ))}
          </div>
        )}

        {/* Sections */}
        {[
          ['Vue d\'ensemble de la situation', c.overview],
          ['Évaluation des besoins', c.needs],
          ['Actions de réponse en cours', c.response],
          ['Priorités pour la prochaine période', c.priorities],
          ['Financement et ressources', c.funding],
        ].filter(([, v]) => v).map(([title, content]) => (
          <div key={title as string} style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#CE1020', borderBottom: '1px solid #eee', paddingBottom: '0.25rem', marginBottom: '0.5rem' }}>{title as string}</h3>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.875rem' }}>{content as string}</p>
          </div>
        ))}

        {/* Pied de page */}
        <div style={{ borderTop: '1px solid #ddd', marginTop: '2rem', paddingTop: '0.75rem', fontSize: '0.7rem', color: '#999', display: 'flex', justifyContent: 'space-between' }}>
          <span>SINAUR-RDC — Système National d'Alerte, d'Urgence et de Réponse aux Sinistres</span>
          <span>CAP 1.2 · HXL · P-codes OCHA · EW4All</span>
        </div>
      </div>
    </div>
  );
}

type ExportStatus = { type: 'success' | 'error' | 'loading'; text: string } | null;

function ExportPublishBar() {
  const [hxlStatus, setHxlStatus]   = useState<ExportStatus>(null);
  const [rwStatus,  setRwStatus]    = useState<ExportStatus>(null);
  const [hdxStatus, setHdxStatus]   = useState<ExportStatus>(null);

  async function handleHxl() {
    setHxlStatus({ type: 'loading', text: 'Téléchargement en cours…' });
    try {
      const res = await apiClient.get('/ai/reporting/hxl/latest', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sinaur-sitrep-${new Date().toISOString().slice(0, 10)}.hxl.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setHxlStatus({ type: 'success', text: 'Fichier HXL téléchargé.' });
    } catch {
      setHxlStatus({ type: 'error', text: 'Échec du téléchargement HXL.' });
    } finally {
      setTimeout(() => setHxlStatus(null), 4000);
    }
  }

  async function handleReliefWeb() {
    setRwStatus({ type: 'loading', text: 'Publication en cours…' });
    try {
      await apiClient.post('/reports/publish/reliefweb', { format: 'situation_report' });
      setRwStatus({ type: 'success', text: 'Publié sur ReliefWeb avec succès.' });
    } catch {
      setRwStatus({ type: 'error', text: 'Échec de la publication ReliefWeb.' });
    } finally {
      setTimeout(() => setRwStatus(null), 4000);
    }
  }

  async function handleHdx() {
    setHdxStatus({ type: 'loading', text: 'Export vers HDX en cours…' });
    try {
      await apiClient.post('/reports/publish/hdx', {});
      setHdxStatus({ type: 'success', text: 'Exporté vers HDX avec succès.' });
    } catch {
      setHdxStatus({ type: 'error', text: 'Échec de l\'export HDX.' });
    } finally {
      setTimeout(() => setHdxStatus(null), 4000);
    }
  }

  function StatusBubble({ status }: { status: ExportStatus }) {
    if (!status) return null;
    const colors =
      status.type === 'success' ? 'bg-green-900/40 text-green-400 border-green-800' :
      status.type === 'error'   ? 'bg-red-900/40 text-red-400 border-red-800' :
                                  'bg-cc-800 text-cc-400 border-cc-700';
    return (
      <span className={`ml-2 text-[10px] font-mono px-2 py-0.5 rounded border ${colors}`}>
        {status.text}
      </span>
    );
  }

  return (
    <div className="border-b border-cc-700 bg-cc-900 px-4 py-3 shrink-0">
      <div className="text-xs font-mono text-cc-500 uppercase tracking-wider mb-2">
        Export &amp; Publication
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center">
          <button
            onClick={handleHxl}
            disabled={hxlStatus?.type === 'loading'}
            className="cc-btn-ghost text-xs disabled:opacity-60"
          >
            ⬆ Exporter HXL
          </button>
          <StatusBubble status={hxlStatus} />
        </div>
        <div className="flex items-center">
          <button
            onClick={handleReliefWeb}
            disabled={rwStatus?.type === 'loading'}
            className="cc-btn-ghost text-xs disabled:opacity-60"
          >
            🌐 Publier sur ReliefWeb
          </button>
          <StatusBubble status={rwStatus} />
        </div>
        <div className="flex items-center">
          <button
            onClick={handleHdx}
            disabled={hdxStatus?.type === 'loading'}
            className="cc-btn-ghost text-xs disabled:opacity-60"
          >
            📊 Exporter vers HDX
          </button>
          <StatusBubble status={hdxStatus} />
        </div>
      </div>
      <p className="text-[10px] text-cc-700 mt-2 font-mono">
        La publication vers ReliefWeb et HDX nécessite une validation préalable
      </p>
    </div>
  );
}

export function RapportsPage() {
  const qc = useQueryClient();
  const [crisisId, setCrisisId] = useState('');
  const [viewId, setViewId]     = useState<string | null>(null);
  const [showNew, setShowNew]   = useState(false);
  const [form, setForm] = useState<{ title: string; periodFrom: string; periodTo: string; content: SitRepContent }>({
    title: '', periodFrom: '', periodTo: '',
    content: { overview: '', needs: '', response: '', figures: {}, priorities: '', funding: '' },
  });

  const today = format(new Date(), 'yyyy-MM-dd');
  const week  = format(new Date(Date.now() - 7 * 864e5), 'yyyy-MM-dd');

  const { data: crises } = useQuery({
    queryKey: ['crises-sitrep'],
    queryFn: () => apiClient.get('/crises?limit=50').then(r => r.data.data),
  });

  const { data: sitreps } = useQuery({
    queryKey: ['sitreps', crisisId],
    queryFn: () => crisisId
      ? apiClient.get(`/crises/${crisisId}`).then(r => r.data.data?.sitreps ?? [])
      : Promise.resolve([]),
    enabled: !!crisisId,
  });

  const { data: sitrep } = useQuery({
    queryKey: ['sitrep', viewId],
    queryFn: () => viewId && crisisId
      ? apiClient.get(`/crises/${crisisId}/sitreps/${viewId}`).then(r => r.data.data)
      : null,
    enabled: !!(viewId && crisisId),
  });

  const createMutation = useMutation({
    mutationFn: (body: unknown) => apiClient.post(`/crises/${crisisId}/sitreps`, body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['sitreps', crisisId] });
      setShowNew(false);
      setViewId(res.data.data.id);
    },
  });

  const publishMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiClient.patch(`/crises/${crisisId}/sitreps/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sitrep', viewId] }),
  });

  const selectedCrisis = crises?.find((c: any) => c.id === crisisId);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Export & Publish bar */}
      <ExportPublishBar />

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
      {/* Left panel */}
      <div className="w-72 shrink-0 border-r border-cc-700 flex flex-col">
        <div className="p-4 border-b border-cc-700 space-y-3 shrink-0">
          <h1 className="text-base font-bold text-white">Rapports SitRep</h1>
          <select
            className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-sinaur-600"
            value={crisisId}
            onChange={e => { setCrisisId(e.target.value); setViewId(null); }}
          >
            <option value="">— Sélectionner une crise —</option>
            {(crises ?? []).map((c: any) => (
              <option key={c.id} value={c.id}>{c.glideNumber} — {c.title}</option>
            ))}
          </select>
          {crisisId && (
            <button onClick={() => { setShowNew(true); setForm(f => ({ ...f, title: `SitRep ${selectedCrisis?.glideNumber}`, periodFrom: week, periodTo: today })); }} className="cc-btn-primary w-full text-xs">
              + Nouveau SitRep
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {(sitreps ?? []).length === 0 && crisisId ? (
            <div className="text-center text-cc-600 text-xs py-8">Aucun rapport</div>
          ) : (
            <div className="divide-y divide-cc-800">
              {(sitreps ?? []).map((s: any) => {
                const sm = STATUS_META[s.status] ?? STATUS_META.draft;
                return (
                  <button
                    key={s.id}
                    onClick={() => setViewId(s.id)}
                    className={`w-full text-left px-4 py-3 hover:bg-cc-800 transition-colors ${viewId === s.id ? 'bg-cc-800' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono text-yellow-400">#{s.reportNumber}</span>
                      <span className={`cc-badge border text-xs ${sm.color}`}>{sm.label}</span>
                    </div>
                    <div className="text-sm text-gray-300 font-medium mt-0.5 line-clamp-1">{s.title}</div>
                    <div className="text-xs text-cc-600 mt-0.5">{s.periodFrom} → {s.periodTo}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right panel — SitRep view */}
      <div className="flex-1 overflow-y-auto">
        {!viewId || !sitrep ? (
          <div className="flex items-center justify-center h-full text-cc-600 text-sm">
            {crisisId ? 'Sélectionnez un rapport ou créez-en un nouveau' : 'Sélectionnez une crise'}
          </div>
        ) : (
          <div className="p-6 max-w-3xl mx-auto">
            {/* Header */}
            <div className="flex items-start justify-between mb-6 gap-4">
              <div>
                <div className="text-xs text-cc-600 font-mono mb-1">{selectedCrisis?.glideNumber}</div>
                <h2 className="text-lg font-bold text-white">{sitrep.title}</h2>
                <div className="text-sm text-cc-600 mt-0.5">Rapport N°{sitrep.reportNumber} · {sitrep.periodFrom} → {sitrep.periodTo}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {sitrep.status === 'draft' && (
                  <button onClick={() => publishMutation.mutate({ id: viewId, status: 'final' })} className="cc-btn-ghost text-xs">
                    ✓ Finaliser
                  </button>
                )}
                {sitrep.status === 'final' && (
                  <button onClick={() => publishMutation.mutate({ id: viewId, status: 'published' })} className="cc-btn-ghost text-xs">
                    📢 Publier
                  </button>
                )}
                <button onClick={() => window.print()} className="cc-btn-primary text-xs no-print">
                  🖨️ Imprimer
                </button>
              </div>
            </div>

            {/* Key figures */}
            {sitrep.content?.figures && Object.values(sitrep.content.figures).some(v => v != null) && (
              <div className="grid grid-cols-4 gap-3 mb-6">
                {[
                  { label: 'Affectées',  key: 'affected',  icon: '👥' },
                  { label: 'Déplacées',  key: 'displaced', icon: '🚶' },
                  { label: 'Blessées',   key: 'injured',   icon: '🏥' },
                  { label: 'Décès',      key: 'deaths',    icon: '💔' },
                ].map(({ label, key, icon }) => {
                  const v = (sitrep.content.figures as any)[key];
                  if (v == null) return null;
                  return (
                    <div key={key} className="cc-card p-3 text-center">
                      <div className="text-xl mb-1">{icon}</div>
                      <div className="text-xl font-bold text-white font-mono">{v.toLocaleString('fr')}</div>
                      <div className="text-xs text-cc-600 mt-0.5">{label}</div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Sections */}
            {[
              { label: 'Vue d\'ensemble', key: 'overview' },
              { label: 'Évaluation des besoins', key: 'needs' },
              { label: 'Réponse en cours', key: 'response' },
              { label: 'Priorités prochaine période', key: 'priorities' },
              { label: 'Financement & ressources', key: 'funding' },
            ].map(({ label, key }) => {
              const val = (sitrep.content as SitRepContent)[key as keyof SitRepContent];
              if (!val || typeof val !== 'string') return null;
              return (
                <div key={key} className="cc-card p-4 mb-3">
                  <h3 className="text-xs font-mono text-cc-600 uppercase tracking-wider mb-2">{label}</h3>
                  <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{val}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Print template */}
      {sitrep && <PrintableSitRep sitrep={sitrep} crisis={selectedCrisis} />}

      {/* Modal nouveau SitRep */}
      {showNew && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-cc-900 border border-cc-700 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-cc-700 sticky top-0 bg-cc-900">
              <h2 className="text-white font-semibold">Nouveau rapport de situation</h2>
              <button onClick={() => setShowNew(false)} className="text-cc-600 hover:text-gray-300 text-xl leading-none">×</button>
            </div>
            <form
              onSubmit={e => { e.preventDefault(); createMutation.mutate({ title: form.title, periodFrom: form.periodFrom, periodTo: form.periodTo, content: form.content }); }}
              className="px-6 py-4 space-y-4"
            >
              <div>
                <label className="block text-xs text-cc-600 font-mono uppercase mb-1">Titre du rapport *</label>
                <input className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-sinaur-600" required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-cc-600 font-mono uppercase mb-1">Période du *</label>
                  <input type="date" className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none" required value={form.periodFrom} onChange={e => setForm(f => ({ ...f, periodFrom: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-cc-600 font-mono uppercase mb-1">Période au *</label>
                  <input type="date" className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none" required value={form.periodTo} onChange={e => setForm(f => ({ ...f, periodTo: e.target.value }))} />
                </div>
              </div>

              {/* Chiffres clés */}
              <div>
                <label className="block text-xs text-cc-600 font-mono uppercase mb-2">Chiffres clés</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['affected', 'displaced', 'injured', 'deaths'] as const).map(k => (
                    <div key={k}>
                      <label className="block text-xs text-cc-600 mb-1 capitalize">{k === 'affected' ? 'Affectées' : k === 'displaced' ? 'Déplacées' : k === 'injured' ? 'Blessées' : 'Décès'}</label>
                      <input type="number" min="0" className="w-full bg-cc-800 border border-cc-700 rounded px-2 py-1.5 text-xs text-gray-100 focus:outline-none" value={(form.content.figures as any)?.[k] ?? ''} onChange={e => setForm(f => ({ ...f, content: { ...f.content, figures: { ...f.content.figures, [k]: e.target.value ? parseInt(e.target.value) : undefined } } }))} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Sections texte */}
              {[
                { key: 'overview',   label: 'Vue d\'ensemble de la situation' },
                { key: 'needs',      label: 'Évaluation des besoins' },
                { key: 'response',   label: 'Actions de réponse' },
                { key: 'priorities', label: 'Priorités prochaine période' },
                { key: 'funding',    label: 'Financement & ressources' },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-xs text-cc-600 font-mono uppercase mb-1">{label}</label>
                  <textarea
                    className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-sinaur-600 h-20 resize-none"
                    value={(form.content as any)[key] ?? ''}
                    onChange={e => setForm(f => ({ ...f, content: { ...f.content, [key]: e.target.value } }))}
                  />
                </div>
              ))}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowNew(false)} className="cc-btn-ghost">Annuler</button>
                <button type="submit" disabled={createMutation.isPending} className="cc-btn-primary">
                  {createMutation.isPending ? 'Création…' : 'Créer le SitRep'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>{/* end body flex */}
    </div>
  );
}
