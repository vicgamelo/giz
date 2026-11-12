// O que o assistente "vê": um resumo em texto do passo atual, montado só com agregados (contagens, tipos,
// estatísticas, alertas, métricas). Valores das linhas (prévia, amostras, categorias mais comuns, a linha explicada)
// ficam de fora, a não ser que a pessoa ligue "incluir exemplos".
import { fmtFixed, fmtInt, fmtMetric, fmtNum, KINDS, metricLabel, METRICS, PROBLEMS } from "../format";
import { opSpec } from "../recipe";
import type {
  Alert,
  Candidate,
  Column,
  PredictSummary,
  Problem,
  Profile,
  Source,
  Step,
  StepReport,
  TargetInfo,
  TrainResult,
} from "../types";
import type { StepKey } from "../state.svelte";

export type { StepKey };

/** Cópia simples do estado da tela (sem runes), para montar o contexto e para testar. */
export type Snapshot = {
  current: StepKey;
  source: Source | null;
  /** Nomes das colunas do arquivo, antes da receita. Serve para reconhecer as colunas que a receita criou. */
  rawColumns: string[] | null;
  profile: Profile | null;
  steps: Step[];
  reports: StepReport[];
  previewOk: boolean;
  target: string | null;
  problem: Problem | null;
  targetInfo: TargetInfo | null;
  budget: number;
  training: boolean;
  metric: string | null;
  candidates: Candidate[];
  result: TrainResult | null;
  stale: boolean;
  batch: PredictSummary | null;
  mlReady: boolean;
  /** O Python está ocupado (lendo arquivo, analisando o alvo…) ou a prévia da receita ainda não voltou. */
  busy: boolean;
  previewing: boolean;
};

export type ContextOptions = {
  /** Teto de caracteres do resumo (a janela do modelo local é pequena). */
  maxChars?: number;
  /** A pessoa pediu para incluir exemplos de valores (as primeiras linhas da prévia). Só no motor local. */
  examples?: boolean;
  /**
   * Modo online: o resumo sai do navegador, então fica mais magro. Saem o nome do arquivo e das abas, mínimo e
   * máximo (são valores de células), o valor digitado em filtros e o texto de erros (podem citar uma célula).
   */
  redact?: boolean;
  /**
   * Motor local: o modelo é pequeno e se perde em resumo comprido. As estatísticas ficam só para as colunas que têm
   * alerta; as outras entram pelo nome.
   */
  compact?: boolean;
  /** Código da ação que aplica a correção de um alerta (ex.: "A2"), para o modelo citar junto do alerta. */
  fixCode?: (fix: Step) => string | null;
};

export const STEP_NAMES: Record<StepKey, string> = {
  import: "1 de 7, Importar",
  profile: "2 de 7, Perfil dos dados",
  recipe: "3 de 7, Receita de tratamento",
  train: "4 de 7, AutoML (treino)",
  evaluate: "5 de 7, Avaliação",
  predict: "6 de 7, Prever em lote",
  export: "7 de 7, Exportar e MLflow",
};

/** Por que cada tipo de alerta importa, em uma linha. O modelo pequeno explica melhor parafraseando do que deduzindo. */
export const ALERT_WHY: Record<string, string> = {
  duplicates: "linhas repetidas: contam em dobro no treino e inflam a nota do modelo; o normal é remover",
  constant: "coluna com um valor só: não ajuda a prever nada; pode apagar",
  id_like: "identificador: é único por linha, o modelo decoraria em vez de aprender; o normal é apagar a coluna",
  missing_high: "muitos nulos: com tanta falta a coluna atrapalha mais do que ajuda; o normal é apagar",
  missing: "nulos: são células vazias; preencher com a mediana (números) ou o valor mais comum (categorias) evita perder linhas",
  date_as_text: "data em texto: o modelo não entende texto como data; converter cria colunas de ano, mês e dia da semana",
  number_as_text: "número em texto (como R$ 1.234,56): não é lido como número; converter resolve",
  high_cardinality: "categorias demais: one-hot criaria centenas de colunas; codificar por frequência resolve",
  free_text: "texto livre: o AutoML ignora esse tipo de coluna",
  outliers: "valores fora de 1,5×IQR (outliers): muito distantes do resto, podem distorcer o modelo; limitar é o mais seguro",
  leakage: "vazamento do alvo: a coluna entrega a resposta e só existe depois do resultado; o modelo pareceria perfeito e falharia na prática; apague a coluna",
  imbalance: "classes desbalanceadas: uma classe é rara, então acurácia engana; olhe AUC, precisão e recall",
  target_missing: "linhas sem alvo: não dá para aprender com elas, ficam fora do treino",
};

