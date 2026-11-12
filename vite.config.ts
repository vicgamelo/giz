import { svelte } from "@sveltejs/vite-plugin-svelte";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const pyodide = JSON.parse(readFileSync("node_modules/pyodide/package.json", "utf8")).version as string;

// COOP/COEP deixam a página "cross-origin isolated": o botão Parar usa SharedArrayBuffer para interromper o Python.
// Em produção o Caddy manda os mesmos cabeçalhos (e a CSP).
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [svelte()],
  define: { __PYODIDE_VERSION__: JSON.stringify(pyodide) },
  server: { headers: isolation, port: 5180, strictPort: true },
  preview: { headers: isolation },
  worker: { format: "es" },
  build: { target: "es2022", modulePreload: { polyfill: false }, assetsInlineLimit: 0 },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
