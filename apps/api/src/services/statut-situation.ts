/**
 * Recalcule statut_situation pour toutes les provinces (level=1)
 * en fonction des incidents actifs des 30 derniers jours.
 *
 * Seuils par province :
 *   CRISE     : ≥ 10 incidents Severe/Extreme  OU  ≥ 20 incidents actifs
 *   ALERTE    : ≥  3 incidents Severe/Extreme  OU  ≥ 10 incidents actifs
 *   VIGILANCE : ≥  1 incident actif
 *   NORMAL    : aucun incident actif
 */
import { sql } from '../db.js';

export async function refreshStatutSituation(): Promise<void> {
  const updated = await sql<{ pcode: string; name: string; statutSituation: string }[]>`
    WITH new_statuts AS (
      SELECT
        a.pcode,
        a.name,
        CASE
          WHEN COUNT(e.id) FILTER (WHERE e.severity IN ('Severe','Extreme')) >= 10
            OR  COUNT(e.id) >= 20
            THEN 'CRISE'
          WHEN COUNT(e.id) FILTER (WHERE e.severity IN ('Severe','Extreme')) >= 3
            OR  COUNT(e.id) >= 10
            THEN 'ALERTE'
          WHEN COUNT(e.id) >= 1
            THEN 'VIGILANCE'
          ELSE 'NORMAL'
        END AS new_statut
      FROM admin_divisions a
      LEFT JOIN disaster_events e
        ON  e.location_pcode LIKE a.pcode || '%'
        AND e.deleted_at IS NULL
        AND e.status NOT IN ('rejected')
        AND e.start_date >= NOW() - INTERVAL '30 days'
      WHERE a.level = 1
      GROUP BY a.pcode, a.name
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
