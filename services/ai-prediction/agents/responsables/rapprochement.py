"""
Rapprochement géographique — rattache l'entité détectée aux admin_divisions.
"""
from __future__ import annotations

import structlog

logger = structlog.get_logger(__name__)


async def rapprocher_entite(nomination: dict, pool) -> dict:
    """
    Cherche l'entité administrative correspondant au nom extrait par Claude.

    Modifie nomination in-place avec :
      - pcode             : si résultat unique (CERTAIN)
      - candidats         : si résultats multiples (AMBIGU)
      - statut_rapprochement : CERTAIN | AMBIGU | ENTITE_INTROUVABLE
    """
    nom = nomination.get('entite', '')

    try:
        candidats = await pool.fetch(
            """
            SELECT pcode, name_fr, level, parent_pcode
            FROM admin_divisions
            WHERE is_active = TRUE
              AND (name_fr ILIKE $1 OR name_fr ILIKE $2)
            ORDER BY level ASC
            LIMIT 5
            """,
            nom,
            f'%{nom}%',
        )
    except Exception as exc:
        logger.warning("rapprochement.db_error", entite=nom, error=str(exc))
        nomination['statut_rapprochement'] = 'ENTITE_INTROUVABLE'
        return nomination

    if len(candidats) == 0:
        nomination['statut_rapprochement'] = 'ENTITE_INTROUVABLE'
    elif len(candidats) == 1:
        nomination['pcode'] = candidats[0]['pcode']
        nomination['statut_rapprochement'] = 'CERTAIN'
    else:
        nomination['candidats'] = [dict(r) for r in candidats]
        nomination['statut_rapprochement'] = 'AMBIGU'

    return nomination
