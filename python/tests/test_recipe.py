import pandas as pd
import pytest

from giz.io import read_table
from giz.recipe import RecipeError, apply_recipe, describe_step, fit_recipe


@pytest.fixture
def df():
    return pd.DataFrame(
        {
            "id": ["a1", "a2", "a3", "a4", "a5", "a5"],
            "idade": [20.0, None, 40.0, 50.0, 300.0, 300.0],
            "cidade": ["SP", "RJ", None, "SP", "BH", "BH"],
            "quando": ["01/02/2024", "15/03/2024", "31/12/2023", None, "10/10/2024", "10/10/2024"],
            "valor": ["R$ 1.234,50", "R$ 10,00", "R$ 7,25", "R$ 3,00", None, None],
        }
    )


def test_imputa_com_valor_aprendido_no_treino_e_reusa_na_previsao(df):
    steps = [{"op": "impute", "columns": ["idade"], "strategy": "median"}]
    out, states, _ = fit_recipe(df, steps)
    med = df["idade"].median()
    assert out["idade"].isna().sum() == 0
    assert states[0]["values"]["idade"] == med
    novo = pd.DataFrame({"idade": [None, 1.0]})
    assert apply_recipe(novo, steps, states)["idade"].tolist() == [med, 1.0]


def test_moda_e_valor_fixo(df):
    out, states, _ = fit_recipe(df, [{"op": "impute", "columns": ["cidade"], "strategy": "mode"}])
    assert out["cidade"].isna().sum() == 0
    assert states[0]["values"]["cidade"] in {"SP", "BH"}
    with pytest.raises(RecipeError, match="numérica"):
        fit_recipe(df, [{"op": "impute", "columns": ["idade"], "strategy": "constant", "value": "x"}])
    with pytest.raises(RecipeError, match="não é numérica"):
        fit_recipe(df, [{"op": "impute", "columns": ["cidade"], "strategy": "median"}])


def test_codificacao_onehot_ordinal_frequencia_com_categoria_nova(df):
    steps = [{"op": "encode", "columns": ["cidade"], "method": "onehot"}]
    out, states, _rep = fit_recipe(df, steps)
    assert {"cidade_SP", "cidade_RJ", "cidade_BH"} <= set(out.columns) and "cidade" not in out
    assert list(out.columns).index("cidade_SP") == 2  # entra no lugar da original, mais frequente antes
    novo = apply_recipe(pd.DataFrame({"cidade": ["Manaus", "SP"]}), steps, states)
    assert novo.filter(like="cidade_").sum(axis=1).tolist() == [0, 1]
    o_steps = [{"op": "encode", "columns": ["cidade"], "method": "ordinal"}]
    out, st, _ = fit_recipe(df, o_steps)
    assert apply_recipe(pd.DataFrame({"cidade": ["Manaus"]}), o_steps, st)["cidade"].tolist() == [-1]
    f_steps = [{"op": "encode", "columns": ["cidade"], "method": "frequency"}]
    out, st, _ = fit_recipe(df, f_steps)
    assert out["cidade"].max() == pytest.approx(2 / 6, abs=1e-6)  # nulos contam no total


def test_filtro_e_duplicados_nao_removem_linhas_na_previsao(df):
    steps = [
        {"op": "filter_rows", "column": "idade", "operator": "lt", "value": "100"},
        {"op": "drop_duplicates"},
    ]
    out, states, rep = fit_recipe(df, steps)
    assert len(out) == 3  # tira nulo, 300 e o repetido
    assert rep[0]["rows_before"] == 6 and rep[0]["rows_after"] == 3
    assert len(apply_recipe(df, steps, states)) == len(df)


