"""
Rule-based Flood Risk Model for SINAUR-RDC.
"""
from __future__ import annotations

from agents.prediction.models.base import BaseRiskModel
from schemas.risk import FactorContribution, RiskScore, RiskType


class FloodRiskModel(BaseRiskModel):
    risk_type = RiskType.FLOOD
    version = "1.0.0-rules"

    def predict(self, features: dict) -> RiskScore:
        factors = self.explain(features)
        score = sum(f.contribution for f in factors if f.contribution > 0)
        p_code: str = features.get("p_code", "UNKNOWN")
        province: str = features.get("province", features.get("p_code", "UNKNOWN"))
        horizon_days: int = features.get("horizon_days", 7)
        return self._make_score(p_code, province, score, factors, horizon_days)

    def explain(self, features: dict) -> list[FactorContribution]:
        factors: list[FactorContribution] = []
        precip = features.get("precipitation_7j_mm", 0.0)
        dist_eau = features.get("distance_cours_eau_km", 5.0)
        saison = features.get("saison_pluies", False)
        idp_thousands = features.get("idp_count_thousands", 0.0)

        # Rule 1: Heavy precipitation (> 80mm over 7 days)
        if precip > 80:
            contrib = 40.0
        elif precip > 40:
            contrib = 20.0
        else:
            contrib = 0.0
        factors.append(
            FactorContribution(
                name="precipitation_7j_mm",
                value=round(precip, 1),
                contribution=contrib,
                direction="+" if contrib > 0 else "-",
            )
        )

        # Rule 2: Proximity to water bodies
        if dist_eau < 2.0:
            contrib_eau = 15.0
        else:
            contrib_eau = 0.0
        factors.append(
            FactorContribution(
                name="distance_cours_eau_km",
                value=round(dist_eau, 2),
                contribution=contrib_eau,
                direction="+" if contrib_eau > 0 else "-",
            )
        )

        # Rule 3: Rainy season
        contrib_saison = 10.0 if saison else 0.0
        factors.append(
            FactorContribution(
                name="saison_pluies",
                value=saison,
                contribution=contrib_saison,
                direction="+" if contrib_saison > 0 else "-",
            )
        )

        # Rule 4: IDP displacement pressure
        contrib_idp = min(20.0, 5.0 * idp_thousands)
        factors.append(
            FactorContribution(
                name="idp_count_thousands",
                value=round(idp_thousands, 1),
                contribution=round(contrib_idp, 2),
                direction="+" if contrib_idp > 0 else "-",
            )
        )

        # Base score
        factors.append(
            FactorContribution(
                name="base_score",
                value=10.0,
                contribution=10.0,
                direction="+",
            )
        )

        return factors
