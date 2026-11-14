// Pedaços do worker do assistente local que não dependem do WebLLM nem do navegador (e por isso têm teste).
import type { LlmErrorCode } from "./llm-protocol";

/** SHA-256 em hexadecimal (como está no lock) → o formato de integridade que o WebLLM confere. */
export function sri(hex: string): string {
  const bytes = hex.match(/../g)!.map((b) => parseInt(b, 16));
  return `sha256-${btoa(String.fromCharCode(...bytes))}`;
}

/**
 * Traduz um erro do WebLLM num código que a tela sabe explicar. `cancelled` só sai quando a pessoa pediu o
 * cancelamento: "abort" no texto também aparece em falta de memória do wasm (`Aborted(OOM)`), que é outra coisa.
 */
export function classify(e: unknown, cancelling = false): { code: LlmErrorCode; error: string } {
  const err = e as { name?: string; message?: string } | null;
  const name = err?.name ?? "";
  const text = String(err?.message ?? e);
  if (cancelling) return { code: "cancelled", error: text };
  if (name === "ContextWindowSizeExceededError" || /context window/i.test(text)) return { code: "context", error: text };
  if (name === "IntegrityError" || /integrity/i.test(text)) return { code: "integrity", error: text };
  if (name === "QuotaExceededError" || /quota ?exceeded/i.test(text)) return { code: "storage", error: text };
  if (name === "DeviceLostError" || /device (was |is )?lost|out of memory|\bOOM\b/i.test(text)) return { code: "device", error: text };
  if (/failed to fetch|networkerror|load failed|network error/i.test(text)) return { code: "network", error: text };
  return { code: "error", error: text };
}

/** Do que está no cache do WebLLM, o que é de outro modelo ou de outra revisão (e pode ser apagado). */
export function staleModelUrls(urls: string[], currentDir: string): string[] {
  return urls.filter((url) => {
    const path = new URL(url).pathname;
    return path.startsWith("/llm/") && !path.startsWith(currentDir);
  });
}
