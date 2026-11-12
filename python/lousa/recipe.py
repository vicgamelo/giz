"""Receita de tratamento: uma lista de passos que se ajustam nos dados de treino e se repetem em dados novos.

Cada passo é um dict JSON (`{"op": "impute", "columns": [...], ...}`). `fit_recipe` ajusta os passos em ordem e guarda
o estado de cada um (a mediana usada, as categorias vistas, os limites do outlier). `apply_recipe` repete a receita
em dados novos com esse estado, sem reaprender nada. Na previsão, passos que removem linhas são pulados (toda linha
da planilha nova precisa de uma previsão) e o corte de outliers vira "limitar" nos mesmos limites do treino.
"""

from __future__ import annotations

import re
import warnings
from collections.abc import Callable

import pandas as pd


class RecipeError(ValueError):
    def __init__(self, index: int, message: str):
        super().__init__(message)
        self.index = index
        self.message = message


DATE_PARTS = {"year": "ano", "month": "mes", "day": "dia", "weekday": "dia_semana", "hour": "hora"}
OPERATORS = ("eq", "ne", "gt", "ge", "lt", "le", "isnull", "notnull", "contains")
ROW_REMOVING = {"filter_rows", "drop_duplicates"}
ENCODE_MAX_CATEGORIES = 30


def _need_columns(df: pd.DataFrame, cols: list[str]) -> list[str]:
    if not cols:
        raise ValueError("escolha ao menos uma coluna")
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise ValueError(f"coluna(s) que não existem mais neste ponto da receita: {', '.join(missing)}")
    return cols


# --- passos: fit(df, step) -> state ; apply(df, step, state, predict) -> df ---------------------------------


def _drop_columns_fit(df, step):
    _need_columns(df, step.get("columns", []))
    return {}


def _drop_columns_apply(df, step, state, predict):
    cols = step["columns"]
    return df.drop(columns=[c for c in cols if c in df.columns] if predict else cols)


def _impute_fit(df, step):
    cols = _need_columns(df, step.get("columns", []))
    strategy = step.get("strategy", "median")
    values = {}
    for c in cols:
        s = df[c]
        if strategy in ("mean", "median"):
            if not pd.api.types.is_numeric_dtype(s):
                raise ValueError(f"'{c}' não é numérica; use moda ou um valor fixo")
            v = s.mean() if strategy == "mean" else s.median()
            v = float(v) if pd.notna(v) else 0.0
        elif strategy == "mode":
            m = s.mode(dropna=True)
            v = m.iloc[0] if len(m) else None
            v = v.item() if hasattr(v, "item") else v
        elif strategy == "constant":
            v = step.get("value")
            if pd.api.types.is_numeric_dtype(s) and v is not None:
                try:
                    v = float(v)
                except TypeError, ValueError:
                    raise ValueError(f"'{c}' é numérica; o valor fixo precisa ser um número") from None
        else:
            raise ValueError(f"estratégia desconhecida: {strategy}")
        values[c] = v
    return {"values": values}


def _impute_apply(df, step, state, predict):
    df = df.copy()
    for c, v in state["values"].items():
        if c in df.columns and v is not None:
            df[c] = df[c].fillna(v)
    return df


def _encode_fit(df, step):
    cols = _need_columns(df, step.get("columns", []))
    method = step.get("method", "onehot")
    st: dict = {"method": method, "maps": {}}
    for c in cols:
        s = df[c].astype("str").where(df[c].notna())
        vc = s.value_counts()
        if method == "onehot":
            st["maps"][c] = [str(k) for k in vc.index[: step.get("max_categories", ENCODE_MAX_CATEGORIES)]]
        elif method == "ordinal":
            st["maps"][c] = {str(k): i for i, k in enumerate(sorted(vc.index))}
        elif method == "frequency":
            st["maps"][c] = {str(k): round(float(v) / len(s), 6) for k, v in vc.items()}
        else:
            raise ValueError(f"método desconhecido: {method}")
    return st


def _encode_apply(df, step, state, predict):
    df = df.copy()
    for c, m in state["maps"].items():
        if c not in df.columns:
            continue
        s = df[c].astype("str").where(df[c].notna())
        if state["method"] == "onehot":
            pos = df.columns.get_loc(c)
            new = pd.DataFrame({f"{c}_{k}": (s == k).astype("int8") for k in m}, index=df.index)
            df = pd.concat([df.iloc[:, :pos], new, df.iloc[:, pos + 1 :]], axis=1)
        elif state["method"] == "ordinal":
            df[c] = s.map(m).fillna(-1).astype("int64")
        else:
            df[c] = s.map(m).fillna(0.0).astype(float)
    return df


def _coerce_like(series: pd.Series, value):
    if pd.api.types.is_numeric_dtype(series):
        try:
            return float(value)
        except TypeError, ValueError:
            raise ValueError(f"'{series.name}' é numérica; o valor do filtro precisa ser um número") from None
    if pd.api.types.is_datetime64_any_dtype(series):
        return pd.to_datetime(value, dayfirst=True)
    return str(value)