/** Como cada passo funciona no Giz, para o modelo explicar a tela em vez de adivinhar. */
export const STEP_HELP: Record<StepKey, string> = {
  import:
    "a pessoa arrasta um CSV (separador, vírgula decimal e codificação são detectados) ou um Excel (escolhe a aba), ou usa um " +
    "exemplo. O arquivo fica só no navegador. Depois de carregar, o Giz mostra o perfil dos dados.",
  profile:
    "mostra tipos, nulos, linhas repetidas, distribuições, correlações e alertas. Cada alerta tem um botão Corrigir que vira " +
    "um passo da receita de tratamento.",
  recipe:
    "a receita é a lista de passos de tratamento (preencher nulos, codificar categorias, converter datas e números, tratar " +
    "outliers, apagar colunas, remover repetidas). Os passos aprendem no treino e se repetem iguais em dados novos. Dá para " +
    "desligar, reordenar, desfazer e ver a prévia.",
  train:
    "a pessoa escolhe a coluna alvo (o que prever). 20% das linhas ficam guardadas para a avaliação final; no resto, cada " +
    "modelo passa por validação cruzada (treina em uma parte e é testado na outra, várias vezes) dentro do tempo escolhido. " +
    "O ranking ordena os modelos pela métrica. O botão Parar interrompe e fica com o que já terminou.",
  evaluate:
    "mostra as métricas do melhor modelo nas linhas guardadas, a matriz de confusão com corte ajustável (classificação) ou " +
    "previsto × real (regressão), a importância de cada coluna e a explicação de uma previsão.",
  predict:
    "a pessoa envia uma planilha nova com as mesmas colunas (o alvo não precisa estar). A receita e o modelo final rodam " +
    "nela, todas as linhas ficam, e sai um CSV com as colunas originais mais as previsões.",
  export:
    "gera um script Python ou um notebook que refaz a receita com os valores aprendidos e treina o mesmo modelo no computador " +
    "da pessoa, com o arquivo original; e a receita em JSON. Opcional: registrar o experimento no MLflow pelo vgmelo.tech " +
    "(vai só o resumo; o modelo só se a pessoa marcar).",
};

const SEVERITY = { danger: "grave", warn: "atenção", info: "dica" } as const;
export const SEVERITY_ORDER = { danger: 0, warn: 1, info: 2 } as const;
const ORDER = SEVERITY_ORDER;
const STATUS: Record<string, string> = {
  pending: "na fila",
  running: "validando",
  done: "pronto",
  skipped: "pulado",
  failed: "falhou",
  stopped: "parado",
};

// Controle, separadores de linha, marcas de direção, espaços de largura zero e "tags" invisíveis do Unicode.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff9-\ufffb]|[\u{e0000}-\u{e007f}]/gu;

