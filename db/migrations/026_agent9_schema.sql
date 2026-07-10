-- Migration 026: Agent 9 — Prévision des Risques de Violence et Protection des Populations
-- Objectif : protection civile et alerte précoce — pas de renseignement tactique.
-- Toutes les données sont agrégées à la maille territoire (niveau 2), jamais individuelle.

-- ─── Incidents de violence issues de sources publiques normalisées ───────────────
CREATE TABLE IF NOT EXISTS violence_incidents (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Déduplication : une paire (source_type, source_id) est unique
  source_id           TEXT          NOT NULL,
  source_type         TEXT          NOT NULL CHECK (
    source_type IN ('acled','ucdp','sinaur','ong','media','ocha')
  ),
  source_url          TEXT,
  event_date          DATE          NOT NULL,
  -- Point GPS (SRID 4326) — précision limitée au centroïde du territoire si imprécis
  location            GEOMETRY(Point, 4326) NOT NULL,
  -- Rattachement administratif COD-AB
  pcode_2             TEXT          REFERENCES admin_divisions(pcode),  -- territoire
  pcode_3             TEXT,                                              -- secteur si dispo
  -- Taxonomie interne orientée impact civil (pas d'information tactique)
  event_type          TEXT          NOT NULL CHECK (
    event_type IN ('violence_civils','deplacement','pillage','destruction_infra','menace_publique','autre')
  ),
  target_type         TEXT          CHECK (
    target_type IN ('civils','infra_sante','ecole','camp_idp','marche','infra_admin','lieu_culte','autre')
  ),
  consequence_types   TEXT[]        NOT NULL DEFAULT '{}',
  estimated_affected  INTEGER,
  fatalities          INTEGER       NOT NULL DEFAULT 0,
  -- Fiabilité héritée du TruthFilter (0.0 → 1.0)
  source_reliability  NUMERIC(3,2)  NOT NULL DEFAULT 0.50
                      CHECK (source_reliability BETWEEN 0.00 AND 1.00),
  -- Texte d'une revendication déjà publiée (source officielle publique uniquement)
  public_claim        TEXT,
  authority_response  TEXT,
  -- Extrait du texte source brut (pour audit et traçabilité)
  raw_text            TEXT,
  ingested_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT violence_incidents_source_unique UNIQUE (source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_violence_incidents_pcode2
  ON violence_incidents(pcode_2);
CREATE INDEX IF NOT EXISTS idx_violence_incidents_date
  ON violence_incidents(event_date DESC);
CREATE INDEX IF NOT EXISTS idx_violence_incidents_type
  ON violence_incidents(event_type);
CREATE INDEX IF NOT EXISTS idx_violence_incidents_location
  ON violence_incidents USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_violence_incidents_ingested
  ON violence_incidents(ingested_at DESC);


-- ─── Vulnérabilité structurelle par zone (données publiques lentes) ──────────────
-- Décrit ce qui expose structurellement une zone, pas ses dispositifs de défense.
CREATE TABLE IF NOT EXISTS zone_vulnerability (
  pcode               TEXT          PRIMARY KEY REFERENCES admin_divisions(pcode),
  -- Scores composantes (0–100) calculés sur données publiques (OSM, WorldPop, CAMI)
  score_ressources    NUMERIC(5,2)  NOT NULL DEFAULT 0
                      CHECK (score_ressources BETWEEN 0 AND 100),
  score_economique    NUMERIC(5,2)  NOT NULL DEFAULT 0
                      CHECK (score_economique BETWEEN 0 AND 100),
  score_geographique  NUMERIC(5,2)  NOT NULL DEFAULT 0
                      CHECK (score_geographique BETWEEN 0 AND 100),
  score_politique     NUMERIC(5,2)  NOT NULL DEFAULT 0
                      CHECK (score_politique BETWEEN 0 AND 100),
  score_population    NUMERIC(5,2)  NOT NULL DEFAULT 0
                      CHECK (score_population BETWEEN 0 AND 100),
  score_composite     NUMERIC(5,2)  NOT NULL DEFAULT 0
                      CHECK (score_composite BETWEEN 0 AND 100),
  -- Indicateurs démographiques et humanitaires
  population_estimate INTEGER,
  idp_count           INTEGER       NOT NULL DEFAULT 0,
  mines_count         INTEGER       NOT NULL DEFAULT 0,
  hospitals_count     INTEGER       NOT NULL DEFAULT 0,
  schools_count       INTEGER       NOT NULL DEFAULT 0,
  -- Traçabilité des sources de données utilisées
  data_sources        TEXT[]        NOT NULL DEFAULT '{}',
  computed_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zone_vulnerability_composite
  ON zone_vulnerability(score_composite DESC);

CREATE TRIGGER zone_vulnerability_updated_at
  BEFORE UPDATE ON zone_vulnerability
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─── Signaux NLP issus de sources publiques ──────────────────────────────────────
-- Sources légales uniquement : pas d'interception, pas de surveillance individuelle.
CREATE TABLE IF NOT EXISTS public_signals (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type         TEXT          NOT NULL CHECK (
    source_type IN ('media','ong','officiel','rs_public')
  ),
  source_name         TEXT          NOT NULL,
  source_url          TEXT,
  published_at        TIMESTAMPTZ   NOT NULL,
  pcodes_mentioned    TEXT[]        NOT NULL DEFAULT '{}',
  signal_type         TEXT          NOT NULL CHECK (
    signal_type IN ('TENSION_MONTANTE','MOUVEMENT_POPULATION','APPEL_AU_CALME','DECLARATION_HOSTILE','NEUTRE','HORS_SUJET')
  ),
  confidence          NUMERIC(3,2)  NOT NULL DEFAULT 0.50
                      CHECK (confidence BETWEEN 0.00 AND 1.00),
  -- Extrait pertinent uniquement (pas le texte intégral)
  extract_text        TEXT          NOT NULL,
  source_reliability  NUMERIC(3,2)  NOT NULL DEFAULT 0.50
                      CHECK (source_reliability BETWEEN 0.00 AND 1.00),
  model_version       TEXT,
  ingested_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_signals_pcode
  ON public_signals USING GIN(pcodes_mentioned);
CREATE INDEX IF NOT EXISTS idx_public_signals_published
  ON public_signals(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_signals_type
  ON public_signals(signal_type);


-- ─── Agrégats comportementaux par zone et période ────────────────────────────────
-- Statistiques agrégées uniquement — aucun détail opérationnel ou individuel.
CREATE TABLE IF NOT EXISTS behavioral_aggregates (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  pcode               TEXT          NOT NULL REFERENCES admin_divisions(pcode),
  period_start        DATE          NOT NULL,
  period_end          DATE          NOT NULL,
  incident_count      INTEGER       NOT NULL DEFAULT 0,
  incident_density    NUMERIC(8,4),            -- incidents / km²
  dominant_targets    TEXT[]        NOT NULL DEFAULT '{}',
  dominant_period     TEXT          CHECK (dominant_period IN ('JOUR','NUIT','INDETERMINE')),
  intensity_median    NUMERIC(6,2),            -- victimes médian / incident
  trend_pct_change    NUMERIC(6,2),            -- variation % vs période précédente
  hotspot_geom        GEOMETRY(MultiPolygon, 4326),
  computed_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (pcode, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_behavioral_aggregates_pcode
  ON behavioral_aggregates(pcode);
CREATE INDEX IF NOT EXISTS idx_behavioral_aggregates_period
  ON behavioral_aggregates(period_start DESC, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_behavioral_aggregates_hotspot
  ON behavioral_aggregates USING GIST(hotspot_geom);


-- ─── Scores de risque calculés par le moteur prédictif ───────────────────────────
-- Score = risque pour les civils dans la zone — pas information sur acteurs armés.
CREATE TABLE IF NOT EXISTS risk_scores_agent9 (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  pcode                 TEXT          NOT NULL REFERENCES admin_divisions(pcode),
  score                 NUMERIC(5,2)  NOT NULL CHECK (score BETWEEN 0 AND 100),
  level                 TEXT          NOT NULL CHECK (
    level IN ('FAIBLE','MOYEN','ELEVE','CRITIQUE')
  ),
  confidence            TEXT          NOT NULL CHECK (
    confidence IN ('FAIBLE','MODEREE','FORTE')
  ),
  uncertainty_low       NUMERIC(5,2),
  uncertainty_high      NUMERIC(5,2),
  -- Facteurs dominants avec poids SHAP pour explicabilité obligatoire
  top_factors           JSONB         NOT NULL DEFAULT '[]',
  horizon_days          INTEGER       NOT NULL CHECK (horizon_days IN (7, 30, 90)),
  model_version         TEXT          NOT NULL DEFAULT '0.1.0',
  -- Détail des 7 composantes pour audit complet
  score_historique      NUMERIC(5,2),
  score_economique      NUMERIC(5,2),
  score_ressources      NUMERIC(5,2),
  score_geographique    NUMERIC(5,2),
  score_evolution       NUMERIC(5,2),
  score_signaux_publics NUMERIC(5,2),
  score_vulnerabilite   NUMERIC(5,2),
  -- Verrou : toujours TRUE — aucune diffusion sans validation humaine
  requires_validation   BOOLEAN       NOT NULL DEFAULT TRUE,
  computed_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_scores9_pcode
  ON risk_scores_agent9(pcode);
CREATE INDEX IF NOT EXISTS idx_risk_scores9_level
  ON risk_scores_agent9(level);
CREATE INDEX IF NOT EXISTS idx_risk_scores9_horizon
  ON risk_scores_agent9(horizon_days);
CREATE INDEX IF NOT EXISTS idx_risk_scores9_computed
  ON risk_scores_agent9(computed_at DESC);


-- ─── Alertes (avant et après validation humaine) ─────────────────────────────────
-- Verrou technique : status PENDING_VALIDATION par défaut.
-- Aucune diffusion automatique — l'analyste est le seul autorisé à valider.
CREATE TABLE IF NOT EXISTS agent9_alerts (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  risk_score_id         UUID          REFERENCES risk_scores_agent9(id),
  pcode                 TEXT          NOT NULL REFERENCES admin_divisions(pcode),
  level                 TEXT          NOT NULL CHECK (
    level IN ('FAIBLE','MOYEN','ELEVE','CRITIQUE')
  ),
  -- Cycle de vie : toujours PENDING avant toute diffusion
  statut                TEXT          NOT NULL DEFAULT 'PENDING_VALIDATION' CHECK (
    statut IN ('PENDING_VALIDATION','VALIDATED','REJECTED','MODIFIED')
  ),
  -- Validation humaine obligatoire
  analyst_id            UUID          REFERENCES users(id),
  validated_at          TIMESTAMPTZ,
  analyst_note          TEXT,
  analyst_modified_level TEXT         CHECK (
    analyst_modified_level IN ('FAIBLE','MOYEN','ELEVE','CRITIQUE')
  ),
  -- Diffusion restreinte aux acteurs de protection civile autorisés
  diffused_at           TIMESTAMPTZ,
  diffusion_scope       TEXT[]        NOT NULL DEFAULT '{}',
  -- Recommandations protection civile (pas d'info tactique)
  recommended_actions   JSONB         NOT NULL DEFAULT '[]',
  -- Retour d'expérience a posteriori pour amélioration continue
  outcome_confirmed     BOOLEAN,
  outcome_note          TEXT,
  outcome_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent9_alerts_statut
  ON agent9_alerts(statut);
CREATE INDEX IF NOT EXISTS idx_agent9_alerts_pcode
  ON agent9_alerts(pcode);
CREATE INDEX IF NOT EXISTS idx_agent9_alerts_level
  ON agent9_alerts(level);
CREATE INDEX IF NOT EXISTS idx_agent9_alerts_created
  ON agent9_alerts(created_at DESC);

CREATE TRIGGER agent9_alerts_updated_at
  BEFORE UPDATE ON agent9_alerts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─── Poids de scoring versionnés et auditables ───────────────────────────────────
-- Un seul jeu de poids actif à la fois (is_active = TRUE).
-- Modification traçable : version, auteur, horodatage.
CREATE TABLE IF NOT EXISTS scoring_weights_agent9 (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  version         TEXT          NOT NULL UNIQUE,
  is_active       BOOLEAN       NOT NULL DEFAULT FALSE,
  weights         JSONB         NOT NULL,
  activated_by    UUID          REFERENCES users(id),
  activated_at    TIMESTAMPTZ,
  note            TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Pondération initiale — ajustable par admin après calibration
INSERT INTO scoring_weights_agent9 (version, is_active, weights, note)
VALUES (
  '1.0.0',
  TRUE,
  '{
    "historique_violences":         0.25,
    "importance_economique":        0.15,
    "ressources_naturelles":        0.15,
    "importance_geographique":      0.15,
    "evolution_recente_incidents":  0.15,
    "signaux_declarations_publics": 0.10,
    "vulnerabilite_populations":    0.05
  }',
  'Pondération initiale — à ajuster après calibration sur données historiques Nord-Kivu'
)
ON CONFLICT (version) DO NOTHING;


-- ─── Journal d'accès aux sorties de l'agent (auditabilité) ───────────────────────
CREATE TABLE IF NOT EXISTS agent9_access_log (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID          REFERENCES users(id),
  alert_id        UUID          REFERENCES agent9_alerts(id),
  action          TEXT          NOT NULL CHECK (
    action IN ('VIEW_SCORE','VIEW_ALERT','VALIDATE','REJECT','MODIFY','EXPORT')
  ),
  accessed_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  ip_addr         INET
);

CREATE INDEX IF NOT EXISTS idx_agent9_access_user
  ON agent9_access_log(user_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent9_access_action
  ON agent9_access_log(action, accessed_at DESC);
