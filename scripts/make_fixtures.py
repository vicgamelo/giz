"""Gera tests/fixtures/*.json com o que o motor devolve para os exemplos (perfil, alvo, treino, lote).

Os testes do assistente usam esses JSON de verdade para conferir o que entra no resumo e o que fica de fora.
    cd python && uv run python ../scripts/make_fixtures.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python"))

from giz import api

SAMPLES = ROOT / "public" / "samples"
OUT = ROOT / "tests" / "fixtures"


def make(name: str, file: str, target: str, batch: str, steps: list[dict]) -> None:
    loaded = json.loads(api.load_path(str(SAMPLES / file), file))
    preview = json.loads(api.preview(json.dumps(steps)))
    info = json.loads(api.target(target))
    result = json.loads(api.train(target, None, 5, None, lambda e: None, lambda: False))
    out = OUT / f"{name}-previsoes.csv"
    summary = json.loads(api.predict_path(str(SAMPLES / batch), batch, str(out)))
    out.unlink()
    # Os testes não usam as curvas nem a amostra inteira do holdout: 20 pontos bastam e o JSON fica pequeno.
    ev = result["evaluation"]
    for key in ("roc", "scores", "residuals"):
        if key in ev:
            ev[key] = {k: v[:20] for k, v in ev[key].items()}
    sample = result["holdout_sample"]
    for key in ("rows", "actual", "pred"):
        sample[key] = sample[key][:20]
    data = {
        "source": loaded["source"],
        "rawProfile": loaded["profile"],
        "steps": steps,
        "reports": preview["reports"],
        "profile": preview["profile"],
        "targetInfo": info,
        "result": result,
        "batch": summary,
    }
    (OUT / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    make(
        "credito-problemas",
        "credito-com-problemas.csv",
        "inadimplente",
        "credito-com-problemas-novos.csv",
        [{"op": "drop_duplicates"}, {"op": "drop_columns", "columns": ["dias_atraso_pos_concessao"]}],
    )
    make("casas", "casas-california.xlsx", "valor_mediano_100mil_usd", "casas-california-novos.csv", [])
    # One-hot cria colunas com o valor da célula no nome (finalidade_carro novo): o resumo não pode repetir isso.
    make(
        "credito-onehot",
        "credito.csv",
        "inadimplente",
        "credito-novos.csv",
        [{"op": "encode", "columns": ["finalidade", "moradia"], "method": "onehot"}],
    )