function sanitize(value: unknown): string {
  return String(value ?? "")
    .replace(INVISIBLE, " ")
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Nomes de colunas, classes e arquivos vêm do arquivo da pessoa. Antes de entrar no resumo perdem quebras de linha,
 * colchetes (a sintaxe das ações) e caracteres invisíveis ou de direção de texto, e ficam com até 40 caracteres.
 */
export function safe(value: unknown, max = 40): string {
  const chars = Array.from(sanitize(value)); // por caractere, para não partir um emoji no corte
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : chars.join("");
}

// Colunas que "Converter datas" cria (python/giz/recipe.py, DATE_PARTS): o sufixo é fixo, não vem dos dados.
const DATE_SUFFIXES = new Set(["ano", "mes", "dia", "dia_semana", "hora"]);

type Derivable = Pick<Snapshot, "steps" | "reports" | "rawColumns" | "profile" | "targetInfo" | "result">;

/** Todo nome de coluna que pode aparecer no resumo: do perfil, dos alertas, da receita, do alvo e do treino. */
function knownColumns(s: Derivable): Set<string> {
  const out = new Set<string>();
  const add = (list: (string | null | undefined)[] | undefined) => list?.forEach((n) => n && out.add(n));
  const alerts = [...(s.profile?.alerts ?? []), ...(s.targetInfo?.alerts ?? [])];
  add(s.profile?.columns.map((c) => c.name));
  add(alerts.flatMap((a) => [a.column, ...(a.fix?.columns ?? []), a.fix?.column]));
  add(s.steps.flatMap((st) => [...(st.columns ?? []), st.column]));
  add(s.reports.flatMap((r) => [...(r.added ?? []), ...(r.removed ?? [])]));
  add(s.targetInfo?.features);
  add(s.targetInfo?.strength.map((x) => x.column));
  add(s.targetInfo?.ignored.map((x) => x.column));
  const r = s.result;
  add(r?.evaluation.importance.map((x) => x.column));
  add(r ? [...r.features.numeric, ...r.features.categorical, ...r.features.ignored.map((x) => x.column)] : []);
  return out;
}

/**
 * Colunas criadas pelo one-hot se chamam `coluna_categoria`: o nome carrega um valor de célula. No resumo elas
 * aparecem juntas, como `coluna_*`.
 *
 * Duas fontes, porque a tela nem sempre está alinhada (o treino guarda as colunas da receita de quando rodou, e a
 * prévia chega depois da mudança): os relatórios da receita atual, e o nome em si — um nome que não existe no
 * arquivo e começa com `coluna_do_arquivo_` foi criado pela receita.
 */
export function derivedColumns(s: Derivable): Map<string, string> {
  const out = new Map<string, string>();
  const longest = (name: string, sources: string[]) =>
    sources.filter((c) => name.startsWith(`${c}_`)).sort((a, b) => b.length - a.length)[0];
  for (const r of s.reports) {
    if (r.op !== "encode") continue;
    const sources = [...(r.removed ?? []), ...(s.steps[r.index]?.columns ?? [])];
    for (const name of r.added ?? []) {
      const source = longest(name, sources);
      if (source) out.set(name, source);
    }
  }
  if (s.rawColumns) {
    const raw = new Set(s.rawColumns);
    for (const name of knownColumns(s)) {
      if (raw.has(name) || out.has(name)) continue;
      const source = longest(name, s.rawColumns);
      if (source && !DATE_SUFFIXES.has(name.slice(source.length + 1))) out.set(name, source);
    }
  }
  return out;
}

/**
 * Troca no texto qualquer nome de coluna one-hot (alertas, importância, ações, mensagens antigas da conversa).
 * Procura o nome como veio e como `safe` o deixaria, com e sem o corte de tamanho.
 */
export function maskDerived(text: string, s: Derivable): string {
  const derived = [...derivedColumns(s)].sort(([a], [b]) => b.length - a.length);
  for (const [name, source] of derived) {
    const masked = `${safe(source)}_*`;
    for (const form of new Set([name, sanitize(name), safe(name)])) {
      // Nome tão comprido que o corte de `safe` já tirou a categoria: não há o que trocar (e trocar repetiria o `_*`).
      if (!masked.startsWith(form)) text = text.replaceAll(form, masked);
    }
  }
  return text;
}

/** Lista "coluna valor" (força, importância) com as one-hot juntas: fica a primeira de cada grupo, que é a maior. */
function ranked(items: { column: string; value: string }[], s: Snapshot, max: number): string {
  const derived = derivedColumns(s);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const name = derived.has(it.column) ? `${safe(derived.get(it.column))}_*` : safe(it.column);
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(`${name} ${it.value}`);
    if (out.length === max) break;
  }
  return out.join("; ");
}

function unique<T>(list: T[]): T[] {
  return [...new Set(list)];
}

export function stepLabel(step: Step, redact = false): string {
  const spec = opSpec(step.op);
  const bits: string[] = [];
  const cols = step.columns ?? (step.column ? [step.column] : []);
  const names = cols.map((c) => safe(c));
  if (names.length) bits.push(names.length > 4 ? `${names.slice(0, 4).join(", ")} e mais ${names.length - 4}` : names.join(", "));
  for (const key of ["strategy", "method", "action", "operator"] as const) {
    const v = step[key];
    if (!v) continue;
    const field = spec?.fields.find((f) => f.key === key);
    const label = field && "options" in field ? field.options.find(([k]) => k === v)?.[1] : undefined;
    bits.push(label ?? safe(v));
  }
  const needsValue = step.op === "filter_rows" ? !["isnull", "notnull"].includes(step.operator ?? "") : step.strategy === "constant";
  if (needsValue && step.value != null) bits.push(redact ? "valor omitido" : safe(step.value));
  return `${spec?.label ?? step.op}${bits.length ? ` (${bits.join("; ")})` : ""}`;
}

