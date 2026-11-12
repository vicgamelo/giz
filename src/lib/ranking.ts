// Ordem do ranking ao vivo do AutoML.
import type { Candidate } from "./types";

/** Nota do candidato: a final, ou a média dos folds que já saíram. */
export function candidateScore(c: Candidate): number | undefined {
  if (c.score != null) return c.score;
  return c.folds.length ? c.folds.reduce((a, b) => a + b, 0) / c.folds.length : undefined;
}

// Pulado, parado ou com erro: a nota é de poucos folds e fica abaixo de quem terminou.
const PARTIAL = new Set<Candidate["status"]>(["skipped", "stopped", "failed"]);

export function isPartial(c: Candidate): boolean {
  return PARTIAL.has(c.status);
}

export function rankCandidates(cands: Candidate[], lower: boolean): Candidate[] {
  return [...cands].sort((a, b) => {
    const ga = isPartial(a) ? 1 : 0;
    const gb = isPartial(b) ? 1 : 0;
    if (ga !== gb) return ga - gb;
    const sa = candidateScore(a);
    const sb = candidateScore(b);
    if (sa == null && sb == null) return 0;
    if (sa == null) return 1;
    if (sb == null) return -1;
    return lower ? sa - sb : sb - sa;
  });
}

/** Quem lidera agora: melhor nota entre os que não são a referência nem parciais. */
export function leaderKey(ranked: Candidate[]): string | undefined {
  return ranked.find((c) => candidateScore(c) != null && c.key !== "baseline" && !isPartial(c))?.key;
}
