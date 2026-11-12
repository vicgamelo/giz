"""Previsão em lote: planilha nova → mesma receita (modo previsão) → modelo → CSV para baixar."""

from __future__ import annotations

import io

import pandas as pd

from . import automl
from .io import read_table
from .recipe import apply_recipe

MAX_ROWS = 500_000
_FORMULA = ("=", "+", "-", "@", "\t", "\r")


def _escape(v):
    # Planilhas executam célula que começa com = + - @: prefixa com ' (CSV injection).
    if isinstance(v, str) and v.startswith(_FORMULA):
        return "'" + v
    return v


def to_csv(df: pd.DataFrame, sep: str = ",", decimal: str = ".") -> bytes:
    out = df.copy()
    for c in out.columns:
        if not pd.api.types.is_numeric_dtype(out[c]):
            out[c] = out[c].map(_escape)
    out.columns = [_escape(str(c)) for c in out.columns]
    buf = io.StringIO()
    out.to_csv(buf, index=False, sep=sep, decimal=decimal)
    return buf.getvalue().encode("utf-8-sig")


def predict_file(
    run, steps, states, data: bytes, filename: str, sheet: str | None = None
) -> tuple[bytes, dict]:
    raw, info = read_table(data, filename, sheet)
    if len(raw) > MAX_ROWS:
        raise automl.AutoMLError(f"A planilha tem {len(raw)} linhas; o limite é {MAX_ROWS}.")
    treated = apply_recipe(raw, steps, states)
    if len(treated) != len(raw):
        raise automl.AutoMLError("A receita mudou o número de linhas na previsão.")
    pred = automl.predict_frame(run, treated)
    out = pd.concat([raw.reset_index(drop=True), pred.reset_index(drop=True)], axis=1)
    summary: dict = {"rows": len(out), "columns": list(pred.columns), "file": info}
    used = run.num + run.cat
    summary["rows_with_missing"] = int(treated[used].isna().any(axis=1).sum())
    if run.target in treated.columns and treated[run.target].notna().any():
        summary["check"] = _check(run, treated, pred)
    col = pred.columns[0]
    vc = pred[col].astype(str).value_counts() if run.problem != "regression" else None
    summary["distribution"] = (
        [[k, int(v)] for k, v in vc.items()]
        if vc is not None
        else {"mean": float(pred[col].mean()), "min": float(pred[col].min()), "max": float(pred[col].max())}
    )
    sep, decimal = (";", ",") if info.get("sep") == ";" else (",", ".")
    summary["preview"] = {"columns": [str(c) for c in out.columns], "rows": _preview(out)}
    return to_csv(out, sep=sep, decimal=decimal), summary


def _preview(df: pd.DataFrame, n: int = 20):
    from .jsonable import rows

    return rows(df, n)


def _check(run, treated: pd.DataFrame, pred: pd.DataFrame) -> dict:
    """Se a planilha nova tem a coluna alvo, mostra como o modelo foi nela."""
    mask = treated[run.target].notna()
    if run.problem == "regression":
        y = pd.to_numeric(treated.loc[mask, run.target], errors="coerce")
        p = pred.loc[mask].iloc[:, 0]
        ok = y.notna()
        return automl.metrics("regression", y[ok].to_numpy(), p[ok].to_numpy()) | {"rows": int(ok.sum())}
    index = {c: i for i, c in enumerate(run.classes)}
    y = treated.loc[mask, run.target].astype(str).map(index)
    ok = y.notna()
    labels = pred.loc[mask].iloc[:, 0].map(index)
    acc = float((labels[ok] == y[ok]).mean())
    res = {"rows": int(ok.sum()), "accuracy": acc}
    if run.problem == "binary" and y[ok].nunique() == 2:
        from sklearn.metrics import roc_auc_score

        res["roc_auc"] = float(roc_auc_score(y[ok].astype(int), pred.loc[mask].iloc[:, 1][ok]))
    return res