function columnLine(c: Column, redact: boolean): string {
  const bits = [KINDS[c.kind] ?? c.kind];
  if (c.missing) bits.push(`${fmtNum(c.missing_pct, 1)}% nulos`);
  bits.push(`${fmtInt(c.unique)} únicos`);
  const st = c.stats;
  if (c.kind === "numeric" && st) {
    const n = (k: string) => fmtNum(st[k] as number | null);
    bits.push(`média ${n("mean")}, mediana ${n("median")}${redact ? "" : `, mín ${n("min")}, máx ${n("max")}`}`);
  }
  return `- ${safe(c.name)}: ${bits.join("; ")}`;
}

function alertLine(a: Alert, s: Snapshot, opts: ContextOptions): string {
  const code = a.fix ? opts.fixCode?.(a.fix) : null;
  // A máscara entra antes do corte de tamanho: um nome one-hot comprido não pode sobrar pela metade.
  return `- (${SEVERITY[a.severity]}) ${safe(maskDerived(a.message, s), 200)}${code ? ` Correção: [${code}]` : ""}`;
}

function sortedAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

/** Lista com teto: mostra as primeiras e diz quantas ficaram de fora (o modelo não deve achar que acabou). */
function capped(lines: string[], max: number, what: string): string[] {
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max), `- … e mais ${lines.length - max} ${what}`];
}

function dataHead(s: Snapshot, redact: boolean): string[] {
  const p = s.profile;
  if (!p) return ["DADOS: ainda não há arquivo carregado."];
  const out: string[] = [];
  const src = s.source;
  if (src) {
    const kind = src.format === "excel" ? "Excel" : "CSV";
    const sheets = src.sheets && src.sheets.length > 1 ? ` (${src.sheets.length} abas no arquivo)` : "";
    if (redact) out.push(`ARQUIVO: ${kind}${sheets}`);
    else out.push(`ARQUIVO: ${safe(src.filename, 80)} (${kind}${src.sheet ? `, aba "${safe(src.sheet)}"` : ""})${sheets}`);
  }
  const after = s.steps.length ? " depois da receita" : "";
  out.push(
    `DADOS${after}: ${fmtInt(p.rows)} linhas, ${fmtInt(p.cols)} colunas, ${fmtInt(p.duplicates)} linhas repetidas, ` +
      `${fmtInt(p.missing_cells)} células vazias.`,
  );
  return out;
}

function columnsSection(s: Snapshot, detail: boolean, opts: ContextOptions): string[] {
  const redact = !!opts.redact;
  const p = s.profile;
  if (!p) return [];
  const out: string[] = [];
  const derived = derivedColumns(s);
  if (!detail) {
    const names = unique(p.columns.map((c) => (derived.has(c.name) ? `${safe(derived.get(c.name))}_*` : safe(c.name))));
    out.push(`COLUNAS: ${names.slice(0, 40).join(", ")}${names.length > 40 ? `… e mais ${names.length - 40}` : ""}`);
    return out;
  }
  // Colunas com alerta primeiro: são as que a pessoa mais pergunta, e o corte por tamanho tira as do fim.
  const flagged = new Set(p.alerts.map((a) => a.column).filter(Boolean));
  const cols = [...p.columns].filter((c) => !derived.has(c.name)).sort((a, b) => Number(flagged.has(b.name)) - Number(flagged.has(a.name)));
  const plain = opts.compact ? cols.filter((c) => !flagged.has(c.name)).map((c) => safe(c.name)) : [];
  const lines = cols.filter((c) => !opts.compact || flagged.has(c.name)).map((c) => columnLine(c, redact));
  for (const source of unique([...derived.values()])) {
    const n = [...derived.values()].filter((x) => x === source).length;
    lines.push(`- ${safe(source)}_*: ${n} colunas 0/1 criadas pela codificação one-hot (uma por categoria)`);
  }
  if (lines.length) out.push(`COLUNAS${opts.compact ? " COM ALERTA" : ""} (nome: tipo; nulos; valores únicos; estatísticas):`, ...capped(lines, 30, "colunas"));
  if (plain.length) out.push(`OUTRAS COLUNAS: ${plain.slice(0, 40).join(", ")}${plain.length > 40 ? `… e mais ${plain.length - 40}` : ""}`);
  return out;
}

