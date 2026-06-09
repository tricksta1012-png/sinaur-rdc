"""
Rule-based Displacement Risk Model for SINAUR-RDC.
"""
from __future__ import annotations

from agents.prediction.models.base import BaseRiskModel
from schemas.risk import FactorContribution, RiskScore, RiskType


class DisplacementRiskModel(BaseRiskModel):
    risk_type = RiskType.DISPLACEMENT
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
        idp_count: int = features.get("idp_count", 0)
        idp_threshold: int = features.get("idp_threshold", 100_000)
        nb_evenements_7j: int = features.get("nb_evenements_meme_type_7j", 0)
        ipc_level: int = features.get("ipc_level", 1)
        nb_signalements: int = features.get("nb_signalements_citoyens_7j", 0)

        # Rule 1: IDP count above province threshold
        contrib_idp = 35.0 if idp_count > idp_threshold else (15.0 if idp_count > idp_threshold // 2 else 0.0)
        factors.append(
            FactorContribution(
                name="idp_count",
                value=idp_count,
                contribution=contrib_idp,
                direction="+" if contrib_idp > 0 else "-",
            )
        )

        # Rule 2: Repeated events of the same type in 7 days
        contrib_events = 25.0 if nb_evenements_7j > 2 else (10.0 if nb_evenements_7j > 0 else 0.0)
        factors.append(
            FactorContribution(
                name="nb_evenements_meme_type_7j",
                value=nb_evenements_7j,
                contribution=contrib_events,
                direction="+" if contrib_events > 0 else "-",
            )
        )

        # Rule 3: IPC food security level ≥ 3 (Crisis)
        contrib_ipc = 20.0 if ipc_level >= 3 else (5.0 if ipc_level == 2 else 0.0)
        factors.append(
            FactorContribution(
                name="ipc_level",
                value=ipc_level,
                contribution=contrib_ipc,
                direction="+" if contrib_ipc > 0 else "-",
            )
        )

        # Rule 4: Citizen report volume
        contrib_reports = 10.0 if nb_signalements > 5 else (5.0 if nb_signalements > 0 else 0.0)
        factors.append(
            FactorContribution(
                name="nb_signalements_citoyens_7j",
                value=nb_signalements,
                contribution=contrib_reports,
                direction="+" if contrib_reports > 0 else "-",
            )
        )

        return factors
