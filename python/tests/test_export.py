"""O script exportado precisa chegar ao mesmo lugar que o Giz: mesmos dados tratados, mesmo holdout e as
mesmas previsões do modelo final."""

import ast
import json
import os

import numpy as np
import pandas as pd
import pytest

from giz import api, automl

STEPS = [
    {"op": "drop_columns", "columns": ["id_contrato", "dias_atraso_pos_concessao"]},
    {"op": "drop_duplicates"},
    {"op": "to_numeric", "columns": ["valor_credito"]},
    {"op": "parse_dates", "columns": ["data_pedido"], "parts": ["month", "weekday"]},
    {"op": "filter_rows", "column": "idade", "operator": "le", "value": 100},
    {"op": "remove_outliers", "columns": ["prazo_meses"], "method": "iqr", "action": "remove"},
    {"op": "impute", "columns": ["poupanca", "tempo_emprego"], "strategy": "mode"},
    {"op": "impute", "columns": ["idade"], "strategy": "median"},
    {"op": "encode", "columns": ["finalidade"], "method": "frequency"},
    {"op": "encode", "columns": ["moradia"], "method": "onehot"},
]


@pytest.fixture
def session(problemas_bytes, tmp_path):
    path = tmp_path / "credito-com-problemas.csv"
    path.write_bytes(problemas_bytes)
    json.loads(api.load(problemas_bytes, path.name))
    rep = json.loads(api.preview(json.dumps(STEPS)))
    assert rep["ok"], rep["reports"]
    return path


def _exec(code: str, cwd) -> dict:
    ns: dict = {"__name__": "giz_exportado"}
    old = os.getcwd()
    os.chdir(cwd)
    try:
        exec(compile(code, "giz_modelo.py", "exec"), ns)  # noqa: S102 — é o script que o Giz gera
    finally:
        os.chdir(old)
    return ns


@pytest.mark.parametrize("model", ["logreg", "hgb", "rf"])
def test_script_reproduz_receita_holdout_e_previsoes(session, tmp_path, model):
    result = json.loads(_train_only(model))
    code = api.export_file("script")
    ast.parse(code)
    ns = _exec(code, tmp_path)

    raw = pd.read_csv(session, sep=";")
    mine = api.S["treated"]
    theirs = ns["tratar"](ns["ler"](str(session)))
    pd.testing.assert_frame_equal(
        mine.reset_index(drop=True), theirs.reset_index(drop=True), check_like=True, check_dtype=False
    )
    assert len(raw) == 1015

    old = os.getcwd()
    os.chdir(tmp_path)
    try:
        modelo = ns["main"](str(session))
    finally:
        os.chdir(old)
    assert (tmp_path / "modelo.joblib").exists()
    X, y = ns["separar"](theirs)
    metric = result["metric"]
    _, X_ho, _, y_ho = __import__("sklearn.model_selection", fromlist=["x"]).train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    p = ns["pipeline"]().fit(*_train_part(X, y))
    assert ns["avaliar"](p, X_ho, y_ho)[metric] == pytest.approx(
        result["evaluation"]["metrics"][metric], abs=1e-9
    )
    # modelo final: mesmas probabilidades do worker
    run = api.S["run"]
    Xr = automl.prepare_xy(mine, "inadimplente", "binary")[0]
    np.testing.assert_allclose(modelo.predict_proba(X), run.pipeline.predict_proba(Xr), atol=1e-9)
    novos = session.parent / "novos.csv"
    raw.head(25).drop(columns=["inadimplente"]).to_csv(novos, sep=";", index=False)
    assert len(ns["prever"](modelo, str(novos))) == 25


def _train_part(X, y):
    from sklearn.model_selection import train_test_split

    X_tr, _, y_tr, _ = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    return X_tr, y_tr


def _train_only(model):
    result, run = automl.train(api.S["treated"], "inadimplente", budget=300, include=[model])
    if result["best"]["key"] == "baseline":
        pytest.skip(f"{model} não terminou")
    assert result["best"]["key"] == model
    api.S["run"] = run
    return json.dumps(result)


def test_script_de_regressao_sem_categoricas(casas_bytes, tmp_path):
    path = tmp_path / "casas.xlsx"
    path.write_bytes(casas_bytes)
    api.load(casas_bytes, path.name)
    api.preview(json.dumps([{"op": "filter_rows", "column": "populacao", "operator": "lt", "value": 5000}]))
    df = api.S["treated"].sample(2500, random_state=1).reset_index(drop=True)
    api.S["treated"] = df
    _result, run = automl.train(df, "valor_mediano_100mil_usd", budget=20, include=["ridge"])
    api.S["run"] = run
    code = api.export_file("script")
    ns = _exec(code, tmp_path)
    assert ns["CATEGORICAS"] == []
    X, y = ns["separar"](df)
    m = ns["pipeline"]().fit(X, y)
    np.testing.assert_allclose(m.predict(X), run.pipeline.predict(X), atol=1e-8)
    assert "sheet_name='casas'" in code


def test_notebook_e_receita_json(session):
    _train_only("logreg")
    nb = json.loads(api.export_file("notebook"))
    assert nb["nbformat"] == 4
    src = "\n".join("".join(c["source"]) for c in nb["cells"] if c["cell_type"] == "code")
    ast.parse(src)
    rec = json.loads(api.export_file("recipe"))
    assert len(rec["steps"]) == len(STEPS) and rec["steps"][0]["descricao"].startswith("Apagar")
    assert (
        18 <= rec["states"][7]["values"]["idade"] <= 75
    )  # mediana aprendida, não a idade 999 digitada errado


def test_preview_com_erro_nao_troca_a_receita_valida(session):
    good = api.S["steps"]
    rep = json.loads(api.preview(json.dumps([{"op": "drop_columns", "columns": ["nao_existe"]}])))
    assert not rep["ok"] and "error" in rep["reports"][0]
    assert api.S["steps"] == good