function alertsSection(title: string, alerts: Alert[], s: Snapshot, opts: ContextOptions): string[] {
  if (!alerts.length) return [`${title}: nada a apontar.`];
  return [`${title}:`, ...capped(sortedAlerts(alerts).map((a) => alertLine(a, s, opts)), 14, "alertas")];
}

/** Uma linha de explicação para cada tipo de alerta que apareceu. */
function whySection(alerts: Alert[]): string[] {
  const codes = unique(sortedAlerts(alerts).map((a) => a.code)).filter((c) => ALERT_WHY[c]);
  return codes.length ? ["O QUE CADA TIPO DE ALERTA QUER DIZER:", ...codes.map((c) => `- ${ALERT_WHY[c]}`)] : [];
}

/**
 * Palpite de alvo para quem ainda não escolheu: a última coluna e as de sim/não ou poucas categorias. O modelo
 * escolhe pelo sentido do nome; a pessoa decide.
 */
function targetHints(s: Snapshot): string[] {
  const p = s.profile;
  if (!p || s.target) return [];
  const derived = derivedColumns(s);
  const flagged = new Set(p.alerts.filter((a) => a.code === "id_like" || a.code === "constant").map((a) => a.column));
  const cols = p.columns.filter((c) => !derived.has(c.name) && !flagged.has(c.name));
  // De trás para a frente: o alvo costuma estar no fim da planilha. Sim/não primeiro, depois a última, depois as
  // de poucas categorias.
  const back = [...cols].reverse();
  const picks = unique([...back.filter((c) => c.kind === "boolean"), ...back.slice(0, 1), ...back.filter((c) => c.kind === "categorical" && c.unique <= 10)]);
  if (!picks.length) return [];
  const names = picks.slice(0, 5).map((c) => safe(c.name)).join(", ");
  return [`POSSÍVEIS ALVOS (palpite do Giz, do mais provável ao menos; a pessoa decide pelo sentido do nome): ${names}`];
}

function recipeSection(s: Snapshot, redact: boolean): string[] {
  if (!s.steps.length) return ["RECEITA: vazia (sem passos de tratamento)."];
  const lines = s.steps.map((step, i) => {
    const r = s.reports.find((x) => x.index === i);
    const notes: string[] = [];
    if (step.disabled) notes.push("desligado");
    if (r?.error) notes.push(redact ? "ERRO (texto omitido)" : `ERRO: ${safe(r.error, 200)}`);
    if (r && r.rows_before != null && r.rows_after != null && r.rows_before !== r.rows_after) {
      notes.push(`linhas ${fmtInt(r.rows_before)} → ${fmtInt(r.rows_after)}`);
    }
    if (r?.added?.length) notes.push(`criou ${r.added.length} coluna(s)`);
    if (r?.removed?.length) notes.push(`removeu ${r.removed.length} coluna(s)`);
    return `${i + 1}. ${stepLabel(step, redact)}${notes.length ? ` [${notes.join("; ")}]` : ""}`;
  });
  return [`RECEITA (${s.steps.length} passo(s))${s.previewOk ? "" : " COM ERRO"}:`, ...capped(lines, 20, "passos")];
}

function targetSection(s: Snapshot, opts: ContextOptions): string[] {
  const redact = !!opts.redact;
  if (!s.target) return ["ALVO: ainda não escolhido."];
  const info = s.targetInfo;
  if (!info || info.target !== s.target) return [`ALVO: ${safe(s.target)} (análise do alvo ainda não terminou).`];
  const out = [`ALVO: ${safe(info.target)}. Problema: ${PROBLEMS[info.problem]}. ${fmtInt(info.rows)} linhas com alvo.`];
  if (info.class_counts) out.push(`CLASSES (nome: linhas): ${info.class_counts.map(([c, n]) => `${safe(c)}: ${fmtInt(n)}`).join("; ")}`);
  if (info.target_stats) {
    const t = info.target_stats;
    out.push(`ALVO numérico: média ${fmtNum(t.mean)}, desvio ${fmtNum(t.std)}${redact ? "" : `, mín ${fmtNum(t.min)}, máx ${fmtNum(t.max)}`}`);
  }
  if (info.ignored.length) {
    out.push(`COLUNAS IGNORADAS PELO AUTOML: ${capped(info.ignored.map((i) => `${safe(i.column)} (${safe(i.reason, 80)})`), 10, "colunas").join("; ")}`);
  }
  if (info.strength.length) {
    const top = ranked(info.strength.map((x) => ({ column: x.column, value: fmtFixed(x.score, 2) })), s, 8);
    out.push(`FORÇA DE CADA COLUNA SOZINHA (${info.strength_metric}): ${top}`);
  }
  out.push(...alertsSection("ALERTAS DO ALVO", info.alerts, s, opts), ...whySection(info.alerts));
  return out;
}

