// Números em pt-BR e nomes das métricas.

const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

export function fmtInt(n: number | null | undefined): string {
  return n == null || Number.isNaN(n) ? "–" : int.format(n);
}

export function fmtNum(n: number | null | undefined, digits = 3): string {
  if (n == null || Number.isNaN(n)) return "–";
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-3)) {
    return n.toExponential(2).replace(".", ",");
  }
  const d = abs >= 1000 ? 0 : abs >= 100 ? 1 : digits;
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(n);
}

/** Casas fixas (métricas, importância): 0,800 em vez de 0,8 e nada de notação científica. */
export function fmtFixed(n: number | null | undefined, digits = 3): string {
  if (n == null || Number.isNaN(n)) return "–";
  const v = Math.abs(n) < 0.5 * 10 ** -digits ? 0 : n;
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "–";
  return new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: digits }).format(n);
}

export function fmtSeconds(s: number | null | undefined): string {
  if (s == null) return "–";
  if (s < 1) return `${Math.round(s * 1000)} ms`;
  if (s < 60) return `${fmtNum(s, 1)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

export const METRICS: Record<string, { label: string; lower?: boolean; pct?: boolean; help: string }> = {
  roc_auc: { label: "AUC", help: "Chance de o modelo dar nota maior a um positivo do que a um negativo (0,5 = sorte)." },
  accuracy: { label: "Acurácia", pct: true, help: "Fração de acertos com corte em 0,5." },
  balanced_accuracy: { label: "Acurácia balanceada", pct: true, help: "Média do acerto de cada classe." },
  f1: { label: "F1", help: "Equilíbrio entre precisão e recall da classe positiva." },
  f1_macro: { label: "F1 macro", help: "F1 médio entre as classes." },
  precision: { label: "Precisão", pct: true, help: "Dos marcados como positivos, quantos eram." },
  recall: { label: "Recall", pct: true, help: "Dos positivos, quantos o modelo achou." },
  log_loss: { label: "Log loss", lower: true, help: "Penaliza probabilidades confiantes e erradas (menor é melhor)." },
  rmse: { label: "RMSE", lower: true, help: "Erro típico, na unidade do alvo (menor é melhor)." },
  mae: { label: "MAE", lower: true, help: "Erro absoluto médio, na unidade do alvo." },
  r2: { label: "R²", help: "Quanto da variação do alvo o modelo explica (1 = tudo)." },
};

export function metricLabel(key: string): string {
  return METRICS[key]?.label ?? key;
}

export function fmtMetric(key: string, v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "–";
  if (METRICS[key]?.pct) return fmtPct(v);
  // erro na unidade do alvo (RMSE, MAE) pode ser 12.345; o resto fica entre 0 e 1
  return Math.abs(v) >= 100 ? fmtNum(v) : fmtFixed(v, 3);
}

export const PROBLEMS: Record<string, string> = {
  binary: "Classificação binária",
  multiclass: "Classificação multiclasse",
  regression: "Regressão",
};

export const KINDS: Record<string, string> = {
  numeric: "número",
  categorical: "categoria",
  boolean: "sim/não",
  datetime: "data",
  text: "texto",
};

// Nas células, milhar só a partir de 5 dígitos: ano 2024 fica 2024, valor 22106 vira 22.106.
const cellInt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0, useGrouping: "min2" });
const cellNum = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4, useGrouping: "min2" });

export function fmtCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return String(v);
    return Number.isInteger(v) ? cellInt.format(v) : cellNum.format(v);
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T00:00:00$/.test(v)) return v.slice(0, 10);
  return String(v);
}
