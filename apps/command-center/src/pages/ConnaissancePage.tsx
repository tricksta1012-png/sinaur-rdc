import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { apiClient } from '../lib/api.js';

// ── Types ────────────────────────────────────────────────────────────────────

type KbTab = 'entites' | 'graphe' | 'apprentissage';

interface Entite {
  id: number;
  type_entite: string;
  nom: string;
  noms_alternatifs: string[];
  description: string;
  niveau_confiance: number;
  statut_connaissance: 'EMERGENT' | 'A_CONFIRMER' | 'ETABLI';
  nb_mentions: number;
  derniere_mention: string;
  attributs: Record<string, unknown>;
}

interface Relation {
  id: number;
  type_relation: string;
  niveau_confiance: number;
  cible_id: number;
  cible_nom: string;
  cible_type: string;
  depuis: string | null;
}

interface Journal {
  id: number;
  type_action: string;
  detail: string;
  source: string;
  confiance_avant: number | null;
  confiance_apres: number | null;
  date_appris: string;
  entite_nom: string | null;
}

interface GrapheNode {
  id: number;
  type_entite: string;
  nom: string;
  niveau_confiance: number;
  statut_connaissance: string;
  nb_mentions: number;
}

interface GrapheLink {
  source_id: number;
  cible_id: number;
  type_relation: string;
  niveau_confiance: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<string, string> = {
  GROUPE_ARME: 'text-red-400',
  PERSONNE:    'text-yellow-400',
  LIEU:        'text-blue-400',
  EVENEMENT:   'text-orange-400',
  EPIDEMIE:    'text-purple-400',
  AUTRE:       'text-slate-400',
};

const TYPE_BG: Record<string, string> = {
  GROUPE_ARME: 'bg-red-900/30 border-red-800',
  PERSONNE:    'bg-yellow-900/30 border-yellow-800',
  LIEU:        'bg-blue-900/30 border-blue-800',
  EVENEMENT:   'bg-orange-900/30 border-orange-800',
  EPIDEMIE:    'bg-purple-900/30 border-purple-800',
  AUTRE:       'bg-slate-900/30 border-slate-700',
};

const TYPE_LABEL: Record<string, string> = {
  GROUPE_ARME: 'Groupe armé',
  PERSONNE:    'Personne',
  LIEU:        'Lieu',
  EVENEMENT:   'Événement',
  EPIDEMIE:    'Épidémie',
  AUTRE:       'Autre',
};

const STATUT_COLOR: Record<string, string> = {
  EMERGENT:    'text-yellow-400',
  A_CONFIRMER: 'text-orange-400',
  ETABLI:      'text-green-400',
};

const STATUT_LABEL: Record<string, string> = {
  EMERGENT:    'Émergent',
  A_CONFIRMER: 'À confirmer',
  ETABLI:      'Établi',
};

const ACTION_COLOR: Record<string, string> = {
  DECOUVERTE:    'text-blue-400',
  ENRICHISSEMENT:'text-yellow-400',
  RELATION:      'text-purple-400',
  CONFIRMATION:  'text-green-400',
  CORRECTION:    'text-orange-400',
};

const REL_LABEL: Record<string, string> = {
  OPERE_DANS:    'opère dans',
  DIRIGE:        'dirige',
  AFFRONTE:      'affronte',
  FACTION_DE:    'faction de',
  LIE_A:         'lié à',
  IMPLIQUE_DANS: 'impliqué dans',
  ALLIE_DE:      'allié de',
  RIVAL_DE:      'rival de',
  SUCCEDE_A:     'succède à',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function confBar(conf: number) {
  const pct = Math.round(conf * 100);
  const color = conf >= 0.85 ? 'bg-green-500' : conf >= 0.65 ? 'bg-yellow-500' : conf >= 0.45 ? 'bg-orange-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-400 w-8 text-right">{pct}%</span>
    </div>
  );
}

// ── Composants ───────────────────────────────────────────────────────────────

function EntiteCard({ ent, onClick }: { ent: Entite; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border ${TYPE_BG[ent.type_entite] || TYPE_BG.AUTRE} hover:opacity-90 transition-opacity`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-medium ${TYPE_COLOR[ent.type_entite] || 'text-slate-400'}`}>
              {TYPE_LABEL[ent.type_entite] || ent.type_entite}
            </span>
            <span className={`text-xs ${STATUT_COLOR[ent.statut_connaissance]}`}>
              {STATUT_LABEL[ent.statut_connaissance]}
            </span>
          </div>
          <div className="font-semibold text-white mt-0.5 truncate">{ent.nom}</div>
          {ent.description && (
            <p className="text-xs text-slate-400 mt-1 line-clamp-2">{ent.description}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-slate-500">{ent.nb_mentions} mention{ent.nb_mentions > 1 ? 's' : ''}</div>
        </div>
      </div>
      {confBar(ent.niveau_confiance)}
    </button>
  );
}

function FicheEntite({ entiteId, onClose }: { entiteId: number; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['kb-entite', entiteId],
    queryFn: () => apiClient.get<{ entite: Entite; relations: Relation[]; journal: Journal[] }>(
      `/connaissance/entites/${entiteId}`
    ).then(r => r.data),
    staleTime: 60_000,
  });

  if (isLoading) return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-xl p-8 text-slate-400">Chargement…</div>
    </div>
  );