def _filter_fit(df, step):
    col = step.get("column")
    _need_columns(df, [col] if col else [])
    if step.get("operator") not in OPERATORS:
        raise ValueError(f"operador desconhecido: {step.get('operator')}")
    if step["operator"] not in ("isnull", "notnull", "contains"):
        _coerce_like(df[col], step.get("value"))
    return {}


def _filter_apply(df, step, state, predict):
    if predict:
        return df
    s, op = df[step["column"]], step["operator"]
    if op == "isnull":
        mask = s.isna()
    elif op == "notnull":
        mask = s.notna()
    elif op == "contains":
        mask = s.astype("str").str.contains(str(step.get("value", "")), case=False, regex=False, na=False)
    else:
        v = _coerce_like(s, step.get("value"))
        if op in ("eq", "ne") and not (
            pd.api.types.is_numeric_dtype(s) or pd.api.types.is_datetime64_any_dtype(s)
        ):
            s = s.astype("str")
        mask = {
            "eq": s == v,
            "ne": s != v,
            "gt": s > v,
            "ge": s >= v,
            "lt": s < v,
            "le": s <= v,
        }[op]
    return df[mask.fillna(False).astype(bool)].reset_index(drop=True)


def _parse(s: pd.Series, dayfirst: bool) -> pd.Series:
    if pd.api.types.is_datetime64_any_dtype(s):
        return s
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return pd.to_datetime(
            s.astype("str").where(s.notna()), errors="coerce", dayfirst=dayfirst, format="mixed"
        )


def _dates_fit(df, step):
    cols = _need_columns(df, step.get("columns", []))
    parts = step.get("parts") or ["year", "month", "weekday"]
    bad = [p for p in parts if p not in DATE_PARTS]
    if bad:
        raise ValueError(f"parte de data desconhecida: {', '.join(bad)}")
    for c in cols:
        ok = _parse(df[c], step.get("dayfirst", True)).notna().sum()
        if ok == 0 and df[c].notna().any():
            raise ValueError(f"nenhum valor de '{c}' virou data")
    return {}


def _dates_apply(df, step, state, predict):
    df = df.copy()
    parts = step.get("parts") or ["year", "month", "weekday"]
    for c in step["columns"]:
        if c not in df.columns:
            continue
        d = _parse(df[c], step.get("dayfirst", True))
        pos = df.columns.get_loc(c) + 1
        for p in parts:
            name = f"{c}_{DATE_PARTS[p]}"
            vals = getattr(d.dt, p).astype("Float64").astype(float)
            if name in df.columns:
                df[name] = vals
            else:
                df.insert(pos, name, vals)
                pos += 1
        if step.get("drop", True):
            df = df.drop(columns=[c])
        else:
            df[c] = d
    return df


def _outliers_fit(df, step):
    cols = _need_columns(df, step.get("columns", []))
    method = step.get("method", "iqr")
    k = float(step.get("factor") or (1.5 if method == "iqr" else 3.0))
    bounds = {}
    for c in cols:
        if not pd.api.types.is_numeric_dtype(df[c]):
            raise ValueError(f"'{c}' não é numérica")
        x = df[c].astype(float)
        if method == "iqr":
            q1, q3 = x.quantile([0.25, 0.75])
            lo, hi = q1 - k * (q3 - q1), q3 + k * (q3 - q1)
        elif method == "zscore":
            lo, hi = x.mean() - k * x.std(), x.mean() + k * x.std()
        else:
            raise ValueError(f"método desconhecido: {method}")
        bounds[c] = [float(lo), float(hi)]
    return {"bounds": bounds}


def _outliers_apply(df, step, state, predict):
    df = df.copy()
    action = "clip" if predict else step.get("action", "clip")
    keep = pd.Series(True, index=df.index)
    for c, (lo, hi) in state["bounds"].items():
        if c not in df.columns:
            continue
        if action == "clip":
            df[c] = df[c].clip(lo, hi)
        else:
            keep &= df[c].isna() | df[c].between(lo, hi)
    return df[keep].reset_index(drop=True) if action == "remove" else df


def _dups_fit(df, step):
    return {}


def _dups_apply(df, step, state, predict):
    return df if predict else df.drop_duplicates().reset_index(drop=True)


_NUM_CLEAN = re.compile(r"[R$\s%]")


def to_number(s: pd.Series, style: str) -> pd.Series:
    t = s.astype("str").where(s.notna()).str.replace(_NUM_CLEAN, "", regex=True)
    if style == "br":
        t = t.str.replace(".", "", regex=False).str.replace(",", ".", regex=False)
    else:
        t = t.str.replace(",", "", regex=False)
    return pd.to_numeric(t, errors="coerce")


