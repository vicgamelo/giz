"""Fachada que o worker chama. Guarda o estado da sessão (dados, receita, modelo) dentro do Python; o navegador
recebe só resumos em JSON. Os dados nunca saem desta memória."""

from __future__ import annotations

import hashlib
import json

from . import automl, batch, export, tracking
from .io import read_table
from .jsonable import dumps, rows
from .profile import profile
from .recipe import RecipeError, describe_step, fit_recipe

S: dict = {}


def _treated():
    if "treated" not in S:
        raise ValueError("Carregue os dados primeiro.")
    return S["treated"]


def load(data: bytes, filename: str, sheet: str | None = None) -> str:
    df, info = read_table(bytes(data), filename, sheet)
    S.clear()
    S.update(
        raw=df, source=info, steps=[], states=[], treated=df, sha256=hashlib.sha256(bytes(data)).hexdigest()
    )
    return dumps({"source": info, "profile": profile(df)})


def load_path(path: str, filename: str, sheet: str | None = None) -> str:
    """O worker grava o arquivo no sistema de arquivos em memória do Pyodide e passa o caminho."""
    with open(path, "rb") as f:
        return load(f.read(), filename, sheet or None)


def preview(steps_json: str) -> str:
    steps = json.loads(steps_json)
    out, states, reports = fit_recipe(S["raw"], steps, stop_on_error=False)
    ok = not any("error" in r for r in reports)
    if ok:
        S.update(steps=steps, states=states, treated=out)
        S.pop("run", None)
    for r in reports:
        r["label"] = describe_step(steps[r["index"]])
    return dumps({"ok": ok, "reports": reports, "profile": profile(out)})


def target(name: str, problem: str | None = None, positive: str | None = None) -> str:
    return dumps(automl.target_report(_treated(), name, problem or None, positive or None))


def train(
    name: str, problem: str | None, budget: float, positive: str | None, progress, should_stop=None
) -> str:
    def emit(event):
        progress(dumps(event))

    result, run = automl.train(
        _treated(),
        name,
        problem or None,
        float(budget),
        positive or None,
        progress=emit,
        should_stop=should_stop,
    )
    S["run"] = run
    return dumps(result)


def _run():
    if "run" not in S:
        raise ValueError("Treine um modelo primeiro.")
    return S["run"]


def explain(row_json: str) -> str:
    return dumps(automl.explain(_run(), json.loads(row_json)))


def predict(data: bytes, filename: str, sheet: str | None = None):
    csv, summary = batch.predict_file(_run(), S["steps"], S["states"], bytes(data), filename, sheet)
    return csv, dumps(summary)


def predict_path(path: str, filename: str, out_path: str, sheet: str | None = None) -> str:
    with open(path, "rb") as f:
        csv, summary = predict(f.read(), filename, sheet or None)
    with open(out_path, "wb") as f:
        f.write(csv)
    return summary


def project() -> dict:
    run = _run()
    name = "giz_modelo.py"
    return {
        "source": S["source"],
        "steps": S["steps"],
        "states": S["states"],
        "result": run.result,
        "script_name": name,
    }


def export_file(kind: str) -> str:
    p = project()
    if kind == "script":
        return export.script(p)
    if kind == "notebook":
        return export.notebook(p)
    if kind == "recipe":
        return export.recipe_json(p)
    raise ValueError(kind)


def mlflow_payload(include_model: bool = False) -> str:
    p = tracking.payload(project(), _run(), include_model=bool(include_model), sha256=S.get("sha256"))
    return dumps({"payload": p, "summary": tracking.describe(p)})


def head(n: int = 50) -> str:
    df = _treated()
    return dumps({"columns": [str(c) for c in df.columns], "rows": rows(df, n)})


__all__ = ["RecipeError", "explain", "export_file", "head", "load", "predict", "preview", "target", "train"]
