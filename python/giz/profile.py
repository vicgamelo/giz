"""Perfil dos dados: tipo de cada coluna, nulos, distribuições, correlações e alertas com a correção sugerida.

Cada alerta traz `fix`, um passo de receita pronto (o botão "Corrigir" da tela só adiciona esse passo)."""

from __future__ import annotations

import re
import warnings

import numpy as np
import pandas as pd

from .jsonable import br, clean, rows

ID_NAME = re.compile(
    r"(^|[_\s-])(id|cod|codigo|código|cpf|cnpj|uuid|guid|matricula|matrícula|protocolo|chave|registro)($|[_\s-])",
    re.IGNORECASE,
)
NUM_TEXT = re.compile(r"^\s*-?(R\$\s*)?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?\s*%?\s*$|^\s*-?\d+(\.\d+)?\s*$")
TRUE_FALSE = {"sim", "não", "nao", "yes", "no", "true", "false", "verdadeiro", "falso", "s", "n"}
MAX_CORR_COLS = 30
HIST_BINS = 24


def column_kind(s: pd.Series) -> str:
    if pd.api.types.is_bool_dtype(s):
        return "boolean"
    if pd.api.types.is_datetime64_any_dtype(s):
        return "datetime"
    if pd.api.types.is_numeric_dtype(s):
        return "numeric"
    nn = s.dropna()
    if nn.empty:
        return "categorical"
    low = nn.astype(str).str.lower().unique()
    if len(low) <= 2 and set(low) <= TRUE_FALSE:
        return "boolean"
    nunique = nn.nunique()
    avg_len = nn.astype(str).str.len().mean()
    if nunique > 50 and nunique / len(nn) > 0.5 and avg_len > 25:
        return "text"
    return "categorical"


def _looks_like_dates(s: pd.Series) -> bool:
    nn = s.dropna().astype(str)
    if nn.empty or not nn.str.contains(r"\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}", regex=True).mean() > 0.9:
        return False
    sample = nn.sample(min(len(nn), 500), random_state=0)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        parsed = pd.to_datetime(sample, errors="coerce", dayfirst=True, format="mixed")
    return parsed.notna().mean() >= 0.9


def _looks_like_numbers(s: pd.Series) -> bool:
    nn = s.dropna().astype(str)
    return len(nn) > 0 and nn.str.match(NUM_TEXT).mean() >= 0.95


def _histogram(s: pd.Series) -> dict:
    x = s.dropna().to_numpy(dtype=float)
    x = x[np.isfinite(x)]
    if x.size == 0:
        return {"edges": [], "counts": []}
    lo, hi = np.percentile(x, [0.5, 99.5]) if x.size > 200 else (x.min(), x.max())
    if lo == hi:
        lo, hi = x.min(), x.max()
    if lo == hi:
        return {"edges": [float(lo), float(hi)], "counts": [int(x.size)]}
    counts, edges = np.histogram(np.clip(x, lo, hi), bins=HIST_BINS, range=(lo, hi))
    return {"edges": edges.tolist(), "counts": counts.tolist()}


