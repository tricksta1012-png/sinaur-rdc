"""
Jaro-Winkler fuzzy deduplication engine for aid beneficiary dossiers.
Falls back to a pure-Python implementation if jellyfish is not installed.
"""
from __future__ import annotations

from collections import defaultdict

import structlog

from schemas.fraud import DeduplicationResult

logger = structlog.get_logger(__name__)

# --- Jaro-Winkler implementation ---

try:
    import jellyfish as _jellyfish

    def jaro_winkler(s1: str, s2: str) -> float:
        """Compute Jaro-Winkler similarity using jellyfish library."""
        if not s1 or not s2:
            return 0.0
        return float(_jellyfish.jaro_winkler_similarity(s1, s2))

    logger.debug("dedup_engine.using_jellyfish")

except ImportError:
    logger.warning("dedup_engine.jellyfish_not_found_using_fallback")

    def _jaro(s1: str, s2: str) -> float:
        """Pure-Python Jaro similarity."""
        if s1 == s2:
            return 1.0
        len1, len2 = len(s1), len(s2)
        if len1 == 0 or len2 == 0:
            return 0.0
        match_dist = max(len1, len2) // 2 - 1
        s1_matches = [False] * len1
        s2_matches = [False] * len2
        matches = 0
        transpositions = 0
        for i in range(len1):
            start = max(0, i - match_dist)
            end = min(i + match_dist + 1, len2)
            for j in range(start, end):
                if s2_matches[j] or s1[i] != s2[j]:
                    continue
                s1_matches[i] = True
                s2_matches[j] = True
                matches += 1
                break
        if matches == 0:
            return 0.0
        k = 0
        for i in range(len1):
            if not s1_matches[i]:
                continue
            while not s2_matches[k]:
                k += 1
            if s1[i] != s2[k]:
                transpositions += 1
            k += 1
        return (
            matches / len1 + matches / len2 + (matches - transpositions / 2) / matches
        ) / 3

    def jaro_winkler(s1: str, s2: str) -> float:
        """Pure-Python Jaro-Winkler similarity (fallback)."""
        if not s1 or not s2:
            return 0.0
        jaro_sim = _jaro(s1, s2)
        prefix = 0
        for i in range(min(len(s1), len(s2), 4)):
            if s1[i] == s2[i]:
                prefix += 1
            else:
                break
        return jaro_sim + prefix * 0.1 * (1 - jaro_sim)


_SIMILARITY_THRESHOLD = 0.80

# Field weights for weighted similarity score
_FIELD_WEIGHTS: dict[str, float] = {
    "nom_complet": 0.40,
    "date_naissance": 0.25,
    "taille_menage": 0.10,
    "p_code": 0.15,
    "telephone": 0.10,
}


def _make_block_key(record: dict) -> str:
    """
    Blocking key = p_code + first letter of nom_complet.
    This reduces comparison pairs from O(n²) to O(block_size²).
    """
    p_code = record.get("p_code", "XX")
    nom = record.get("nom_complet", "")
    first_letter = nom[0].upper() if nom else "?"
    return f"{p_code}:{first_letter}"


def _field_similarity(val1, val2, field: str) -> float:
    """Compute similarity between two field values."""
    if val1 is None or val2 is None:
        return 0.0

    if field in ("nom_complet",):
        return jaro_winkler(str(val1).lower(), str(val2).lower())

    if field == "date_naissance":
        # Normalize to YYYY-MM-DD
        s1 = str(val1).strip()[:10]
        s2 = str(val2).strip()[:10]
        return 1.0 if s1 == s2 else jaro_winkler(s1, s2)

    if field == "taille_menage":
        try:
            diff = abs(int(val1) - int(val2))
            return max(0.0, 1.0 - diff / 5.0)
        except (ValueError, TypeError):
            return 0.0

    if field == "p_code":
        return 1.0 if str(val1) == str(val2) else 0.0

    if field == "telephone":
        # Normalize: remove spaces and leading +243/0
        def norm_phone(p: str) -> str:
            p = str(p).replace(" ", "").replace("-", "")
            if p.startswith("+243"):
                p = p[4:]
            if p.startswith("0"):
                p = p[1:]
            return p
        return 1.0 if norm_phone(str(val1)) == norm_phone(str(val2)) else 0.0

    return jaro_winkler(str(val1), str(val2))


class DedupEngine:
    """
    Blocking + fuzzy matching deduplication engine.

    Maintains an in-memory registry of known dossiers.
    """

    def __init__(self) -> None:
        self._registry: dict[str, list[dict]] = defaultdict(list)
        # dossier_id → record
        self._all_records: dict[str, dict] = {}

    def add_record(self, record: dict) -> None:
        """Add a record to the blocking index."""
        block_key = _make_block_key(record)
        self._registry[block_key].append(record)
        dossier_id = record.get("dossier_id", "")
        if dossier_id:
            self._all_records[dossier_id] = record
        logger.debug(
            "dedup_engine.record_added",
            dossier_id=dossier_id,
            block_key=block_key,
        )

    def find_duplicates(self, record: dict) -> list[DeduplicationResult]:
        """
        Find potential duplicates for a given record.

        Uses blocking on (p_code + first_letter_of_nom) then weighted
        Jaro-Winkler similarity on all five fields.
        Returns candidates above the 0.80 similarity threshold.
        """
        block_key = _make_block_key(record)
        candidates = self._registry.get(block_key, [])
        dossier_id = record.get("dossier_id", "")
        results: list[DeduplicationResult] = []

        for candidate in candidates:
            candidate_id = candidate.get("dossier_id", "")
            if candidate_id == dossier_id:
                continue  # skip self

            weighted_score = 0.0
            match_fields: dict[str, float] = {}

            for field, weight in _FIELD_WEIGHTS.items():
                sim = _field_similarity(
                    record.get(field), candidate.get(field), field
                )
                weighted_score += weight * sim
                match_fields[field] = round(sim, 3)

            if weighted_score >= _SIMILARITY_THRESHOLD:
                results.append(
                    DeduplicationResult(
                        dossier_id=candidate_id,
                        similarity_score=round(weighted_score, 4),
                        match_fields=match_fields,
                        status="POSSIBLE_DUPLICATE",
                    )
                )
                logger.info(
                    "dedup_engine.duplicate_found",
                    source_id=dossier_id,
                    candidate_id=candidate_id,
                    score=round(weighted_score, 4),
                )

        results.sort(key=lambda r: r.similarity_score, reverse=True)
        return results

    def resolve(self, dossier_id: str, resolution: str) -> bool:
        """Mark a duplicate resolution (CONFIRMED_DUPLICATE or FALSE_POSITIVE)."""
        if dossier_id not in self._all_records:
            return False
        self._all_records[dossier_id]["_resolution"] = resolution
        return True

    def all_records(self) -> list[dict]:
        return list(self._all_records.values())

    def stats(self) -> dict:
        total_records = sum(len(v) for v in self._registry.values())
        return {
            "blocks": len(self._registry),
            "total_records": total_records,
            "unique_dossiers": len(self._all_records),
        }
