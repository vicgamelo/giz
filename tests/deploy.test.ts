/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error: módulo .mjs de script, sem tipos
import { cacheControl, headers, STATIC_PREFIXES } from "../scripts/headers.mjs";

// O servidor local (serve-dist) e o Caddy de produção precisam mandar os mesmos cabeçalhos: é o que torna o teste
// local sob CSP/COOP/COEP uma prova do que vai ao ar.
const caddyfile = readFileSync(new URL("../deploy/Caddyfile", import.meta.url), "utf8");

function caddyHeaders(): Record<string, string> {
  const block = caddyfile.slice(caddyfile.indexOf("header {") + 8, caddyfile.indexOf("}", caddyfile.indexOf("header {")));
  const out: Record<string, string> = {};
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;
    const m = line.match(/^(\S+)\s+(.+)$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
}

/** `@nome path /a/* /b/*` e `@nome not path …` do Caddyfile, como função de caminho. */
function caddyMatchers(): Record<string, (path: string) => boolean> {
  const out: Record<string, (path: string) => boolean> = {};
  for (const m of caddyfile.matchAll(/^\t@(\w+) (not )?path (.+)$/gm)) {
    const prefixes = m[3].split(/\s+/).map((p) => p.replace(/\*$/, ""));
    const hit = (path: string) => prefixes.some((p) => path.startsWith(p));
    out[m[1]] = m[2] ? (path) => !hit(path) : hit;
  }
  return out;
}

function caddyCacheControl(path: string): string[] {
  const matchers = caddyMatchers();
  return [...caddyfile.matchAll(/^\theader @(\w+) Cache-Control "([^"]+)"$/gm)].filter((m) => matchers[m[1]](path)).map((m) => m[2]);
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

  it("o assistente local não abre a CSP: pesos e worker saem do próprio domínio, e só o portal é destino externo", () => {
    const csp = headers("https://vgmelo.tech")["Content-Security-Policy"];
    expect(csp).toContain("connect-src 'self' https://vgmelo.tech;");
    expect(csp).toContain("worker-src 'self';");
    expect(csp).not.toMatch(/huggingface|githubusercontent|\*/);
    expect(csp.match(/https?:\/\/[^\s;]+/g)).toEqual(["https://vgmelo.tech"]);
  });

  it.each([
    ["/", "no-cache"],
    ["/index.html", "no-cache"],
    ["/samples/credito.csv", "no-cache"],
    ["/assets/index-abc.js", "public, max-age=31536000, immutable"],
    ["/pyodide/v314.0.7/pyodide.asm.wasm", "public, max-age=31536000, immutable"],
    ["/llm/Qwen/abc-def/resolve/main/params_shard_0.bin", "no-store"],
    ["/llm/Qwen/abc-def/model.wasm", "no-store"],
  ])("cache de %s é igual no Caddy e no servidor local: %s", (path, expected) => {
    expect(cacheControl(path)).toBe(expected);
    expect(caddyCacheControl(path)).toEqual([expected]);
  });

  it("arquivo que falta em /pyodide, /assets ou /llm responde 404, nunca o index.html", () => {
    // O WebLLM grava no cache o que receber: um index.html com 200 no lugar de um pedaço do modelo ficaria lá.
    const page = caddyfile.match(/@pagina \{\n\t\tnot path (.+)\n\t\tfile \{\n\t\t\ttry_files \{path\} \/index\.html/);
    expect(page?.[1].split(" ").map((p) => p.replace(/\*$/, ""))).toEqual(STATIC_PREFIXES);
    expect(caddyfile).toContain("rewrite @pagina {file_match.relative}");
    expect(caddyfile).not.toMatch(/^\ttry_files /m);
    // e o 404 não herda o "immutable" do caminho
    expect(caddyfile).toMatch(/handle_errors \{\n\t\theader Cache-Control "no-store"/);
  });

  it("os pesos do assistente saem de um volume à parte, não do dist", () => {
    expect(caddyfile).toContain("root @llm /srv-llm");
    const compose = readFileSync(new URL("../deploy/compose.yml", import.meta.url), "utf8");
    expect(compose).toContain("- ./llm:/srv-llm/llm:ro");
  });
});
