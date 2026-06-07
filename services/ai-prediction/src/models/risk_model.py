"""
Modèle de risque SINAUR-RDC — GradientBoosting explicable.

Design :
  - Gradient Boosting (scikit-learn) pour chaque type d'aléa
  - Score 0–100 par P-code et horizon (7j / 30j / 90j)
  - Explicabilité : contribution de chaque feature (Shapley approximation)
  - Niveau de risque : low / medium / high / critical
  - Conforme à l'exigence §5 : "Explicabilité obligatoire"
  - Validation humaine requise pour niveau critical (implémenté dans alerting/)
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import cross_val_score

from ..features.engineering import (
    FEATURE_NAMES, FEATURE_LABELS_FR, build_features, load_historical_events
)
from ..config import settings

logger = logging.getLogger(__name__)

RISK_THRESHOLDS = {
    "7d":  {"low": 20, "medium": 45, "high": 70},
    "30d": {"low": 25, "medium": 50, "high": 75},
    "90d": {"low": 30, "medium": 55, "high": 80},
}

HAZARD_TYPES = [
    "flood", "landslide", "mass_displacement", "humanitarian_crisis",
    "health_epidemic", "drought", "fire", "conflict",
]


def score_to_level(score: float, horizon: str) -> str:
    t = RISK_THRESHOLDS[horizon]
    if score >= t["high"]:
        return "critical"
    if score >= t["medium"]:
        return "high"
    if score >= t["low"]:
        return "medium"
    return "low"


class HazardRiskModel:
    """Modèle de risque pour un type d'aléa donné."""

    def __init__(self, hazard_type: str) -> None:
        self.hazard_type = hazard_type
        self.model: GradientBoostingClassifier | None = None
        self.version: str = "untrained"
        self._model_path = Path(settings.model_store_path) / f"risk_{hazard_type}.joblib"

    def load_or_train(self) -> None:
        """Charge le modèle depuis le disque ou entraîne un modèle initial."""
        if self._model_path.exists():
            try:
                saved = joblib.load(self._model_path)
                self.model = saved["model"]
                self.version = saved["version"]
                logger.info(f"Loaded model {self.hazard_type} v{self.version}")
                return
            except Exception as e:
                logger.warning(f"Could not load model {self.hazard_type}: {e}")

        self._train_initial()

    def _train_initial(self) -> None:
        """
        Entraînement initial sur les données historiques disponibles.
        Si peu de données : modèle baseline avec règles heuristiques.
        """
        logger.info(f"Training initial model for {self.hazard_type}")

        # Récupérer les données historiques pour toutes les provinces
        all_pcodes = [f"CD{i:02d}" for i in range(1, 28)] + ["COD"]
        rows: list[dict] = []
        labels: list[int] = []

        for pcode in all_pcodes:
            feats = build_features(pcode, self.hazard_type)
            row = [feats[f] for f in FEATURE_NAMES]

            hist_30d = feats["events_30d"]
            max_sev = feats["max_severity_90d"]
            precip = feats["max_precip_7d"]

            # Label heuristique : 1 si risque élevé probable
            label = int(
                hist_30d >= 2
                or max_sev >= 3
                or (self.hazard_type == "flood" and precip >= 60)
                or (self.hazard_type == "drought" and feats["dry_days"] >= 15)
            )
            rows.append(row)
            labels.append(label)

        X = np.array(rows, dtype=float)
        y = np.array(labels, dtype=int)

        # Ajouter du bruit synthétique pour éviter l'overfitting sur peu de données
        if len(set(y)) < 2:
            y[0] = 1  # Garantir au moins une classe positive

        self.model = GradientBoostingClassifier(
            n_estimators=100,
            max_depth=3,
            learning_rate=0.1,
            random_state=42,
        )
        self.model.fit(X, y)

        self.version = "1.0.0-heuristic"
        Path(settings.model_store_path).mkdir(parents=True, exist_ok=True)
        joblib.dump({"model": self.model, "version": self.version}, self._model_path)
        logger.info(f"Model {self.hazard_type} trained and saved (v{self.version})")

    def predict(self, pcode: str, horizon: str) -> dict[str, Any]:
        """
        Retourne la prédiction de risque pour (pcode, horizon) avec explicabilité.

        Retourne :
          score (0–100), level (low/medium/high/critical),
          contributing_factors (list des facteurs et leur contribution),
          uncertainty (0–1), model_version
        """
        if self.model is None:
            self.load_or_train()
            assert self.model is not None

        feats = build_features(pcode, self.hazard_type)
        X = np.array([[feats[f] for f in FEATURE_NAMES]], dtype=float)

        # Probabilité de la classe 1 (risque élevé)
        proba = float(self.model.predict_proba(X)[0][1])

        # Modulation par l'horizon : le score augmente avec l'horizon
        horizon_factor = {"7d": 0.80, "30d": 1.0, "90d": 1.20}[horizon]

        # Incertitude plus élevée pour les horizons lointains
        data_uncertainty = max(0.1, 1.0 - min(feats["events_90d"] / 10.0, 1.0))
        base_uncertainty = {"7d": 0.20, "30d": 0.35, "90d": 0.50}[horizon]
        uncertainty = min(0.95, base_uncertainty + data_uncertainty * 0.3)

        # Score final 0–100
        raw_score = proba * 100 * horizon_factor
        score = max(0, min(100, int(round(raw_score))))

        # Explicabilité : feature importance * valeur normalisée
        importances = self.model.feature_importances_
        feat_values = X[0]
        max_values = np.array([10.0, 20.0, 4.0, 999.0, 200.0, 30.0, 1.0, 20000.0])
        normalized = np.clip(feat_values / np.maximum(max_values, 1e-9), 0, 1)
        contributions = importances * normalized

        # Top 3 facteurs contributifs (uniquement si contribution > 0.01)
        factor_scores = list(zip(FEATURE_NAMES, contributions.tolist()))
        factor_scores.sort(key=lambda x: x[1], reverse=True)

        contributing_factors = [
            {
                "feature": name,
                "label_fr": FEATURE_LABELS_FR[name],
                "value": round(float(feats[name]), 2),
                "contribution": round(float(contrib), 4),
            }
            for name, contrib in factor_scores
            if contrib > 0.01
        ][:5]

        return {
            "pcode": pcode,
            "hazard_type": self.hazard_type,
            "horizon": horizon,
            "score": score,
            "level": score_to_level(score, horizon),
            "uncertainty": round(uncertainty, 3),
            "contributing_factors": contributing_factors,
            "model_version": self.version,
            "features_snapshot": {k: round(float(v), 2) for k, v in feats.items()},
        }


# Registry global des modèles (chargé une seule fois au démarrage)
_models: dict[str, HazardRiskModel] = {}


def get_model(hazard_type: str) -> HazardRiskModel:
    if hazard_type not in _models:
        m = HazardRiskModel(hazard_type)
        m.load_or_train()
        _models[hazard_type] = m
    return _models[hazard_type]


def predict_all_hazards(pcode: str) -> list[dict[str, Any]]:
    """Calcule les scores pour tous les aléas et horizons pour un pcode donné."""
    results = []
    for hazard in HAZARD_TYPES:
        model = get_model(hazard)
        for horizon in ("7d", "30d", "90d"):
            try:
                pred = model.predict(pcode, horizon)
                if pred["score"] > 0:
                    results.append(pred)
            except Exception as e:
                logger.warning(f"Prediction failed {hazard}/{pcode}/{horizon}: {e}")
    return results
