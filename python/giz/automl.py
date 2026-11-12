"""AutoML: detecta o problema, compara modelos por validação cruzada dentro de um orçamento de tempo e avalia o
vencedor num holdout que o ranking nunca viu.

Fluxo: separa 20% de holdout → ranking por CV nos 80% (até `CV_MAX_ROWS` linhas) → o vencedor treina nos 80% e é
avaliado no holdout (métricas, curvas, importância por permutação) → treina de novo em 100% para prever e exportar.
O pré-processamento (imputação, one-hot, escala) fica dentro do pipeline, então cada fold aprende só com o seu treino.
"""

from __future__ import annotations

import time
import warnings
from collections.abc import Callable

import numpy as np
import pandas as pd

from . import models
from .jsonable import br
from .profile import column_kind

CV_MAX_ROWS = 50_000
HOLDOUT = 0.2
SEED = 42
RESERVE = 0.15  # parte do orçamento guardada para treinar e avaliar o vencedor
LEAK_SCORE = 0.97
LEAK_R2 = 0.95


class AutoMLError(ValueError):
    pass


# --- problema e colunas --------------------------------------------------------------------------------------


def detect_problem(y: pd.Series) -> str:
    y = y.dropna()
    if pd.api.types.is_bool_dtype(y) or not pd.api.types.is_numeric_dtype(y):
        return "binary" if y.nunique() == 2 else "multiclass"
    n = y.nunique()
    if n <= 2:
        return "binary"
    integer = np.all(np.mod(y.to_numpy(dtype=float), 1) == 0)
    if integer and n <= 10:
        return "multiclass"
    return "regression"


def feature_columns(df: pd.DataFrame, target: str) -> tuple[list[str], list[str], list[dict]]:
    num, cat, ignored = [], [], []
    for c in df.columns:
        if c == target:
            continue
        s = df[c]
        kind = column_kind(s)
        if s.nunique(dropna=True) <= 1:
            ignored.append({"column": c, "reason": "valor constante"})
        elif kind == "datetime":
            ignored.append({"column": c, "reason": "data: converta na receita para usar"})
        elif kind == "text":
            ignored.append({"column": c, "reason": "texto livre"})
        elif kind == "numeric":
            num.append(c)
        else:
            cat.append(c)
    return num, cat, ignored


def preprocessor(num: list[str], cat: list[str], scale: bool):
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import OneHotEncoder, StandardScaler

    num_steps = [SimpleImputer(strategy="median")] + ([StandardScaler()] if scale else [])
    cat_steps = [
        SimpleImputer(strategy="most_frequent"),
        OneHotEncoder(handle_unknown="infrequent_if_exist", max_categories=30, sparse_output=False),
    ]
    parts = []
    if num:
        parts.append(("num", make_pipeline(*num_steps), num))
    if cat:
        parts.append(("cat", make_pipeline(*cat_steps), cat))
    return ColumnTransformer(parts, remainder="drop", verbose_feature_names_out=False)


def make_pipeline_for(spec: dict, num: list[str], cat: list[str]):
    from sklearn.pipeline import Pipeline

    return Pipeline([("prep", preprocessor(num, cat, spec["scale"])), ("model", models.build(spec))])


def prepare_xy(df: pd.DataFrame, target: str, problem: str, positive=None):
    """Tira linhas sem alvo, converte as categóricas para texto e codifica o alvo da classificação."""
    if target not in df.columns:
        raise AutoMLError(f"A coluna alvo '{target}' não existe depois da receita.")
    d = df[df[target].notna()].reset_index(drop=True)
    if len(d) < 30:
        raise AutoMLError("Preciso de pelo menos 30 linhas com o alvo preenchido.")
    num, cat, ignored = feature_columns(d, target)
    if not num and not cat:
        raise AutoMLError("Nenhuma coluna sobrou para usar como variável.")
    X = d[num + cat].copy()
    for c in cat:
        X[c] = X[c].astype("str").where(X[c].notna()).astype(object)
    for c in num:
        X[c] = X[c].astype(float)
    y_raw = d[target]
    classes = None
    if problem == "regression":
        if not pd.api.types.is_numeric_dtype(y_raw):
            raise AutoMLError(f"'{target}' não é numérica; não dá para tratar como regressão.")
        y = y_raw.astype(float).to_numpy()
    else:
        labels = y_raw.astype("str")
        counts = labels.value_counts()
        if len(counts) < 2:
            raise AutoMLError("O alvo tem uma classe só.")
        if len(counts) > 50:
            raise AutoMLError(f"O alvo tem {len(counts)} classes; o limite é 50 (é regressão?).")
        if problem == "binary" and len(counts) != 2:
            problem = "multiclass"
        if problem == "binary":
            pos = (
                str(positive)
                if positive is not None and str(positive) in counts.index
                else _default_positive(counts)
            )
            classes = [c for c in counts.index if c != pos] + [pos]
        else:
            classes = sorted(counts.index.tolist())
        index = {c: i for i, c in enumerate(classes)}
        y = labels.map(index).to_numpy()
    return X, y, num, cat, ignored, classes, problem


