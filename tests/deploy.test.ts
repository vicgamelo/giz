/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error: módulo .mjs de script, sem tipos
import { headers } from "../scripts/headers.mjs";

// O servidor local (serve-dist) e o Caddy de produção precisam mandar os mesmos cabeçalhos: é o que torna o teste
// local sob CSP/COOP/COEP uma prova do que vai ao ar.
function caddyHeaders(): Record<string, string> {
  const text = readFileSync(new URL("../deploy/Caddyfile", import.meta.url), "utf8");
  const block = text.slice(text.indexOf("header {") + 8, text.indexOf("}", text.indexOf("header {")));
  const out: Record<string, string> = {};
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;
    const m = line.match(/^(\S+)\s+(.+)$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
}

describe("cabeçalhos de produção", () => {
  it("deploy/Caddyfile e scripts/headers.mjs batem", () => {
    expect(caddyHeaders()).toEqual(headers("https://vgmelo.tech"));
  });

  it("CSP sem eval nem inline, com o isolamento do botão Parar", () => {
    const h = headers();
    expect(h["Content-Security-Policy"]).toContain("script-src 'self' 'wasm-unsafe-eval';");
    expect(h["Content-Security-Policy"]).not.toMatch(/'unsafe-eval'|'unsafe-inline'/);
    expect(h["Cross-Origin-Embedder-Policy"]).toBe("require-corp");
  });
});