function candidateLine(c: Candidate, metric: string, redact: boolean): string {
  const bits = [STATUS[c.status] ?? c.status];
  if (c.score != null) bits.push(`${metricLabel(metric)} ${fmtMetric(metric, c.score)}${c.std != null ? ` ± ${fmtFixed(c.std, 3)}` : ""}`);
  if (c.seconds != null) bits.push(`${fmtNum(c.seconds, 1)} s`);
  if (c.reason) bits.push(redact && c.status === "failed" ? "motivo omitido" : safe(c.reason, 200));
  return `- ${c.label}: ${bits.join("; ")}`;
}

function trainSection(s: Snapshot, redact: boolean): string[] {
  const out: string[] = [];
  if (s.training) out.push("TREINO: em andamento agora.");
  else if (!s.result) out.push(`TREINO: ainda não rodou. Orçamento de tempo: ${s.budget} s. Modelos ${s.mlReady ? "prontos" : "ainda carregando"}.`);
  const r = s.result;
  const metric = r?.metric ?? s.metric;
  const list = r?.ranking ?? s.candidates;
  if (metric && list.length) {
    out.push(`RANKING NA VALIDAÇÃO CRUZADA (métrica: ${metricLabel(metric)}):`, ...list.map((c) => candidateLine(c, metric, redact)));
  }
  if (r) {
    out.push(
      `TREINO TERMINADO${r.stopped ? " (parado antes do fim)" : ""}: melhor modelo ${r.best.label}; ` +
        `${fmtInt(r.cv_rows)} linhas na validação cruzada (${r.folds} partes), ${fmtInt(r.holdout_rows)} guardadas para a avaliação; ` +
        `${fmtNum(r.seconds, 1)} s.`,
    );
    if (r.baseline?.score != null) {
      out.push(`REFERÊNCIA INGÊNUA (chutar sempre o mais comum/a média): ${metricLabel(r.metric)} ${fmtMetric(r.metric, r.baseline.score)}`);
    }
    if (s.stale) out.push("ATENÇÃO: a receita mudou depois do treino; o modelo está desatualizado até treinar de novo.");
  }
  return out;
}

function evaluationSection(s: Snapshot): string[] {
  const r = s.result;
  if (!r) return [];
  const ev = r.evaluation;
  const out = [
    `AVALIAÇÃO NAS ${fmtInt(r.holdout_rows)} LINHAS GUARDADAS (o modelo nunca viu): ` +
      Object.entries(ev.metrics)
        .map(([k, v]) => `${metricLabel(k)} ${fmtMetric(k, v)}`)
        .join("; "),
  ];
  if (ev.confusion && r.classes) {
    const cls = r.classes.map((c) => safe(c));
    const rows = ev.confusion.map((row, i) => `real ${cls[i]} → ${row.map((n, j) => `previsto ${cls[j]}: ${fmtInt(n)}`).join(", ")}`);
    out.push("MATRIZ DE CONFUSÃO:", ...capped(rows.map((x) => `- ${x}`), 6, "classes"));
  }
  const explain = Object.keys(ev.metrics).filter((k) => METRICS[k]);
  if (explain.length) out.push("O QUE CADA MÉTRICA MEDE:", ...explain.map((k) => `- ${METRICS[k].label}: ${METRICS[k].help}`));
  if (ev.importance.length) {
    const top = ranked(ev.importance.map((x) => ({ column: x.column, value: fmtFixed(x.importance, 3) })), s, 10);
    out.push(`IMPORTÂNCIA POR PERMUTAÇÃO (quanto a métrica piora ao embaralhar a coluna): ${top}`);
  }
  return out;
}

const AUC_BANDS = "faixas de AUC: abaixo de 0,6 fraco; de 0,6 a 0,7 razoável; de 0,7 a 0,8 bom; de 0,8 a 0,9 muito bom; acima de 0,9 excelente";
const R2_BANDS = "faixas de R²: abaixo de 0,3 fraco; de 0,3 a 0,6 razoável; de 0,6 a 0,8 bom; acima de 0,8 muito bom";