  const ent = data?.entite;
  if (!ent) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`p-4 border-b border-slate-700 ${TYPE_BG[ent.type_entite] || ''}`}>
          <div className="flex items-start justify-between">
            <div>
              <span className={`text-xs font-medium ${TYPE_COLOR[ent.type_entite]}`}>
                {TYPE_LABEL[ent.type_entite]}
              </span>
              <h2 className="text-xl font-bold text-white mt-0.5">{ent.nom}</h2>
              {ent.noms_alternatifs?.length > 0 && (
                <p className="text-xs text-slate-400 mt-0.5">
                  Alias : {ent.noms_alternatifs.join(', ')}
                </p>
              )}
            </div>
            <div className="text-right">
              <span className={`text-sm font-semibold ${STATUT_COLOR[ent.statut_connaissance]}`}>
                {STATUT_LABEL[ent.statut_connaissance]}
              </span>
              <div className="text-xs text-slate-500 mt-0.5">{ent.nb_mentions} mentions</div>
            </div>
          </div>
          {confBar(ent.niveau_confiance)}
        </div>

        <div className="p-4 space-y-4">
          {/* Description */}
          {ent.description && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Description</h4>
              <p className="text-sm text-slate-300">{ent.description}</p>
            </div>
          )}

          {/* Attributs */}
          {ent.attributs && Object.keys(ent.attributs).length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Attributs</h4>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(ent.attributs).map(([k, v]) => (
                  <div key={k} className="bg-slate-800 rounded p-2">
                    <div className="text-xs text-slate-500">{k}</div>
                    <div className="text-xs text-white mt-0.5">
                      {Array.isArray(v) ? v.join(', ') : String(v)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Relations */}
          {data?.relations && data.relations.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Liens connus ({data.relations.length})
              </h4>
              <div className="space-y-1.5">
                {data.relations.map(r => (
                  <div key={r.id} className="flex items-center gap-2 text-sm bg-slate-800 rounded p-2">
                    <span className="text-slate-400 text-xs">{REL_LABEL[r.type_relation] || r.type_relation}</span>
                    <span className="text-white font-medium">{r.cible_nom}</span>
                    <span className={`text-xs ml-auto ${TYPE_COLOR[r.cible_type]}`}>{TYPE_LABEL[r.cible_type]}</span>
                    <span className="text-xs text-slate-500">{Math.round(r.niveau_confiance * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Journal */}
          {data?.journal && data.journal.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Ce que SINAUR a appris
              </h4>
              <div className="space-y-1.5">
                {data.journal.map(j => (
                  <div key={j.id} className="bg-slate-800 rounded p-2 text-xs">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`font-semibold ${ACTION_COLOR[j.type_action]}`}>{j.type_action}</span>
                      <span className="text-slate-500">
                        {formatDistanceToNow(new Date(j.date_appris), { addSuffix: true, locale: fr })}
                      </span>
                      {j.source && <span className="text-slate-600 ml-auto">via {j.source}</span>}
                    </div>
                    <p className="text-slate-300">{j.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-700 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors">
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

function GrapheViz({ nodes, links }: { nodes: GrapheNode[]; links: GrapheLink[] }) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const grouped: Record<string, GrapheNode[]> = {};
  for (const n of nodes) {
    (grouped[n.type_entite] ||= []).push(n);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap text-xs">
        {Object.entries(TYPE_COLOR).map(([t, cls]) => (
          <div key={t} className="flex items-center gap-1">
            <div className={`w-2.5 h-2.5 rounded-full ${cls.replace('text-', 'bg-')}`} />
            <span className="text-slate-400">{TYPE_LABEL[t]}</span>
          </div>
        ))}
      </div>

      {/* Groupes d'entités par type */}
      {Object.entries(grouped).map(([type, ents]) => (
        <div key={type}>
          <h4 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${TYPE_COLOR[type]}`}>
            {TYPE_LABEL[type]} ({ents.length})
          </h4>
          <div className="flex flex-wrap gap-2">
            {ents.map(n => (
              <div
                key={n.id}
                className={`px-2 py-1 rounded text-xs border ${TYPE_BG[n.type_entite]}`}
                style={{ fontSize: `${0.65 + n.niveau_confiance * 0.35}rem` }}
                title={`${n.nom} — confiance ${Math.round(n.niveau_confiance * 100)}%`}
              >
                {n.nom}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Liste des liens */}
      {links.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Relations ({links.length})
          </h4>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {links.map((l, i) => {
              const src = nodeById.get(l.source_id);
              const cib = nodeById.get(l.cible_id);
              if (!src || !cib) return null;
              return (
                <div key={i} className="flex items-center gap-2 text-xs bg-slate-800/50 rounded px-2 py-1">
                  <span className={`font-medium ${TYPE_COLOR[src.type_entite]}`}>{src.nom}</span>
                  <span className="text-slate-500">—{REL_LABEL[l.type_relation] || l.type_relation}→</span>
                  <span className={`font-medium ${TYPE_COLOR[cib.type_entite]}`}>{cib.nom}</span>
                  <span className="text-slate-600 ml-auto">{Math.round(l.niveau_confiance * 100)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export function ConnaissancePage() {
  const [tab, setTab] = useState<KbTab>('entites');
  const [typeFilter, setTypeFilter] = useState('');
  const [statutFilter, setstatutFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: status } = useQuery({
    queryKey: ['kb-status'],
    queryFn: () => apiClient.get<Record<string, unknown>>('/connaissance/status').then(r => r.data),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const { data: entitesData, isLoading: loadingEntites } = useQuery({
    queryKey: ['kb-entites', typeFilter, statutFilter, search],
    queryFn: () => {
      const params: Record<string, string> = { limit: '100' };
      if (typeFilter) params.type_entite = typeFilter;
      if (statutFilter) params.statut = statutFilter;
      if (search) params.q = search;
      return apiClient.get<{ data: Entite[]; total: number }>('/connaissance/entites', { params }).then(r => r.data);
    },
    staleTime: 60_000,
    enabled: tab === 'entites',
  });

  const { data: grapheData, isLoading: loadingGraphe } = useQuery({
    queryKey: ['kb-graphe'],
    queryFn: () => apiClient.get<{ nodes: GrapheNode[]; links: GrapheLink[] }>('/connaissance/graphe').then(r => r.data),
    staleTime: 120_000,
    enabled: tab === 'graphe',
  });

  const { data: apprentissageData, isLoading: loadingApprentissage } = useQuery({
    queryKey: ['kb-apprentissage'],
    queryFn: () => apiClient.get<{ data: Journal[] }>('/connaissance/apprentissage', { params: { limit: '100' } }).then(r => r.data),
    staleTime: 60_000,
    enabled: tab === 'apprentissage',
  });

  const entites = entitesData?.data ?? [];
  const total = entitesData?.total ?? 0;

  const TABS: { id: KbTab; label: string }[] = [
    { id: 'entites',       label: `Entités${total ? ` (${total})` : ''}` },
    { id: 'graphe',        label: 'Graphe' },
    { id: 'apprentissage', label: 'Journal' },
  ];

  return (
    <div className="p-4 space-y-4 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Connaissance évolutive</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Graphe de connaissance SINAUR-RDC — entités découvertes et enrichies en continu
          </p>
        </div>
        {status && (
          <div className="flex gap-3 text-xs">
            <div className="bg-slate-800 rounded-lg px-3 py-1.5 text-center">
              <div className="text-blue-400 font-semibold">{Number(status.total_decouvertes ?? 0)}</div>
              <div className="text-slate-500">Découvertes</div>
            </div>
            <div className="bg-slate-800 rounded-lg px-3 py-1.5 text-center">
              <div className="text-yellow-400 font-semibold">{Number(status.total_enrichissements ?? 0)}</div>
              <div className="text-slate-500">Enrichissements</div>
            </div>
            <div className="bg-slate-800 rounded-lg px-3 py-1.5 text-center">
              <div className="text-green-400 font-semibold">{Number(status.runs_total ?? 0)}</div>
              <div className="text-slate-500">Cycles</div>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-700 pb-0">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm rounded-t-lg transition-colors ${
              tab === t.id
                ? 'bg-slate-800 text-white border-b-2 border-blue-500'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Onglet Entités */}
      {tab === 'entites' && (
        <div className="space-y-3">
          {/* Filtres */}
          <div className="flex gap-2 flex-wrap">
            <input
              type="text"
              placeholder="Rechercher une entité…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 flex-1 min-w-48"
            />
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">Tous types</option>
              {Object.entries(TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <select
              value={statutFilter}
              onChange={e => setStatutFilter(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">Tous statuts</option>
              <option value="EMERGENT">Émergent</option>
              <option value="A_CONFIRMER">À confirmer</option>
              <option value="ETABLI">Établi</option>
            </select>
          </div>

          {loadingEntites ? (
            <div className="text-center text-slate-400 py-12">Chargement…</div>
          ) : entites.length === 0 ? (
            <div className="text-center text-slate-500 py-12">Aucune entité trouvée</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {entites.map(ent => (
                <EntiteCard key={ent.id} ent={ent} onClick={() => setSelectedId(ent.id)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Onglet Graphe */}
      {tab === 'graphe' && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          {loadingGraphe ? (
            <div className="text-center text-slate-400 py-12">Chargement du graphe…</div>
          ) : grapheData ? (
            <GrapheViz nodes={grapheData.nodes} links={grapheData.links} />
          ) : (
            <div className="text-center text-slate-500 py-12">Graphe indisponible</div>
          )}
        </div>
      )}

      {/* Onglet Journal */}
      {tab === 'apprentissage' && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">
            Chaque ligne représente une découverte ou un enrichissement réalisé par les agents IA.
          </p>
          {loadingApprentissage ? (
            <div className="text-center text-slate-400 py-12">Chargement…</div>
          ) : (
            <div className="space-y-1.5">
              {(apprentissageData?.data ?? []).map(j => (
                <div key={j.id} className="bg-slate-800 rounded-lg p-3 text-sm">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`font-semibold text-xs ${ACTION_COLOR[j.type_action]}`}>
                      {j.type_action}
                    </span>
                    {j.entite_nom && (
                      <span className="text-white font-medium">{j.entite_nom}</span>
                    )}
                    <span className="text-slate-500 text-xs ml-auto">
                      {formatDistanceToNow(new Date(j.date_appris), { addSuffix: true, locale: fr })}
                    </span>
                  </div>
                  <p className="text-slate-300 text-xs">{j.detail}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-600">
                    {j.source && <span>via {j.source}</span>}
                    {j.confiance_avant != null && j.confiance_apres != null && (
                      <span>{Math.round(j.confiance_avant * 100)}% → {Math.round(j.confiance_apres * 100)}%</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Fiche détail */}
      {selectedId !== null && (
        <FicheEntite entiteId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
