from pathlib import Path

import pandas as pd
import pytest

from giz.io import ReadError, excel_sheets, read_table


def test_csv_brasileiro_ponto_e_virgula_e_virgula_decimal():
    data = "nome;valor;quantidade\nA;1.234,56;3\nB;10,5;4\nC;7,25;1\nD;1.000,00;2\n".encode("cp1252")
    df, info = read_table(data, "x.csv")
    assert info["sep"] == ";" and info["decimal"] == ","
    assert df["valor"].tolist() == [1234.56, 10.5, 7.25, 1000.0]
    assert df["quantidade"].dtype.kind == "i"


def test_csv_latin1_e_bom():
    latin = "cidade,nota\nSão Paulo,1\nGoiânia,2\n".encode("latin-1")
    df, info = read_table(latin, "x.csv")
    assert df["cidade"].tolist() == ["São Paulo", "Goiânia"]
    bom = "﻿cidade,nota\nRecife,1\nNatal,2\n".encode()
    df, info = read_table(bom, "x.csv")
    assert list(df.columns) == ["cidade", "nota"]
    assert info["encoding"] == "utf-8-sig"


def test_colunas_repetidas_sem_nome_e_texto_vazio():
    df, _ = read_table(b"a,a,,b\n1,2,3, \n4,5,6,x\n", "x.csv")
    assert list(df.columns) == ["a", "a.1", "coluna_3", "b"]  # o pandas já renomeia a repetida
    assert df["b"].isna().tolist() == [True, False]


def test_vazio_vira_erro_legivel():
    with pytest.raises(ReadError, match="vazio"):
        read_table(b"  \n", "x.csv")


def test_excel_com_varias_abas(casas_bytes):
    sheets = excel_sheets(casas_bytes)
    assert [s["name"] for s in sheets] == ["casas", "sobre"]
    df, info = read_table(casas_bytes, "casas.xlsx")
    assert info["sheet"] == "casas"  # a maior aba é a escolhida
    assert df.shape == (20640, 9)
    df2, info2 = read_table(casas_bytes, "casas.xlsx", sheet="sobre")
    assert info2["sheet"] == "sobre" and len(df2) == 5
    with pytest.raises(ReadError, match="não existe"):
        read_table(casas_bytes, "casas.xlsx", sheet="nada")


def test_excel_com_datas():
    data = (Path(__file__).parent / "fixtures" / "datas.xlsx").read_bytes()
    df, info = read_table(data, "d.xlsx")
    assert info["sheet"] == "pedidos"
    assert pd.api.types.is_datetime64_any_dtype(df["quando"])


def test_amostra_credito(credito_bytes):
    df, info = read_table(credito_bytes, "credito.csv")
    assert df.shape == (1000, 19)
    assert info["decimal"] == ","
    assert df["valor_credito"].dtype.kind == "f"
