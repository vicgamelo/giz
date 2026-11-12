"""Catálogo de modelos do AutoML. Cada candidato é uma especificação (classe + parâmetros), para o mesmo dado
gerar o estimador aqui, o script exportado e o registro no MLflow."""

from __future__ import annotations

import importlib

# fmt: off
CLASSIFIERS = [
    {"key": "baseline", "label": "Referência (classe mais frequente)", "cls": "sklearn.dummy.DummyClassifier",
     "params": {"strategy": "prior"}, "scale": False, "cost": 0},
    {"key": "logreg", "label": "Regressão logística", "cls": "sklearn.linear_model.LogisticRegression",
     "params": {"C": 1.0, "max_iter": 1000}, "scale": True, "cost": 1},
    {"key": "hgb", "label": "Gradient boosting (scikit-learn)",
     "cls": "sklearn.ensemble.HistGradientBoostingClassifier",
     "params": {"learning_rate": 0.08, "max_iter": 200, "early_stopping": True, "random_state": 42},
     "scale": False, "cost": 3},
    {"key": "lgbm", "label": "LightGBM", "cls": "lightgbm.LGBMClassifier",
     "params": {"n_estimators": 300, "learning_rate": 0.05, "num_leaves": 31, "subsample": 0.8,
                "subsample_freq": 1, "colsample_bytree": 0.8, "random_state": 42, "n_jobs": 1, "verbose": -1},
     "scale": False, "cost": 3},
    {"key": "xgb", "label": "XGBoost", "cls": "xgboost.XGBClassifier",
     "params": {"n_estimators": 300, "learning_rate": 0.05, "max_depth": 4, "subsample": 0.8,
                "colsample_bytree": 0.8, "random_state": 42, "n_jobs": 1, "tree_method": "hist"},
     "scale": False, "cost": 3},
    {"key": "extra", "label": "Extra Trees", "cls": "sklearn.ensemble.ExtraTreesClassifier",
     "params": {"n_estimators": 200, "min_samples_leaf": 2, "random_state": 42, "n_jobs": 1}, "scale": False, "cost": 4},
    {"key": "rf", "label": "Random Forest", "cls": "sklearn.ensemble.RandomForestClassifier",
     "params": {"n_estimators": 200, "min_samples_leaf": 2, "random_state": 42, "n_jobs": 1}, "scale": False, "cost": 5},
    {"key": "logreg_l1", "label": "Regressão logística (L1, C=0,1)", "cls": "sklearn.linear_model.LogisticRegression",
     "params": {"C": 0.1, "l1_ratio": 1.0, "solver": "saga", "max_iter": 2000}, "scale": True, "cost": 2},
    {"key": "lgbm_small", "label": "LightGBM (árvores rasas)", "cls": "lightgbm.LGBMClassifier",
     "params": {"n_estimators": 500, "learning_rate": 0.03, "num_leaves": 15, "min_child_samples": 30,
                "subsample": 0.8, "subsample_freq": 1, "colsample_bytree": 0.7, "random_state": 42, "n_jobs": 1,
                "verbose": -1},
     "scale": False, "cost": 4},
    {"key": "knn", "label": "k vizinhos (k=25)", "cls": "sklearn.neighbors.KNeighborsClassifier",
     "params": {"n_neighbors": 25, "weights": "distance"}, "scale": True, "cost": 4, "max_rows": 20000,
     "stores_data": True},
]

REGRESSORS = [
    {"key": "baseline", "label": "Referência (média)", "cls": "sklearn.dummy.DummyRegressor",
     "params": {"strategy": "mean"}, "scale": False, "cost": 0},
    {"key": "ridge", "label": "Regressão linear (Ridge)", "cls": "sklearn.linear_model.Ridge",
     "params": {"alpha": 1.0}, "scale": True, "cost": 1},
    {"key": "hgb", "label": "Gradient boosting (scikit-learn)",
     "cls": "sklearn.ensemble.HistGradientBoostingRegressor",
     "params": {"learning_rate": 0.08, "max_iter": 200, "early_stopping": True, "random_state": 42},
     "scale": False, "cost": 3},
    {"key": "lgbm", "label": "LightGBM", "cls": "lightgbm.LGBMRegressor",
     "params": {"n_estimators": 300, "learning_rate": 0.05, "num_leaves": 31, "subsample": 0.8,
                "subsample_freq": 1, "colsample_bytree": 0.8, "random_state": 42, "n_jobs": 1, "verbose": -1},
     "scale": False, "cost": 3},
    {"key": "xgb", "label": "XGBoost", "cls": "xgboost.XGBRegressor",
     "params": {"n_estimators": 300, "learning_rate": 0.05, "max_depth": 5, "subsample": 0.8,
                "colsample_bytree": 0.8, "random_state": 42, "n_jobs": 1, "tree_method": "hist"},
     "scale": False, "cost": 3},
    {"key": "extra", "label": "Extra Trees", "cls": "sklearn.ensemble.ExtraTreesRegressor",
     "params": {"n_estimators": 200, "min_samples_leaf": 2, "random_state": 42, "n_jobs": 1}, "scale": False, "cost": 4},
    {"key": "rf", "label": "Random Forest", "cls": "sklearn.ensemble.RandomForestRegressor",
     "params": {"n_estimators": 200, "min_samples_leaf": 2, "random_state": 42, "n_jobs": 1}, "scale": False, "cost": 5},
    {"key": "lgbm_small", "label": "LightGBM (árvores rasas)", "cls": "lightgbm.LGBMRegressor",
     "params": {"n_estimators": 500, "learning_rate": 0.03, "num_leaves": 15, "min_child_samples": 30,
                "subsample": 0.8, "subsample_freq": 1, "colsample_bytree": 0.7, "random_state": 42, "n_jobs": 1,
                "verbose": -1},
     "scale": False, "cost": 4},
    {"key": "knn", "label": "k vizinhos (k=15)", "cls": "sklearn.neighbors.KNeighborsRegressor",
     "params": {"n_neighbors": 15, "weights": "distance"}, "scale": True, "cost": 4, "max_rows": 20000,
     "stores_data": True},
]
# fmt: on


def catalog(problem: str) -> list[dict]:
    return REGRESSORS if problem == "regression" else CLASSIFIERS


def available(spec: dict) -> bool:
    mod = spec["cls"].rsplit(".", 1)[0]
    try:
        importlib.import_module(mod)
    except Exception:  # noqa: BLE001 — sem libomp no macOS, por exemplo
        return False
    return True


def build(spec: dict):
    mod, name = spec["cls"].rsplit(".", 1)
    return getattr(importlib.import_module(mod), name)(**spec["params"])
