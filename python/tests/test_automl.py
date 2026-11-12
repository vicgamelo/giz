import time

import numpy as np
import pandas as pd
import pytest

from lousa import automl, models
from lousa.io import read_table
from lousa.recipe import fit_recipe


def test_deteccao_do_problema():
    assert automl.detect_problem(pd.Series(["sim", "não", "sim"])) == "binary"
    assert automl.detect_problem(pd.Series([0, 1, 1, 0])) == "binary"
    assert automl.detect_problem(pd.Series([1, 2, 3, 4, 5] * 10)) == "multiclass"
    assert automl.detect_problem(pd.Series(["a", "b", "c"])) == "multiclass"
    assert automl.detect_problem(pd.Series(np.linspace(0, 1, 100))) == "regression"
    assert automl.detect_problem(pd.Series(range(100))) == "regression"


def test_classe_positiva_padrao_e_escolhida(small):
    _X, _y, num, cat, _ignored, classes, problem = automl.prepare_xy(small, "cancelou", "binary")
    assert classes[-1] == "sim" and problem == "binary"
    _, _, _, _, _, classes, _ = automl.prepare_xy(small, "cancelou", "binary", positive="não")
    assert classes[-1] == "não"
    assert set(num) == {"idade", "renda"} and set(cat) == {"cidade", "plano"}


def test_treino_classificacao_com_ranking_ao_vivo(small):
    events = []
    result, _run = automl.train(small, "cancelou", budget=30, progress=events.append)
    assert events[0]["type"] == "start" and events[-1]["type"] == "done"
    assert any(e["type"] == "fold" for e in events)
    keys = [e["key"] for e in result["ranking"]]
    assert "baseline" in keys and "logreg" in keys
    best = result["best"]
    assert best["key"] != "baseline"
    assert best["score"] > result["baseline"]["score"]
    ev = result["evaluation"]
    assert 0.5 < ev["metrics"]["roc_auc"] <= 1
    assert np.array(ev["confusion"]).sum() == result["holdout_rows"] == 80
    assert len(ev["roc"]["fpr"]) == len(ev["roc"]["tpr"])
    assert {d["column"] for d in ev["importance"]} == {"idade", "renda", "cidade", "plano"}
    # o plano é a variável mais forte na simulação
    assert ev["importance"][0]["column"] in ("plano", "idade")


def test_orcamento_de_tempo_pula_modelos_que_nao_cabem():
    rng = np.random.default_rng(0)
    n = 6000
    df = pd.DataFrame(rng.normal(size=(n, 12)), columns=[f"x{i}" for i in range(12)])
    df["y"] = (df["x0"] + rng.normal(size=n) > 0).astype(int)
    t = time.perf_counter()
    result, _ = automl.train(df, "y", budget=4)
    took = time.perf_counter() - t
    statuses = {e["key"]: e["status"] for e in result["ranking"]}
    assert "skipped" in statuses.values()
    # o orçamento vale para o ranking; o vencedor ainda treina e é avaliado (folga para máquina carregada)
    assert took < 4 * 4


def test_parar_devolve_o_que_ja_terminou(small):
    calls = {"n": 0}

    def stop():
        calls["n"] += 1
        return calls["n"] > 7  # baseline (5 folds) e parte do segundo modelo

    result, _ = automl.train(small, "cancelou", budget=60, should_stop=stop)
    assert result["stopped"]
    assert [e["key"] for e in result["ranking"] if "score" in e] == ["baseline"] or result["best"]


def test_regressao_nas_casas(casas_bytes):
    df, _ = read_table(casas_bytes, "casas.xlsx")
    df = df.sample(3000, random_state=0)
    result, _run = automl.train(df, "valor_mediano_100mil_usd", budget=20, include=["ridge", "hgb", "lgbm"])
    assert result["problem"] == "regression" and result["metric"] == "rmse"
    m = result["evaluation"]["metrics"]
    assert m["r2"] > 0.6
    assert result["best"]["score"] < result["baseline"]["score"]  # RMSE menor é melhor
    assert len(result["evaluation"]["residuals"]["actual"]) == 600


def test_multiclasse():
    rng = np.random.default_rng(3)
    n = 600
    df = pd.DataFrame({"a": rng.normal(size=n), "b": rng.normal(size=n)})
    df["classe"] = np.select([df["a"] > 0.5, df["b"] > 0], ["alta", "media"], "baixa")
    result, run = automl.train(df, "classe", budget=20, include=["logreg", "hgb"])
    assert result["problem"] == "multiclass" and result["metric"] == "f1_macro"
    assert result["evaluation"]["metrics"]["f1_macro"] > 0.8
    assert np.array(result["evaluation"]["confusion"]).shape == (3, 3)
    exp = automl.explain(run, {"a": 2.0, "b": -1.0})
    assert exp["label"] == "alta"


