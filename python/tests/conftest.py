from pathlib import Path

import numpy as np
import pandas as pd
import pytest

SAMPLES = Path(__file__).resolve().parents[2] / "public" / "samples"


@pytest.fixture(scope="session")
def samples() -> Path:
    return SAMPLES


@pytest.fixture(scope="session")
def credito_bytes() -> bytes:
    return (SAMPLES / "credito.csv").read_bytes()


@pytest.fixture(scope="session")
def problemas_bytes() -> bytes:
    return (SAMPLES / "credito-com-problemas.csv").read_bytes()


@pytest.fixture(scope="session")
def casas_bytes() -> bytes:
    return (SAMPLES / "casas-california.xlsx").read_bytes()


@pytest.fixture
def small() -> pd.DataFrame:
    rng = np.random.default_rng(0)
    n = 400
    df = pd.DataFrame(
        {
            "idade": rng.integers(18, 70, n).astype(float),
            "renda": rng.lognormal(8, 0.5, n).round(2),
            "cidade": rng.choice(["SP", "RJ", "BH", "POA"], n),
            "plano": rng.choice(["básico", "pro"], n),
        }
    )
    logit = -2 + 0.04 * (df["idade"] - 40) + 1.2 * (df["plano"] == "pro") + 0.6 * (df["cidade"] == "SP")
    df["cancelou"] = np.where(rng.random(n) < 1 / (1 + np.exp(-logit)), "sim", "não")
    df.loc[rng.choice(n, 20, replace=False), "idade"] = np.nan
    return df
