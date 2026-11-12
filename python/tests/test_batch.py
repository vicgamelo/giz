import io

import pandas as pd

from lousa import automl
from lousa.batch import predict_file, to_csv
from lousa.io import read_table
from lousa.recipe import fit_recipe

STEPS = [
    {"op": "drop_columns", "columns": ["id_contrato", "dias_atraso_pos_concessao"]},
    {"op": "drop_duplicates"},
    {"op": "to_numeric", "columns": ["valor_credito"]},
    {"op": "parse_dates", "columns": ["data_pedido"], "parts": ["month"]},
    {"op": "filter_rows", "column": "idade", "operator": "le", "value": 100},
    {"op": "impute", "columns": ["idade"], "strategy": "median"},
]


def _trained(problemas_bytes):
    raw, _ = read_table(problemas_bytes, "p.csv")
    df, states, _ = fit_recipe(raw, STEPS)
    _, run = automl.train(df, "inadimplente", budget=20, include=["logreg"])
    return run, states


def test_lote_mantem_todas_as_linhas_e_usa_a_receita(problemas_bytes, samples):
    run, states = _trained(problemas_bytes)
    novos = (samples / "credito-com-problemas-novos.csv").read_bytes()
    csv, summary = predict_file(run, STEPS, states, novos, "novos.csv")
    out = pd.read_csv(io.BytesIO(csv), sep=";", decimal=",")
    original = pd.read_csv(io.BytesIO(novos), sep=";")
    assert len(out) == len(original) == summary["rows"] == 60  # filtro e duplicados não valem na previsão
    assert out["id_contrato"].tolist() == original["id_contrato"].tolist()  # colunas originais voltam
    assert set(out["previsto_inadimplente"]) <= {"sim", "não"}
    assert out["prob_inadimplente_sim"].between(0, 1).all()
    assert "check" not in summary


def test_lote_com_alvo_mostra_o_desempenho(problemas_bytes):
    run, states = _trained(problemas_bytes)
    _csv, summary = predict_file(run, STEPS, states, problemas_bytes, "p.csv")
    assert summary["check"]["rows"] == 1015
    assert summary["check"]["roc_auc"] > 0.7


def test_lote_sem_coluna_usada_vira_erro(problemas_bytes):
    run, states = _trained(problemas_bytes)
    ruim = b"prazo_meses;idade\n12;30\n"
    try:
        predict_file(run, STEPS[:1], states[:1], ruim, "r.csv")
    except automl.AutoMLError as e:
        assert "Faltam colunas" in str(e)
    else:
        raise AssertionError("devia falhar")


def test_csv_escapa_formulas():
    df = pd.DataFrame({"nome": ["=HYPERLINK(1)", "+soma", "@x", "normal", "-1"], "v": [-1, 2, 3, 4, 5]})
    text = to_csv(df).decode("utf-8-sig")
    lines = text.splitlines()
    assert lines[1] == "'=HYPERLINK(1),-1"  # número negativo continua número
    assert lines[2:] == ["'+soma,2", "'@x,3", "normal,4", "'-1,5"]
