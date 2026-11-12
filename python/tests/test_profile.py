import json

import numpy as np
import pandas as pd

from giz.io import read_table
from giz.jsonable import dumps
from giz.profile import column_kind, profile


def codes(p, column=None):
    return {a["code"] for a in p["alerts"] if column is None or a["column"] == column}


def test_tipos_de_coluna():
    assert column_kind(pd.Series([1.0, 2.5])) == "numeric"
    assert column_kind(pd.Series(["sim", "não", "sim"])) == "boolean"
    assert column_kind(pd.Series(pd.date_range("2024-01-01", periods=3))) == "datetime"
    assert column_kind(pd.Series(["a", "b", "a"])) == "categorical"
    long = pd.Series([f"comentário longo número {i} sobre o atendimento recebido" for i in range(200)])
    assert column_kind(long) == "text"


def test_alertas_do_dataset_com_problemas(problemas_bytes):
    df, _ = read_table(problemas_bytes, "p.csv")
    p = profile(df)
    assert "id_like" in codes(p, "id_contrato")
    assert "date_as_text" in codes(p, "data_pedido")
    assert "number_as_text" in codes(p, "valor_credito")
    assert "missing" in codes(p, "poupanca")
    assert "duplicates" in codes(p)
    assert p["duplicates"] == 15
    idade = next(a for a in p["alerts"] if a["code"] == "missing" and a["column"] == "idade")
    assert idade["message"] == "'idade' tem 39 nulos (3,8%)."
    fix = next(a["fix"] for a in p["alerts"] if a["code"] == "id_like")
    assert fix == {"op": "drop_columns", "columns": ["id_contrato"]}


def test_constante_e_muitos_nulos():
    df = pd.DataFrame(
        {"k": ["x"] * 50, "quase_vazia": [None] * 45 + [1.0, 2.0, 3.0, 4.0, 5.0], "v": range(50)}
    )
    p = profile(df)
    assert "constant" in codes(p, "k")
    assert "missing_high" in codes(p, "quase_vazia")


def test_float_continuo_nao_e_id():
    rng = np.random.default_rng(0)
    p = profile(pd.DataFrame({"renda": rng.lognormal(8, 1, 500)}))
    assert "id_like" not in codes(p, "renda")


def test_histograma_correlacao_e_json_sem_nan():
    rng = np.random.default_rng(1)
    x = rng.normal(size=300)
    df = pd.DataFrame({"x": x, "y": 2 * x + rng.normal(scale=0.1, size=300), "z": [np.nan] * 300})
    df.loc[0, "x"] = np.inf
    p = profile(df)
    col = next(c for c in p["columns"] if c["name"] == "x")
    assert sum(col["hist"]["counts"]) == 299  # o inf fica de fora
    corr = p["correlations"]
    assert corr["columns"][:2] == ["x", "y"]
    json.loads(dumps(p))  # sem NaN/inf: o JSON.parse do navegador recusaria


def test_numero_em_formato_brasileiro():
    from giz.jsonable import br

    assert br(1234567) == "1.234.567"
    assert br(3.849, 1) == "3,8"
    assert br(1234.5, 2) == "1.234,50"
    assert br(0.999, 2) == "1,00"