def _default_positive(counts: pd.Series) -> str:
    for p in ("1", "1.0", "True", "true", "sim", "Sim", "yes", "bad", "mau", "inadimplente"):
        if p in counts.index:
            return p
    return str(counts.idxmin())


# --- métricas ------------------------------------------------------------------------------------------------

LEAK_LABEL = {"binary": "AUC", "multiclass": "acurácia balanceada", "regression": "R²"}
PRIMARY = {"binary": "roc_auc", "multiclass": "f1_macro", "regression": "rmse"}
LOWER_IS_BETTER = {"rmse", "mae", "log_loss"}


def predict_scores(pipe, X, problem):
    if problem == "regression":
        return pipe.predict(X)
    return pipe.predict_proba(X)


def metrics(problem: str, y, out) -> dict:
    from sklearn import metrics as m

    if problem == "regression":
        rmse = float(np.sqrt(m.mean_squared_error(y, out)))
        return {"rmse": rmse, "mae": float(m.mean_absolute_error(y, out)), "r2": float(m.r2_score(y, out))}
    pred = out.argmax(axis=1)
    res = {
        "accuracy": float(m.accuracy_score(y, pred)),
        "balanced_accuracy": float(m.balanced_accuracy_score(y, pred)),
        "f1_macro": float(m.f1_score(y, pred, average="macro")),
    }
    if problem == "binary":
        p1 = out[:, 1]
        res.update(
            {
                "roc_auc": float(m.roc_auc_score(y, p1)) if len(np.unique(y)) == 2 else float("nan"),
                "f1": float(m.f1_score(y, pred)),
                "precision": float(m.precision_score(y, pred, zero_division=0)),
                "recall": float(m.recall_score(y, pred)),
                "log_loss": float(m.log_loss(y, np.clip(out, 1e-15, 1), labels=[0, 1])),
            }
        )
    return res


def better(a: float, b: float, metric: str) -> bool:
    return a < b if metric in LOWER_IS_BETTER else a > b


# --- alvo e vazamento -----------------------------------------------------------------------------------------


