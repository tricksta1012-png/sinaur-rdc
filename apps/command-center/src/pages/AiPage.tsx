import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../lib/api.js';

type Tab = 'status' | 'predictions' | 'veille' | 'renseignements' | 'antifraud' | 'stocks' | 'signalements' | 'epidemie' | 'logistique' | 'reporting' | 'sources';

// ── Risk ─────────────────────────────────────────────────────────────────────

const LEVEL_BADGE: Record<string, { cls: string; label: string }> = {
  CRITIQUE: { cls: 'bg-red-900 text-white border border-red-700',    label: 'CRITIQUE' },
  ELEVE:    { cls: 'bg-red-700 text-white border border-red-600',    label: 'ÉLEVÉ'    },
  MODERE:   { cls: 'bg-yellow-700 text-black border border-yellow-600', label: 'MODÉRÉ' },
  FAIBLE:   { cls: 'bg-green-800 text-green-200 border border-green-700', label: 'FAIBLE' },
};

const RISK_TYPE_ICON: Record<string, string> = {
  FLOOD: '🌊', LANDSLIDE: '⛰️', DISPLACEMENT: '🏃', EPIDEMIC: '🦠',
};
const RISK_TYPE_FR: Record<string, string> = {
  FLOOD: 'Inondation', LANDSLIDE: 'Glissement de terrain', DISPLACEMENT: 'Déplacement', EPIDEMIC: 'Épidémie',
};

const ACTION_RECOMMENDATIONS: Record<string, Record<string, string[]>> = {
  FLOOD: {
    CRITIQUE: ['Évacuation immédiate des zones inondables', 'Pré-positionnement des équipes de secours', 'Alerte immédiate des populations riveraines', 'Coordination avec les autorités locales et la protection civile'],
    ELEVE:    ['Surveillance accrue des niveaux des cours d\'eau', 'Pré-alerte des populations en zones à risque', 'Vérification des digues, barrages et drains'],
    MODERE:   ['Suivi météorologique renforcé', 'Inventaire des ressources d\'urgence disponibles', 'Sensibilisation communautaire préventive'],
    FAIBLE:   ['Veille hydrologique continue', 'Mise à jour des plans de contingence inondation'],
  },
  LANDSLIDE: {
    CRITIQUE: ['Évacuation d\'urgence des zones instables', 'Fermeture des routes et axes dangereux', 'Déploiement des équipes de recherche et sauvetage'],
    ELEVE:    ['Surveillance géotechnique renforcée', 'Alerte des populations vivant sur les pentes instables'],
    MODERE:   ['Inspection des terrains et talus à risque', 'Sensibilisation aux signes précurseurs de glissement'],
    FAIBLE:   ['Cartographie des zones à risque', 'Suivi des précipitations cumulées'],
  },
  DISPLACEMENT: {
    CRITIQUE: ['Ouverture de sites d\'accueil d\'urgence', 'Distribution de kits non-alimentaires (NFI)', 'Coordination immédiate avec UNHCR/IOM/UNICEF', 'Enregistrement et protection des personnes déplacées'],
    ELEVE:    ['Préparation des capacités d\'accueil', 'Mobilisation des partenaires humanitaires', 'Monitoring des flux de déplacement'],
    MODERE:   ['Évaluation des besoins humanitaires potentiels', 'Pré-positionnement des stocks humanitaires'],
    FAIBLE:   ['Analyse des facteurs de déplacement', 'Renforcement des mécanismes d\'alerte précoce communautaires'],
  },
  EPIDEMIC: {
    CRITIQUE: ['Déploiement immédiat des équipes de Réponse Rapide', 'Mise en place des mesures de quarantaine', 'Activation du centre de crise santé', 'Notification OMS, UNICEF et MSF'],
    ELEVE:    ['Renforcement de la surveillance épidémiologique', 'Pré-positionnement des stocks médicaux d\'urgence', 'Formation des équipes de santé communautaire'],
    MODERE:   ['Investigation des cas suspects', 'Campagne de sensibilisation à l\'hygiène et à la prévention'],
    FAIBLE:   ['Surveillance renforcée des signaux sanitaires', 'Vérification et maintien des stocks de vaccins'],
  },
};

// ── Hazard helpers (shared across tabs) ─────────────────────────────────────

const HAZARD_ICONS: Record<string, string> = {
  flood: '🌊', landslide: '⛰️', mass_displacement: '🏃', humanitarian_crisis: '🆘',
  health_epidemic: '🦠', volcanic_eruption: '🌋', drought: '☀️', fire: '🔥',
  conflict: '⚔️', earthquake: '📳', other: '⚠️',
};
const SOURCE_LABELS: Record<string, string> = {
  reliefweb: 'ReliefWeb', fews_net: 'FEWS NET', gdacs: 'GDACS',
  open_meteo: 'Open-Meteo', mettelsat: 'METTELSAT',
};
const CONNECTOR_STATUS: Record<string, string> = {
  ok: 'bg-green-500', degraded: 'bg-yellow-400', down: 'bg-red-500', no_data: 'bg-gray-500',
};

// ── Intelligence categories for "Renseignements" tab ─────────────────────────

const INTEL_CATEGORIES: { key: string; label: string; icon: string; hazards: string[] }[] = [
  { key: 'military',     label: 'Activité militaire',         icon: '⚔️',  hazards: ['conflict'] },
  { key: 'displacement', label: 'Déplacements de population', icon: '🏃',  hazards: ['mass_displacement'] },
  { key: 'security',     label: 'Incidents sécuritaires',     icon: '🔒',  hazards: ['conflict', 'other'] },
  { key: 'infra',        label: 'Dommages infrastructures',   icon: '🏗️',  hazards: ['earthquake', 'volcanic_eruption', 'fire'] },
  { key: 'humanitarian', label: 'Besoins humanitaires',       icon: '🆘',  hazards: ['humanitarian_crisis', 'drought'] },
  { key: 'environment',  label: 'Risques environnementaux',   icon: '🌍',  hazards: ['flood', 'landslide', 'health_epidemic'] },
];