function band(value: number, cuts: [number, string][], top: string): string {
  return cuts.find(([limit]) => value < limit)?.[1] ?? top;
}

/**
 * As contas que respondem "o modelo está bom?", já feitas: comparação com a referência ingênua, validação cruzada ×
 * avaliação final, e precisão/recall em número de casos. O modelo de linguagem pequeno erra essas contas; aqui ele
 * só precisa explicar.
 */
function readingSection(s: Snapshot): string[] {
  const r = s.result;
  if (!r) return [];
  const m = r.evaluation.metrics;
  const main = m[r.metric];
  const out: string[] = [];
  const label = metricLabel(r.metric);
  const lower = !!METRICS[r.metric]?.lower;
  const base = r.baseline?.score;
  if (main != null && base != null) {
    const versus = `${label} ${fmtMetric(r.metric, main)} na avaliação final contra ${fmtMetric(r.metric, base)} da referência ingênua`;
    if (lower) {
      const cut = base > 0 ? Math.round((1 - main / base) * 100) : 0;
      out.push(`- ${versus}: ${cut > 0 ? `o erro é ${cut}% menor que o de chutar sempre a média` : "o modelo não erra menos que chutar sempre a média"}.`);
    } else if (r.metric === "roc_auc") {
      const verdict = band(main, [[0.6, "fraco"], [0.7, "razoável"], [0.8, "bom"], [0.9, "muito bom"]], "excelente");
      out.push(`- ${versus}: ${verdict} (${AUC_BANDS}).`);
    } else {
      out.push(`- ${versus}: ${main > base ? "melhor que a referência" : "não é melhor que a referência"}.`);
    }
  }
  if (m.r2 != null) {
    const verdict = band(m.r2, [[0.3, "fraco"], [0.6, "razoável"], [0.8, "bom"]], "muito bom");
    out.push(`- R² ${fmtMetric("r2", m.r2)}: o modelo explica ${Math.round(Math.max(0, m.r2) * 100)}% da variação do alvo, ${verdict} (${R2_BANDS}).`);
  }
  if (main != null && r.best.score != null) {
    const gap = Math.abs(main - r.best.score);
    const tolerance = Math.max(2 * (r.best.std ?? 0), 0.03 * Math.abs(r.best.score));
    const stable = gap <= tolerance;
    const worse = lower ? main > r.best.score : main < r.best.score;
    out.push(
      `- Na validação cruzada deu ${fmtMetric(r.metric, r.best.score)} e na avaliação final ${fmtMetric(r.metric, main)}: ` +
        (stable ? "resultado estável." : worse ? "piorou nos dados guardados, sinal de que o modelo decorou parte do treino." : "foi melhor nos dados guardados (pode ser sorte da amostra)."),
    );
  }
  const cm = r.evaluation.confusion;
  if (r.problem === "binary" && cm?.length === 2 && r.classes) {
    const pos = safe(r.classes[1]);
    const [fn, tp] = cm[1];
    const fp = cm[0][1];
    out.push(
      `- De ${fmtInt(fn + tp)} casos reais de "${pos}", o modelo achou ${fmtInt(tp)} (recall ${fmtMetric("recall", m.recall)}); ` +
        `de ${fmtInt(tp + fp)} que ele marcou como "${pos}", ${fmtInt(tp)} eram (precisão ${fmtMetric("precision", m.precision)}). Isso com o corte padrão de 0,5.`,
    );
  }
  if (main != null && r.metric === "roc_auc" && main >= 0.98) out.push("- AUC perto de 1 é bom demais: confira se alguma coluna entrega a resposta (vazamento do alvo).");
  return out.length ? ["LEITURA DO GIZ (contas já feitas; use para dizer se o modelo está bom):", ...out] : [];
}

function batchSection(s: Snapshot, redact: boolean): string[] {
  const b = s.batch;
  if (!b) return ["LOTE: ainda sem planilha nova prevista."];
  const out = [`LOTE: ${fmtInt(b.rows)} linhas previstas; ${fmtInt(b.rows_with_missing)} com algum valor faltando.`];
  if (Array.isArray(b.distribution)) out.push(`PREVISÕES (classe: linhas): ${b.distribution.map(([c, n]) => `${safe(c)}: ${fmtInt(n)}`).join("; ")}`);
  else out.push(`PREVISÕES: média ${fmtNum(b.distribution.mean)}${redact ? "" : `, mín ${fmtNum(b.distribution.min)}, máx ${fmtNum(b.distribution.max)}`}`);
  if (b.check) out.push(`A PLANILHA TINHA O ALVO; conferência: ${Object.entries(b.check).map(([k, v]) => `${metricLabel(k)} ${fmtMetric(k, v)}`).join("; ")}`);
  return out;
}