def test_filtro_texto_e_operadores(df):
    out, _, _ = fit_recipe(df, [{"op": "filter_rows", "column": "cidade", "operator": "eq", "value": "SP"}])
    assert out["cidade"].tolist() == ["SP", "SP"]
    out, _, _ = fit_recipe(df, [{"op": "filter_rows", "column": "cidade", "operator": "notnull"}])
    assert len(out) == 5
    with pytest.raises(RecipeError, match="número"):
        fit_recipe(df, [{"op": "filter_rows", "column": "idade", "operator": "gt", "value": "muito"}])


def test_datas_dia_primeiro_e_partes(df):
    steps = [{"op": "parse_dates", "columns": ["quando"], "parts": ["year", "month", "weekday"]}]
    out, _states, rep = fit_recipe(df, steps)
    assert "quando" not in out
    assert out["quando_mes"].tolist()[:3] == [2.0, 3.0, 12.0]  # 01/02 é fevereiro
    assert out["quando_ano"].isna().tolist()[3]
    assert rep[0]["added"] == ["quando_ano", "quando_mes", "quando_dia_semana"]


def test_outliers_remover_no_treino_vira_limitar_na_previsao(df):
    d = pd.DataFrame({"idade": [20.0, 25, 30, 33, 35, 38, 41, 45, 50, 300]})
    steps = [
        {"op": "remove_outliers", "columns": ["idade"], "method": "iqr", "factor": 1.5, "action": "remove"}
    ]
    out, states, _ = fit_recipe(d, steps)
    _lo, hi = states[0]["bounds"]["idade"]
    assert out["idade"].max() <= hi < 300
    novo = apply_recipe(pd.DataFrame({"idade": [1000.0, 30.0]}), steps, states)
    assert len(novo) == 2 and novo["idade"].iloc[0] == hi


def test_texto_para_numero_estilo_brasileiro(df):
    out, states, _ = fit_recipe(df, [{"op": "to_numeric", "columns": ["valor"]}])
    assert states[0]["styles"]["valor"] == "br"
    assert out["valor"].tolist()[:4] == [1234.5, 10.0, 7.25, 3.0]


def test_ordem_importa_e_erro_aponta_o_passo(df):
    steps = [
        {"op": "drop_columns", "columns": ["idade"]},
        {"op": "impute", "columns": ["idade"], "strategy": "median"},
    ]
    with pytest.raises(RecipeError) as e:
        fit_recipe(df, steps)
    assert e.value.index == 1 and "não existem mais" in e.value.message
    out, _states, rep = fit_recipe(df, steps, stop_on_error=False)
    assert "error" in rep[1] and "idade" not in out  # prévia para no passo com erro
    ok, _, _ = fit_recipe(df, list(reversed(steps)))
    assert "idade" not in ok


def test_passo_desligado_e_desconhecido(df):
    out, states, rep = fit_recipe(df, [{"op": "drop_columns", "columns": ["id"], "disabled": True}])
    assert "id" in out and rep[0]["skipped"] and states == [None]
    with pytest.raises(RecipeError, match="desconhecido"):
        fit_recipe(df, [{"op": "magica"}])


def test_receita_completa_no_dataset_com_problemas(problemas_bytes):
    raw, _ = read_table(problemas_bytes, "p.csv")
    steps = [
        {"op": "drop_columns", "columns": ["id_contrato", "dias_atraso_pos_concessao"]},
        {"op": "drop_duplicates"},
        {"op": "to_numeric", "columns": ["valor_credito"]},
        {"op": "parse_dates", "columns": ["data_pedido"], "parts": ["month", "weekday"]},
        {"op": "filter_rows", "column": "idade", "operator": "le", "value": 100},
        {"op": "impute", "columns": ["poupanca", "tempo_emprego"], "strategy": "mode"},
        {"op": "impute", "columns": ["idade"], "strategy": "median"},
    ]
    out, _states, _rep = fit_recipe(raw, steps)
    assert out.isna().sum().sum() == 0
    assert out["idade"].max() <= 100
    assert out["valor_credito"].dtype.kind == "f"
    assert next(describe_step(s) for s in steps) == "Apagar id_contrato, dias_atraso_pos_concessao"
