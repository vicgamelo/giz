// Serve dist/ com os cabeçalhos de produção (CSP, COOP/COEP), para testar o build como ele vai ao ar.
//   PORTAL=http://localhost:8010 PORT=4180 node scripts/serve-dist.mjs
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { headers } from "./headers.mjs";

const root = resolve("dist");
const port = Number(process.env.PORT ?? 4180);
const base = headers(process.env.PORTAL ?? "https://vgmelo.tech");
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
  ".csv": "text/csv; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  let file = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) file = join(root, "index.html");
  const type = TYPES[extname(file)] ?? "application/octet-stream";
  const cache = url.pathname.startsWith("/pyodide/") || url.pathname.startsWith("/assets/")
    ? "public, max-age=31536000, immutable"
    : "no-cache";
  res.writeHead(200, { ...base, "Content-Type": type, "Cache-Control": cache });
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`Lousa (dist) em http://127.0.0.1:${port}`));