def _to_numeric_fit(df, step):
    cols = _need_columns(df, step.get("columns", []))
    styles = {}
    for c in cols:
        t = df[c].dropna().astype("str")
        br = t.str.contains(r",\d{1,2}\s*%?$", regex=True).mean() > 0.3 or t.str.contains(r"\d\.\d{3},").any()
        styles[c] = "br" if br else "us"
        if to_number(df[c], styles[c]).notna().sum() == 0 and df[c].notna().any():
            raise ValueError(f"nenhum valor de '{c}' virou número")
    return {"styles": styles}


def _to_numeric_apply(df, step, state, predict):
    df = df.copy()
    for c, style in state["styles"].items():
        if c in df.columns:
            df[c] = to_number(df[c], style)
    return df


OPS: dict[str, tuple[Callable, Callable]] = {
    "drop_columns": (_drop_columns_fit, _drop_columns_apply),
    "impute": (_impute_fit, _impute_apply),
    "encode": (_encode_fit, _encode_apply),
    "filter_rows": (_filter_fit, _filter_apply),
    "parse_dates": (_dates_fit, _dates_apply),
    "remove_outliers": (_outliers_fit, _outliers_apply),
    "drop_duplicates": (_dups_fit, _dups_apply),
    "to_numeric": (_to_numeric_fit, _to_numeric_apply),
}


def fit_recipe(df: pd.DataFrame, steps: list[dict], stop_on_error: bool = True):
    """Ajusta a receita em ordem. Devolve (df tratado, estados, relatório por passo).

    Com `stop_on_error=False` (prévia ao vivo), o primeiro passo com erro é marcado e a prévia para nele."""
    states, reports = [], []
    for i, step in enumerate(steps):
        op = step.get("op")
        if step.get("disabled"):
            states.append(None)
            reports.append({"index": i, "op": op, "skipped": True})
            continue
        before_rows, before_cols = len(df), list(df.columns)
        try:
            if op not in OPS:
                raise ValueError(f"passo desconhecido: {op}")
            fit, apply = OPS[op]
            state = fit(df, step)
            out = apply(df, step, state, False)
        except Exception as e:
            if stop_on_error:
                raise RecipeError(i, str(e)) from e
            reports.append({"index": i, "op": op, "error": str(e)})
            return df, states, reports
        states.append(state)
        reports.append(
            {
                "index": i,
                "op": op,
                "rows_before": before_rows,
                "rows_after": len(out),
                "added": [c for c in out.columns if c not in before_cols],
                "removed": [c for c in before_cols if c not in out.columns],
            }
        )
        df = out
    return df, states, reports


def apply_recipe(df: pd.DataFrame, steps: list[dict], states: list) -> pd.DataFrame:
    """Repete a receita já ajustada em dados novos (modo previsão)."""
    for i, (step, state) in enumerate(zip(steps, states, strict=True)):
        if step.get("disabled") or state is None:
            continue
        try:
            df = OPS[step["op"]][1](df, step, state, True)
        except Exception as e:
            raise RecipeError(i, str(e)) from e
    return df


def describe_step(step: dict) -> str:
    """Frase curta em português para a lista da receita e para o script exportado."""
    op, cols = step.get("op"), ", ".join(step.get("columns", []) or [])
    strategy = {"mean": "média", "median": "mediana", "mode": "moda", "constant": "valor fixo"}
    ops = {"eq": "=", "ne": "≠", "gt": ">", "ge": "≥", "lt": "<", "le": "≤"}
    match op:
        case "drop_columns":
            return f"Apagar {cols}"
        case "impute":
            return f"Preencher nulos de {cols} com {strategy.get(step.get('strategy'), step.get('strategy'))}"
        case "encode":
            m = {"onehot": "one-hot", "ordinal": "ordinal", "frequency": "frequência"}
            return f"Codificar {cols} ({m.get(step.get('method'), step.get('method'))})"
        case "filter_rows":
            o = step.get("operator")
            if o == "isnull":
                return f"Manter linhas com {step.get('column')} nulo"
            if o == "notnull":
                return f"Manter linhas com {step.get('column')} preenchido"
            if o == "contains":
                return f"Manter linhas em que {step.get('column')} contém “{step.get('value')}”"
            return f"Manter linhas com {step.get('column')} {ops.get(o, o)} {step.get('value')}"
        case "parse_dates":
            return f"Converter {cols} em data"
        case "remove_outliers":
            a = "Limitar" if step.get("action", "clip") == "clip" else "Remover"
            return f"{a} outliers de {cols} ({step.get('method', 'iqr').upper()})"
        case "drop_duplicates":
            return "Remover linhas repetidas"
        case "to_numeric":
            return f"Converter {cols} em número"
    return str(op)


__all__ = [
    "OPS",
    "ROW_REMOVING",
    "RecipeError",
    "apply_recipe",
    "describe_step",
    "fit_recipe",
]
