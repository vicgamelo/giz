// Receita na página: catálogo de passos, histórico para desfazer/refazer e reordenação.
import type { Step } from "./types";

export type OpField =
  | { key: "columns"; label: string; kinds?: string[] }
  | { key: "column"; label: string }
  | { key: "strategy" | "method" | "action" | "operator"; label: string; options: [string, string][] }
  | { key: "value"; label: string; when?: (s: Step) => boolean }
  | { key: "factor"; label: string }
  | { key: "parts"; label: string; options: [string, string][] };

export type OpSpec = { op: string; label: string; help: string; fields: OpField[]; defaults: Partial<Step> };

export const OPS: OpSpec[] = [
  {
    op: "impute",
    label: "Preencher nulos",
    help: "Troca os vazios pela média, mediana, moda ou um valor fixo, aprendidos no treino.",
    fields: [
      { key: "columns", label: "Colunas" },
      {
        key: "strategy",
        label: "Com",
        options: [
          ["median", "mediana"],
          ["mean", "média"],
          ["mode", "moda (mais comum)"],
          ["constant", "valor fixo"],
        ],
      },
      { key: "value", label: "Valor", when: (s) => s.strategy === "constant" },
    ],
    defaults: { strategy: "median" },
  },
  {
    op: "encode",
    label: "Codificar categorias",
    help: "One-hot cria uma coluna 0/1 por categoria; ordinal numera; frequência troca pela proporção.",
    fields: [
      { key: "columns", label: "Colunas", kinds: ["categorical", "boolean", "text"] },
      {
        key: "method",
        label: "Método",
        options: [
          ["onehot", "one-hot"],
          ["ordinal", "ordinal"],
          ["frequency", "frequência"],
        ],
      },
    ],
    defaults: { method: "onehot" },
  },
  {
    op: "filter_rows",
    label: "Filtrar linhas",
    help: "Mantém só as linhas que passam na condição. Na previsão em lote, nenhuma linha é removida.",
    fields: [
      { key: "column", label: "Coluna" },
      {
        key: "operator",
        label: "Condição",
        options: [
          ["eq", "igual a"],
          ["ne", "diferente de"],
          ["gt", "maior que"],
          ["ge", "maior ou igual a"],
          ["lt", "menor que"],
          ["le", "menor ou igual a"],
          ["contains", "contém"],
          ["notnull", "está preenchida"],
          ["isnull", "está vazia"],
        ],
      },
      { key: "value", label: "Valor", when: (s) => !["isnull", "notnull"].includes(s.operator ?? "") },
    ],
    defaults: { operator: "notnull" },
  },
  {
    op: "parse_dates",
    label: "Converter datas",
    help: "Lê texto como data (dia primeiro, como no Brasil) e cria colunas de ano, mês, dia da semana…",
    fields: [
      { key: "columns", label: "Colunas" },
      {
        key: "parts",
        label: "Extrair",
        options: [
          ["year", "ano"],
          ["month", "mês"],
          ["day", "dia"],
          ["weekday", "dia da semana"],
          ["hour", "hora"],
        ],
      },
    ],
    defaults: { parts: ["year", "month", "weekday"], drop: true, dayfirst: true },
  },
  {
    op: "to_numeric",
    label: "Converter em número",
    help: "Lê “R$ 1.234,56”, “12%” e afins como número.",
    fields: [{ key: "columns", label: "Colunas", kinds: ["categorical", "text", "boolean"] }],
    defaults: {},
  },
  {
    op: "remove_outliers",
    label: "Tratar outliers",
    help: "Limites por IQR ou desvio padrão, aprendidos no treino. Remover vale só no treino; na previsão vira limitar.",
    fields: [
      { key: "columns", label: "Colunas", kinds: ["numeric"] },
      {
        key: "method",
        label: "Regra",
        options: [
          ["iqr", "IQR (quartis)"],
          ["zscore", "desvio padrão"],
        ],
      },
      { key: "factor", label: "Fator" },
      {
        key: "action",
        label: "Ação",
        options: [
          ["clip", "limitar"],
          ["remove", "remover linhas"],
        ],
      },
    ],
    defaults: { method: "iqr", factor: 1.5, action: "clip" },
  },
  {
    op: "drop_columns",
    label: "Apagar colunas",
    help: "Tira colunas que não devem entrar no modelo (IDs, vazamento, texto livre).",
    fields: [{ key: "columns", label: "Colunas" }],
    defaults: {},
  },
  {
    op: "drop_duplicates",
    label: "Remover repetidas",
    help: "Tira linhas idênticas (só no treino).",
    fields: [],
    defaults: {},
  },
];

export function opSpec(op: string): OpSpec | undefined {
  return OPS.find((o) => o.op === op);
}

let counter = 0;
export function uid(): string {
  counter += 1;
  return `p${Date.now().toString(36)}${counter}`;
}

export function withUid(step: Step): Step {
  return step.uid ? step : { ...step, uid: uid() };
}

/** O motor não precisa do uid; ele só existe para a lista animar e arrastar. */
export function forEngine(steps: Step[]): Step[] {
  return steps.map(({ uid: _uid, ...rest }) => rest);
}

export function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const out = list.slice();
  const [item] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, item);
  return out;
}

/** Histórico simples: cada mudança guarda a receita anterior. */
export class History<T> {
  past: T[] = [];
  future: T[] = [];
  constructor(public limit = 100) {}

  push(previous: T) {
    this.past.push(previous);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: T): T | undefined {
    const prev = this.past.pop();
    if (prev !== undefined) this.future.push(current);
    return prev;
  }

  redo(current: T): T | undefined {
    const next = this.future.pop();
    if (next !== undefined) this.past.push(current);
    return next;
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }
}

/** Mesmo passo já está na receita? (o botão "Corrigir" de um alerta não duplica) */
export function sameStep(a: Step, b: Step): boolean {
  return canonical(forEngine([{ ...a, disabled: undefined }])[0]) === canonical(forEngine([{ ...b, disabled: undefined }])[0]);
}

/** JSON com as chaves em ordem, para comparar passos que vieram de lugares diferentes (motor × formulário). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    return `{${entries
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export function validate(step: Step): string | null {
  const spec = opSpec(step.op);
  if (!spec) return "passo desconhecido";
  for (const f of spec.fields) {
    if (f.key === "columns" && !(step.columns && step.columns.length)) return "escolha ao menos uma coluna";
    if (f.key === "column" && !step.column) return "escolha a coluna";
    if (f.key === "value" && (!("when" in f) || !f.when || f.when(step))) {
      if (step.value === undefined || step.value === null || String(step.value).trim() === "") return "informe o valor";
    }
    if (f.key === "parts" && !(step.parts && step.parts.length)) return "escolha o que extrair";
  }
  return null;
}
