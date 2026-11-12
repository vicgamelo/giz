import base64
import json

import numpy as np
import pytest

from lousa import api, automl, tracking
from lousa.io import read_table


@pytest.fixture
def trained(credito_bytes):
    api.load(credito_bytes, "credito.csv")
    api.preview(json.dumps([{"op": "impute", "columns": ["idade"], "strategy": "median"}]))

    def train(model):
        # orçamento folgado: aqui o que importa é o modelo, não o tempo (com a máquina carregada o RF era pulado)
        result, run = automl.train(api.S["treated"], "inadimplente", budget=300, include=[model])
        assert result["best"]["key"] == model
        api.S["run"] = run
        return run

    return train


def test_payload_tem_parametros_metricas_e_artefatos_sem_linhas(trained, credito_bytes):
    trained("logreg")
    out = json.loads(api.mlflow_payload(False))
    p = out["payload"]
    assert p["params"]["target"] == "inadimplente" and p["params"]["model.C"] == "1.0"
    assert p["params"]["positive_class"] == "sim"
    assert 0.6 < p["metrics"]["holdout_roc_auc"] < 0.95
    assert "cv_roc_auc" in p["metrics"] and "baseline_cv_roc_auc" in p["metrics"]
    assert set(p["artifacts"]) == {
        "receita.json",
        "lousa_modelo.py",
        "lousa_modelo.ipynb",
        "ranking.json",
        "avaliacao.json",
    }
    assert p["model"] is None
    assert p["tags"]["lousa.dataset_sha256"] and len(p["tags"]["lousa.dataset_sha256"]) == 64
    assert all(len(v) <= tracking.MAX_PARAM for v in p["params"].values())
    # nenhuma linha dos dados: o holdout (que tem linhas) e as probabilidades por linha ficam de fora
    blob = json.dumps(p)
    raw, _ = read_table(credito_bytes, "credito.csv")
    assert "holdout_sample" not in blob and '"scores"' not in blob
    first = ";".join(str(v) for v in raw.iloc[0].tolist())
    assert first not in blob
    assert set(out["summary"]["artifacts"]) == set(p["artifacts"])


@pytest.mark.parametrize("model", ["logreg", "hgb", "rf", "lgbm", "xgb"])
def test_modelo_skops_volta_igual_e_sem_tipos_estranhos(trained, model):
    pytest.importorskip("skops")
    from lousa import models

    spec = next(s for s in models.CLASSIFIERS if s["key"] == model)
    if not models.available(spec):
        pytest.skip(f"{model} não importa neste ambiente")
    run = trained(model)
    p = json.loads(api.mlflow_payload(True))["payload"]
    data = base64.b64decode(p["model"]["b64"])
    import skops.io as sio

    untrusted = sio.get_untrusted_types(data=data)
    # Só tipos de bibliotecas conhecidas; nada de builtins perigosos.
    assert all(
        t.split(".")[0] in {"lightgbm", "xgboost", "sklearn", "numpy", "scipy", "collections"}
        for t in untrusted
    )
    loaded = sio.loads(data, trusted=untrusted)
    X = automl.prepare_xy(api.S["treated"], "inadimplente", "binary")[0]
    np.testing.assert_allclose(loaded.predict_proba(X), run.pipeline.predict_proba(X), atol=1e-12)
    assert "scikit-learn==" in p["model"]["requirements"]


def test_knn_nao_vai_para_o_mlflow(trained):
    pytest.importorskip("skops")
    trained("knn")
    with pytest.raises(ValueError, match="guarda as linhas"):
        api.mlflow_payload(True)
