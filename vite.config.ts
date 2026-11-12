import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
// @ts-expect-error: módulo .mjs de script, sem tipos
import { LLM_ROOT, llmDir } from "./scripts/vendor-llm.mjs";
// @ts-expect-error: módulo .mjs de script, sem tipos
import { resolveUnder } from "./scripts/serve-dist.mjs";

const pyodide = JSON.parse(readFileSync("node_modules/pyodide/package.json", "utf8")).version as string;
const llmLock = JSON.parse(readFileSync("scripts/llm-lock.json", "utf8"));
const llmModel = { id: llmLock.id as string, bytes: llmLock.bytes as number, dir: `/${llmDir(llmLock)}/` };

// COOP/COEP deixam a página "cross-origin isolated": o botão Parar usa SharedArrayBuffer para interromper o Python.
// Em produção o Caddy manda os mesmos cabeçalhos (e a CSP).
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

// No `npm run dev`, /llm/ sai de .cache/llm (os pesos do assistente local não ficam em public/ nem entram no dist/).
const llm: Plugin = {
  name: "giz-llm",
  configureServer(server) {
    server.middlewares.use("/llm", (req, res) => {
      const file = resolveUnder(join(LLM_ROOT, "llm"), (req.url ?? "/").split("?")[0]);
      if (!file || !existsSync(file) || !statSync(file).isFile()) {
        res.statusCode = 404;
        res.end("404");
        return;
      }
      res.setHeader("Content-Type", file.endsWith(".json") ? "application/json" : file.endsWith(".wasm") ? "application/wasm" : "application/octet-stream");
      res.setHeader("Content-Length", statSync(file).size);
      res.setHeader("Cache-Control", "no-store");
      createReadStream(file).pipe(res);
    });
  },
};

export default defineConfig({
  plugins: [svelte(), llm],
  define: { __PYODIDE_VERSION__: JSON.stringify(pyodide), __LLM_MODEL__: JSON.stringify(llmModel) },
  server: { headers: isolation, port: 5180, strictPort: true },
  preview: { headers: isolation },
  worker: { format: "es" },
  build: { target: "es2022", modulePreload: { polyfill: false }, assetsInlineLimit: 0 },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
