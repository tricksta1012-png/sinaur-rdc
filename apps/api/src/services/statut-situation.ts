/**
 * Recalcule statut_situation pour toutes les provinces (level=1).
 * Combine : incidents terrain (disaster_events) + signaux corroborés (evenement_flux).
 *
 * Seuils :
 *   CRISE     : ≥ 10 graves OU ≥ 20 incidents OU flux CRITIQUE corroboré
 *   ALERTE    : ≥  3 graves OU ≥ 10 incidents OU flux ELEVÉ corroboré
 *   VIGILANCE : ≥  1 incident
 *   NORMAL    : aucun signal
 */
import { sql } from '../db.js';

export async function refreshStatutSituation(): Promise<void> {
  const updated = await sql<{ pcode: string; name: string; statutSituation: string }[]>`
    WITH incidents AS (
      SELECT
        a.pcode,
        COUNT(e.id)                                                   AS total,
        COUNT(e.id) FILTER (WHERE e.severity IN ('Severe','Extreme')) AS graves
      FROM admin_divisions a
      LEFT JOIN disaster_events e
        ON  e.location_pcode LIKE a.pcode || '%'
        AND e.deleted_at IS NULL
        AND e.status NOT IN ('rejected')
        AND e.start_date >= NOW() - INTERVAL '30 days'
      WHERE a.level = 1
      GROUP BY a.pcode
    ),
    flux AS (
      SELECT
        province_pcode AS pcode,
        MAX(CASE
          WHEN impacte_statut AND gravite = 'CRITIQUE' THEN 4
          WHEN impacte_statut AND gravite = 'ELEVEE'   THEN 3
          ELSE 0
        END) AS flux_niveau
      FROM evenement_flux
      WHERE date_evenement >= NOW() - INTERVAL '30 days'
        AND statut_verification IN ('CORROBORE','PROBABLE')
        AND province_pcode IS NOT NULL
      GROUP BY province_pcode
    ),
    new_statuts AS (
      SELECT
        a.pcode,
        a.name,
        CASE
          WHEN COALESCE(i.graves, 0) >= 10
            OR  COALESCE(i.total,  0) >= 20
            OR  COALESCE(f.flux_niveau, 0) = 4
            THEN 'CRISE'
          WHEN COALESCE(i.graves, 0) >= 3
            OR  COALESCE(i.total,  0) >= 10
            OR  COALESCE(f.flux_niveau, 0) = 3
            THEN 'ALERTE'
          WHEN COALESCE(i.total, 0) >= 1
            THEN 'VIGILANCE'
          ELSE 'NORMAL'
        END AS new_statut
      FROM admin_divisions a
      LEFT JOIN incidents i USING (pcode)
      LEFT JOIN flux f USING (pcode)
      WHERE a.level = 1
    )
    UPDATE admin_divisions d
    SET statut_situation = n.new_statut
    FROM new_statuts n
    WHERE d.pcode = n.pcode
      AND d.statut_situation IS DISTINCT FROM n.new_statut
    RETURNING d.pcode, d.name, d.statut_situation
  `;

  if (updated.length > 0) {
    const changes = updated.map(r => `${r.name}(${r.pcode})→${r.statutSituation}`).join(', ');
    console.log(`[statut-situation] ${updated.length} province(s) mise(s) à jour : ${changes}`);
  }
}

export function startStatutSituationScheduler(): void {
  refreshStatutSituation().catch(err =>
    console.error('[statut-situation] Erreur initiale:', err.message),
  );
  setInterval(
    () => refreshStatutSituation().catch(err =>
      console.error('[statut-situation] Erreur planifiée:', err.message),
    ),
    5 * 60 * 1000,
  );
}
