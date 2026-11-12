// Ações que o assistente pode sugerir. A lista é calculada pelo Giz a partir do estado da tela (alertas que têm
// correção e o próximo passo); o modelo só cita o código de uma ação da lista ou o nome de uma coluna para o alvo.
// Nada roda sem o clique da pessoa, e o clique confere de novo se a ação ainda vale.
import { sameStep, validate } from "../recipe";
import type { Alert, Step } from "../types";
import { buildContext, maskDerived, safe, SEVERITY_ORDER as ORDER, STEP_NAMES, stepLabel, type ContextOptions, type Snapshot, type StepKey } from "./context";

export type Action =
  | { kind: "fix"; code: string; label: string; step: Step }
  | { kind: "target"; code: string; label: string; column: string }
  | { kind: "goto"; code: string; label: string; step: StepKey };

const NEXT: Partial<Record<StepKey, StepKey>> = {
  import: "profile",
  profile: "recipe",
  recipe: "train",
  train: "evaluate",
  evaluate: "predict",
  predict: "export",
};
const MAX_FIXES = 8;
// Passos em que o Giz oferece correções e a escolha do alvo. Da avaliação em diante só há navegação: mexer na receita
// ali deixaria o modelo desatualizado sem a pessoa ver a tela da receita.
const FIX_STEPS = new Set<StepKey>(["import", "profile", "recipe", "train"]);

export function reached(s: Snapshot, step: StepKey): boolean {
  if (step === "import") return true;
  if (step === "profile" || step === "recipe" || step === "train") return !!s.profile;
  return !!s.result;
}

/** O Python está no meio de alguma coisa: mexer na receita ou no alvo agora bagunça o estado. */
function locked(s: Snapshot): string | null {
  if (s.training) return "Espere o treino terminar.";
  if (s.busy || s.previewing) return "Espere o Giz terminar o que está fazendo.";
  return null;
}

function columnsExist(s: Snapshot, step: Step): boolean {
  const names = new Set(s.profile?.columns.map((c) => c.name));
  return [...(step.columns ?? []), ...(step.column ? [step.column] : [])].every((c) => names.has(c));
}

function fixes(s: Snapshot): Step[] {
  const alerts: Alert[] = [...(s.targetInfo?.alerts ?? []), ...(s.profile?.alerts ?? [])];
  const out: Step[] = [];
  for (const a of [...alerts].sort((x, y) => ORDER[x.severity] - ORDER[y.severity])) {
    const fix = a.fix;
    if (!fix || validate(fix) || !columnsExist(s, fix)) continue;
    if (s.steps.some((st) => sameStep(st, fix)) || out.some((st) => sameStep(st, fix))) continue;
    out.push(fix);
  }
  return out.slice(0, MAX_FIXES);
}

/** As ações que valem agora, já com o código que o modelo vai citar. */
export function availableActions(s: Snapshot): Action[] {
  const out: Action[] = [];
  const code = () => `A${out.length + 1}`;
  if (!locked(s) && FIX_STEPS.has(s.current)) {
    for (const step of fixes(s)) out.push({ kind: "fix", code: code(), label: `Adicionar à receita: ${stepLabel(step)}`, step });
  }
  const next = NEXT[s.current];
  if (next && reached(s, next)) out.push({ kind: "goto", code: code(), label: `Ir para o passo ${STEP_NAMES[next].replace(" de 7,", ":")}`, step: next });
  return out;
}

/** O texto que entra no resumo: o modelo só conhece as ações por aqui. */
export function actionsText(actions: Action[], opts: Pick<ContextOptions, "compact" | "redact"> = {}): string {
  // No resumo compacto o código de cada correção já vai colado no alerta dela; aqui ficam só as outras ações.
  const listed = actions.filter((a) => !opts.compact || a.kind !== "fix");
  // No resumo que sai do navegador, o rótulo é refeito sem valores digitados (filtro, valor fixo).
  const label = (a: Action) => (a.kind === "fix" && opts.redact ? `Adicionar à receita: ${stepLabel(a.step, true)}` : a.label);
  const lines = listed.map((a) => `[${a.code}] ${label(a)}`);
  if (!lines.length) return opts.compact && actions.length ? "" : "AÇÕES: sem ações disponíveis agora.";
  return ["AÇÕES QUE VOCÊ PODE SUGERIR (a pessoa confirma com um clique):", ...lines].join("\n");
}

