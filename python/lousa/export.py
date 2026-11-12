"""Exportação: script Python (ou notebook) que reproduz a receita, com os valores aprendidos, e o melhor modelo.

O código gerado usa só pandas e scikit-learn (mais lightgbm/xgboost se o vencedor for um deles). O teste
`test_export.py` roda o script e confere que ele chega aos mesmos dados tratados e às mesmas previsões."""

from __future__ import annotations

import datetime as dt
import json
import textwrap

from .jsonable import clean
from .recipe import DATE_PARTS, describe_step


def lit(v) -> str:
    v = clean(v)
    return repr(v)


def _step_code(step: dict, state) -> tuple[list[str], set[str]]:
    """Linhas de pandas para um passo (dentro de `tratar(df, prever)`), e os helpers que elas usam."""
    op, cols = step["op"], step.get("columns", [])
    helpers: set[str] = set()
    L: list[str] = []
    if op == "drop_columns":
        L.append(f"df = df.drop(columns=[c for c in {lit(cols)} if c in df.columns])")
    elif op == "impute":
        for c, v in state["values"].items():
            if v is not None:
                L.append(f"df[{lit(c)}] = df[{lit(c)}].fillna({lit(v)})")
    elif op == "encode":
        method = state["method"]
        for c, m in state["maps"].items():
            helpers.add("texto")
            if method == "onehot":
                L.append(f"for k in {lit(m)}:")
                L.append(f'    df[{lit(c + "_")} + k] = (texto(df[{lit(c)}]) == k).astype("int8")')
                L.append(f"df = df.drop(columns=[{lit(c)}])")
            elif method == "ordinal":
                L.append(f'df[{lit(c)}] = texto(df[{lit(c)}]).map({lit(m)}).fillna(-1).astype("int64")')
            else:
                L.append(f"df[{lit(c)}] = texto(df[{lit(c)}]).map({lit(m)}).fillna(0.0).astype(float)")
    elif op == "filter_rows":
        c, o, v = step["column"], step["operator"], step.get("value")
        L.append("if not prever:  # na previsão, toda linha recebe uma previsão")
        if o == "isnull":
            cond = f"df[{lit(c)}].isna()"
        elif o == "notnull":
            cond = f"df[{lit(c)}].notna()"
        elif o == "contains":
            helpers.add("texto")
            cond = f"texto(df[{lit(c)}]).str.contains({lit(str(v))}, case=False, regex=False, na=False)"
        else:
            sym = {"eq": "==", "ne": "!=", "gt": ">", "ge": ">=", "lt": "<", "le": "<="}[o]
            L.append(f"    s = df[{lit(c)}]")
            L.append("    if pd.api.types.is_numeric_dtype(s):")
            L.append(f"        alvo = float({lit(v)})")
            L.append("    elif pd.api.types.is_datetime64_any_dtype(s):")
            L.append(f"        alvo = pd.to_datetime({lit(v)}, dayfirst=True)")
            L.append("    else:")
            L.append(f"        alvo = str({lit(v)})")
            if o in ("eq", "ne"):
                L.append('        s = s.astype("str")')
            cond = f"(s {sym} alvo)"
        L.append(f"    df = df[({cond}).fillna(False).astype(bool)].reset_index(drop=True)")
    elif op == "parse_dates":
        helpers.add("datas")
        parts = step.get("parts") or ["year", "month", "weekday"]
        for c in cols:
            L.append(f"d = datas(df[{lit(c)}], dayfirst={lit(step.get('dayfirst', True))})")
            for p in parts:
                L.append(f'df[{lit(f"{c}_{DATE_PARTS[p]}")}] = d.dt.{p}.astype("Float64").astype(float)')
            L.append(f"df = df.drop(columns=[{lit(c)}])" if step.get("drop", True) else f"df[{lit(c)}] = d")
    elif op == "remove_outliers":
        action = step.get("action", "clip")
        for c, (lo, hi) in state["bounds"].items():
            if action == "clip":
                L.append(f"df[{lit(c)}] = df[{lit(c)}].clip({lit(lo)}, {lit(hi)})")
            else:
                L.append("if prever:  # na previsão, o corte vira limite")
                L.append(f"    df[{lit(c)}] = df[{lit(c)}].clip({lit(lo)}, {lit(hi)})")
                L.append("else:")
                L.append(
                    f"    df = df[df[{lit(c)}].isna() | df[{lit(c)}].between({lit(lo)}, {lit(hi)})]"
                    ".reset_index(drop=True)"
                )
    elif op == "drop_duplicates":
        L.append("if not prever:")
        L.append("    df = df.drop_duplicates().reset_index(drop=True)")
    elif op == "to_numeric":
        helpers.add("numero")
        for c, style in state["styles"].items():
            L.append(f"df[{lit(c)}] = numero(df[{lit(c)}], {lit(style)})")
    return L, helpers


