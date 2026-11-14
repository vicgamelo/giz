// Serve dist/ com os cabeçalhos de produção (CSP, COOP/COEP), para testar o build como ele vai ao ar.
//   PORTAL=http://localhost:8010 PORT=4180 node scripts/serve-dist.mjs
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { cacheControl, headers, STATIC_PREFIXES } from "./headers.mjs";
import { LLM_ROOT } from "./vendor-llm.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".zip": "application/zip",
  ".whl": "application/zip",
  ".bin": "application/octet-stream",
  ".csv": "text/csv; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Caminho do arquivo dentro de `base`, ou null se a URL for inválida ou tentar sair da pasta. */
export function resolveUnder(base, urlPath) {
  let path;
  try {
    path = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (path.includes("\0")) return null;
  const root = resolve(base);
  const file = resolve(join(root, path));
  return file === root || file.startsWith(root + sep) ? file : null;
}

/** O mesmo roteamento do deploy/Caddyfile: dist/ na raiz, /llm/ de outra pasta, 404 de verdade nos caminhos fixos. */
export function createHandler({ root, llmRoot, portal = "https://vgmelo.tech" }) {
  const base = headers(portal);
  const plain = (res, status) =>
    res.writeHead(status, { ...base, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).end(String(status));
  return (req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    // /llm/ sai de .cache/llm (os pesos não entram no dist/); em produção é um volume à parte no Caddy.
    let file = resolveUnder(path.startsWith("/llm/") ? llmRoot : root, path);
    if (!file) return plain(res, 400);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) {
      if (STATIC_PREFIXES.some((p) => path.startsWith(p))) return plain(res, 404);
      file = join(root, "index.html");
    }
    const type = TYPES[extname(file)] ?? "application/octet-stream";
    res.writeHead(200, { ...base, "Content-Type": type, "Cache-Control": cacheControl(path), "Content-Length": statSync(file).size });
    createReadStream(file).pipe(res);
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4180);
  createServer(createHandler({ root: resolve("dist"), llmRoot: LLM_ROOT, portal: process.env.PORTAL })).listen(port, "127.0.0.1", () =>
    console.log(`Giz (dist) em http://127.0.0.1:${port}`),
  );
}
