import { useState, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { apiClient } from '../lib/api.js';

// ── Constants ───────────────────────────────────────────────────────────────

type RensTab = 'menaces' | 'militaire' | 'incidents' | 'infrastructure' | 'bulletin' | 'recherche';

const THREAT_COLOR: Record<number, string> = {
  1: '#22c55e', 2: '#eab308', 3: '#f97316', 4: '#ef4444', 5: '#dc2626',
};
const THREAT_BG: Record<number, string> = {
  1: 'bg-green-900/30 border-green-800',
  2: 'bg-yellow-900/30 border-yellow-800',
  3: 'bg-orange-900/30 border-orange-800',
  4: 'bg-red-900/30 border-red-700',
  5: 'bg-red-950/60 border-red-600',
};
const THREAT_LABEL: Record<number, string> = {
  1: 'STABLE', 2: 'VIGILANCE', 3: 'ÉLEVÉ', 4: 'SÉVÈRE', 5: 'CRITIQUE',
};

const CAT_ICON: Record<string, string> = {
  ACTIVITE_MILITAIRE: '🪖', DEPLACEMENT: '🏃', INCIDENT_SECURITAIRE: '🚨',
  DOMMAGE_INFRASTRUCTURE: '🏗️', NEGOCIATION: '🤝', AUTRE: '📋',
};
const CAT_LABEL: Record<string, string> = {
  ACTIVITE_MILITAIRE: 'Activité militaire', DEPLACEMENT: 'Déplacement',
  INCIDENT_SECURITAIRE: 'Incident sécuritaire', DOMMAGE_INFRASTRUCTURE: 'Infrastructure',
  NEGOCIATION: 'Négociation', AUTRE: 'Autre',
};
const CAT_COLOR: Record<string, string> = {
  ACTIVITE_MILITAIRE: 'text-red-400', DEPLACEMENT: 'text-orange-400',
  INCIDENT_SECURITAIRE: 'text-yellow-400', DOMMAGE_INFRASTRUCTURE: 'text-blue-400',
  NEGOCIATION: 'text-green-400', AUTRE: 'text-cc-400',
};
const ACCESS_COLOR: Record<string, string> = {
  LIBRE: 'text-green-400', DIFFICILE: 'text-yellow-400',
  TRES_DIFFICILE: 'text-orange-400', BLOQUE: 'text-red-400',
};

function reliabilityLabel(r: number): { label: string; cls: string } {
  if (r >= 0.85) return { label: 'Fiable',       cls: 'text-green-400'  };
  if (r >= 0.70) return { label: 'Probable',     cls: 'text-yellow-400' };
  if (r >= 0.50) return { label: 'Incertain',    cls: 'text-orange-400' };
  return               { label: 'Non confirmé',  cls: 'text-red-400'    };
}

function safeDate(s: string | undefined): string {
  if (!s) return '—';
  try { return formatDistanceToNow(new Date(s), { addSuffix: true, locale: fr }); }
  catch { return s; }
}

function safeFormatFull(s: string | undefined): string {
  if (!s) return '—';
  try { return format(new Date(s), 'dd MMM yyyy HH:mm', { locale: fr }); }
  catch { return s; }
}

// ── Sub-components ──────────────────────────────────────────────────────────

function EmptyState({ icon, msg }: { icon: string; msg: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-cc-600 font-mono space-y-2">
      <span className="text-3xl opacity-30">{icon}</span>
      <span className="text-xs">{msg}</span>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-16 text-cc-600 text-xs font-mono">
      <span className="animate-pulse">Chargement…</span>
    </div>
  );
}

function EventCard({ event }: { event: any }) {
  const [open, setOpen] = useState(false);
  const rel = reliabilityLabel(event.reliability ?? 0.7);
  const cat = event.category ?? 'AUTRE';
  return (
    <div className="bg-cc-800/60 rounded-lg border border-cc-700 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-3 py-2.5 flex items-start gap-2.5 text-left hover:bg-cc-700/30 transition-colors"
      >
        <span className="text-base shrink-0 mt-px">{CAT_ICON[cat] ?? '📋'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <span className="text-[11px] text-gray-200 font-semibold leading-tight line-clamp-2">{event.title}</span>
            <div className="shrink-0 flex flex-col items-end gap-0.5">
              <span className={`text-[8px] font-mono font-bold ${rel.cls}`}>{rel.label}</span>
              <div className="w-10 h-0.5 bg-cc-700 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${rel.cls.replace('text-', 'bg-')}`}
                  style={{ width: `${Math.round((event.reliability ?? 0.7) * 100)}%` }} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className={`text-[9px] font-mono ${CAT_COLOR[cat] ?? 'text-cc-400'}`}>{CAT_LABEL[cat] ?? cat}</span>
            {event.province && <span className="text-[9px] text-cc-500 font-mono">{event.province}</span>}
            <span className="text-[9px] text-cc-600 font-mono ml-auto shrink-0">{safeDate(event.date)}</span>
          </div>
        </div>
        <span className="text-cc-600 text-[9px] shrink-0 mt-1">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-cc-700 space-y-2">
          {event.content && (
            <p className="text-[10px] text-cc-300 leading-relaxed">{event.content}</p>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[9px] font-mono">
            {event.territoire && (
              <>
                <span className="text-cc-500">Territoire :</span>
                <span className="text-gray-300">{event.territoire}</span>
              </>
            )}
            {event.actor_names?.length > 0 && (
              <>
                <span className="text-cc-500">Acteurs :</span>
                <span className="text-red-300">{event.actor_names.join(', ')}</span>
              </>
            )}
            <span className="text-cc-500">Source :</span>
            <span className="text-gray-300">{event.source_id ?? '—'}</span>
            <span className="text-cc-500">Date :</span>
            <span className="text-gray-300">{safeFormatFull(event.date)}</span>
          </div>
          {event.url && (
            <a href={event.url} target="_blank" rel="noopener noreferrer"
              className="text-[9px] text-sinaur-400 hover:text-sinaur-300 font-mono block truncate">
              🔗 Source originale
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────────

function MenacesTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['rens-threat-assessment'],
    queryFn: () => apiClient.get('/renseignement/threat-assessment').then(r => r.data),
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  });

  const assessments: any[] = data?.assessments ?? [];

  if (isLoading) return <LoadingState />;
  if (assessments.length === 0) return <EmptyState icon="🛡️" msg="Aucune évaluation de menace disponible" />;

  const [selectedPcode, setSelectedPcode] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const sorted = [...assessments].sort((a, b) => (b.threat_level ?? 0) - (a.threat_level ?? 0));

  function scrollToCard(pcode: string) {
    setSelectedPcode(pcode);
    const el = cardRefs.current[pcode];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  return (
    <div className="space-y-3 p-4">
      {/* Summary row */}
      <div className="grid grid-cols-5 gap-2">
        {[5, 4, 3, 2, 1].map(lvl => {
          const count = assessments.filter(a => a.threat_level === lvl).length;
          return (
            <div key={lvl} className={`rounded-lg border px-2 py-2 text-center ${THREAT_BG[lvl]}`}>
              <div className="text-lg font-bold font-mono" style={{ color: THREAT_COLOR[lvl] }}>{count}</div>
              <div className="text-[8px] font-mono" style={{ color: THREAT_COLOR[lvl] }}>{THREAT_LABEL[lvl]}</div>
            </div>
          );
        })}
      </div>

      {/* Threat matrix — compact province grid */}
      <div className="bg-cc-800/40 rounded-xl border border-cc-700 p-2.5">
        <div className="text-[9px] font-mono text-cc-500 uppercase tracking-wider mb-2">Matrice des menaces — cliquer pour accéder</div>
        <div className="flex flex-wrap gap-1.5">
          {sorted.map((a: any) => (
            <button
              key={a.p_code}
              onClick={() => scrollToCard(a.p_code)}
              title={`${a.province} — ${THREAT_LABEL[a.threat_level ?? 1]}`}
              className={`px-2 py-1 rounded text-[9px] font-mono font-bold border transition-all ${
                selectedPcode === a.p_code ? 'ring-1 ring-white/40 scale-105' : 'hover:scale-105'
              }`}
              style={{
                backgroundColor: (THREAT_COLOR[a.threat_level ?? 1]) + '22',
                borderColor:     (THREAT_COLOR[a.threat_level ?? 1]) + '60',
                color:           THREAT_COLOR[a.threat_level ?? 1],
              }}
            >
              {a.province?.split(' ')[0] ?? a.p_code}
            </button>
          ))}
        </div>
      </div>

      {/* Province cards */}
      <div className="grid grid-cols-1 gap-2">
        {sorted.map((a: any) => (
          <div
            key={a.p_code ?? a.province}
            ref={el => { cardRefs.current[a.p_code] = el; }}
            className={`rounded-lg border px-3 py-2.5 transition-all ${THREAT_BG[a.threat_level ?? 1]} ${selectedPcode === a.p_code ? 'ring-1 ring-white/20' : ''}`}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <div className="text-[12px] text-white font-bold">{a.province}</div>
                <div className="text-[9px] font-mono text-cc-500">{a.p_code}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[11px] font-bold font-mono" style={{ color: THREAT_COLOR[a.threat_level ?? 1] }}>
                  {THREAT_LABEL[a.threat_level ?? 1]}
                </div>
                <div className="text-[8px] text-cc-600 font-mono">Conf. {Math.round((a.confidence ?? 0) * 100)}%</div>
              </div>
            </div>

            {/* Threat bar */}
            <div className="h-1 bg-cc-800 rounded-full mb-2">
              <div className="h-full rounded-full" style={{
                width: `${((a.threat_level ?? 1) / 5) * 100}%`,
                backgroundColor: THREAT_COLOR[a.threat_level ?? 1],
              }} />
            </div>

            <div className="text-[10px] text-cc-300 mb-2 leading-relaxed">{a.justification}</div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[9px]">
              <div>
                <span className="text-cc-500 font-mono">Accès humanitaire : </span>
                <span className={`font-mono font-bold ${ACCESS_COLOR[a.humanitarian_access] ?? 'text-cc-400'}`}>
                  {(a.humanitarian_access ?? '—').replace(/_/g, ' ')}
                </span>
              </div>
              {a.active_actors?.length > 0 && (
                <div>
                  <span className="text-cc-500 font-mono">Acteurs : </span>
                  <span className="text-red-300 font-mono">{a.active_actors.slice(0, 2).join(', ')}{a.active_actors.length > 2 ? ` +${a.active_actors.length - 2}` : ''}</span>
                </div>
              )}
            </div>

            {a.recommended_actions?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {a.recommended_actions.slice(0, 3).map((act: string, i: number) => (
                  <span key={i} className="text-[8px] bg-cc-900/70 text-cc-400 border border-cc-700 px-1.5 py-0.5 rounded font-mono">{act}</span>
                ))}
              </div>
            )}

            {a.safe_corridors?.length > 0 && (
              <div className="mt-1.5 text-[9px] text-green-400 font-mono">
                ✅ Corridors sûrs : {a.safe_corridors.join(' · ')}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

type SortBy = 'date_desc' | 'date_asc' | 'reliability';

function EventListTab({ queryKey, endpoint, emptyMsg }: { queryKey: string; endpoint: string; emptyMsg: string }) {
  const [province, setProvince] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('date_desc');
  const [minRel, setMinRel] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: [queryKey, province],
    queryFn: () => {
      const params = province ? `?p_code=${encodeURIComponent(province)}` : '';
      return apiClient.get(`${endpoint}${params}`).then(r => r.data);
    },
    staleTime: 5 * 60_000,
  });

  const allEvents: any[] = data?.events ?? [];

  const filtered = useMemo(() => {
    let res = allEvents;
    if (catFilter) res = res.filter(e => (e.category ?? '') === catFilter);
    if (minRel > 0) res = res.filter(e => (e.reliability ?? 0.7) >= minRel);
    return [...res].sort((a, b) => {
      if (sortBy === 'date_asc')       return new Date(a.date).getTime() - new Date(b.date).getTime();
      if (sortBy === 'reliability')    return (b.reliability ?? 0) - (a.reliability ?? 0);
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [allEvents, catFilter, sortBy, minRel]);

  // category counts for chips
  const catCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of allEvents) { const c = e.category ?? 'AUTRE'; counts[c] = (counts[c] ?? 0) + 1; }
    return counts;
  }, [allEvents]);

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="px-3 py-2.5 border-b border-cc-700 shrink-0 space-y-2">
        {/* Province filter */}
        <input
          type="text"
          value={province}
          onChange={e => setProvince(e.target.value.toUpperCase())}
          placeholder="Filtrer par pcode province (ex. CD61)"
          className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-1.5 text-[11px] font-mono text-gray-200 placeholder-cc-600 focus:outline-none focus:border-cc-500"
        />

        {/* Category chips */}
        {Object.keys(catCounts).length > 0 && (
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setCatFilter('')}
              className={`px-2 py-0.5 rounded text-[9px] font-mono border transition-colors ${
                catFilter === '' ? 'bg-cc-600 border-cc-500 text-white' : 'border-cc-700 text-cc-500 hover:text-gray-300'
              }`}
            >Tous ({allEvents.length})</button>
            {Object.entries(catCounts).sort((a,b) => b[1]-a[1]).map(([cat, cnt]) => (
              <button
                key={cat}
                onClick={() => setCatFilter(catFilter === cat ? '' : cat)}
                className={`px-2 py-0.5 rounded text-[9px] font-mono border transition-colors ${
                  catFilter === cat ? 'bg-cc-700 border-cc-500 text-white' : 'border-cc-700 text-cc-500 hover:text-gray-300'
                }`}
              >
                {CAT_ICON[cat] ?? '📋'} {CAT_LABEL[cat] ?? cat} <span className="opacity-60">({cnt})</span>
              </button>
            ))}
          </div>
        )}

        {/* Sort + min reliability */}
        <div className="flex items-center gap-2">
          <div className="flex gap-1 flex-1">
            {([
              { key: 'date_desc',   label: '↓ Date'     },
              { key: 'date_asc',    label: '↑ Date'     },
              { key: 'reliability', label: '★ Fiabilité' },
            ] as { key: SortBy; label: string }[]).map(s => (
              <button
                key={s.key}
                onClick={() => setSortBy(s.key)}
                className={`px-2 py-0.5 rounded text-[8px] font-mono border transition-colors ${
                  sortBy === s.key ? 'bg-cc-700 border-cc-500 text-white' : 'border-cc-700 text-cc-500 hover:text-gray-300'
                }`}
              >{s.label}</button>
            ))}
          </div>
          <div className="flex gap-1">
            {[
              { v: 0,    label: 'Tout'  },
              { v: 0.5,  label: '50%+'  },
              { v: 0.7,  label: '70%+'  },
              { v: 0.85, label: '85%+'  },
            ].map(r => (
              <button
                key={r.v}
                onClick={() => setMinRel(r.v)}
                className={`px-1.5 py-0.5 rounded text-[8px] font-mono border transition-colors ${
                  minRel === r.v ? 'bg-cc-700 border-cc-500 text-white' : 'border-cc-700 text-cc-500 hover:text-gray-300'
                }`}
              >{r.label}</button>
            ))}
          </div>
        </div>

        {/* Result count */}
        {!isLoading && allEvents.length > 0 && (
          <div className="text-[9px] text-cc-600 font-mono">
            {filtered.length} / {allEvents.length} résultat{filtered.length !== 1 ? 's' : ''}
            {catFilter && ` · ${CAT_LABEL[catFilter] ?? catFilter}`}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {isLoading ? <LoadingState /> : filtered.length === 0 ? <EmptyState icon="🔍" msg={emptyMsg} /> : (
          filtered.map((e: any, i: number) => <EventCard key={e.external_id ?? i} event={e} />)
        )}
      </div>
    </div>
  );
}

function BulletinTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['rens-bulletin'],
    queryFn: () => apiClient.get('/renseignement/bulletin/latest').then(r => r.data),
    staleTime: 10 * 60_000,
  });

  const bulletin = data?.bulletin;

  if (isLoading) return <LoadingState />;
  if (!bulletin) return <EmptyState icon="📋" msg="Aucun bulletin disponible — en cours de génération" />;

  return (
    <div className="p-4 space-y-4 overflow-y-auto">
      {/* Header */}
      <div className="bg-red-950/40 border border-red-800 rounded-xl px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-mono text-red-400 uppercase tracking-wider mb-1">
              🔒 BULLETIN DE RENSEIGNEMENT — RESTREINT
            </div>
            <div className="text-white font-bold text-sm">Bulletin #{(bulletin.bulletin_id ?? '').slice(0, 8)}</div>
            <div className="text-[10px] text-cc-500 font-mono mt-0.5">
              Période : {safeDate(bulletin.period_start)} → {safeDate(bulletin.period_end)}
            </div>
          </div>
          <div className="text-right shrink-0 space-y-1.5">
            <div>
              <div className="text-[9px] text-cc-500 font-mono">Généré</div>
              <div className="text-[10px] text-gray-300 font-mono">{safeDate(bulletin.generated_at)}</div>
            </div>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1 px-2 py-1 rounded border border-cc-600 text-cc-400 hover:text-gray-200 hover:border-cc-500 text-[9px] font-mono transition-colors"
            >🖨️ Imprimer</button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-red-900/30 border border-red-800 rounded-lg px-3 py-2 text-center">
          <div className="text-xl font-bold font-mono text-red-400">{bulletin.critical_count ?? 0}</div>
          <div className="text-[9px] font-mono text-red-400 uppercase">Événements critiques</div>
        </div>
        <div className="bg-orange-900/30 border border-orange-800 rounded-lg px-3 py-2 text-center">
          <div className="text-xl font-bold font-mono text-orange-400">{bulletin.high_count ?? 0}</div>
          <div className="text-[9px] font-mono text-orange-400 uppercase">Priorité haute</div>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-cc-800/60 rounded-xl border border-cc-700 px-4 py-3">
        <div className="text-[9px] font-mono text-cc-500 uppercase tracking-wider mb-2">Résumé exécutif</div>
        <p className="text-[11px] text-cc-300 leading-relaxed">{bulletin.summary}</p>
      </div>

      {/* Province assessments */}
      {bulletin.province_assessments?.length > 0 && (
        <div>
          <div className="text-[10px] font-mono text-cc-500 uppercase tracking-wider mb-2">
            Évaluations provinciales ({bulletin.province_assessments.length})
          </div>
          <div className="space-y-2">
            {[...bulletin.province_assessments]
              .sort((a: any, b: any) => (b.threat_level ?? 0) - (a.threat_level ?? 0))
              .slice(0, 6)
              .map((a: any) => (
                <div key={a.p_code} className="flex items-center justify-between bg-cc-800/60 rounded-lg border border-cc-700 px-3 py-2">
                  <span className="text-[11px] text-gray-200 font-medium">{a.province}</span>
                  <span className="text-[9px] font-mono font-bold" style={{ color: THREAT_COLOR[a.threat_level ?? 1] }}>
                    {THREAT_LABEL[a.threat_level ?? 1]}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Key events */}
      {bulletin.key_events?.length > 0 && (
        <div>
          <div className="text-[10px] font-mono text-cc-500 uppercase tracking-wider mb-2">
            Événements clés ({bulletin.key_events.length})
          </div>
          <div className="space-y-2">
            {bulletin.key_events.slice(0, 5).map((e: any, i: number) => (
              <EventCard key={e.external_id ?? i} event={e} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RechercheTab() {
  const [query, setQuery] = useState('');
  const [province, setProvince] = useState('');
  const [category, setCategory] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  async function doSearch(overrideQuery?: string) {
    const q = overrideQuery ?? query;
    setSearching(true);
    if (q && !recentSearches.includes(q)) {
      setRecentSearches(prev => [q, ...prev].slice(0, 5));
    }
    try {
      const { data } = await apiClient.post('/renseignement/search', {
        query: q || undefined,
        province: province || undefined,
        type: category || undefined,
      });
      setResults(data?.events ?? []);
      setSearched(true);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function applyRecent(q: string) {
    setQuery(q);
    doSearch(q);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-cc-700 space-y-2 shrink-0">
        <div className="text-[10px] font-mono text-cc-500 uppercase tracking-wider">Recherche intel</div>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doSearch(undefined)}
          placeholder="Rechercher par mot-clé…"
          className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-1.5 text-[11px] font-mono text-gray-200 placeholder-cc-600 focus:outline-none focus:border-cc-500"
        />
        <div className="flex gap-2">
          <input
            type="text"
            value={province}
            onChange={e => setProvince(e.target.value.toUpperCase())}
            placeholder="Pcode (ex. CD61)"
            className="flex-1 bg-cc-800 border border-cc-700 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-gray-200 placeholder-cc-600 focus:outline-none focus:border-cc-500"
          />
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="flex-1 bg-cc-800 border border-cc-700 rounded-lg px-2 py-1.5 text-[10px] font-mono text-gray-200 focus:outline-none focus:border-cc-500"
          >
            <option value="">Toutes catégories</option>
            {Object.entries(CAT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => doSearch()}
          disabled={searching}
          className="w-full py-2 bg-red-900/70 hover:bg-red-800 border border-red-700 text-red-100 text-[11px] font-mono font-bold rounded-lg transition-colors disabled:opacity-50"
        >
          {searching ? 'Recherche…' : '🔍 Rechercher'}
        </button>

        {/* Recent searches */}
        {recentSearches.length > 0 && (
          <div>
            <div className="text-[8px] font-mono text-cc-600 uppercase tracking-wider mb-1">Recherches récentes</div>
            <div className="flex flex-wrap gap-1">
              {recentSearches.map(q => (
                <button
                  key={q}
                  onClick={() => applyRecent(q)}
                  className="px-2 py-0.5 bg-cc-800 border border-cc-700 rounded text-[9px] font-mono text-cc-400 hover:text-gray-200 hover:border-cc-500 transition-colors"
                >{q}</button>
              ))}
              <button
                onClick={() => setRecentSearches([])}
                className="px-1.5 py-0.5 text-[8px] font-mono text-cc-700 hover:text-cc-500 transition-colors"
              >effacer</button>
            </div>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {!searched && !searching && <EmptyState icon="🔍" msg="Entrez un mot-clé et lancez la recherche" />}
        {searching && <LoadingState />}
        {searched && !searching && results.length === 0 && <EmptyState icon="🔍" msg="Aucun résultat" />}
        {results.map((e: any, i: number) => <EventCard key={e.external_id ?? i} event={e} />)}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

const TABS: { key: RensTab; icon: string; label: string }[] = [
  { key: 'menaces',        icon: '🛡️', label: 'Menaces'       },
  { key: 'militaire',      icon: '🪖', label: 'Militaire'     },
  { key: 'incidents',      icon: '🚨', label: 'Incidents'     },
  { key: 'infrastructure', icon: '🏗️', label: 'Infra.'        },
  { key: 'bulletin',       icon: '📋', label: 'Bulletin'      },
  { key: 'recherche',      icon: '🔍', label: 'Recherche'     },
];

export function RenseignementPage() {
  const [tab, setTab] = useState<RensTab>('menaces');

  const { data: statusData } = useQuery({
    queryKey: ['rens-status'],
    queryFn: () => apiClient.get('/renseignement/status').then(r => r.data).catch(() => null),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const eventsStored: number = statusData?.events_stored ?? 0;
  const schedulerOk: boolean = statusData?.scheduler_running ?? false;

  return (
    <div className="flex h-full flex-col">

      {/* Page header */}
      <div className="px-4 pt-3 pb-2.5 border-b border-cc-700 bg-cc-900 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">🔎</span>
            <div>
              <div className="text-white font-bold text-sm leading-tight">Renseignement Militaire & Sécuritaire</div>
              <div className="text-cc-500 text-[10px] font-mono uppercase tracking-wider">Agent 10 — SINAUR-RDC</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {statusData && (
              <div className="flex items-center gap-2 text-[9px] font-mono">
                <span className={`w-1.5 h-1.5 rounded-full ${schedulerOk ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                <span className="text-cc-500">{eventsStored} événements intel</span>
              </div>
            )}
            <span className="text-[9px] bg-red-900/70 text-red-300 border border-red-700 px-1.5 py-0.5 rounded font-mono font-bold shrink-0">
              🔒 RESTREINT
            </span>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-cc-700 bg-cc-900 shrink-0 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[10px] font-mono whitespace-nowrap transition-colors border-b-2 shrink-0 ${
              tab === t.key
                ? 'text-red-300 border-red-600 bg-cc-800/40'
                : 'text-cc-500 border-transparent hover:text-gray-300 hover:bg-cc-800/20'
            }`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden bg-cc-950">
        {tab === 'menaces'        && <div className="h-full overflow-y-auto"><MenacesTab /></div>}
        {tab === 'militaire'      && (
          <EventListTab
            queryKey="rens-militaire"
            endpoint="/renseignement/military-activity"
            emptyMsg="Aucune activité militaire détectée"
          />
        )}
        {tab === 'incidents'      && (
          <EventListTab
            queryKey="rens-incidents"
            endpoint="/renseignement/security-incidents"
            emptyMsg="Aucun incident sécuritaire recensé"
          />
        )}
        {tab === 'infrastructure' && (
          <EventListTab
            queryKey="rens-infrastructure"
            endpoint="/renseignement/infrastructure-damage"
            emptyMsg="Aucun dommage infra. rapporté"
          />
        )}
        {tab === 'bulletin'       && <div className="h-full overflow-y-auto"><BulletinTab /></div>}
        {tab === 'recherche'      && <RechercheTab />}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-cc-700 bg-red-950/20 shrink-0">
        <div className="text-[9px] text-red-400/60 font-mono">
          Sources : ACLED · Radio Okapi · Crisis Group · MONUSCO · RFI — Usage RESTRICTED uniquement
        </div>
      </div>
    </div>
  );
}