HELPERS = {
    "texto": """
def texto(s):
    return s.astype("str").where(s.notna())
""",
    "datas": """
def datas(s, dayfirst=True):
    if pd.api.types.is_datetime64_any_dtype(s):
        return s
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return pd.to_datetime(s.astype("str").where(s.notna()), errors="coerce", dayfirst=dayfirst, format="mixed")
""",
    "numero": """
def numero(s, estilo):
    t = s.astype("str").where(s.notna()).str.replace(r"[R$\\s%]", "", regex=True)
    if estilo == "br":  # 1.234,56
        t = t.str.replace(".", "", regex=False).str.replace(",", ".", regex=False)
    else:
        t = t.str.replace(",", "", regex=False)
    return pd.to_numeric(t, errors="coerce")
""",
}


def _reader(source: dict) -> str:
    if source.get("format") == "excel":
        return f"pd.read_excel(caminho, sheet_name={lit(source.get('sheet'))})"
    args = []
    if source.get("sep", ",") != ",":
        args.append(f"sep={lit(source['sep'])}")
    if source.get("decimal", ".") != ".":
        args.append(f"decimal={lit(source['decimal'])}, thousands='.'")
    if source.get("encoding") and source["encoding"] not in ("utf-8", "utf-8-sig"):
        args.append(f"encoding={lit(source['encoding'])}")
    return f"pd.read_csv(caminho{', ' if args else ''}{', '.join(args)})"


def _model_import(cls: str) -> tuple[str, str]:
    mod, name = cls.rsplit(".", 1)
    return f"from {mod} import {name}", name


