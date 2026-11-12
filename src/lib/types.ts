// Formas do JSON que o motor Python devolve (python/giz).

export type Kind = "numeric" | "categorical" | "boolean" | "datetime" | "text";

export type Step = {
  op: string;
  columns?: string[];
  column?: string;
  operator?: string;
  value?: string | number | null;
  strategy?: string;
  method?: string;
  action?: string;
  factor?: number;
  parts?: string[];
  drop?: boolean;
  dayfirst?: boolean;
  disabled?: boolean;
  uid?: string;
};

export type Alert = {
  code: string;
  column?: string | null;
  severity: "info" | "warn" | "danger";
  message: string;
  fix?: Step | null;
};

export type Column = {
  name: string;
  kind: Kind;
  dtype: string;
  missing: number;
  missing_pct: number;
  unique: number;
  sample: unknown[];
  stats?: Record<string, number | boolean | string | null>;
  hist?: { edges: number[]; counts: number[] };
  top?: [string, number][];
  other?: number;
};

export type Table = { columns: string[]; rows: unknown[][] };

export type Profile = {
  rows: number;
  cols: number;
  duplicates: number;
  missing_cells: number;
  memory_mb: number;
  columns: Column[];
  alerts: Alert[];
  correlations: { columns: string[]; matrix: (number | null)[][] };
  head: Table;
};

export type Source = {
  format: "csv" | "excel";
  filename: string;
  rows: number;
  cols: number;
  sep?: string;
  decimal?: string;
  encoding?: string;
  sheet?: string;
  sheets?: { name: string; rows: number; cols: number }[];
};

export type StepReport = {
  index: number;
  op: string;
  label: string;
  skipped?: boolean;
  error?: string;
  rows_before?: number;
  rows_after?: number;
  added?: string[];
  removed?: string[];
};

export type Problem = "binary" | "multiclass" | "regression";

export type TargetInfo = {
  target: string;
  problem: Problem;
  detected: Problem;
  rows: number;
  classes: string[] | null;
  class_counts?: [string, number][];
  target_stats?: { mean: number; std: number; min: number; max: number };
  features: string[];
  ignored: { column: string; reason: string }[];
  strength: { column: string; score: number }[];
  strength_metric: string;
  alerts: Alert[];
};

export type Candidate = {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "skipped" | "failed" | "stopped";
  folds: number[];
  score?: number;
  std?: number;
  reason?: string;
  seconds?: number;
};

export type Evaluation = {
  metrics: Record<string, number>;
  confusion?: number[][];
  roc?: { fpr: number[]; tpr: number[] };
  scores?: { y: number[]; p: number[] };
  residuals?: { actual: number[]; pred: number[] };
  error_hist?: { edges: number[]; counts: number[] };
  importance: { column: string; importance: number; std: number }[];
};

export type TrainResult = {
  problem: Problem;
  metric: string;
  target: string;
  classes: string[] | null;
  rows: number;
  cv_rows: number;
  holdout_rows: number;
  folds: number;
  features: { numeric: string[]; categorical: string[]; ignored: { column: string; reason: string }[] };
  ranking: Candidate[];
  best: Candidate & { cls: string; params: Record<string, unknown>; stores_data: boolean };
  baseline: Candidate | null;
  evaluation: Evaluation;
  stopped: boolean;
  seconds: number;
  budget: number;
  holdout_sample: Table & { actual: (string | number)[]; pred: (string | number)[] };
};

export type Explanation = {
  value: number;
  label: string;
  proba?: Record<string, number>;
  positive?: string | null;
  contributions: { column: string; value: unknown; reference: unknown; effect: number }[];
};

export type PredictSummary = {
  rows: number;
  columns: string[];
  rows_with_missing: number;
  check?: Record<string, number>;
  distribution: [string, number][] | { mean: number; min: number; max: number };
  preview: Table;
  file: Source;
};
