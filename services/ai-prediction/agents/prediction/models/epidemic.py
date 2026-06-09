"""
Rule-based Epidemic Risk Model for SINAUR-RDC.
"""
from __future__ import annotations

from agents.prediction.models.base import BaseRiskModel
from schemas.risk import FactorContribution, RiskScore, RiskType

_SEUIL_SIGNALEMENTS_SANITAIRES = 5


class EpidemicRiskModel(BaseRiskModel):
    risk_type = RiskType.EPIDEMIC
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
        nb_sanitaires: int = features.get("nb_signalements_sanitaires_7j", 0)
        ipc_level: int = features.get("ipc_level", 1)
        idp_count: int = features.get("idp_count", 0)
        saison: bool = features.get("saison_pluies", False)

        # Rule 1: Health/sanitary reports above threshold
        contrib_sanitaires = 40.0 if nb_sanitaires > _SEUIL_SIGNALEMENTS_SANITAIRES else (
            20.0 if nb_sanitaires > 0 else 0.0
        )
        factors.append(
            FactorContribution(
                name="nb_signalements_sanitaires_7j",
                value=nb_sanitaires,
                contribution=contrib_sanitaires,
                direction="+" if contrib_sanitaires > 0 else "-",
            )
        )

        # Rule 2: Food insecurity (malnutrition → immunodeficiency)
        contrib_ipc = 25.0 if ipc_level >= 3 else (10.0 if ipc_level == 2 else 0.0)
        factors.append(
            FactorContribution(
                name="ipc_level",
                value=ipc_level,
                contribution=contrib_ipc,
                direction="+" if contrib_ipc > 0 else "-",
            )
        )

        # Rule 3: Large displaced population → overcrowding risk
        contrib_idp = 20.0 if idp_count > 50_000 else (10.0 if idp_count > 10_000 else 0.0)
        factors.append(
            FactorContribution(
                name="idp_count",
                value=idp_count,
                contribution=contrib_idp,
                direction="+" if contrib_idp > 0 else "-",
            )
        )

        # Rule 4: Rainy season → cholera/waterborne disease risk
        contrib_saison = 10.0 if saison else 0.0
        factors.append(
            FactorContribution(
                name="saison_pluies",
                value=saison,
                contribution=contrib_saison,
                direction="+" if contrib_saison > 0 else "-",
            )
        )

        return factors