def target_report(df: pd.DataFrame, target: str, problem: str | None = None, positive=None) -> dict:
    """O que acontece se `target` for o alvo: tipo do problema, classes, alertas e força de cada coluna sozinha
    (uma árvore rasa por coluna). Uma coluna que sozinha acerta quase tudo é suspeita de vazar o alvo."""
    from sklearn.model_selection import KFold, StratifiedKFold, cross_val_predict
    from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor

    y_all = df[target]
    detected = detect_problem(y_all)
    problem = problem or detected
    X, y, num, cat, ignored, classes, problem = prepare_xy(df, target, problem, positive)
    alerts = []
    n_null = int(y_all.isna().sum())
    if n_null:
        alerts.append(
            {
                "code": "target_missing",
                "severity": "info",
                "message": f"{n_null} linhas sem alvo ficam de fora do treino.",
            }
        )
    info = {
        "target": target,
        "problem": problem,
        "detected": detected,
        "rows": len(X),
        "classes": classes,
        "features": num + cat,
        "ignored": ignored,
    }
    if classes:
        counts = np.bincount(y, minlength=len(classes))
        info["class_counts"] = [[c, int(n)] for c, n in zip(classes, counts, strict=True)]
        minority = counts.min() / counts.sum()
        if minority < 0.1:
            alerts.append(
                {
                    "code": "imbalance",
                    "severity": "warn",
                    "message": f"A classe menor tem só {br(100 * minority, 1)}% das linhas; "
                    "acurácia engana, olhe AUC e recall.",
                }
            )
        if counts.min() < 5:
            raise AutoMLError("Alguma classe tem menos de 5 linhas; não dá para validar.")
    else:
        info["target_stats"] = {
            "mean": float(np.mean(y)),
            "std": float(np.std(y)),
            "min": float(np.min(y)),
            "max": float(np.max(y)),
        }

    rng = np.random.default_rng(SEED)
    idx = rng.choice(len(X), size=min(len(X), 5000), replace=False)
    Xs, ys = X.iloc[idx], y[idx]
    cv = (
        StratifiedKFold(3, shuffle=True, random_state=SEED)
        if classes
        else KFold(3, shuffle=True, random_state=SEED)
    )
    strength = []
    for c in (num + cat)[:150]:
        col = Xs[[c]]
        if c in cat:
            col = col[c].astype("category").cat.codes.to_frame()
        col = col.fillna(-1e12)
        try:
            if classes:
                tree = DecisionTreeClassifier(max_depth=4, min_samples_leaf=5, random_state=SEED)
                out = cross_val_predict(tree, col, ys, cv=cv, method="predict_proba")
                score = metrics(problem, ys, out)["roc_auc" if problem == "binary" else "balanced_accuracy"]
            else:
                tree = DecisionTreeRegressor(max_depth=4, min_samples_leaf=5, random_state=SEED)
                out = cross_val_predict(tree, col, ys, cv=cv)
                score = metrics(problem, ys, out)["r2"]
        except ValueError:
            continue
        strength.append({"column": c, "score": round(float(score), 4)})
        limit = LEAK_R2 if problem == "regression" else LEAK_SCORE
        if score >= limit:
            alerts.append(
                {
                    "code": "leakage",
                    "severity": "danger",
                    "column": c,
                    "message": f"'{c}' sozinha prevê o alvo quase perfeitamente ({LEAK_LABEL[problem]} {br(score, 2)}). "
                    "Se ela só existe depois do resultado, é vazamento: apague a coluna.",
                    "fix": {"op": "drop_columns", "columns": [c]},
                }
            )
    strength.sort(key=lambda s: -s["score"])
    info["strength"] = strength
    info["strength_metric"] = (
        "R²" if problem == "regression" else ("AUC" if problem == "binary" else "acurácia bal.")
    )
    info["alerts"] = alerts
    return info


# --- treino --------------------------------------------------------------------------------------------------


class Run:
    """Estado do último treino, guardado no worker para avaliar, explicar, prever e exportar."""

    def __init__(self, **kw):
        self.__dict__.update(kw)


def _splits(problem, y, n_folds):
    from sklearn.model_selection import KFold, StratifiedKFold

    if problem == "regression":
        return list(KFold(n_folds, shuffle=True, random_state=SEED).split(np.zeros(len(y))))
    return list(StratifiedKFold(n_folds, shuffle=True, random_state=SEED).split(np.zeros(len(y)), y))


def _subsample(problem, y, n):
    from sklearn.model_selection import train_test_split

    if len(y) <= n:
        return np.arange(len(y))
    idx, _ = train_test_split(
        np.arange(len(y)), train_size=n, random_state=SEED, stratify=None if problem == "regression" else y
    )
    return np.sort(idx)