def sections(project: dict) -> dict[str, str]:
    """Pedaços do código, para o script e para as células do notebook."""
    src, steps, states = project["source"], project["steps"], project["states"]
    res, best = project["result"], project["result"]["best"]
    num, cat = res["features"]["numeric"], res["features"]["categorical"]
    target, problem, classes = res["target"], res["problem"], res["classes"]
    imp, model_name = _model_import(best["cls"])

    body, helpers = [], set()
    active = [
        (s, st) for s, st in zip(steps, states, strict=True) if not s.get("disabled") and st is not None
    ]
    for i, (s, st) in enumerate(active, 1):
        lines, h = _step_code(s, st)
        helpers |= h
        body.append(f"# {i}. {describe_step(s)}")
        body.extend(lines)
    if not body:
        body = ["# receita vazia"]
    tratar = (
        "def tratar(df, prever=False):\n"
        '    """Receita da Lousa com os valores aprendidos no treino. prever=True não remove linhas."""\n'
        "    df = df.copy()\n" + textwrap.indent("\n".join(body), "    ") + "\n    return df\n"
    )
    helper_code = "".join(HELPERS[h] for h in ("texto", "datas", "numero") if h in helpers)

    model_imports = [imp]
    header = textwrap.dedent(f'''\
        """Gerado pela Lousa (https://ml.vgmelo.tech) em {dt.date.today().isoformat()}.

        Reproduz a receita de tratamento e o melhor modelo do AutoML: {best["label"]}.
        Problema: {problem}; alvo: {target}; métrica principal: {res["metric"]}.
        Rode com:  python {project.get("script_name", "lousa_modelo.py")} dados.csv
        """
        ''')
    imports = (
        textwrap.dedent("""\
        import sys
        import warnings

        import joblib
        import numpy as np
        import pandas as pd
        from sklearn.compose import ColumnTransformer
        from sklearn.impute import SimpleImputer
        from sklearn.model_selection import train_test_split
        from sklearn.pipeline import Pipeline, make_pipeline
        from sklearn.preprocessing import OneHotEncoder, StandardScaler
        """)
        + "\n".join(model_imports)
        + "\n"
    )
    consts = (
        f"ALVO = {lit(target)}\n"
        f"PROBLEMA = {lit(problem)}\n"
        f"NUMERICAS = {lit(num)}\n"
        f"CATEGORICAS = {lit(cat)}\n"
        + (f"CLASSES = {lit(classes)}  # a última é a classe positiva\n" if classes else "")
    )
    reader = f"def ler(caminho):\n    return {_reader(src)}\n"
    scale = "[StandardScaler()]" if models_scale(best["cls"], best.get("scale")) else "[]"
    params = ",\n".join(f"        {k}={lit(v)}" for k, v in best["params"].items())
    pipeline = (
        textwrap.dedent(f"""\
        def pipeline():
            prep = ColumnTransformer(
                [
                    ("num", make_pipeline(SimpleImputer(strategy="median"), *{scale}), NUMERICAS),
                    ("cat", make_pipeline(
                        SimpleImputer(strategy="most_frequent"),
                        OneHotEncoder(handle_unknown="infrequent_if_exist", max_categories=30, sparse_output=False),
                    ), CATEGORICAS),
                ],
                remainder="drop",
                verbose_feature_names_out=False,
            )
            modelo = {model_name}(
        """)
        + params
        + ",\n    )\n"
        + '    return Pipeline([("prep", prep), ("model", modelo)])\n'
    )
    xy = textwrap.dedent("""\
        def separar(df):
            df = df[df[ALVO].notna()].reset_index(drop=True)
            X = df[NUMERICAS + CATEGORICAS].copy()
            for c in CATEGORICAS:
                X[c] = X[c].astype("str").where(X[c].notna()).astype(object)
            for c in NUMERICAS:
                X[c] = X[c].astype(float)
        """)
    if classes:
        xy += '    y = df[ALVO].astype("str").map({c: i for i, c in enumerate(CLASSES)}).to_numpy()\n'
    else:
        xy += "    y = df[ALVO].astype(float).to_numpy()\n"
    xy += "    return X, y\n"
    if problem == "regression":
        score = textwrap.dedent("""\
            def avaliar(modelo, X, y):
                from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
                p = modelo.predict(X)
                return {"rmse": float(np.sqrt(mean_squared_error(y, p))), "mae": float(mean_absolute_error(y, p)),
                        "r2": float(r2_score(y, p))}
            """)
    elif problem == "binary":
        score = textwrap.dedent("""\
            def avaliar(modelo, X, y):
                from sklearn.metrics import accuracy_score, roc_auc_score
                p = modelo.predict_proba(X)
                return {"roc_auc": float(roc_auc_score(y, p[:, 1])), "accuracy": float(accuracy_score(y, p.argmax(1)))}
            """)
    else:
        score = textwrap.dedent("""\
            def avaliar(modelo, X, y):
                from sklearn.metrics import accuracy_score, f1_score
                pred = modelo.predict_proba(X).argmax(1)
                return {"f1_macro": float(f1_score(y, pred, average="macro")), "accuracy": float(accuracy_score(y, pred))}
            """)
    strat = "None" if problem == "regression" else "y"
    main = textwrap.dedent(f'''\
        def main(caminho):
            df = tratar(ler(caminho))
            X, y = separar(df)
            # Mesmo holdout da Lousa: 20%, semente 42.
            X_tr, X_ho, y_tr, y_ho = train_test_split(X, y, test_size=0.2, random_state=42, stratify={strat})
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                print("holdout:", avaliar(pipeline().fit(X_tr, y_tr), X_ho, y_ho))
                modelo = pipeline().fit(X, y)  # modelo final, com todas as linhas
            joblib.dump(modelo, "modelo.joblib")
            print("modelo salvo em modelo.joblib")
            return modelo


        def prever(modelo, caminho):
            """Previsões para uma planilha nova, com a mesma receita."""
            df = tratar(ler(caminho), prever=True)
            X = df[NUMERICAS + CATEGORICAS].copy()
            for c in CATEGORICAS:
                X[c] = X[c].astype("str").where(X[c].notna()).astype(object)
            for c in NUMERICAS:
                X[c] = pd.to_numeric(X[c], errors="coerce").astype(float)
        ''')
    if problem == "regression":
        main += "    return modelo.predict(X)\n"
    else:
        main += "    return [CLASSES[i] for i in modelo.predict_proba(X).argmax(1)]\n"
    main += (
        '\n\nif __name__ == "__main__":\n    main(sys.argv[1] if len(sys.argv) > 1 else '
        + lit(src.get("filename", "dados.csv"))
        + ")\n"
    )
    return {
        "header": header,
        "imports": imports,
        "helpers": helper_code,
        "consts": consts,
        "reader": reader,
        "tratar": tratar,
        "pipeline": pipeline,
        "xy": xy,
        "score": score,
        "main": main,
    }