def test_vazamento_e_desbalanceamento(problemas_bytes):
    raw, _ = read_table(problemas_bytes, "p.csv")
    info = automl.target_report(raw, "inadimplente")
    leaks = [a for a in info["alerts"] if a["code"] == "leakage"]
    assert [a["column"] for a in leaks] == ["dias_atraso_pos_concessao"]
    assert leaks[0]["fix"] == {"op": "drop_columns", "columns": ["dias_atraso_pos_concessao"]}
    # "(1.000)" lia como mil em pt-BR; a métrica vai com nome e vírgula.
    assert "(AUC 1,00)" in leaks[0]["message"]
    assert info["problem"] == "binary" and info["classes"][-1] == "sim"
    assert info["strength"][0]["column"] == "dias_atraso_pos_concessao"
    rng = np.random.default_rng(0)
    df = pd.DataFrame({"x": rng.normal(size=500), "y": np.where(np.arange(500) < 20, "raro", "comum")})
    alerts = automl.target_report(df, "y")["alerts"]
    imb = next(a for a in alerts if a["code"] == "imbalance")
    assert "só 4,0% das linhas" in imb["message"]


def test_explicacao_e_variavel_que_importa(small):
    _, run = automl.train(small, "cancelou", budget=30, include=["logreg"])
    ref = run.reference
    outro = "pro" if ref["plano"] == "básico" else "básico"
    row = {"idade": ref["idade"], "renda": 3000, "cidade": ref["cidade"], "plano": outro}
    exp = automl.explain(run, row)
    assert 0 <= exp["value"] <= 1 and exp["label"] in ("sim", "não")
    assert pytest.approx(sum(exp["proba"].values())) == 1
    effects = {c["column"]: c["effect"] for c in exp["contributions"]}
    assert effects["idade"] == 0 and effects["cidade"] == 0  # no valor típico, efeito zero
    assert exp["contributions"][0]["column"] == "plano"
    assert (effects["plano"] > 0) == (outro == "pro")  # o plano pro aumenta o cancelamento na simulação
    with pytest.raises(automl.AutoMLError, match="número"):
        automl.explain(run, {**row, "idade": "velho"})


def test_previsao_exige_as_colunas_usadas(small):
    _, run = automl.train(small, "cancelou", budget=30, include=["logreg"])
    with pytest.raises(automl.AutoMLError, match="Faltam colunas"):
        automl.predict_frame(run, small.drop(columns=["cidade"]))
    out = automl.predict_frame(run, small.drop(columns=["cancelou"]))
    assert list(out.columns) == ["previsto_cancelou", "prob_cancelou_sim"]


def test_poucas_linhas_e_classe_rara_viram_erro():
    with pytest.raises(automl.AutoMLError, match="30 linhas"):
        automl.train(pd.DataFrame({"x": range(10), "y": [0, 1] * 5}), "y")
    df = pd.DataFrame({"x": range(100), "y": ["a"] * 97 + ["b"] * 3})
    with pytest.raises(automl.AutoMLError, match="menos de 5"):
        automl.target_report(df, "y")


def test_credito_de_ponta_a_ponta_com_receita(problemas_bytes):
    raw, _ = read_table(problemas_bytes, "p.csv")
    steps = [
        {"op": "drop_columns", "columns": ["id_contrato", "dias_atraso_pos_concessao"]},
        {"op": "drop_duplicates"},
        {"op": "to_numeric", "columns": ["valor_credito"]},
        {"op": "parse_dates", "columns": ["data_pedido"], "parts": ["month"]},
        {"op": "filter_rows", "column": "idade", "operator": "le", "value": 100},
    ]
    df, _, _ = fit_recipe(raw, steps)
    result, _ = automl.train(df, "inadimplente", budget=40, include=["logreg", "hgb", "rf"])
    # credit-g real: AUC fica perto de 0,75–0,80 (o mlops-platform tem 0,77 no holdout)
    assert 0.68 < result["evaluation"]["metrics"]["roc_auc"] < 0.9


def test_catalogo_tem_lightgbm_e_xgboost():
    keys = {s["key"] for s in models.CLASSIFIERS}
    assert {"lgbm", "xgb", "hgb", "rf", "logreg"} <= keys
    assert all(models.catalog("regression")[0]["key"] == "baseline" for _ in [0])
