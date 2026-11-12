"""Conversão para JSON: o navegador recebe só JSON do worker (nada de proxies do Pyodide)."""

from __future__ import annotations

import datetime as dt
import json
import math

import numpy as np
import pandas as pd


def clean(v):
    if v is None or v is pd.NA or v is pd.NaT:
        return None
    if isinstance(v, (bool, np.bool_)):
        return bool(v)
    if isinstance(v, (int, np.integer)):
        return int(v)
    if isinstance(v, (float, np.floating)):
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    if isinstance(v, (pd.Timestamp, dt.datetime, dt.date)):
        return v.isoformat()
    if isinstance(v, (pd.Timedelta, dt.timedelta)):
        return str(v)
    if isinstance(v, dict):
        return {str(k): clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple, set)):
        return [clean(x) for x in v]
    if isinstance(v, np.ndarray):
        return [clean(x) for x in v.tolist()]
    if isinstance(v, str):
        return v
    try:
        if pd.isna(v):
            return None
    except TypeError, ValueError:
        pass
    return str(v)


def dumps(obj) -> str:
    return json.dumps(clean(obj), ensure_ascii=False, allow_nan=False)


def rows(df: pd.DataFrame, limit: int = 50) -> list[list]:
    return [[clean(x) for x in r] for r in df.head(limit).itertuples(index=False, name=None)]


def br(x, digits: int = 0) -> str:
    """Número no formato brasileiro para mensagens: 1.234,5 (milhar com ponto, decimal com vírgula)."""
    s = f"{x:,.{digits}f}"
    return s.replace(",", "\0").replace(".", ",").replace("\0", ".")