def models_scale(cls: str, scale) -> bool:
    if scale is not None:
        return bool(scale)
    return cls.endswith(("LogisticRegression", "Ridge", "KNeighborsClassifier", "KNeighborsRegressor"))


def script(project: dict) -> str:
    s = sections(project)
    parts = [
        s["header"],
        s["imports"],
        s["helpers"].strip("\n"),
        s["consts"],
        s["reader"],
        s["tratar"],
        s["pipeline"],
        s["xy"],
        s["score"],
        s["main"],
    ]
    return "\n\n".join(p.strip("\n") for p in parts if p.strip()) + "\n"


def notebook(project: dict) -> str:
    s = sections(project)
    res = project["result"]

    def md(text):
        return {"cell_type": "markdown", "metadata": {}, "source": text.splitlines(keepends=True)}

    def code(text):
        return {
            "cell_type": "code",
            "metadata": {},
            "execution_count": None,
            "outputs": [],
            "source": text.strip("\n").splitlines(keepends=True),
        }

    m = res["evaluation"]["metrics"]
    metr = ", ".join(f"{k} = {v:.4f}" for k, v in m.items() if isinstance(v, float))
    cells = [
        md(
            f"# Modelo da Lousa: {res['best']['label']}\n\nAlvo `{res['target']}` ({res['problem']}). "
            f"No holdout da Lousa: {metr}.\n\nOs dados não saíram do navegador; este notebook refaz tudo na sua máquina."
        ),
        code(s["imports"] + s["helpers"]),
        md(
            "## Leitura e receita de tratamento\n\nOs valores (medianas, categorias, limites) foram aprendidos no treino."
        ),
        code(s["consts"] + "\n" + s["reader"] + "\n" + s["tratar"]),
        code(f"df = tratar(ler({lit(project['source'].get('filename', 'dados.csv'))}))\ndf.head()"),
        md("## Modelo"),
        code(s["pipeline"] + "\n" + s["xy"] + "\n" + s["score"]),
        code(
            "X, y = separar(df)\nX_tr, X_ho, y_tr, y_ho = train_test_split(X, y, test_size=0.2, random_state=42, "
            f"stratify={'None' if res['problem'] == 'regression' else 'y'})\n"
            "modelo = pipeline().fit(X_tr, y_tr)\navaliar(modelo, X_ho, y_ho)"
        ),
        code('modelo = pipeline().fit(X, y)\njoblib.dump(modelo, "modelo.joblib")'),
    ]
    nb = {
        "cells": cells,
        "metadata": {
            "kernelspec": {"name": "python3", "display_name": "Python 3", "language": "python"},
            "language_info": {"name": "python"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    return json.dumps(nb, ensure_ascii=False, indent=1)


def recipe_json(project: dict) -> str:
    steps = [{**s, "descricao": describe_step(s)} for s in project["steps"]]
    return json.dumps(
        clean({"source": project["source"], "steps": steps, "states": project["states"]}),
        ensure_ascii=False,
        indent=2,
    )