/**
 * Resumo do passo + ações, do jeito que o modelo recebe (e, no modo online, do jeito que sai do navegador). Nunca
 * passa de `maxChars`: as ações têm lugar garantido e o resumo é cortado para caber junto com elas.
 */
export function contextWithActions(s: Snapshot, actions: Action[], opts: ContextOptions = {}): string {
  const max = opts.maxChars ?? 4500;
  // As ações ficam com até metade do espaço; as que não couberem não são oferecidas ao modelo (nem viram botão).
  let listed = actions;
  let tail = maskDerived(actionsText(listed, opts), s);
  while (tail.length > max / 2 && listed.length) {
    listed = listed.slice(0, -1);
    tail = maskDerived(actionsText(listed, opts), s);
  }
  if (tail.length > max / 2) tail = "";
  const fixCode = (fix: Step) => listed.find((a) => a.kind === "fix" && sameStep(a.step, fix))?.code ?? null;
  const body = buildContext(s, { ...opts, fixCode, maxChars: max - (tail ? tail.length + 1 : 0) });
  return tail ? `${body}\n${tail}` : body;
}

/** Só as ações cujo código aparece no texto que o modelo recebeu: um código que ele não viu não vira botão. */
export function shownActions(actions: Action[], context: string): Action[] {
  return actions.filter((a) => context.includes(`[${a.code}]`));
}

const CODE = /\[\s*(A\d{1,2})\s*\]/g;
const TARGET = /\[\s*alvo\s*:\s*([^\[\]\n]{1,80})\]/gi;
const QUOTES = /^["'“”‘’`]+|["'“”‘’`]+$/g;

/** Acha a coluna pelo nome exato ou pelo nome como apareceu no resumo (saneado). Ambíguo não vale. */
function findColumn(s: Snapshot, raw: string): string | null {
  const wanted = raw.trim().replace(QUOTES, "").trim();
  const names = s.profile?.columns.map((c) => c.name) ?? [];
  if (names.includes(wanted)) return wanted;
  const matches = names.filter((n) => safe(n) === wanted);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Acha na resposta as ações citadas. Só entram códigos da lista oferecida e alvos que existem no perfil; um passo de
 * receita nunca é montado a partir do texto do modelo.
 */
export function parseActions(text: string, offered: Action[], s: Snapshot): { text: string; actions: Action[] } {
  const found: Action[] = [];
  const add = (a: Action) => {
    if (!found.some((f) => f.code === a.code)) found.push(a);
  };
  let clean = text.replace(CODE, (whole, code: string) => {
    const action = offered.find((a) => a.code === code);
    if (!action) return ""; // código que o modelo inventou: some do texto, não vira botão
    add(action);
    return `“${action.label}”`;
  });
  clean = clean.replace(TARGET, (whole, raw: string) => {
    const column = findColumn(s, raw);
    if (!column) return whole;
    // Coluna que existe mas não pode virar ação agora (já é o alvo, tela ocupada): fica só o nome, sem a sintaxe.
    if (column !== s.target && !locked(s) && FIX_STEPS.has(s.current)) {
      add({ kind: "target", code: `alvo:${column}`, label: `Prever a coluna ${safe(column)}`, column });
    }
    return `“${safe(column)}”`;
  });
  return { text: clean.replace(/[ \t]+([.,;:!?])/g, "$1").replace(/[ \t]{2,}/g, " "), actions: found };
}

/** A ação já está feita na tela? Deriva do estado: depois de um desfazer, o botão volta a valer. */
export function isDone(action: Action, s: Snapshot): boolean {
  if (action.kind === "fix") return s.steps.some((st) => sameStep(st, action.step));
  if (action.kind === "target") return s.target === action.column;
  return s.current === action.step;
}

/** Entre a sugestão e o clique o estado pode ter mudado (receita, arquivo, treino): confere de novo. */
export function stillValid(action: Action, s: Snapshot): string | null {
  if (action.kind === "goto") return reached(s, action.step) ? null : "Esse passo ainda não está liberado.";
  const wait = locked(s);
  if (wait) return wait;
  if (!s.profile) return "Não há arquivo carregado.";
  if (action.kind === "fix") {
    if (validate(action.step) || !columnsExist(s, action.step)) return "Esse passo não vale mais: a coluna mudou ou saiu dos dados.";
    return isDone(action, s) ? "Esse passo já está na receita." : null;
  }
  if (!s.profile.columns.some((c) => c.name === action.column)) return "Essa coluna não existe mais.";
  return isDone(action, s) ? "Essa coluna já é o alvo." : null;
}
