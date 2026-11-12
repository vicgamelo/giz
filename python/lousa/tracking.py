"""O que vai para o MLflow quando a pessoa pede: parâmetros, métricas, a receita, o código exportado e, se ela
marcar, o modelo salvo com skops (formato sem pickle: carregar não executa código).

Nunca vão linhas dos dados. Vão valores derivados deles, e a tela mostra quais: categorias vistas pela receita, medianas
e limites aprendidos, as métricas e o modelo (árvores guardam cortes; o kNN guardaria as linhas, por isso fica de fora).
"""

from __future__ import annotations

import base64
import json
import math
import platform

from . import __version__, export
from .jsonable import clean

MAX_PARAM = 500


def versions() -> dict[str, str]:
    import numpy
    import pandas
    import sklearn

    out = {
        "python": platform.python_version(),
        "numpy": numpy.__version__,
        "pandas": pandas.__version__,
        "scikit-learn": sklearn.__version__,
        "lousa": __version__,
    }
    for mod in ("lightgbm", "xgboost", "skops"):
        try:
            out[mod] = __import__(mod).__version__
        except Exception:  # noqa: BLE001, S112
            continue
    try:
        import pyodide  # type: ignore[import-not-found]

        out["pyodide"] = pyodide.__version__
    except ImportError:
        pass
    return out


def _params(project: dict) -> dict[str, str]:
    res, src = project["result"], project["source"]
    p = {
        "target": res["target"],
        "problem": res["problem"],
        "model": res["best"]["label"],
        "model_class": res["best"]["cls"],
        "metric": res["metric"],
        "budget_s": res["budget"],
        "cv_folds": res["folds"],
        "cv_rows": res["cv_rows"],
        "holdout_rows": res["holdout_rows"],
        "rows": res["rows"],
        "n_numeric": len(res["features"]["numeric"]),
        "n_categorical": len(res["features"]["categorical"]),
        "recipe_steps": sum(1 for s in project["steps"] if not s.get("disabled")),
        "dataset": src.get("filename"),
    }
    if src.get("sheet"):
        p["sheet"] = src["sheet"]
    if res.get("classes"):
        p["positive_class"] = res["classes"][-1] if res["problem"] == "binary" else ",".join(res["classes"])
    for k, v in res["best"]["params"].items():
        p[f"model.{k}"] = v
    return {k: str(clean(v))[:MAX_PARAM] for k, v in p.items() if v is not None}


def _metrics(res: dict) -> dict[str, float]:
    m: dict[str, float] = {}
    for k, v in res["evaluation"]["metrics"].items():
        if isinstance(v, (int, float)) and math.isfinite(v):
            m[f"holdout_{k}"] = float(v)
    best, base = res["best"], res.get("baseline") or {}
    if best.get("score") is not None:
        m[f"cv_{res['metric']}"] = float(best["score"])
        m[f"cv_{res['metric']}_std"] = float(best.get("std") or 0.0)
    if base.get("score") is not None:
        m[f"baseline_cv_{res['metric']}"] = float(base["score"])
    m["train_seconds"] = float(res["seconds"])
    m["models_tried"] = float(sum(1 for e in res["ranking"] if e.get("score") is not None))
    return m


def _evaluation(res: dict) -> dict:
    ev = res["evaluation"]
    keep = {k: ev[k] for k in ("metrics", "confusion", "roc", "importance", "error_hist") if k in ev}
    return {"best": res["best"]["label"], "classes": res["classes"], **keep}


def model_bytes(run) -> bytes:
    import skops.io as sio

    return sio.dumps(run.pipeline)


def payload(project: dict, run, *, include_model: bool, sha256: str | None = None) -> dict:
    res, src = project["result"], project["source"]
    artifacts = {
        "receita.json": export.recipe_json(project),
        "lousa_modelo.py": export.script(project),
        "lousa_modelo.ipynb": export.notebook(project),
        "ranking.json": json.dumps(clean(res["ranking"]), ensure_ascii=False, indent=2),
        "avaliacao.json": json.dumps(clean(_evaluation(res)), ensure_ascii=False, indent=2),
    }
    vers = versions()
    out = {
        "run_name": f"{src.get('filename', 'dados')} · {res['best']['label']}"[:120],
        "params": _params(project),
        "metrics": _metrics(res),
        "tags": {
            "lousa.problem": res["problem"],
            "lousa.target": res["target"],
            "lousa.dataset": str(src.get("filename", ""))[:200],
            "lousa.dataset_rows": str(src.get("rows", "")),
            "lousa.dataset_sha256": sha256 or "",
            "lousa.versions": json.dumps(vers, sort_keys=True),
        },
        "artifacts": artifacts,
        "model": None,
    }
    if include_model:
        if res["best"].get("stores_data"):
            raise ValueError(
                "Este modelo (k vizinhos) guarda as linhas de treino; ele não vai para o MLflow."
            )
        data = model_bytes(run)
        reqs = (
            "\n".join(f"{k}=={v}" for k, v in vers.items() if k not in ("python", "lousa", "pyodide")) + "\n"
        )
        signature = {
            "inputs": {"numeric": run.num, "categorical": run.cat},
            "output": {"problem": run.problem, "classes": run.classes},
            "load": "import skops.io as sio; sio.load('modelo.skops', trusted=sio.get_untrusted_types(file="
            "'modelo.skops'))  # revise a lista antes de confiar",
        }
        out["model"] = {
            "file": "modelo.skops",
            "b64": base64.b64encode(data).decode(),
            "requirements": reqs,
            "signature": json.dumps(clean(signature), ensure_ascii=False, indent=2),
        }
    return out


def describe(p: dict) -> dict:
    """Resumo do que será enviado, para a tela mostrar antes do clique."""
    sizes = {k: len(v.encode()) for k, v in p["artifacts"].items()}
    if p["model"]:
        sizes["model/modelo.skops"] = len(base64.b64decode(p["model"]["b64"]))
    return {"params": p["params"], "metrics": p["metrics"], "tags": p["tags"], "artifacts": sizes}
