"""Gera os datasets de exemplo em public/samples/ a partir de data/.

- credito.csv: Statlog German Credit (UCI, CC BY 4.0) em reais, como no mlops-platform, com nomes em português.
- credito-com-problemas.csv: o mesmo crédito com problemas colocados de propósito para a demo (ID, data como texto,
  valor como texto em R$, nulos, linhas repetidas, idades digitadas errado e uma coluna que vaza o alvo).
- casas-california.xlsx: California Housing (StatLib, censo dos EUA de 1990), planilha com duas abas.
- *-novos.csv: linhas sem a coluna alvo, para testar a previsão em lote.

Rode com:  cd python && uv run python ../scripts/make_samples.py
"""

from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "samples"

COLS = {
    "duration": "prazo_meses",
    "credit_amount": "valor_credito",
    "installment_commitment": "comprometimento_renda",
    "residence_since": "anos_na_residencia",
    "age": "idade",
    "existing_credits": "creditos_ativos",
    "num_dependents": "dependentes",
    "checking_status": "conta_corrente",
    "credit_history": "historico_credito",
    "purpose": "finalidade",
    "savings_status": "poupanca",
    "employment": "tempo_emprego",
    "other_parties": "garantia",
    "property_magnitude": "patrimonio",
    "other_payment_plans": "outros_parcelamentos",
    "housing": "moradia",
    "job": "emprego",
    "own_telephone": "telefone",
    "default": "inadimplente",
}
VALUES = {
    "checking_status": {"<0": "negativa", "0<=X<1940": "até R$ 1.940", ">=1940": "R$ 1.940 ou mais",
                        "no checking": "sem conta"},
    "credit_history": {"all paid": "tudo pago neste banco", "critical/other existing credit": "crítico",
                       "delayed previously": "atrasou antes", "existing paid": "em dia",
                       "no credits/all paid": "sem créditos"},
    "purpose": {"business": "negócio", "domestic appliance": "eletrodoméstico", "education": "educação",
                "furniture/equipment": "móveis", "new car": "carro novo", "other": "outro", "radio/tv": "rádio/TV",
                "repairs": "reforma", "retraining": "requalificação", "used car": "carro usado"},
    "savings_status": {"<970": "até R$ 970", "970<=X<4850": "R$ 970 a 4.850", "4850<=X<9700": "R$ 4.850 a 9.700",
                       ">=9700": "R$ 9.700 ou mais", "no known savings": "sem poupança"},
    "employment": {"unemployed": "desempregado", "<1": "menos de 1 ano", "1<=X<4": "1 a 4 anos",
                   "4<=X<7": "4 a 7 anos", ">=7": "7 anos ou mais"},
    "other_parties": {"none": "nenhuma", "guarantor": "fiador", "co applicant": "cotitular"},
    "property_magnitude": {"real estate": "imóvel", "life insurance": "seguro de vida", "car": "carro",
                           "no known property": "nenhum"},
    "other_payment_plans": {"none": "nenhum", "bank": "banco", "stores": "lojas"},
    "housing": {"own": "própria", "rent": "aluguel", "for free": "cedida"},
    "job": {"skilled": "qualificado", "unskilled resident": "não qualificado",
            "high qualif/self emp/mgmt": "gestor ou autônomo", "unemp/unskilled non res": "sem emprego fixo"},
    "own_telephone": {"none": "não", "yes": "sim"},
}


def credito() -> pd.DataFrame:
    raw = pd.read_csv(ROOT / "data" / "credit_g_reais.csv.gz")
    for col, m in VALUES.items():
        missing = set(raw[col].unique()) - set(m)
        assert not missing, (col, missing)
        raw[col] = raw[col].map(m)
    raw["default"] = raw["default"].map({1: "sim", 0: "não"})
    return raw.rename(columns=COLS)[list(COLS.values())]


def brl(v: float) -> str:
    s = f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {s}"


def com_problemas(df: pd.DataFrame) -> pd.DataFrame:
    rng = np.random.default_rng(7)
    d = df.copy()
    n = len(d)
    d.insert(0, "id_contrato", [f"C-{i:06d}" for i in rng.permutation(np.arange(100000, 100000 + n))])
    dias = rng.integers(0, 730, n)
    d.insert(1, "data_pedido", (pd.Timestamp("2023-01-02") + pd.to_timedelta(dias, unit="D")).strftime("%d/%m/%Y"))
    d["valor_credito"] = d["valor_credito"].map(brl)
    for col, frac in (("poupanca", 0.06), ("tempo_emprego", 0.05), ("idade", 0.04)):
        d.loc[rng.random(n) < frac, col] = None
    erradas = rng.choice(n, 3, replace=False)
    d.loc[erradas, "idade"] = [999, 0, 245]
    d["idade"] = d["idade"].astype("Int64")
    sim = d["inadimplente"] == "sim"
    d["dias_atraso_pos_concessao"] = np.where(sim, rng.integers(31, 181, n), rng.choice([0, 0, 0, 1, 2, 3], n))
    dup = d.iloc[rng.choice(n, 15, replace=False)]
    d = pd.concat([d, dup], ignore_index=True)
    return d.sample(frac=1.0, random_state=7).reset_index(drop=True)


CASAS = {
    "MedInc": "renda_mediana_10mil_usd",
    "HouseAge": "idade_mediana_casas",
    "AveRooms": "comodos_por_domicilio",
    "AveBedrms": "quartos_por_domicilio",
    "Population": "populacao",
    "AveOccup": "moradores_por_domicilio",
    "Latitude": "latitude",
    "Longitude": "longitude",
    "MedHouseVal": "valor_mediano_100mil_usd",
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    c = credito()
    c.to_csv(OUT / "credito.csv", index=False, sep=";", decimal=",")
    c.sample(60, random_state=1).drop(columns=["inadimplente"]).to_csv(
        OUT / "credito-novos.csv", index=False, sep=";", decimal=","
    )
    p = com_problemas(c)
    p.to_csv(OUT / "credito-com-problemas.csv", index=False, sep=";")
    p.sample(60, random_state=2).drop(columns=["inadimplente", "dias_atraso_pos_concessao"]).to_csv(
        OUT / "credito-com-problemas-novos.csv", index=False, sep=";"
    )

    casas = pd.read_csv(ROOT / "data" / "california_housing.csv.gz").rename(columns=CASAS)
    sobre = pd.DataFrame(
        {
            "campo": ["fonte", "linhas", "alvo", "unidades", "licença"],
            "valor": [
                "California Housing (StatLib; Pace & Barry, 1997), censo dos EUA de 1990",
                f"{len(casas)} grupos de quarteirões",
                "valor_mediano_100mil_usd (valor mediano das casas, em US$ 100 mil)",
                "renda em US$ 10 mil; cômodos, quartos e moradores são médias por domicílio",
                "dados públicos do censo dos EUA",
            ],
        }
    )
    with pd.ExcelWriter(OUT / "casas-california.xlsx") as w:
        casas.to_excel(w, sheet_name="casas", index=False)
        sobre.to_excel(w, sheet_name="sobre", index=False)
    casas.sample(80, random_state=3).drop(columns=["valor_mediano_100mil_usd"]).to_csv(
        OUT / "casas-california-novos.csv", index=False
    )
    for f in sorted(OUT.iterdir()):
        print(f.name, f.stat().st_size)


if __name__ == "__main__":
    main()
