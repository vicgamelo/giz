// Confere o build antes de subir: nada de script ou estilo inline (a CSP recusaria), nada de CDN, e o Pyodide
// publicado inteiro (cada wheel do lock existe e bate o SHA-256).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = "dist";
const errors = [];
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = walk(dist);

for (const f of files.filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(f, "utf8");
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) errors.push(`${f}: <script> inline`);
  if (/<style[\s>]/i.test(html)) errors.push(`${f}: <style> inline`);
  if (/\sstyle=/i.test(html)) errors.push(`${f}: atributo style=`);
  if (/\son[a-z]+=/i.test(html)) errors.push(`${f}: handler inline (on…=)`);
  for (const m of html.matchAll(/(?:src|href)="(https?:)?\/\/[^"]+"/g)) errors.push(`${f}: recurso externo ${m[0]}`);
}
for (const f of files.filter((f) => /\.(js|css)$/.test(f) && f.includes("assets"))) {
  const text = readFileSync(f, "utf8");
  for (const host of ["cdn.jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com", "fonts.googleapis.com"]) {
    if (text.includes(host)) errors.push(`${f}: referência a ${host}`);
  }
}

const pyDirs = existsSync(join(dist, "pyodide")) ? readdirSync(join(dist, "pyodide")) : [];
if (pyDirs.length !== 1) errors.push(`dist/pyodide deve ter uma versão só (achei: ${pyDirs.join(", ") || "nenhuma"})`);
for (const v of pyDirs) {
  const dir = join(dist, "pyodide", v);
  const lock = JSON.parse(readFileSync(join(dir, "pyodide-lock.json"), "utf8"));
  for (const [name, pkg] of Object.entries(lock.packages)) {
    const file = join(dir, pkg.file_name);
    if (!existsSync(file)) {
      errors.push(`${name}: falta ${pkg.file_name}`);
      continue;
    }
    const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
    if (sha !== pkg.sha256) errors.push(`${name}: SHA-256 diferente do lock`);
  }
  for (const f of ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "extra-wheels.json"]) {
    if (!existsSync(join(dir, f))) errors.push(`falta ${f}`);
  }
}
for (const f of ["credito.csv", "credito-com-problemas.csv", "casas-california.xlsx"]) {
  if (!existsSync(join(dist, "samples", f))) errors.push(`falta o exemplo ${f}`);
}

const total = files.reduce((n, f) => n + statSync(f).size, 0);
if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join("\n"));
  process.exit(1);
}
console.log(`check-dist ok: ${files.length} arquivos, ${(total / 1e6).toFixed(1)} MB`);