def describe_column(s: pd.Series, n_rows: int) -> dict:
    kind = column_kind(s)
    nn = s.dropna()
    n_missing = int(n_rows - len(nn))
    n_unique = int(nn.nunique())
    col = {
        "name": str(s.name),
        "kind": kind,
        "dtype": str(s.dtype),
        "missing": n_missing,
        "missing_pct": round(100 * n_missing / n_rows, 2) if n_rows else 0.0,
        "unique": n_unique,
        "sample": [clean(v) for v in nn.head(3).tolist()],
    }
    if kind == "numeric":
        x = nn.astype(float)
        q = x.quantile([0, 0.25, 0.5, 0.75, 1]).tolist() if len(x) else [None] * 5
        iqr = (q[3] - q[1]) if len(x) else 0
        outliers = int(((x < q[1] - 1.5 * iqr) | (x > q[3] + 1.5 * iqr)).sum()) if len(x) and iqr > 0 else 0
        col["stats"] = {
            "mean": clean(x.mean()),
            "std": clean(x.std()),
            "min": clean(q[0]),
            "q1": clean(q[1]),
            "median": clean(q[2]),
            "q3": clean(q[3]),
            "max": clean(q[4]),
            "skew": clean(x.skew()) if len(x) > 2 else None,
            "zeros": int((x == 0).sum()),
            "outliers": outliers,
            "integer": bool(len(x) and np.all(np.mod(x, 1) == 0)),
        }
        col["hist"] = _histogram(x)
    elif kind == "datetime":
        col["stats"] = {"min": clean(nn.min()), "max": clean(nn.max())}
        col["hist"] = _histogram(nn.astype("int64") // 10**9) if len(nn) else {"edges": [], "counts": []}
    else:
        vc = nn.astype(str).value_counts()
        col["top"] = [[str(k), int(v)] for k, v in vc.head(8).items()]
        col["other"] = int(vc.iloc[8:].sum()) if len(vc) > 8 else 0
    return col


def _alerts_for(col: dict, s: pd.Series, n_rows: int) -> list[dict]:
    name, kind, out = col["name"], col["kind"], []

    def add(code, severity, message, fix=None):
        out.append({"code": code, "column": name, "severity": severity, "message": message, "fix": fix})

    drop = {"op": "drop_columns", "columns": [name]}
    if col["unique"] <= 1:
        add("constant", "warn", f"'{name}' tem um valor só: não ajuda o modelo.", drop)
        return out
    ratio = col["unique"] / max(n_rows - col["missing"], 1)
    integer_like = kind == "numeric" and col["stats"]["integer"]
    if (ratio >= 0.95 and (integer_like or kind in ("categorical", "text"))) or (
        ID_NAME.search(name) and ratio > 0.5
    ):
        add("id_like", "warn", f"'{name}' parece um identificador (quase um valor por linha).", drop)
    if col["missing_pct"] > 40:
        add("missing_high", "warn", f"'{name}' tem {br(col['missing_pct'])}% de nulos.", drop)
    elif col["missing"] > 0:
        strategy = "median" if kind == "numeric" else "mode"
        add(
            "missing",
            "info",
            f"'{name}' tem {br(col['missing'])} nulos ({br(col['missing_pct'], 1)}%).",
            {"op": "impute", "columns": [name], "strategy": strategy},
        )
    if kind in ("categorical", "text") and s.dtype != bool:
        if _looks_like_dates(s):
            add(
                "date_as_text",
                "warn",
                f"'{name}' tem datas guardadas como texto.",
                {"op": "parse_dates", "columns": [name], "parts": ["year", "month", "weekday"], "drop": True},
            )
        elif _looks_like_numbers(s):
            add(
                "number_as_text",
                "warn",
                f"'{name}' tem números guardados como texto.",
                {"op": "to_numeric", "columns": [name]},
            )
        elif kind == "categorical" and col["unique"] > 50 and not any(a["code"] == "id_like" for a in out):
            add(
                "high_cardinality",
                "info",
                f"'{name}' tem {br(col['unique'])} categorias; codificar por frequência evita centenas de colunas.",
                {"op": "encode", "columns": [name], "method": "frequency"},
            )
    if kind == "text":
        add("free_text", "info", f"'{name}' parece texto livre; o AutoML vai ignorá-la.", drop)
    if kind == "numeric":
        st = col["stats"]
        if st["outliers"] and st["outliers"] / n_rows > 0.01 and not any(a["code"] == "id_like" for a in out):
            add(
                "outliers",
                "info",
                f"'{name}' tem {br(st['outliers'])} valores fora de 1,5×IQR.",
                {
                    "op": "remove_outliers",
                    "columns": [name],
                    "method": "iqr",
                    "factor": 1.5,
                    "action": "clip",
                },
            )
    return out


def correlations(df: pd.DataFrame, kinds: dict[str, str]) -> dict:
    cols = [
        c for c in df.columns if kinds[c] in ("numeric", "boolean") and pd.api.types.is_numeric_dtype(df[c])
    ]
    if len(cols) > MAX_CORR_COLS:
        cols = df[cols].var().sort_values(ascending=False).index[:MAX_CORR_COLS].tolist()
    if len(cols) < 2:
        return {"columns": cols, "matrix": []}
    m = df[cols].astype(float).corr().round(3)
    return {"columns": cols, "matrix": [[clean(v) for v in r] for r in m.to_numpy()]}


def profile(df: pd.DataFrame) -> dict:
    n_rows = len(df)
    columns, alerts = [], []
    for c in df.columns:
        col = describe_column(df[c], n_rows)
        columns.append(col)
        alerts.extend(_alerts_for(col, df[c], n_rows))
    dups = int(df.duplicated().sum())
    if dups:
        alerts.insert(
            0,
            {
                "code": "duplicates",
                "column": None,
                "severity": "warn",
                "message": f"{br(dups)} linhas repetidas.",
                "fix": {"op": "drop_duplicates"},
            },
        )
    kinds = {c["name"]: c["kind"] for c in columns}
    return {
        "rows": n_rows,
        "cols": int(df.shape[1]),
        "duplicates": dups,
        "missing_cells": int(df.isna().sum().sum()),
        "memory_mb": round(df.memory_usage(deep=True).sum() / 1e6, 2),
        "columns": columns,
        "alerts": alerts,
        "correlations": correlations(df, kinds),
        "head": {"columns": [str(c) for c in df.columns], "rows": rows(df, 50)},
    }
