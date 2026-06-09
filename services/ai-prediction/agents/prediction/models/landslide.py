"""
Rule-based Landslide Risk Model for SINAUR-RDC.
"""
from __future__ import annotations

from agents.prediction.models.base import BaseRiskModel
from schemas.risk import FactorContribution, RiskScore, RiskType


class LandslideRiskModel(BaseRiskModel):
    risk_type = RiskType.LANDSLIDE
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
        pente = features.get("pente_moyenne", 5.0)
        altitude = features.get("altitude_m", 500.0)
        couverture = features.get("couverture_forestiere_pct", 50.0)
        saison = features.get("saison_pluies", False)

        # Rule 1: Significant precipitation (saturates soil)
        contrib_precip = 40.0 if precip > 60 else (20.0 if precip > 30 else 0.0)
        factors.append(
            FactorContribution(
                name="precipitation_7j_mm",
                value=round(precip, 1),
                contribution=contrib_precip,
                direction="+" if contrib_precip > 0 else "-",
            )
        )

        # Rule 2: Steep slope
        contrib_pente = 30.0 if pente > 15 else (15.0 if pente > 8 else 0.0)
        factors.append(
            FactorContribution(
                name="pente_moyenne",
                value=round(pente, 1),
                contribution=contrib_pente,
                direction="+" if contrib_pente > 0 else "-",
            )
        )

        # Rule 3: High altitude
        contrib_altitude = 15.0 if altitude > 1000 else 0.0
        factors.append(
            FactorContribution(
                name="altitude_m",
                value=round(altitude, 0),
                contribution=contrib_altitude,
                direction="+" if contrib_altitude > 0 else "-",
            )
        )

        # Rule 4: Deforestation risk (low tree cover)
        contrib_foret = 10.0 if couverture < 30 else 0.0
        factors.append(
            FactorContribution(
                name="couverture_forestiere_pct",
                value=round(couverture, 1),
                contribution=contrib_foret,
                direction="+" if contrib_foret > 0 else "-",
            )
        )

        # Rule 5: Rainy season
        contrib_saison = 5.0 if saison else 0.0
        factors.append(
            FactorContribution(
                name="saison_pluies",
                value=saison,
                contribution=contrib_saison,
                direction="+" if contrib_saison > 0 else "-",
            )
        )

        return factors