def train(
    df: pd.DataFrame,
    target: str,
    problem: str | None = None,
    budget: float = 60.0,
    positive=None,
    include: list[str] | None = None,
    progress: Callable[[dict], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
) -> tuple[dict, Run]:
    from sklearn.model_selection import train_test_split

    emit = progress or (lambda e: None)
    stop = should_stop or (lambda: False)
    t0 = time.perf_counter()
    problem = problem or detect_problem(df[target])
    X, y, num, cat, ignored, classes, problem = prepare_xy(df, target, problem, positive)
    metric = PRIMARY[problem]

    strat = None if problem == "regression" else y
    tr_idx, ho_idx = train_test_split(np.arange(len(y)), test_size=HOLDOUT, random_state=SEED, stratify=strat)
    X_tr, y_tr, X_ho, y_ho = X.iloc[tr_idx], y[tr_idx], X.iloc[ho_idx], y[ho_idx]
    cv_idx = _subsample(problem, y_tr, CV_MAX_ROWS)
    X_cv, y_cv = X_tr.iloc[cv_idx], y_tr[cv_idx]
    n_folds = 5 if len(y_cv) <= 20_000 else 3
    folds = _splits(problem, y_cv, n_folds)

    specs = [s for s in models.catalog(problem) if models.available(s)]
    if include:
        specs = [s for s in specs if s["key"] in include or s["key"] == "baseline"]
    specs = [s for s in specs if len(y_cv) <= s.get("max_rows", 10**9)]
    emit(
        {
            "type": "start",
            "problem": problem,
            "metric": metric,
            "rows": len(y),
            "cv_rows": len(y_cv),
            "holdout_rows": len(ho_idx),
            "folds": n_folds,
            "budget": budget,
            "candidates": [{"key": s["key"], "label": s["label"]} for s in specs],
        }
    )

    deadline = t0 + budget * (1 - RESERVE)
    board = []
    stopped = False
    for spec in specs:
        entry = {"key": spec["key"], "label": spec["label"], "status": "running", "folds": []}
        emit({"type": "candidate", **entry})
        fold_times = []
        try:
            for k, (a, b) in enumerate(folds):
                if stop():
                    raise KeyboardInterrupt
                remaining = deadline - time.perf_counter()
                if fold_times and np.mean(fold_times) * (n_folds - k) > remaining * 1.1:
                    entry["status"] = "skipped"
                    entry["reason"] = "não cabe no tempo"
                    break
                if not fold_times and remaining <= 0:
                    entry["status"] = "skipped"
                    entry["reason"] = "tempo esgotado"
                    break
                ts = time.perf_counter()
                pipe = make_pipeline_for(spec, num, cat)
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    pipe.fit(X_cv.iloc[a], y_cv[a])
                    out = predict_scores(pipe, X_cv.iloc[b], problem)
                fold_times.append(time.perf_counter() - ts)
                score = metrics(problem, y_cv[b], out)[metric]
                entry["folds"].append(round(score, 5))
                emit(
                    {
                        "type": "fold",
                        "key": spec["key"],
                        "fold": k + 1,
                        "score": score,
                        "seconds": fold_times[-1],
                    }
                )
        except KeyboardInterrupt:
            stopped = True
            entry["status"] = "stopped"
        except Exception as e:  # noqa: BLE001 — um modelo que falha não derruba o ranking
            entry["status"] = "failed"
            entry["reason"] = str(e)[:200]
        if entry["status"] == "running":
            entry["status"] = "done"
        if entry["folds"] and entry["status"] in ("done",):
            entry["score"] = float(np.mean(entry["folds"]))
            entry["std"] = float(np.std(entry["folds"]))
        entry["seconds"] = round(float(np.sum(fold_times)), 3)
        board.append(entry)
        emit({"type": "candidate", **entry})
        if stopped:
            break

    done = [e for e in board if "score" in e]
    if not done:
        raise AutoMLError("Nenhum modelo terminou a validação. Aumente o tempo ou reduza os dados.")
    done.sort(key=lambda e: e["score"], reverse=metric not in LOWER_IS_BETTER)
    best = next((e for e in done if e["key"] != "baseline"), done[0])
    spec = next(s for s in specs if s["key"] == best["key"])
    baseline = next((e for e in done if e["key"] == "baseline"), None)

    emit({"type": "phase", "phase": "evaluate", "key": spec["key"]})
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        pipe = make_pipeline_for(spec, num, cat).fit(X_tr, y_tr)
        out_ho = predict_scores(pipe, X_ho, problem)
    evaluation = evaluate(problem, y_ho, out_ho, classes)
    evaluation["importance"] = importance(pipe, X_ho, y_ho, problem, metric)
    emit({"type": "phase", "phase": "refit", "key": spec["key"]})
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        final = make_pipeline_for(spec, num, cat).fit(X, y)

    reference = {c: float(X[c].median()) if c in num else _mode(X[c]) for c in num + cat}
    ranking = sorted(
        board,
        key=lambda e: (
            "score" not in e,
            (e.get("score", 0) if metric in LOWER_IS_BETTER else -e.get("score", 0)),
        ),
    )
    result = {
        "problem": problem,
        "metric": metric,
        "target": target,
        "classes": classes,
        "rows": len(y),
        "cv_rows": len(y_cv),
        "holdout_rows": len(ho_idx),
        "folds": n_folds,
        "features": {"numeric": num, "categorical": cat, "ignored": ignored},
        "ranking": ranking,
        "best": {
            **best,
            "cls": spec["cls"],
            "params": spec["params"],
            "scale": spec["scale"],
            "stores_data": bool(spec.get("stores_data")),
        },
        "baseline": baseline,
        "evaluation": evaluation,
        "stopped": stopped,
        "seconds": round(time.perf_counter() - t0, 2),
        "budget": budget,
        "holdout_sample": _holdout_sample(X_ho, y_ho, out_ho, problem, classes),
    }
    run = Run(
        spec=spec,
        pipeline=final,
        num=num,
        cat=cat,
        classes=classes,
        problem=problem,
        target=target,
        reference=reference,
        metric=metric,
        X_ho=X_ho,
        y_ho=y_ho,
        result=result,
    )
    emit({"type": "done", "best": best["key"]})
    return result, run


def _mode(s: pd.Series):
    m = s.mode(dropna=True)
    return str(m.iloc[0]) if len(m) else None


def evaluate(problem: str, y, out, classes) -> dict:
    from sklearn import metrics as m

    res: dict = {"metrics": metrics(problem, y, out)}
    if problem == "regression":
        rng = np.random.default_rng(SEED)
        idx = rng.choice(len(y), size=min(len(y), 1500), replace=False)
        res["residuals"] = {
            "actual": np.asarray(y)[idx].round(6).tolist(),
            "pred": np.asarray(out)[idx].round(6).tolist(),
        }
        err = np.asarray(out) - np.asarray(y)
        counts, edges = np.histogram(err, bins=30)
        res["error_hist"] = {"edges": edges.tolist(), "counts": counts.tolist()}
        return res
    pred = out.argmax(axis=1)
    res["confusion"] = m.confusion_matrix(y, pred, labels=list(range(len(classes)))).tolist()
    if problem == "binary":
        fpr, tpr, _thr = m.roc_curve(y, out[:, 1])
        keep = np.unique(np.linspace(0, len(fpr) - 1, min(len(fpr), 200)).astype(int))
        res["roc"] = {"fpr": fpr[keep].round(5).tolist(), "tpr": tpr[keep].round(5).tolist()}
        # Probabilidades do holdout (arredondadas) para a tela recalcular a matriz ao mover o corte.
        rng = np.random.default_rng(SEED)
        idx = rng.choice(len(y), size=min(len(y), 5000), replace=False)
        res["scores"] = {"y": np.asarray(y)[idx].tolist(), "p": out[idx, 1].round(4).tolist()}
    return res


def importance(pipe, X, y, problem, metric, max_rows=3000, repeats=3) -> list[dict]:
    """Importância por permutação nas colunas originais (antes do one-hot), no holdout."""
    rng = np.random.default_rng(SEED)
    idx = rng.choice(len(y), size=min(len(y), max_rows), replace=False)
    Xs, ys = X.iloc[idx].reset_index(drop=True), np.asarray(y)[idx]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        base = metrics(problem, ys, predict_scores(pipe, Xs, problem))[metric]
        out = []
        for c in X.columns:
            drops = []
            for r in range(repeats):
                Xp = Xs.copy()
                Xp[c] = Xs[c].sample(frac=1.0, random_state=SEED + r).to_numpy()
                score = metrics(problem, ys, predict_scores(pipe, Xp, problem))[metric]
                drops.append(score - base if metric in LOWER_IS_BETTER else base - score)
            out.append({"column": c, "importance": float(np.mean(drops)), "std": float(np.std(drops))})
    out.sort(key=lambda d: -d["importance"])
    return out


def _holdout_sample(X_ho, y_ho, out, problem, classes, n=200) -> dict:
    Xs = X_ho.head(n)
    if problem == "regression":
        actual, pred = np.asarray(y_ho)[:n].tolist(), np.asarray(out)[:n].tolist()
    else:
        actual = [classes[i] for i in np.asarray(y_ho)[:n]]
        pred = [classes[i] for i in out[:n].argmax(axis=1)]
    from .jsonable import rows

    return {"columns": list(Xs.columns), "rows": rows(Xs, n), "actual": actual, "pred": pred}


# --- explicação de uma previsão ------------------------------------------------------------------------------


def _row_frame(run: Run, row: dict) -> pd.DataFrame:
    data = {}
    for c in run.num:
        v = row.get(c)
        try:
            data[c] = [float(v)] if v is not None and v != "" else [np.nan]
        except TypeError, ValueError:
            raise AutoMLError(f"'{c}' precisa ser número (recebi '{v}').") from None
    for c in run.cat:
        v = row.get(c)
        data[c] = [str(v) if v is not None and v != "" else None]
    return pd.DataFrame(data, columns=run.num + run.cat).astype({c: object for c in run.cat})


def _value(run: Run, out) -> tuple[float, str]:
    if run.problem == "regression":
        return float(out[0]), f"{float(out[0]):.4g}"
    if run.problem == "binary":
        return float(out[0, 1]), run.classes[int(out[0].argmax())]
    k = int(out[0].argmax())
    return float(out[0, k]), run.classes[k]


def explain(run: Run, row: dict) -> dict:
    """Efeito de cada variável nesta previsão: quanto a saída muda se a variável voltar ao valor típico
    (mediana ou moda do treino). Simples e honesto; não é SHAP."""
    x = _row_frame(run, row)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        out = predict_scores(run.pipeline, x, run.problem)
        value, label = _value(run, out)
        k = None if run.problem != "multiclass" else int(out[0].argmax())
        batch = pd.concat([x] * len(x.columns), ignore_index=True)
        for i, c in enumerate(x.columns):
            batch.loc[i, c] = run.reference[c]
        outs = predict_scores(run.pipeline, batch, run.problem)
    contrib = []
    for i, c in enumerate(x.columns):
        if run.problem == "regression":
            ref = float(outs[i])
        elif run.problem == "binary":
            ref = float(outs[i, 1])
        else:
            ref = float(outs[i, k])
        contrib.append(
            {"column": c, "value": row.get(c), "reference": run.reference[c], "effect": value - ref}
        )
    contrib.sort(key=lambda d: -abs(d["effect"]))
    res = {"value": value, "label": label, "contributions": contrib}
    if run.problem != "regression":
        res["proba"] = {cl: float(p) for cl, p in zip(run.classes, out[0], strict=True)}
        res["positive"] = run.classes[-1] if run.problem == "binary" else None
    return res


def predict_frame(run: Run, df: pd.DataFrame) -> pd.DataFrame:
    """Previsões para um DataFrame já tratado pela receita. Colunas que faltam viram erro; a mais, são ignoradas."""
    missing = [c for c in run.num + run.cat if c not in df.columns]
    if missing:
        raise AutoMLError(f"Faltam colunas na planilha: {', '.join(missing)}.")
    X = df[run.num + run.cat].copy()
    for c in run.cat:
        X[c] = X[c].astype("str").where(X[c].notna()).astype(object)
    for c in run.num:
        X[c] = pd.to_numeric(X[c], errors="coerce").astype(float)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        out = predict_scores(run.pipeline, X, run.problem)
    res = pd.DataFrame(index=df.index)
    if run.problem == "regression":
        res[f"previsto_{run.target}"] = out
    else:
        res[f"previsto_{run.target}"] = [run.classes[i] for i in out.argmax(axis=1)]
        if run.problem == "binary":
            res[f"prob_{run.target}_{run.classes[-1]}"] = out[:, 1].round(6)
        else:
            for i, cl in enumerate(run.classes):
                res[f"prob_{cl}"] = out[:, i].round(6)
    return res