function examplesSection(p: Profile): string[] {
  const rows = p.head.rows.slice(0, 5).map((r) => `- ${r.map((v) => (v == null ? "" : safe(v))).join(" | ")}`);
  return ["EXEMPLOS (primeiras linhas, incluídas a pedido da pessoa):", `- ${p.head.columns.map((c) => safe(c)).join(" | ")}`, ...rows];
}

/** Seções em ordem de prioridade para o passo: se passar do teto, as últimas caem primeiro. */
function sections(s: Snapshot, opts: ContextOptions): string[][] {
  const redact = !!opts.redact;
  const head = [`PASSO ATUAL: ${STEP_NAMES[s.current]}`, `COMO ESTE PASSO FUNCIONA NO GIZ: ${STEP_HELP[s.current]}`, ...dataHead(s, redact)];
  const p = s.profile;
  if (!p) return [head];
  const columns = (detail: boolean) => columnsSection(s, detail, opts);
  const recipe = recipeSection(s, redact);
  const target = targetSection(s, opts);
  const train = trainSection(s, redact);
  const evaluation = evaluationSection(s);
  const alerts = alertsSection("ALERTAS DO PERFIL", p.alerts, s, opts);
  const why = whySection(p.alerts);
  const hints = targetHints(s);
  // Exemplos são linhas do arquivo: só a pedido, e nunca no resumo que sai do navegador.
  const examples = opts.examples && !redact ? [examplesSection(p)] : [];
  switch (s.current) {
    case "import":
    case "profile":
      return [head, alerts, why, recipe, target.slice(0, 1), hints, ...examples, columns(true)];
    case "recipe":
      return [head, recipe, alerts, why, target.slice(0, 1), hints, ...examples, columns(true)];
    case "train":
      return [head, target, hints, train, recipe, ...examples, columns(false)];
    case "evaluate":
      return [head, readingSection(s), evaluation, train, target.slice(0, 2), recipe, columns(false)];
    case "predict":
      return [head, batchSection(s, redact), readingSection(s), evaluation.slice(0, 1), target.slice(0, 2), columns(false)];
    case "export":
      return [head, train.slice(-3), readingSection(s), evaluation.slice(0, 1), recipe, target.slice(0, 1), columns(false)];
  }
}

const CUT_NOTICE = (n: number) => `(resumo cortado para caber: ${n} linha(s) ficaram de fora)`;

function fit(parts: string[][], max: number): { lines: string[]; dropped: number } {
  const lines: string[] = [];
  let used = 0;
  let dropped = 0;
  for (const part of parts) {
    const kept: string[] = [];
    for (const line of part) {
      if (used + line.length + 1 > max) break;
      kept.push(line);
      used += line.length + 1;
    }
    // Um título de lista sem nenhum item não ajuda: sai junto.
    if (kept.length === 1 && part.length > 1 && kept[0].endsWith(":")) used -= kept.pop()!.length + 1;
    dropped += part.length - kept.length;
    lines.push(...kept);
  }
  return { lines, dropped };
}

/** O resumo do passo, com no máximo `maxChars` caracteres (o aviso de corte entra na conta). */
export function buildContext(s: Snapshot, opts: ContextOptions = {}): string {
  const max = opts.maxChars ?? 4500;
  const parts = sections(s, opts).filter((x) => x.length);
  let { lines, dropped } = fit(parts, max);
  if (dropped) {
    ({ lines, dropped } = fit(parts, max - CUT_NOTICE(9999).length - 1));
    lines.push(CUT_NOTICE(dropped));
  }
  // A máscara só encurta o texto (`coluna_*` é menor que `coluna_categoria`); o corte final é só garantia.
  return clip(maskDerived(lines.join("\n"), s), max);
}

/** Corta por caractere (não por unidade UTF-16) e troca metades soltas de emoji, que quebram o JSON no servidor. */
export function clip(text: string, max: number): string {
  const whole = text.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd");
  if (whole.length <= max) return whole;
  const chars = Array.from(whole);
  let out = "";
  for (const ch of chars) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}