function getCategoryForEvent(e: any): string {
  const h = e.hazard_type ?? '';
  for (const cat of INTEL_CATEGORIES) {
    if (cat.hazards.includes(h)) return cat.key;
  }
  return 'environment';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FactorBar({ name, contribution, direction }: { name: string; contribution: number; direction: string }) {
  const pct = Math.min(100, Math.abs(contribution) * 100);
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className={`w-3 shrink-0 font-bold ${direction === '+' ? 'text-red-400' : 'text-green-400'}`}>{direction}</span>
      <span className="text-cc-400 w-28 shrink-0 truncate" title={name}>{name}</span>
      <div className="flex-1 h-1.5 bg-cc-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${direction === '+' ? 'bg-red-500' : 'bg-green-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`w-8 text-right font-mono ${direction === '+' ? 'text-red-300' : 'text-green-300'}`}>
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

function RiskDetailPanel({ risk, onClose }: { risk: any; onClose: () => void }) {
  const level = risk.level ?? 'FAIBLE';
  const badge = LEVEL_BADGE[level] ?? LEVEL_BADGE.FAIBLE;
  const actions = ACTION_RECOMMENDATIONS[risk.risk_type]?.[level] ?? [];
  const factors: any[] = risk.factors ?? [];
  const confidence = risk.confidence ?? null;

  return (
    <div className="mt-3 bg-cc-800 rounded-xl border border-cc-600 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">{RISK_TYPE_ICON[risk.risk_type] ?? '⚠️'}</span>
            <span className="font-bold text-white text-sm">{risk.province ?? risk.p_code}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
          </div>
          <div className="text-[10px] text-cc-500 font-mono">
            {RISK_TYPE_FR[risk.risk_type] ?? risk.risk_type} · Horizon {risk.horizon_days}j · v{risk.model_version ?? '?'}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-3xl font-bold text-white">{Math.round(risk.score)}</div>
          <div className="text-[10px] text-cc-500 font-mono">/100</div>
        </div>
      </div>

      {/* Confidence */}
      {confidence !== null && (
        <div>
          <div className="text-[10px] font-mono text-cc-500 uppercase mb-1.5">Niveau de confiance</div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-cc-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${confidence >= 0.7 ? 'bg-green-500' : confidence >= 0.5 ? 'bg-yellow-500' : 'bg-red-500'}`}
                style={{ width: `${Math.round(confidence * 100)}%` }}
              />
            </div>
            <span className={`text-sm font-bold ${confidence >= 0.7 ? 'text-green-400' : confidence >= 0.5 ? 'text-yellow-400' : 'text-red-400'}`}>
              {Math.round(confidence * 100)}%
            </span>
          </div>
          <div className="text-[9px] text-cc-600 font-mono mt-0.5">
            {confidence >= 0.7 ? 'Confiance élevée — données suffisantes' :
             confidence >= 0.5 ? 'Confiance modérée — données partielles' :
             'Confiance faible — données insuffisantes, résultat indicatif'}
          </div>
        </div>
      )}

      {/* Contributing factors */}
      {factors.length > 0 && (
        <div>
          <div className="text-[10px] font-mono text-cc-500 uppercase mb-2">Facteurs contributifs</div>
          <div className="space-y-1.5">
            {factors
              .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
              .slice(0, 8)
              .map((f, i) => (
                <FactorBar key={i} name={f.name} contribution={f.contribution} direction={f.direction ?? (f.contribution >= 0 ? '+' : '-')} />
              ))
            }
          </div>
          {factors.length === 0 && (
            <div className="text-[10px] text-cc-600 italic">Aucun facteur détaillé disponible pour ce calcul</div>
          )}
        </div>
      )}

      {/* Action recommendations */}
      {actions.length > 0 && (
        <div>
          <div className="text-[10px] font-mono text-cc-500 uppercase mb-2">Actions recommandées</div>
          <div className="space-y-1">
            {actions.map((a, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px] text-gray-300">
                <span className="text-sinaur-500 shrink-0 font-bold mt-px">{i + 1}.</span>
                <span>{a}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[9px] text-cc-600 italic border-t border-cc-700 pt-1.5">
            ⚠ Ces recommandations sont générées automatiquement par l'IA. Toute décision opérationnelle requiert validation humaine.
          </div>
        </div>
      )}

      <button
        onClick={onClose}
        className="w-full text-center text-[10px] font-mono text-cc-500 hover:text-gray-300 transition-colors pt-1"
      >
        ▲ Fermer le détail
      </button>
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

const RISK_TYPE_FILTER: { key: string; label: string; icon: string }[] = [
  { key: 'ALL',          label: 'Tous',              icon: '🌐' },
  { key: 'FLOOD',        label: 'Inondation',        icon: '🌊' },
  { key: 'LANDSLIDE',    label: 'Glissement',        icon: '⛰️' },
  { key: 'DISPLACEMENT', label: 'Déplacement',       icon: '🏃' },
  { key: 'EPIDEMIC',     label: 'Épidémie',          icon: '🦠' },
];

// ── Domain config for PredictionsTab ─────────────────────────────────────────

const DOMAIN_CONFIG: {
  key: string;
  icon: string;
  label: string;
  borderActive: string;
  borderCard: string;
}[] = [
  { key: 'FLOOD',        icon: '🌊', label: 'Inondations',  borderActive: 'border-blue-500',   borderCard: 'border-blue-700'   },
  { key: 'DISPLACEMENT', icon: '🏃', label: 'Déplacements', borderActive: 'border-orange-500', borderCard: 'border-orange-700' },
  { key: 'EPIDEMIC',     icon: '🦠', label: 'Épidémies',    borderActive: 'border-red-500',    borderCard: 'border-red-700'    },
  { key: 'LANDSLIDE',    icon: '⛰️', label: 'Glissements',  borderActive: 'border-yellow-500', borderCard: 'border-yellow-700' },
];

const DOMAIN_CONTEXT: Record<string, { lines: string[] }> = {
  FLOOD: {
    lines: [
      '🌊 Saison des pluies : mars–mai / sept–déc (pic actuel)',
      '📍 Zones à risque chronique : Équateur, Kasaï-Central, Tanganyika, Maniema',
      '⚡ Seuil critique : cumul ≥ 200mm/semaine ou niveau rivière +2m au-dessus cote alerte',
      '🏠 Population exposée zones inondables : ~4.2M personnes (OCHA 2025)',
    ],
  },
  DISPLACEMENT: {
    lines: [
      '🏃 6.9M PDI en RDC — 1ère crise de déplacement en Afrique (UNHCR juin 2026)',
      '📈 Tendance : +340 000 nouveaux déplacés depuis janvier 2026',
      '⚔️ Facteurs principaux : M23/AFC (Kivu), ADF (Ituri/Nord-Kivu), CODECO (Ituri)',
      '🏕️ Sites saturés : Bunia, Goma, Beni — capacité accueil dépassée de 40%',
    ],
  },
  EPIDEMIC: {
    lines: [
      '🚨 USPPI active : Ebola Bundibugyo (OMS, 17 mai 2026) — 515 cas, 91 décès',
      '🦠 Co-épidémies actives : Choléra (4 820 cas), Mpox (1 240 cas), Rougeole (12 400 cas)',
      '⚠️ Risque émergent : Virus Marburg (frontière Ouganda), Hantavirus Andes (import)',
      '🏥 Réseau santé : 68% des zones de santé actives sous pression',
    ],
  },
  LANDSLIDE: {
    lines: [
      '⛰️ Zones à relief escarpé à risque : Nord-Kivu, Sud-Kivu, Ituri, Maniema',
      '🌧️ Déclencheur principal : pluies cumulées > 200mm/semaine + sols saturés',
      '🏘️ Exposition : 1.8M personnes en zones de pente > 30° (RMSI 2024)',
      '📅 Saison critique : avril–juin / octobre–novembre (convergence pluies + déjà saturé)',
    ],
  },
};

const DOMAIN_INDICATORS: Record<string, string[]> = {
  FLOOD:        ['Intensité pluies', 'Population exposée', 'Infrastructures à risque', 'Capacité évacuation'],
  DISPLACEMENT: ['Intensité conflit', 'Flux sortants', 'Capacité accueil', 'Stocks NFI'],
  EPIDEMIC:     ['Taux d\'attaque', 'Rayon diffusion', 'Couverture vaccin', 'Accès équipes santé'],
  LANDSLIDE:    ['Saturation sol', 'Pente moy.', 'Couvert végétal', 'Densité population'],
};

function levelScoreColor(level: string): string {
  if (level === 'CRITIQUE') return 'bg-red-500';
  if (level === 'ELEVE')    return 'bg-orange-400';
  if (level === 'MODERE')   return 'bg-yellow-500';
  return 'bg-green-500';
}

function levelCardBorder(level: string): string {
  if (level === 'CRITIQUE') return 'border-red-700 bg-red-950/20';
  if (level === 'ELEVE')    return 'border-orange-700 bg-orange-950/10';
  if (level === 'MODERE')   return 'border-yellow-700 bg-yellow-950/10';
  return 'border-cc-700 bg-cc-800';
}

function getHighestLevel(risks: any[]): string {
  const order = ['CRITIQUE', 'ELEVE', 'MODERE', 'FAIBLE'];
  for (const lvl of order) {
    if (risks.some(r => r.level === lvl)) return lvl;
  }
  return '—';
}

function ProvinceCard({ r, expanded, onToggle }: { r: any; expanded: boolean; onToggle: () => void }) {
  const level = r.level ?? 'FAIBLE';
  const badge = LEVEL_BADGE[level] ?? LEVEL_BADGE.FAIBLE;
  const score = Math.round(r.score ?? 0);
  const confidence = r.confidence ?? null;
  const factors: { name: string; contribution: number; direction: string }[] = r.factors ?? [];
  const actions: string[] = (ACTION_RECOMMENDATIONS[r.risk_type]?.[level] ?? []).slice(0, 4);
  const indicators: string[] = DOMAIN_INDICATORS[r.risk_type] ?? [];

  return (
    <div
      className={`rounded-xl border transition-colors cursor-pointer ${levelCardBorder(level)}`}
      onClick={onToggle}
    >
      {/* Collapsed header — always visible */}
      <div className="px-3 py-2.5 flex items-center gap-3">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${badge.cls}`}>
          {badge.label}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold text-white truncate">{r.province ?? r.p_code}</div>
          <div className="text-[10px] text-cc-500 font-mono">{r.p_code} · Horizon {r.horizon_days}j</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:flex items-center gap-1.5">
            <div className="w-16 h-1.5 bg-cc-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${levelScoreColor(level)}`}
                style={{ width: `${score}%` }}
              />
            </div>
          </div>
          <span className="text-white font-bold font-mono text-sm">{score}</span>
          <span className="text-cc-600 text-[10px] font-mono">/100</span>
        </div>
        {confidence !== null && (
          <div className="hidden sm:block text-[10px] text-cc-400 font-mono shrink-0 w-10 text-right">
            {Math.round(confidence * 100)}%
          </div>
        )}
        <span className="text-cc-600 text-[10px] shrink-0">{expanded ? '▲' : '▼'}</span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div
          className="px-3 pb-3 space-y-3 border-t border-cc-700/40 pt-3"
          onClick={e => e.stopPropagation()}
        >
          {/* Score bar large */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-mono text-cc-500 uppercase">Score de risque</span>
              <span className="text-xs font-bold font-mono text-white">{score}/100</span>
            </div>
            <div className="h-2 bg-cc-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${levelScoreColor(level)}`}
                style={{ width: `${score}%` }}
              />
            </div>
          </div>

          {/* Confidence gauge */}
          {confidence !== null && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-mono text-cc-500 uppercase">Niveau de confiance</span>
                <span className={`text-[10px] font-bold font-mono ${confidence >= 0.7 ? 'text-green-400' : confidence >= 0.5 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {Math.round(confidence * 100)}%
                </span>
              </div>
              <div className="h-1.5 bg-cc-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${confidence >= 0.7 ? 'bg-green-500' : confidence >= 0.5 ? 'bg-yellow-500' : 'bg-red-500'}`}
                  style={{ width: `${Math.round(confidence * 100)}%` }}
                />
              </div>
              <div className="text-[9px] text-cc-600 font-mono mt-0.5">
                {confidence >= 0.7 ? 'Confiance élevée — données suffisantes' :
                 confidence >= 0.5 ? 'Confiance modérée — données partielles' :
                 'Confiance faible — données insuffisantes, résultat indicatif'}
              </div>
            </div>
          )}

          {/* Factors */}
          {factors.length > 0 && (
            <div>
              <div className="text-[10px] font-mono text-cc-500 uppercase mb-1.5">Facteurs contributifs</div>
              <div className="space-y-1.5">
                {[...factors]
                  .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
                  .slice(0, 5)
                  .map((f, i) => (
                    <FactorBar
                      key={i}
                      name={f.name}
                      contribution={f.contribution}
                      direction={f.direction ?? (f.contribution >= 0 ? '+' : '-')}
                    />
                  ))
                }
              </div>
            </div>
          )}

          {/* Domain-specific indicators */}
          {indicators.length > 0 && (
            <div>
              <div className="text-[10px] font-mono text-cc-500 uppercase mb-1.5">Indicateurs domaine</div>
              <div className="flex flex-wrap gap-1.5">
                {indicators.map((ind, i) => {
                  const matchingFactor = factors.find(f =>
                    f.name.toLowerCase().includes(ind.toLowerCase().split(' ')[0].toLowerCase())
                  );
                  const val = matchingFactor
                    ? `${(Math.abs(matchingFactor.contribution) * 100).toFixed(0)}%`
                    : '—';
                  return (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 text-[9px] font-mono bg-cc-700 text-cc-300 border border-cc-600 px-2 py-1 rounded-lg"
                    >
                      <span className="text-cc-500">{ind}</span>
                      <span className="text-white font-bold">{val}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Actions recommandées */}
          {actions.length > 0 && (
            <div>
              <div className="text-[10px] font-mono text-cc-500 uppercase mb-1.5">Actions recommandées</div>
              <div className="space-y-1">
                {actions.map((a, i) => (
                  <div key={i} className="flex items-start gap-2 text-[10px] text-gray-300">
                    <span className="text-sinaur-500 shrink-0 font-bold mt-px">{i + 1}.</span>
                    <span>{a}</span>
                  </div>
                ))}
              </div>
              <div className="mt-1.5 text-[9px] text-cc-600 italic border-t border-cc-700/50 pt-1.5">
                ⚠ Ces recommandations sont générées automatiquement par l'IA. Toute décision opérationnelle requiert validation humaine.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PredictionsTab() {
  // ── All hooks at the top (Rules of Hooks) ──
  const [horizon, setHorizon] = useState<7 | 30 | 90>(7);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  // null = auto (derive from data); string = user manually picked
  const [userDomain, setUserDomain] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['ai-risks', horizon],
    queryFn: () => apiClient.get(`/predictions/risks?horizon=${horizon}`).then(r => r.data),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: viewsData } = useQuery({
    queryKey: ['conflit-previsions-views'],
    queryFn: () => apiClient.get('/conflit/previsions?horizon=3').then(r => r.data),
    staleTime: 60 * 60_000,
    refetchInterval: 60 * 60_000,
  });
  const viewsPrevisions: any[] = viewsData?.previsions ?? [];

  const refresh = useMutation({
    mutationFn: () => apiClient.post('/predictions/refresh').then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ai-risks'] }); },
  });

  const alertsQuery = useQuery({
    queryKey: ['ai-alerts-pending'],
    queryFn: () => apiClient.get('/predictions/alerts/pending').then(r => r.data),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const pendingAlerts: any[] = Array.isArray(alertsQuery.data) ? alertsQuery.data : [];

  const allRisks: any[] = data?.data ?? (Array.isArray(data) ? data : []);
  const critical = allRisks.filter(r => r.level === 'CRITIQUE');
  const high     = allRisks.filter(r => r.level === 'ELEVE');

  // Derive best domain from data (most CRITIQUE, fallback DISPLACEMENT)
  const autoDomain: string = allRisks.length > 0
    ? DOMAIN_CONFIG.reduce((bestKey, d) => {
        const cnt     = allRisks.filter(r => r.risk_type === d.key     && r.level === 'CRITIQUE').length;
        const bestCnt = allRisks.filter(r => r.risk_type === bestKey   && r.level === 'CRITIQUE').length;
        return cnt > bestCnt ? d.key : bestKey;
      }, 'DISPLACEMENT')
    : 'DISPLACEMENT';

  const selectedDomain = userDomain ?? autoDomain;

  const domainRisks = allRisks
    .filter(r => r.risk_type === selectedDomain)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 15);

  return (
    <div className="space-y-4">
      {/* ── 1. KPI row ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'CRITIQUE', value: critical.length, cls: 'bg-red-950 border border-red-800' },
          { label: 'ÉLEVÉ',    value: high.length,     cls: 'bg-red-900/50 border border-red-800' },
          { label: 'TOTAL',    value: allRisks.length, cls: 'bg-cc-800 border border-cc-600' },
        ].map(k => (
          <div key={k.label} className={`rounded-lg p-3 ${k.cls}`}>
            <div className="text-[10px] font-mono text-gray-400 mb-1">{k.label}</div>
            <div className="text-2xl font-bold text-white">{k.value}</div>
          </div>
        ))}
      </div>

      {/* ── 2. Pending CAP alerts banner ── */}
      {pendingAlerts.length > 0 && (
        <div className="bg-red-950/40 border border-red-800 rounded-lg p-3">
          <div className="text-[10px] font-mono text-red-400 uppercase mb-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
            {pendingAlerts.length} alerte{pendingAlerts.length > 1 ? 's' : ''} CAP en attente de validation
          </div>
          <div className="space-y-1">
            {pendingAlerts.slice(0, 3).map((a: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-[11px] text-gray-300">
                <span className="text-red-400 font-mono shrink-0">{a.risk_level}</span>
                <span className="truncate">{a.province ?? a.p_code}</span>
                <span className="text-cc-500 shrink-0">{a.risk_type}</span>
                <span className="text-white font-bold shrink-0">{Math.round(a.score ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 3. Horizon selector + refresh ── */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1 bg-cc-800 rounded-lg p-1">
          {([7, 30, 90] as const).map(h => (
            <button
              key={h}
              onClick={() => { setHorizon(h); setExpandedCard(null); }}
              className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
                horizon === h ? 'bg-sinaur-700 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {h}J
            </button>
          ))}
        </div>
        <div className="text-[10px] text-cc-500 font-mono">
          {horizon === 7 ? 'Horizon court terme' : horizon === 30 ? 'Horizon moyen terme' : 'Horizon long terme'}
        </div>
        <button
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="ml-auto px-3 py-1.5 text-xs font-mono bg-cc-700 hover:bg-cc-600 text-gray-300 rounded-lg transition-colors disabled:opacity-50"
        >
          {refresh.isPending ? '⟳ Calcul…' : '⟳ Recalculer'}
        </button>
      </div>

      {/* ── 4. Domain selector cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {DOMAIN_CONFIG.map(d => {
          const domRisks = allRisks.filter(r => r.risk_type === d.key);
          const isActive = selectedDomain === d.key;
          const highestLvl = getHighestLevel(domRisks);
          const hlBadge = LEVEL_BADGE[highestLvl];
          return (
            <button
              key={d.key}
              onClick={() => { setUserDomain(d.key); setExpandedCard(null); }}
              className={`rounded-xl border-2 p-3 text-left transition-all ${
                isActive
                  ? `${d.borderActive} bg-cc-800`
                  : 'border-cc-700 bg-cc-800 hover:border-cc-500'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-xl">{d.icon}</span>
                <span className="text-xs font-bold text-white">{d.label}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-cc-400">
                  {domRisks.length} zone{domRisks.length !== 1 ? 's' : ''}
                </span>
                {hlBadge && (
                  <span className={`text-[8px] font-bold px-1.5 py-px rounded-full ${hlBadge.cls}`}>
                    {hlBadge.label}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── 5. Domain context box ── */}
      {DOMAIN_CONTEXT[selectedDomain] && (
        <div className="bg-cc-800 border border-cc-600 rounded-xl p-3 space-y-1.5">
          {DOMAIN_CONTEXT[selectedDomain].lines.map((line, i) => (
            <div key={i} className="text-[10px] text-gray-300 leading-relaxed">{line}</div>
          ))}
        </div>
      )}

      {/* ── 6. VIEWS forecast banner (conflit long-terme) ── */}
      {viewsPrevisions.length > 0 && (
        <div className="bg-indigo-950/40 border border-indigo-800/60 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-mono text-indigo-400 uppercase flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full shrink-0" />
              Prévisions VIEWS — Conflit (horizon 3 mois)
            </div>
            <div className="text-[8px] text-indigo-700 font-mono">Uppsala/PRIO · {viewsPrevisions.length} provinces</div>
          </div>
          <div className="space-y-1.5">
            {viewsPrevisions.slice(0, 6).map((p: any) => (
              <div key={`${p.pred_pcode}-${p.mois_cible}`} className="flex items-center gap-2">
                <span className="text-[10px] text-gray-300 w-28 truncate shrink-0">{p.province_nom}</span>
                <div className="flex-1 h-1 bg-cc-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all"
                    style={{ width: `${Math.round((p.probabilite_max ?? 0) * 100)}%` }}
                  />
                </div>
                <span className="text-[9px] font-mono text-indigo-300 w-8 text-right shrink-0">
                  {Math.round((p.probabilite_max ?? 0) * 100)}%
                </span>
                <span className="text-[9px] font-mono text-gray-600 w-16 text-right shrink-0">
                  ~{Math.round(p.morts_predites_total ?? 0)} morts
                </span>
              </div>
            ))}
          </div>
          <div className="text-[8px] text-indigo-900 font-mono pt-0.5">
            Prédictions — pas des incidents réels · PRIO-GRID 55×55km · Mis à jour hebdomadairement
          </div>
        </div>
      )}

      {/* ── 7. Province risk cards ── */}
      {isLoading ? (
        <div className="text-center text-gray-500 text-sm py-8">Chargement…</div>
      ) : domainRisks.length === 0 ? (
        <div className="text-center text-gray-500 text-sm py-8">
          Aucune donnée pour {DOMAIN_CONFIG.find(d => d.key === selectedDomain)?.label ?? selectedDomain} — lancer un recalcul
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-[10px] font-mono text-cc-500 uppercase flex items-center gap-2">
            <span>{RISK_TYPE_ICON[selectedDomain]}</span>
            <span>{RISK_TYPE_FR[selectedDomain] ?? selectedDomain} — {domainRisks.length} provinces (top 15 par score)</span>
          </div>
          {domainRisks.map((r, i) => {
            const cardKey = `${r.p_code ?? i}-${r.risk_type}`;
            return (
              <ProvinceCard
                key={cardKey}
                r={r}
                expanded={expandedCard === cardKey}
                onToggle={() => setExpandedCard(expandedCard === cardKey ? null : cardKey)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function VeilleTab() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['ai-veille'],
    queryFn: () => apiClient.get('/ai/veille/events?limit=40').then(r => r.data),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const { data: healthData } = useQuery({
    queryKey: ['ai-veille-health'],
    queryFn: () => apiClient.get('/ai/veille/health').then(r => r.data),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const events: any[] = Array.isArray(data) ? data : (data?.events ?? []);
  const connectors: any[] = healthData?.connectors ?? [];

  return (
    <div className="space-y-4">
      {connectors.length > 0 && (
        <div>
          <div className="text-[10px] font-mono text-gray-500 uppercase mb-2">Connecteurs d'ingestion</div>
          <div className="grid grid-cols-5 gap-2">
            {connectors.map(c => {
              const srcId = c.source_id ?? c.source ?? String(Math.random());
              const status = c.status ?? (c.circuit_open ? 'down' : 'ok');
              return (
                <div key={srcId} className="bg-cc-800 rounded-lg p-2 text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <span className={`w-2 h-2 rounded-full ${CONNECTOR_STATUS[status] ?? 'bg-gray-500'}`} />
                    <span className={`text-[10px] font-mono font-bold ${status === 'ok' ? 'text-green-400' : status === 'degraded' ? 'text-yellow-400' : 'text-red-400'}`}>
                      {status.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-400">{SOURCE_LABELS[srcId] ?? srcId}</div>
                  <div className="text-xs font-bold text-white">{c.events_48h ?? c.event_store_size ?? '—'}</div>
                  <div className="text-[9px] text-gray-600">evt / 48h</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono text-gray-500 uppercase">Signaux récents ({events.length})</div>
        <button onClick={() => refetch()} className="text-[10px] text-gray-500 hover:text-gray-300 font-mono">↺ Actualiser</button>
      </div>

      {isLoading ? (
        <div className="text-center text-gray-500 text-sm py-8">Chargement…</div>
      ) : events.length === 0 ? (
        <div className="text-center text-gray-500 text-sm py-8">Aucun signal sur les 48 dernières heures</div>
      ) : (
        <div className="space-y-1.5 max-h-96 overflow-y-auto">
          {events.map((e, i) => (
            <div key={i} className="bg-cc-800 rounded-lg p-3 flex items-start gap-3">
              <span className="text-base shrink-0 mt-0.5">{HAZARD_ICONS[e.hazard_type] ?? '⚠️'}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-mono text-gray-500">{SOURCE_LABELS[e.source] ?? e.source}</span>
                  <span className="text-[10px] font-mono text-gray-600">{e.location_pcode}</span>
                  {e.is_duplicate && <span className="text-[10px] text-yellow-500 font-bold">DOUBLON</span>}
                </div>
                <p className="text-xs text-gray-200 truncate">{e.title}</p>
              </div>
              <div className="text-[10px] text-gray-600 whitespace-nowrap shrink-0">
                {e.fetched_at ? new Date(e.fetched_at).toLocaleDateString('fr-FR') : '—'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RenseignementsTab() {
  const [activeCat, setActiveCat] = useState<string>('all');
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Set<string>>(new Set());

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['ai-veille-intel'],
    queryFn: () => apiClient.get('/ai/veille/events?limit=80').then(r => r.data),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const events: any[] = Array.isArray(data) ? data : (data?.events ?? []);

  const filteredEvents = activeCat === 'all'
    ? events
    : events.filter(e => getCategoryForEvent(e) === activeCat);

  async function suggestAsCrisis(e: any) {
    const key = e.id ?? e.external_id ?? String(Math.random());
    setSubmitting(key);
    try {
      await apiClient.post('/events', {
        title: e.title ?? 'Signal veille',
        description: e.description ?? e.body ?? '',
        hazardType: e.hazard_type ?? 'other',
        severity: e.severity ?? 'Unknown',
        locationPcode: e.location_pcode ?? e.p_code ?? 'CD',
        locationName: e.location_name ?? e.province ?? 'Non précisé',
        locationLevel: 1,
        locationAccuracy: 'pcode',
        source: e.source ?? 'reliefweb',
        status: 'under_review',
        confidence: 'probable',
      });
      setSubmitted(prev => new Set([...prev, key]));
    } catch { /* show error state */ } finally {
      setSubmitting(null);
    }
  }

  const countByCat = INTEL_CATEGORIES.reduce<Record<string, number>>((acc, cat) => {
    acc[cat.key] = events.filter(e => getCategoryForEvent(e) === cat.key).length;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white">Renseignements & Suggestions</h3>
          <p className="text-[10px] text-cc-500 mt-0.5">
            Signaux collectés par les agents IA, classifiés et proposés pour création dans la base de crises.
          </p>
        </div>
        <button onClick={() => refetch()} className="text-[10px] text-gray-500 hover:text-gray-300 font-mono">↺</button>
      </div>

      {/* Category filters */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setActiveCat('all')}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-mono transition-colors ${
            activeCat === 'all' ? 'bg-sinaur-800 text-sinaur-300 border border-sinaur-700' : 'bg-cc-800 text-cc-400 hover:text-gray-300'
          }`}
        >
          Tous <span className="text-cc-500">({events.length})</span>
        </button>
        {INTEL_CATEGORIES.map(cat => (
          <button
            key={cat.key}
            onClick={() => setActiveCat(cat.key)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-mono transition-colors ${
              activeCat === cat.key ? 'bg-sinaur-800 text-sinaur-300 border border-sinaur-700' : 'bg-cc-800 text-cc-400 hover:text-gray-300'
            }`}
          >
            <span>{cat.icon}</span>
            <span>{cat.label}</span>
            <span className="text-cc-600">({countByCat[cat.key] ?? 0})</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center text-gray-500 text-sm py-8">Chargement des renseignements…</div>
      ) : filteredEvents.length === 0 ? (
        <div className="text-center text-gray-500 text-sm py-8">Aucun signal dans cette catégorie</div>
      ) : (
        <div className="space-y-2 max-h-[520px] overflow-y-auto">
          {filteredEvents.map((e, i) => {
            const cat = INTEL_CATEGORIES.find(c => c.key === getCategoryForEvent(e));
            const key = e.id ?? e.external_id ?? String(i);
            const isSubmitted = submitted.has(key);
            const isSubmittingThis = submitting === key;

            return (
              <div key={i} className="bg-cc-800 rounded-xl border border-cc-700 p-3 space-y-2">
                {/* Top row */}
                <div className="flex items-start gap-2">
                  <span className="text-base shrink-0 mt-0.5">{cat?.icon ?? HAZARD_ICONS[e.hazard_type] ?? '⚠️'}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                      <span className="text-[10px] bg-cc-700 text-cc-400 px-1.5 py-px rounded font-mono">
                        {cat?.label ?? 'Autre'}
                      </span>
                      <span className="text-[10px] text-gray-500 font-mono">{SOURCE_LABELS[e.source] ?? e.source}</span>
                      {e.location_pcode && (
                        <span className="text-[10px] font-mono text-cc-500">📍 {e.location_pcode}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-200 leading-snug">{e.title}</p>
                  </div>
                  <div className="text-[10px] text-cc-600 shrink-0 whitespace-nowrap">
                    {e.fetched_at ? new Date(e.fetched_at).toLocaleDateString('fr-FR') : '—'}
                  </div>
                </div>

                {/* Description preview */}
                {(e.description || e.body) && (
                  <p className="text-[10px] text-cc-400 line-clamp-2 pl-7">
                    {e.description ?? e.body}
                  </p>
                )}

                {/* Action */}
                <div className="flex justify-end pt-0.5">
                  {isSubmitted ? (
                    <span className="text-[10px] text-green-400 font-mono flex items-center gap-1">
                      ✓ Ajouté à la base d'événements
                    </span>
                  ) : (
                    <button
                      onClick={() => suggestAsCrisis(e)}
                      disabled={!!isSubmittingThis}
                      className="text-[10px] font-mono px-3 py-1 bg-sinaur-900 hover:bg-sinaur-800 text-sinaur-400 hover:text-sinaur-300 border border-sinaur-800 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isSubmittingThis ? '⟳ Création…' : '+ Créer un événement'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="text-[9px] text-cc-700 italic border-t border-cc-800 pt-2">
        Les signaux ci-dessus proviennent des connecteurs de veille (ReliefWeb, GDACS, FEWS NET, etc.) et sont proposés
        pour enrichir la base de données des événements. Chaque entrée doit être validée par un opérateur avant publication.
      </div>
    </div>
  );
}

function AntifraudTab() {
  const { data: statsData } = useQuery({
    queryKey: ['ai-antifraud-stats'],
    queryFn: () => apiClient.get('/ai/antifraud/stats').then(r => r.data),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: queueData, isLoading: queueLoading } = useQuery({
    queryKey: ['ai-antifraud-queue'],
    queryFn: () => apiClient.get('/ai/antifraud/queue').then(r => r.data),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const stats = statsData ?? {};
  const queue: any[] = queueData?.queue ?? [];

  return (
    <div className="space-y-4">
      {stats.events && (
        <div className="bg-cc-800 rounded-lg p-3">
          <div className="text-[10px] font-mono text-gray-500 uppercase mb-2">30 derniers jours</div>
          <div className="grid grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-xl font-bold text-white">{stats.events.total.toLocaleString()}</div>
              <div className="text-[10px] text-gray-500">Événements</div>
            </div>
            <div>
              <div className="text-xl font-bold text-yellow-400">{stats.moderation_queue?.pending ?? 0}</div>
              <div className="text-[10px] text-gray-500">En attente</div>
            </div>
            <div>
              <div className="text-xl font-bold text-red-400">{stats.events.rejected}</div>
              <div className="text-[10px] text-gray-500">Rejetés</div>
            </div>
            <div>
              <div className="text-xl font-bold text-orange-400">{stats.events.rejection_rate_pct}%</div>
              <div className="text-[10px] text-gray-500">Taux rejet</div>
            </div>
          </div>
        </div>
      )}

      <div className="text-[10px] font-mono text-gray-500 uppercase">File de modération ({queue.length})</div>
      {queueLoading ? (
        <div className="text-center text-gray-500 text-sm py-6">Chargement…</div>
      ) : queue.length === 0 ? (
        <div className="text-center text-gray-500 text-sm py-6">File vide — aucun dossier en attente</div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {queue.map((item, i) => (
            <div key={i} className="bg-cc-800 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-gray-200 truncate">{item.notes ?? `Dossier ${item.id?.slice(0, 8) ?? i}`}</div>
                <div className="text-[10px] text-gray-600 font-mono">
                  {item.created_at ? new Date(item.created_at).toLocaleDateString('fr-FR') : '—'}
                </div>
              </div>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                item.priority >= 5 ? 'bg-red-800 text-red-200' : 'bg-yellow-800 text-yellow-200'
              }`}>P{item.priority ?? '?'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const AGENT_STATUS_COLORS: Record<string, string> = {
  ok: 'bg-green-500', degraded: 'bg-yellow-400', error: 'bg-red-500',
};

function AgentsStatusTab() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['ai-agents-status'],
    queryFn: () => apiClient.get('/ai/agents/status').then(r => r.data),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const { data: autoCrisisStats } = useQuery({
    queryKey: ['ai-auto-crisis-stats'],
    queryFn: () => apiClient.get('/ai/auto_crisis/stats').then(r => r.data).catch(() => null),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });
  const { data: virusStatus } = useQuery({
    queryKey: ['ai-virus-emergents-status'],
    queryFn: () => apiClient.get('/ai/virus_emergents/status').then(r => r.data).catch(() => null),
    staleTime: 30_000,
  });

  const agents: any[] = data?.agents ?? [];
  const sources: any[] = virusStatus?.sources ?? [];

  const PATHOGEN_STATUS: Record<string, { label: string; cls: string; icon: string }> = {
    'SURVEILLANCE_ACTIVE':  { label: 'SURVEILLANCE ACTIVE',  cls: 'bg-yellow-900/60 text-yellow-300 border-yellow-700', icon: '🔍' },
    'SURVEILLANCE_PASSIVE': { label: 'SURVEILLANCE PASSIVE', cls: 'bg-cc-800 text-gray-400 border-cc-600',               icon: '📡' },
    'ALERTE':               { label: 'ALERTE',               cls: 'bg-red-900/60 text-red-300 border-red-700',           icon: '🚨' },
  };

  const pathogenes = virusStatus?.pathogenes ?? {
    hantavirus_andes: { nom_fr: 'Hantavirus Andes',       statut: 'SURVEILLANCE_ACTIVE',  transmission_h2h: true,  risque_label: 'MODÉRÉ',      surveillance_rdc: true  },
    henipavirus_nipah:{ nom_fr: 'Henipavirus Nipah (NiV)',statut: 'SURVEILLANCE_PASSIVE', transmission_h2h: true,  risque_label: 'FAIBLE',       surveillance_rdc: false },
    virus_marburg:    { nom_fr: 'Virus Marburg',           statut: 'SURVEILLANCE_ACTIVE',  transmission_h2h: true,  risque_label: 'ÉLEVÉ',        surveillance_rdc: true  },
    disease_x:        { nom_fr: 'Disease X',               statut: 'SURVEILLANCE_PASSIVE', transmission_h2h: null,  risque_label: 'INDÉTERMINÉ',  surveillance_rdc: true  },
  };

  const autoStats = autoCrisisStats ?? {
    received_today: 0, validated: 0, auto_created: 0, pending_human: 0, rejected: 0,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono text-gray-500 uppercase">
          {agents.length} agents · {data?.response_ms != null ? `${data.response_ms}ms` : '…'}
        </div>
        <button onClick={() => refetch()} className="text-[10px] text-gray-500 hover:text-gray-300 font-mono">↺ Actualiser</button>
      </div>

      {/* Section 1 — Agents IA */}
      <div>
        <div className="text-[10px] font-mono text-cc-500 uppercase tracking-wider mb-2 flex items-center gap-2">
          <span className="w-3 h-px bg-cc-600 inline-block" />
          Agents IA — Santé opérationnelle
        </div>
        {isLoading ? (
          <div className="text-center text-gray-500 text-sm py-6">Chargement…</div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {agents.map((a: any) => (
              <div key={a.id} className="bg-cc-800 rounded-lg p-2.5 space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${AGENT_STATUS_COLORS[a.status] ?? 'bg-gray-500'}`} />
                  <span className="text-[11px] font-bold text-white leading-tight truncate flex-1">{a.name}</span>
                  <span className={`text-[8px] font-mono font-bold px-1 py-px rounded shrink-0 ${
                    a.status === 'ok' ? 'bg-green-900 text-green-300' :
                    a.status === 'degraded' ? 'bg-yellow-900 text-yellow-300' : 'bg-red-900 text-red-300'
                  }`}>{a.status?.toUpperCase()}</span>
                </div>
                {Object.keys(a.metrics ?? {}).length > 0 && (
                  <div className="flex flex-wrap gap-x-2 gap-y-px">
                    {Object.entries(a.metrics).slice(0, 3).map(([k, v]: any) => (
                      <span key={k} className="text-[9px] font-mono text-gray-500">
                        {k.replace(/_/g, ' ')}: <span className="text-gray-300">{v}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section 2 — Filtre Vérité */}
      <div>
        <div className="text-[10px] font-mono text-cc-500 uppercase tracking-wider mb-2 flex items-center gap-2">
          <span className="w-3 h-px bg-cc-600 inline-block" />
          Filtre Vérité — Validation multi-sources
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {[
            { label: 'Reçus/24h',    value: autoStats.received_today ?? 0, cls: 'bg-cc-800',                              textCls: 'text-white' },
            { label: 'Validés',      value: autoStats.validated      ?? 0, cls: 'bg-green-900/40 border border-green-800', textCls: 'text-green-300' },
            { label: 'Créés auto',   value: autoStats.auto_created   ?? 0, cls: 'bg-yellow-900/40 border border-yellow-800', textCls: 'text-yellow-300' },
            { label: 'Attente hum.', value: autoStats.pending_human  ?? 0, cls: 'bg-orange-900/40 border border-orange-800 animate-pulse', textCls: 'text-orange-300' },
            { label: 'Rejetés',      value: autoStats.rejected       ?? 0, cls: 'bg-cc-800',                              textCls: 'text-red-400' },
          ].map(k => (
            <div key={k.label} className={`rounded-lg p-2 text-center ${k.cls}`}>
              <div className={`text-lg font-bold font-mono ${k.textCls}`}>{k.value}</div>
              <div className="text-[8px] text-gray-500 leading-tight mt-0.5">{k.label}</div>
            </div>
          ))}
        </div>

        {/* Sources de collecte */}
        <div className="mt-2.5">
          <div className="text-[9px] font-mono text-cc-600 uppercase mb-1.5">Sources actives ({sources.length > 0 ? sources.filter((s:any) => s.status === 'ok').length : 8}/{sources.length > 0 ? sources.length : 8})</div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {(sources.length > 0 ? sources : [
              { id:'WHO_DON',     nom:'WHO DON',              status:'ok', events_per_h:0.5,  reliability:0.95, last_fetch: null },
              { id:'PROMEDMAIL',  nom:'ProMED-mail',          status:'ok', events_per_h:8.0,  reliability:0.78, last_fetch: null },
              { id:'HEALTHMAP',   nom:'HealthMap',            status:'ok', events_per_h:15.0, reliability:0.72, last_fetch: null },
              { id:'ECDC',        nom:'ECDC',                 status:'ok', events_per_h:1.0,  reliability:0.90, last_fetch: null },
              { id:'CDC_HAN',     nom:'CDC HAN',              status:'ok', events_per_h:0.2,  reliability:0.92, last_fetch: null },
              { id:'AFRICA_CDC',  nom:'Africa CDC',           status:'ok', events_per_h:2.0,  reliability:0.88, last_fetch: null },
              { id:'PASTEUR',     nom:'Institut Pasteur',     status:'ok', events_per_h:0.3,  reliability:0.92, last_fetch: null },
              { id:'WHO_TWITTER', nom:'WHO @WHO',             status:'ok', events_per_h:4.0,  reliability:0.80, last_fetch: null },
            ]).map((src: any) => (
              <div key={src.id} className="flex items-center gap-2 bg-cc-800/60 rounded px-2 py-1">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${src.status === 'ok' ? 'bg-green-400' : 'bg-red-400'}`} />
                <span className="text-[10px] text-gray-300 flex-1 truncate">{src.nom}</span>
                <span className="text-[9px] font-mono text-gray-500 shrink-0">
                  {src.events_per_h}/h
                </span>
                <span className="text-[9px] font-mono text-gray-600 shrink-0">
                  {Math.round((src.reliability ?? 0) * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Section 3 — Pathogènes émergents */}
      <div>
        <div className="text-[10px] font-mono text-cc-500 uppercase tracking-wider mb-2 flex items-center gap-2">
          <span className="w-3 h-px bg-cc-600 inline-block" />
          Pathogènes émergents — Veille VirusEmergentAgent
        </div>
        <div className="space-y-1.5">
          {Object.entries(pathogenes).map(([pid, p]: any) => {
            const meta = PATHOGEN_STATUS[p.statut] ?? PATHOGEN_STATUS['SURVEILLANCE_PASSIVE'];
            return (
              <div key={pid} className="bg-cc-800 rounded-lg px-3 py-2 flex items-center gap-3">
                <span className="text-base shrink-0">{meta.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[11px] font-bold text-white">{p.nom_fr}</span>
                    {p.transmission_h2h && (
                      <span className="text-[8px] bg-red-900/60 text-red-300 border border-red-800 px-1 rounded font-mono">H2H</span>
                    )}
                    {p.surveillance_rdc && (
                      <span className="text-[8px] bg-blue-900/60 text-blue-300 border border-blue-800 px-1 rounded font-mono">RDC</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[8px] font-mono px-1.5 py-px rounded border ${meta.cls}`}>{meta.label}</span>
                    {p.risque_label && (
                      <span className="text-[9px] text-gray-500 font-mono">Import: {p.risque_label}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StocksTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['ai-stocks-dashboard'],
    queryFn: () => apiClient.get('/ai/anomalie-stocks/dashboard').then(r => r.data),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const { data: alertsData } = useQuery({
    queryKey: ['ai-stocks-alerts'],
    queryFn: () => apiClient.get('/ai/anomalie-stocks/alerts').then(r => r.data),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });
  const alerts: any[] = alertsData?.alerts ?? [];

  return (
    <div className="space-y-4">
      {data && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'CRITIQUE',    value: data.by_level?.CRITICAL ?? 0, cls: 'bg-red-900 border border-red-800' },
            { label: 'ÉLEVÉ',       value: data.by_level?.HIGH ?? 0,     cls: 'bg-red-900/50 border border-red-800' },
            { label: 'NON TRAITÉS', value: data.unresolved ?? 0,          cls: 'bg-cc-800 border border-cc-600' },
          ].map(k => (
            <div key={k.label} className={`rounded-lg p-3 ${k.cls}`}>
              <div className="text-[10px] font-mono text-gray-400 mb-1">{k.label}</div>
              <div className="text-2xl font-bold text-white">{k.value}</div>
            </div>
          ))}
        </div>
      )}
      <div className="text-[10px] font-mono text-gray-500 uppercase">Anomalies récentes</div>
      {isLoading ? (
        <div className="text-center text-gray-500 text-sm py-6">Chargement…</div>
      ) : alerts.length === 0 ? (
        <div className="text-center text-gray-500 text-sm py-6">Aucune anomalie détectée</div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {alerts.slice(0, 20).map((a: any, i: number) => (
            <div key={i} className="bg-cc-800 rounded-lg px-3 py-2 flex items-center gap-3">
              <span className={`w-2 h-2 rounded-full shrink-0 ${a.level === 'CRITICAL' ? 'bg-red-500 animate-pulse' : a.level === 'HIGH' ? 'bg-orange-400' : 'bg-yellow-400'}`} />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-gray-200 truncate">{a.pattern_id ?? 'Anomalie'} — {a.entrepot_id}</div>
                <div className="text-[10px] text-gray-500 font-mono">{a.province ?? ''}</div>
              </div>
              <span className="text-[10px] font-bold text-white">{a.score}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SignalementsTab() {
  const { data: statsData } = useQuery({
    queryKey: ['ai-signalements-stats'],
    queryFn: () => apiClient.get('/ai/signalements/stats').then(r => r.data),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const { data: priorityData, isLoading } = useQuery({
    queryKey: ['ai-signalements-priority'],
    queryFn: () => apiClient.get('/ai/signalements/priority').then(r => r.data),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });
  const priority: any[] = priorityData?.queue ?? [];
  const stats = statsData ?? {};

  return (
    <div className="space-y-4">
      {stats.total != null && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'TOTAL',         value: stats.total ?? 0 },
            { label: 'CLUSTERS',      value: stats.cluster_count ?? 0 },
            { label: 'FIABILITÉ MOY.', value: stats.avg_reliability ? `${Math.round(stats.avg_reliability * 100)}%` : '—' },
            { label: 'À TRAITER',     value: stats.high_priority ?? 0 },
          ].map(k => (
            <div key={k.label} className="bg-cc-800 rounded-lg p-3">
              <div className="text-[10px] font-mono text-gray-400 mb-1">{k.label}</div>
              <div className="text-xl font-bold text-white">{k.value}</div>
            </div>
          ))}
        </div>
      )}
      <div className="text-[10px] font-mono text-gray-500 uppercase">File de priorité</div>
      {isLoading ? (
        <div className="text-center text-gray-500 text-sm py-6">Chargement…</div>
      ) : priority.length === 0 ? (
        <div className="text-center text-gray-500 text-sm py-6">Aucun signalement prioritaire</div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {priority.slice(0, 20).map((s: any, i: number) => (
            <div key={i} className="bg-cc-800 rounded-lg px-3 py-2 flex items-start gap-3">
              <span className="text-base shrink-0">
                {s.classe === 'INONDATION' ? '🌊' : s.classe === 'EPIDEMIE' ? '🦠' : s.classe === 'CONFLIT' ? '⚔️' : '⚠️'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-mono text-gray-500">{s.classe}</span>
                  <span className="text-[10px] font-mono text-gray-600">{s.province}</span>
                </div>
                <p className="text-xs text-gray-200 truncate">{s.text}</p>
              </div>
              <div className="text-[10px] font-bold text-white shrink-0">
                {s.priority_score != null ? Math.round(s.priority_score * 100) : '—'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const DISEASE_ICONS: Record<string, string> = {
  cholera: '💧', mpox: '🐒', rougeole: '🔴', meningite: '🧠', ebola: '☣️',
};
const DISEASE_FR: Record<string, string> = {
  cholera: 'Choléra', mpox: 'Mpox', rougeole: 'Rougeole',
  meningite: 'Méningite', ebola: 'Ebola',
};
const DISEASE_RESPONSES: Record<string, string[]> = {
  cholera: [
    'Distribution de sachets de réhydratation orale (SRO)',
    'Chloration des points d\'eau et désinfection des latrines',
    'Déploiement des équipes de traitement oral du choléra (OTC)',
    'Sensibilisation communautaire hygiènes mains/eau',
  ],
  mpox: [
    'Isolement des cas confirmés et contacts',
    'Vaccination anneau des contacts à haut risque',
    'Port des EPI pour le personnel de santé',
    'Notification OMS dans les 24 heures',
  ],
  rougeole: [
    'Campagne de vaccination de riposte (6 mois–15 ans)',
    'Supplémentation en vitamine A',
    'Isolement des cas dans les 4 jours après l\'éruption',
    'Renforcement surveillance dans les zones de déplacement',
  ],
  meningite: [
    'Chimioprophylaxie des contacts proches (ciprofloxacine)',
    'Vaccination méningococcique en urgence',
    'Déclaration obligatoire dans les 24 heures',
    'Investigation des sources d\'eau potentiellement contaminées',
  ],
  ebola: [
    '⚠️ ALERTE CRITIQUE — Activation cellule de crise nationale',
    'Isolement immédiat et identification des chaînes de transmission',
    'Déploiement équipe d\'intervention rapide REDS',
    'Notification OMS, UNICEF, MSF dans les 2 heures',
    'Incinération sécurisée des déchets biologiques',
  ],
};

function EpidemieClusterCard({ c, expanded, onToggle }: { c: any; expanded: boolean; onToggle: () => void }) {
  const level = c.alert_level as string;
  const daysActive = c.first_case_at
    ? Math.ceil((Date.now() - new Date(c.first_case_at).getTime()) / 86400000)
    : null;
  const responses = DISEASE_RESPONSES[c.disease_id] ?? [];

  return (
    <div
      className={`rounded-lg border transition-colors ${
        level === 'CRITICAL' ? 'bg-red-950/40 border-red-800' :
        level === 'HIGH' ? 'bg-orange-950/40 border-orange-800' :
        'bg-cc-800 border-cc-700'
      }`}
    >
      {/* Header — always visible */}
      <div
        className="px-3 py-2.5 flex items-center gap-3 cursor-pointer"
        onClick={onToggle}
      >
        <span className="text-xl shrink-0">{DISEASE_ICONS[c.disease_id] ?? '🦠'}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-bold text-white">{DISEASE_FR[c.disease_id] ?? c.disease_id}</span>
            {level === 'CRITICAL' && (
              <span className="text-[9px] bg-red-800 text-red-200 px-1.5 py-px rounded-full font-bold animate-pulse">CRITIQUE</span>
            )}
          </div>
          <div className="flex items-center gap-3 text-[10px] text-gray-400">
            <span>📍 {c.province}</span>
            <span>👥 {c.size ?? c.case_count} cas</span>
            <span>🗺️ {c.radius_km?.toFixed(1) ?? '?'}km</span>
            {daysActive && <span>🗓️ {daysActive}j actif</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
            level === 'CRITICAL' ? 'bg-red-900 text-red-200 border-red-700' :
            level === 'HIGH'     ? 'bg-orange-900 text-orange-200 border-orange-700' :
                                   'bg-yellow-900 text-yellow-200 border-yellow-700'
          }`}>{level}</span>
          <div className="text-cc-600 text-[10px]">{expanded ? '▲' : '▼'}</div>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-cc-700/50 pt-2">
          {/* Score bar */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-cc-500 font-mono uppercase">Score de risque</span>
              <span className="text-[10px] font-bold font-mono text-white">{Math.round(c.score ?? 0)}/100</span>
            </div>
            <div className="h-1.5 bg-cc-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  (c.score ?? 0) >= 80 ? 'bg-red-500' : (c.score ?? 0) >= 60 ? 'bg-orange-500' : 'bg-yellow-500'
                }`}
                style={{ width: `${Math.min(100, c.score ?? 0)}%` }}
              />
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            {c.first_case_at && (
              <div>
                <div className="text-cc-600 font-mono">Premier cas</div>
                <div className="text-gray-300">{new Date(c.first_case_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
              </div>
            )}
            {c.last_case_at && (
              <div>
                <div className="text-cc-600 font-mono">Dernier cas</div>
                <div className="text-gray-300">{new Date(c.last_case_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
              </div>
            )}
            {c.centroid_lat && (
              <div>
                <div className="text-cc-600 font-mono">Coordonnées</div>
                <div className="text-gray-300 font-mono">{c.centroid_lat?.toFixed(3)}°, {c.centroid_lng?.toFixed(3)}°</div>
              </div>
            )}
            <div>
              <div className="text-cc-600 font-mono">Source signaux</div>
              <div className="text-gray-300">{c.signal_ids?.length ?? 0} signalement{(c.signal_ids?.length ?? 0) !== 1 ? 's' : ''}</div>
            </div>
          </div>

          {/* Response actions */}
          {responses.length > 0 && (
            <div>
              <div className="text-[10px] font-mono text-green-500 uppercase mb-1.5">Actions de réponse recommandées</div>
              <div className="space-y-1">
                {responses.map((r, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[10px] text-gray-300">
                    <span className="text-green-600 shrink-0 mt-0.5">▶</span>
                    <span>{r}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Disease cards config (AI tab — compact) ──────────────────────────────────

const DISEASE_META: Record<string, {
  nom: string; emoji: string; statut: string; statut_cls: string;
  vaccin: boolean; traitement: boolean; usppi: boolean; border: string;
  fb_zones: number; fb_cas: number; fb_deces: number;
}> = {
  EBOLA:        { nom: 'Ebola Bundibugyo', emoji: '🦠', statut: 'URGENCE INTERNATIONALE', statut_cls: 'text-red-300',     vaccin: false, traitement: false, usppi: true,  border: 'border-red-800',     fb_zones: 25,  fb_cas: 515,    fb_deces: 91    },
  CHOLERA:      { nom: 'Choléra',          emoji: '💧', statut: 'ENDÉMIQUE',               statut_cls: 'text-blue-300',    vaccin: true,  traitement: true,  usppi: false, border: 'border-blue-900',    fb_zones: 18,  fb_cas: 4820,   fb_deces: 89    },
  MPOX:         { nom: 'Mpox',             emoji: '⚕️', statut: 'ALERTE',                  statut_cls: 'text-purple-300',  vaccin: true,  traitement: true,  usppi: false, border: 'border-purple-900',  fb_zones: 8,   fb_cas: 1240,   fb_deces: 23    },
  ROUGEOLE:     { nom: 'Rougeole',         emoji: '🔴', statut: 'ENDÉMIQUE',               statut_cls: 'text-orange-300',  vaccin: true,  traitement: false, usppi: false, border: 'border-orange-900',  fb_zones: 34,  fb_cas: 12400,  fb_deces: 234   },
  MENINGITE:    { nom: 'Méningite',        emoji: '🧠', statut: 'SURVEILLANCE',            statut_cls: 'text-green-300',   vaccin: true,  traitement: true,  usppi: false, border: 'border-green-900',   fb_zones: 4,   fb_cas: 320,    fb_deces: 48    },
  PALUDISME:    { nom: 'Paludisme',        emoji: '🦟', statut: 'ENDÉMIQUE',               statut_cls: 'text-emerald-300', vaccin: true,  traitement: true,  usppi: false, border: 'border-emerald-900', fb_zones: 145, fb_cas: 890000, fb_deces: 12400 },
  FIEVRE_JAUNE: { nom: 'Fièvre Jaune',    emoji: '🌡️', statut: 'SURVEILLANCE',            statut_cls: 'text-yellow-300',  vaccin: true,  traitement: false, usppi: false, border: 'border-yellow-900',  fb_zones: 0,   fb_cas: 0,      fb_deces: 0     },
};

function EpidemieTab() {
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAlerts, setShowAlerts] = useState(false);
  const [showClusters, setShowClusters] = useState(false);

  const { data: dashData } = useQuery({
    queryKey: ['ai-epidemie-dashboard'],
    queryFn: () => apiClient.get('/ai/epidemie/dashboard').then(r => r.data),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const { data: statsData } = useQuery({
    queryKey: ['epidemie-stats-live'],
    queryFn: () => apiClient.get('/epidemie/stats').then(r => r.data),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });
  const { data: clustersData, isLoading: clustersLoading } = useQuery({
    queryKey: ['ai-epidemie-clusters'],
    queryFn: () => apiClient.get('/ai/epidemie/clusters').then(r => r.data),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const { data: alertsData } = useQuery({
    queryKey: ['ai-epidemie-alerts'],
    queryFn: () => apiClient.get('/ai/epidemie/alerts').then(r => r.data),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const clusters: any[] = (clustersData?.clusters ?? []).sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0));
  const alerts: any[] = alertsData?.alerts ?? [];
  const criticalClusters = clusters.filter(c => c.alert_level === 'CRITICAL');

  const liveStats: Record<string, { zones_actives: number; cas_confirmes: number; deces: number }> = statsData?.data ?? {};
  const displayDiseases = Object.entries(DISEASE_META)
    .map(([id, meta]) => {
      const live = liveStats[id];
      return {
        id,
        ...meta,
        zones: live?.zones_actives ?? meta.fb_zones,
        cas:   live?.cas_confirmes  ?? meta.fb_cas,
        deces: live?.deces          ?? meta.fb_deces,
        isLive: !!live,
      };
    })
    .filter(d => d.zones > 0 || d.cas > 0 || d.usppi);

  return (
    <div className="space-y-4">

      {/* USPPI Banner */}
      <div className="bg-red-950/80 border border-red-700 rounded-lg p-3 flex items-start gap-3">
        <span className="text-red-400 animate-pulse text-xl shrink-0 mt-0.5">🚨</span>
        <div className="flex-1 min-w-0">
          <div className="text-red-200 text-xs font-bold leading-tight">
            URGENCE SANITAIRE DE PORTÉE INTERNATIONALE — OMS (17 MAI 2026)
          </div>
          <div className="text-red-400 text-[10px] font-mono mt-0.5">
            Ebola Bundibugyo · 515 cas confirmés · 91 décès · 25 zones · 3 provinces
          </div>
          <div className="text-[9px] text-red-500 font-mono mt-0.5">
            ⚠ Aucun vaccin ni traitement approuvé pour la souche Bundibugyo
          </div>
        </div>
        <button
          onClick={() => navigate('/epidemie')}
          className="text-[10px] bg-red-900 hover:bg-red-800 text-red-200 px-2.5 py-1.5 rounded font-mono whitespace-nowrap shrink-0 transition-colors"
        >
          Module Épidémie →
        </button>
      </div>

      {/* Disease cards grid */}
      <div>
        <div className="text-[10px] font-mono text-gray-500 uppercase mb-2">{displayDiseases.length} maladies sous surveillance active</div>
        <div className="grid grid-cols-2 gap-2">
          {displayDiseases.map(d => (
            <div key={d.id} className={`bg-cc-800 rounded-lg border ${d.border} p-2.5 space-y-1.5`}>
              <div className="flex items-center gap-1.5">
                <span className="text-base">{d.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[11px] font-bold text-white truncate">{d.nom}</span>
                    {d.usppi && <span className="text-[7px] bg-red-900 text-red-200 border border-red-700 px-1 py-px rounded font-bold shrink-0">USPPI</span>}
                    {d.isLive && <span className="text-[7px] bg-green-900 text-green-300 border border-green-700 px-1 py-px rounded font-mono shrink-0">LIVE</span>}
                  </div>
                  <span className={`text-[8px] font-mono ${d.statut_cls}`}>{d.statut}</span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1 text-center">
                <div>
                  <div className="text-[11px] font-bold text-white">{d.zones}</div>
                  <div className="text-[7px] text-cc-600 font-mono">zones</div>
                </div>
                <div>
                  <div className="text-[11px] font-bold text-white">{d.cas >= 1000 ? `${(d.cas/1000).toFixed(0)}k` : d.cas}</div>
                  <div className="text-[7px] text-cc-600 font-mono">cas</div>
                </div>
                <div>
                  <div className="text-[11px] font-bold text-red-400">{d.deces >= 1000 ? `${(d.deces/1000).toFixed(1)}k` : d.deces}</div>
                  <div className="text-[7px] text-cc-600 font-mono">décès</div>
                </div>
              </div>
              <div className="flex gap-1">
                <span className={`text-[7px] px-1 py-px rounded font-mono border ${d.vaccin ? 'bg-green-950 text-green-400 border-green-900' : 'bg-red-950 text-red-400 border-red-900'}`}>
                  💉{d.vaccin ? 'OUI' : 'NON'}
                </span>
                <span className={`text-[7px] px-1 py-px rounded font-mono border ${d.traitement ? 'bg-green-950 text-green-400 border-green-900' : 'bg-red-950 text-red-400 border-red-900'}`}>
                  💊{d.traitement ? 'OUI' : 'NON'}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 text-right">
          <button
            onClick={() => navigate('/epidemie')}
            className="text-[10px] text-red-400 hover:text-red-200 font-mono transition-colors"
          >
            Carte épidémie temps réel →
          </button>
        </div>
      </div>

      {/* Foyers IA (DBSCAN) — collapsible */}
      <div>
        <button
          onClick={() => setShowClusters(v => !v)}
          className="flex items-center justify-between w-full text-left"
        >
          <div className="text-[10px] font-mono text-gray-500 uppercase">
            Foyers détectés par IA — DBSCAN {dashData?.active_clusters != null ? `(${dashData.active_clusters})` : ''}
          </div>
          <span className="text-cc-600 text-[10px]">{showClusters ? '▲' : '▼'}</span>
        </button>

        {showClusters && (
          <div className="mt-2 space-y-2">
            {/* CAP Alerts */}
            {alerts.length > 0 && (
              <button
                onClick={() => setShowAlerts(v => !v)}
                className="text-[10px] font-mono text-orange-400 hover:text-orange-300 transition-colors w-full text-left"
              >
                {showAlerts ? '▲' : '▼'} {alerts.length} alerte{alerts.length !== 1 ? 's' : ''} CAP
              </button>
            )}

            {showAlerts && alerts.length > 0 && (
              <div className="space-y-1 bg-orange-950/30 border border-orange-800 rounded-lg p-2.5">
                {alerts.slice(0, 5).map((a: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-[10px] border-b border-orange-900/50 pb-1 last:border-0 last:pb-0">
                    <span>{DISEASE_ICONS[a.disease_id] ?? '🦠'}</span>
                    <span className="text-orange-200 font-bold">{a.alert_level}</span>
                    <span className="text-gray-300 flex-1 truncate">{DISEASE_FR[a.disease_id] ?? a.disease_id} — {a.province}</span>
                    {a.validated && <span className="text-green-400 text-[9px]">✓</span>}
                  </div>
                ))}
              </div>
            )}

            {criticalClusters.length > 0 && (
              <div className="bg-red-950/40 border border-red-800 rounded-lg p-2.5">
                <div className="flex items-center gap-2 text-red-300 text-[10px] font-bold mb-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  {criticalClusters.length} foyer{criticalClusters.length > 1 ? 's' : ''} CRITIQUE{criticalClusters.length > 1 ? 'S' : ''}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {criticalClusters.map((c, i) => (
                    <span key={i} className="text-[9px] bg-red-900 text-red-200 px-1.5 py-px rounded-full font-mono">
                      {DISEASE_ICONS[c.disease_id] ?? '🦠'} {DISEASE_FR[c.disease_id] ?? c.disease_id} — {c.province}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {clustersLoading ? (
              <div className="text-center text-gray-500 text-xs py-4 animate-pulse">Chargement…</div>
            ) : clusters.length === 0 ? (
              <div className="py-4 text-center">
                <div className="text-2xl opacity-30 mb-1">🦠</div>
                <div className="text-xs text-gray-500">Aucun cluster DBSCAN détecté</div>
                <div className="text-[10px] text-cc-600 mt-1">Cycle 30 min · Sources : SMS USSD, App mobile, Veille IA</div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {clusters.map((c: any) => {
                  const id = c.cluster_id ?? String(Math.random());
                  return (
                    <EpidemieClusterCard
                      key={id}
                      c={c}
                      expanded={expandedId === id}
                      onToggle={() => setExpandedId(expandedId === id ? null : id)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="text-[10px] text-cc-700 font-mono pt-1">
        Surveillance continue · DBSCAN · 30 min · Sources : App mobile, SMS USSD, Veille IA
      </div>
    </div>
  );
}

function LogistiqueTab() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['ai-logistique-recs'],
    queryFn: () => apiClient.get('/ai/logistique/recommendations').then(r => r.data),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const recs: any[] = data?.recommendations ?? [];
  const pending = recs.filter((r: any) => r.status === 'PENDING');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono text-gray-500 uppercase">
          {pending.length} recommandation{pending.length !== 1 ? 's' : ''} en attente de validation
        </div>
        <button onClick={() => refetch()} className="text-[10px] text-gray-500 hover:text-gray-300 font-mono">↺</button>
      </div>
      {isLoading ? (
        <div className="text-center text-gray-500 text-sm py-6">Chargement…</div>
      ) : recs.length === 0 ? (
        <div className="text-center text-gray-500 text-sm py-6">Aucune recommandation logistique</div>
      ) : (
        <div className="space-y-1.5 max-h-80 overflow-y-auto">
          {recs.slice(0, 20).map((r: any, i: number) => (
            <div key={i} className="bg-cc-800 rounded-lg px-3 py-2.5 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white truncate flex-1">{r.resource_type ?? 'Ressource'}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                  r.status === 'PENDING' ? 'bg-yellow-800 text-yellow-200' :
                  r.status === 'ACCEPTED' ? 'bg-green-800 text-green-200' : 'bg-gray-700 text-gray-300'
                }`}>{r.status}</span>
              </div>
              <div className="text-[10px] text-gray-400">
                {r.warehouse_name ?? r.warehouse_id} → {r.disaster_pcode} · {r.distance_km?.toFixed(0)}km · P{r.priority ?? '?'}
              </div>
              <div className="text-[10px] text-gray-500 italic">{r.reason}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportingTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['ai-reports'],
    queryFn: () => apiClient.get('/ai/reporting/reports').then(r => r.data),
    staleTime: 60_000,
    refetchInterval: 300_000,
  });
  const reports: any[] = data?.reports ?? [];

  return (
    <div className="space-y-4">
      <div className="text-[10px] font-mono text-gray-500 uppercase">Rapports générés ({reports.length})</div>
      {isLoading ? (
        <div className="text-center text-gray-500 text-sm py-6">Chargement…</div>
      ) : reports.length === 0 ? (
        <div className="text-center text-gray-500 text-sm py-6">Aucun rapport généré — le premier bulletin quotidien sera produit à 06h00</div>
      ) : (
        <div className="space-y-1.5 max-h-80 overflow-y-auto">
          {reports.map((r: any, i: number) => (
            <div key={i} className="bg-cc-800 rounded-lg px-3 py-2 flex items-center gap-3">
              <span className="text-base shrink-0">
                {r.report_type === 'daily' ? '📋' : r.report_type === 'weekly' ? '📊' : '📄'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-gray-200 truncate">{r.title ?? r.report_type}</div>
                <div className="text-[10px] text-gray-500 font-mono">
                  {r.generated_at ? new Date(r.generated_at).toLocaleDateString('fr-FR') : '—'}
                </div>
              </div>
              <a href={`/ai/reporting/reports/${r.id}`} className="text-[10px] text-sinaur-400 hover:text-sinaur-300 font-mono shrink-0">
                Voir →
              </a>
            </div>
          ))}
        </div>
      )}
      <div className="pt-1">
        <a href="/ai/reporting/hxl/latest" target="_blank"
          className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 font-mono transition-colors">
          ⬇ Export HXL (CSV)
        </a>
      </div>
    </div>
  );
}

// ── Panneau de santé des sources ──────────────────────────────────────────────

const STATUT_CFG: Record<string, { dot: string; badge: string; label: string }> = {
  OK:       { dot: 'bg-green-500',  badge: 'bg-green-900 text-green-300',   label: 'OK'       },
  DEGRADED: { dot: 'bg-yellow-500', badge: 'bg-yellow-900 text-yellow-300', label: 'DÉGRADÉ'  },
  ERROR:    { dot: 'bg-red-500 animate-pulse', badge: 'bg-red-900 text-red-300', label: 'ERREUR' },
  UNKNOWN:  { dot: 'bg-gray-600',  badge: 'bg-cc-700 text-gray-400',       label: '?'         },
};

const CATEGORIE_COLOR: Record<string, string> = {
  'CONFLIT':            'text-red-400',
  'CONFLIT EST-RDC':    'text-red-400',
  'SÉCURITÉ':           'text-orange-400',
  'ÉPIDÉMIE':           'text-purple-400',
  'CATASTROPHE':        'text-blue-400',
  'MÉTÉO':              'text-cyan-400',
  'HUMANITAIRE':        'text-yellow-400',
  'SÉCURITÉ ALIMENTAIRE':'text-amber-400',
  'DROITS HUMAINS':     'text-pink-400',
  'TÉLÉCOMMUNICATIONS': 'text-teal-400',
  'FEUX':               'text-orange-500',
  'PRÉVISION':          'text-indigo-400',
  'MÉDIA/CONFLIT':      'text-red-300',
  'GÉNÉRAL':            'text-gray-400',
};

function tempsEcoule(mins: number | null): string {
  if (mins == null) return '—';
  if (mins < 1) return '< 1 min';
  if (mins < 60) return `${mins} min`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h${mins % 60 > 0 ? (mins % 60) + 'm' : ''}`;
  return `${Math.floor(mins / 1440)}j`;
}

function SanteSourcesTab() {
  const { data, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['hub-sources-sante'],
    queryFn: () => apiClient.get('/hub/sources/sante').then(r => r.data),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const sources: any[] = data?.sources ?? [];
  const [filtre, setFiltre] = useState<string>('TOUTES');

  const categories = ['TOUTES', ...Array.from(new Set(sources.map((s: any) => s.categorie))).sort()];
  const filtered = filtre === 'TOUTES' ? sources : sources.filter((s: any) => s.categorie === filtre);

  const ok      = data?.sains    ?? 0;
  const deg     = data?.degrades ?? 0;
  const err     = data?.erreurs  ?? 0;
  const total   = data?.total    ?? 0;

  return (
    <div className="space-y-4">
      {/* Header + KPIs */}
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono text-cc-500 uppercase">
          {total} sources · actualisation 30s
        </div>
        <button onClick={() => refetch()} className="text-[10px] text-gray-500 hover:text-gray-300 font-mono">↺ Rafraîchir</button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'TOTAL',    value: total, cls: 'bg-cc-800 border-cc-600' },
          { label: 'SAINES',   value: ok,    cls: 'bg-green-950 border-green-800' },
          { label: 'DÉGRADÉES',value: deg,   cls: 'bg-yellow-950 border-yellow-800' },
          { label: 'ERREUR',   value: err,   cls: 'bg-red-950 border-red-800' },
        ].map(k => (
          <div key={k.label} className={`rounded-lg p-2.5 border ${k.cls}`}>
            <div className="text-[9px] font-mono text-gray-400 mb-0.5">{k.label}</div>
            <div className="text-xl font-bold text-white">{k.value}</div>
          </div>
        ))}
      </div>

      {/* Filtre catégorie */}
      <div className="flex flex-wrap gap-1">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setFiltre(cat)}
            className={`px-2 py-0.5 rounded text-[9px] font-mono transition-colors ${
              filtre === cat
                ? 'bg-sinaur-700 text-white'
                : 'bg-cc-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Liste des sources */}
      {isLoading ? (
        <div className="text-center text-gray-500 text-sm py-8">Chargement…</div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((s: any) => {
            const cfg = STATUT_CFG[s.statut_sante] ?? STATUT_CFG.UNKNOWN;
            const catColor = CATEGORIE_COLOR[s.categorie] ?? 'text-gray-400';
            return (
              <div
                key={s.id}
                className="bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 flex items-center gap-3"
              >
                {/* Dot statut */}
                <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />

                {/* Nom + agent */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-white truncate">{s.nom}</span>
                    {s.dynamique && (
                      <span className="text-[7px] bg-cc-700 text-cc-400 px-1 py-px rounded font-mono shrink-0">LIVE</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-px">
                    <span className={`text-[9px] font-mono ${catColor}`}>{s.categorie}</span>
                    <span className="text-cc-600 text-[9px]">·</span>
                    <span className="text-[9px] font-mono text-gray-500">agent:{s.agent}</span>
                  </div>
                </div>

                {/* Métriques */}
                <div className="flex items-center gap-3 shrink-0">
                  {s.temps_ecoule_min != null && (
                    <div className="text-right">
                      <div className="text-[9px] font-mono text-gray-400">{tempsEcoule(s.temps_ecoule_min)}</div>
                      <div className="text-[8px] text-gray-600">collecte</div>
                    </div>
                  )}
                  {s.nb_evenements != null && (
                    <div className="text-right">
                      <div className="text-[9px] font-mono text-gray-300">{s.nb_evenements}</div>
                      <div className="text-[8px] text-gray-600">événements</div>
                    </div>
                  )}
                  <div className="text-right">
                    <div className="text-[9px] font-mono text-gray-400">{Math.round(s.fiabilite * 100)}%</div>
                    <div className="text-[8px] text-gray-600">fiabilité</div>
                  </div>
                  <span className={`text-[8px] font-mono font-bold px-1.5 py-px rounded ${cfg.badge}`}>
                    {cfg.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dataUpdatedAt > 0 && (
        <div className="text-[8px] font-mono text-cc-700 text-right">
          Mis à jour {new Date(dataUpdatedAt).toLocaleTimeString('fr-FR')}
        </div>
      )}
    </div>
  );
}

// ── Navigation ────────────────────────────────────────────────────────────────

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: 'status',          icon: '🖥️',  label: 'Tableau de bord'   },
  { key: 'predictions',     icon: '📊',  label: 'Prédictions'       },
  { key: 'renseignements',  icon: '🔍',  label: 'Renseignements'    },
  { key: 'veille',          icon: '🔭',  label: 'Veille'            },
  { key: 'antifraud',       icon: '🛡️',  label: 'Anti-Fraude'       },
  { key: 'stocks',          icon: '📦',  label: 'Stocks'            },
  { key: 'signalements',    icon: '📡',  label: 'Signalements'      },
  { key: 'epidemie',        icon: '🦠',  label: 'Épidémie'          },
  { key: 'logistique',      icon: '🚚',  label: 'Logistique'        },
  { key: 'reporting',       icon: '📄',  label: 'Reporting'         },
  { key: 'sources',         icon: '🛰️',  label: 'Sources'           },
];

export function AiPage() {
  const [tab, setTab] = useState<Tab>('status');

  return (
    <div className="p-6 space-y-4 h-full overflow-y-auto">
      <div className="flex items-center gap-3">
        <span className="text-2xl">🤖</span>
        <div>
          <h1 className="text-white font-bold text-lg leading-tight">Intelligence Artificielle</h1>
          <p className="text-cc-600 text-xs font-mono">9 AGENTS ACTIFS — SINAUR-RDC AI PLATFORM</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="flex gap-1 bg-cc-800 rounded-lg p-1 w-fit">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                tab === t.key ? 'bg-cc-700 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-cc-900 rounded-xl border border-cc-700 p-4">
        {tab === 'status'         && <AgentsStatusTab />}
        {tab === 'predictions'    && <PredictionsTab />}
        {tab === 'renseignements' && <RenseignementsTab />}
        {tab === 'veille'         && <VeilleTab />}
        {tab === 'antifraud'      && <AntifraudTab />}
        {tab === 'stocks'         && <StocksTab />}
        {tab === 'signalements'   && <SignalementsTab />}
        {tab === 'epidemie'       && <EpidemieTab />}
        {tab === 'logistique'     && <LogistiqueTab />}
        {tab === 'reporting'      && <ReportingTab />}
        {tab === 'sources'        && <SanteSourcesTab />}
      </div>
    </div>
  );
}
