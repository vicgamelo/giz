// Baixa o modelo do assistente local para .cache/llm/, para os pesos saírem do próprio domínio (a CSP não deixa
// buscar no Hugging Face). Cada arquivo é conferido pelo tamanho e pelo SHA-256 do scripts/llm-lock.json.
//   node scripts/vendor-llm.mjs                  baixa (uma vez) e confere o modelo do lock
//   node scripts/vendor-llm.mjs --check <pasta>  confere uma pasta já publicada (ex.: /opt/vgmelo/giz/llm na VPS)
//   node scripts/vendor-llm.mjs --update <repo do HF> <arquivo .wasm da lib>   troca o modelo e regrava o lock
// São ~1 GB, então os pesos não entram no dist/: o `npm run dev` e o `npm run preview` servem /llm/ direto de
// .cache/llm, e em produção a pasta vai por rsync para um volume (deploy/vps-infra.md). Sem ela o Giz funciona,
// só sem o assistente local.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = join(root, "scripts", "llm-lock.json");
/** Raiz servida em /: os arquivos ficam em <LLM_ROOT>/llm/<modelo>/<revisão>/… */
export const LLM_ROOT = join(root, ".cache", "llm");
const cache = LLM_ROOT;
const LIBS = "mlc-ai/binary-mlc-llm-libs";

/** Pasta publicada: muda quando os pesos ou a lib mudam (o cache do navegador guarda por URL e nunca revalida). */
export function llmDir(lock) {
  return `llm/${lock.id}/${lock.revision.slice(0, 10)}-${lock.lib.commit.slice(0, 10)}`;
}

export function llmFiles(lock) {
  return [
    ...lock.files.map((f) => ({ ...f, path: `resolve/main/${f.name}`, url: `https://huggingface.co/${lock.repo}/resolve/${lock.revision}/${f.name}` })),
    { ...lock.lib, name: "model.wasm", path: "model.wasm", url: `https://raw.githubusercontent.com/${LIBS}/${lock.lib.commit}/${lock.lib.path}` },
  ];
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function download(url, dest) {
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok || !resp.body) throw new Error(`${url}: HTTP ${resp.status}`);
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.parcial`;
  await pipeline(Readable.fromWeb(resp.body), createWriteStream(tmp));
  renameSync(tmp, dest);
}

async function json(url) {
  const resp = await fetch(url, { headers: { "User-Agent": "giz-vendor-llm" } });
  if (!resp.ok) throw new Error(`${url}: HTTP ${resp.status}`);
  return resp.json();
}

/** Baixa para o cache se faltar e confere tamanho e SHA-256 (quando o lock já tem). Devolve o que mediu. */
async function ensure(file, where) {
  const dest = join(where, file.path);
  if (!existsSync(dest)) {
    process.stdout.write(`  baixando ${file.name}…\n`);
    await download(file.url, dest);
  }
  const size = statSync(dest).size;
  const sha256 = await sha256File(dest);
  if ((file.size != null && size !== file.size) || (file.sha256 && sha256 !== file.sha256)) {
    rmSync(dest);
    throw new Error(`${file.name}: tamanho ou SHA-256 diferente do lock (apaguei do cache; rode de novo)`);
  }
  return { size, sha256 };
}

async function update(repo, libFile) {
  const info = await json(`https://huggingface.co/api/models/${repo}?blobs=true`);
  const libPath = `web-llm-models/${webllmModelVersion()}/${libFile}`;
  const commits = await json(`https://api.github.com/repos/${LIBS}/commits?path=${encodeURIComponent(libPath)}&per_page=1`);
  if (!commits.length) throw new Error(`não achei ${libPath} em ${LIBS}`);
  const lock = {
    id: repo.split("/")[1],
    repo,
    revision: info.sha,
    lib: { commit: commits[0].sha, path: libPath },
    files: [],
  };
  // Só o que o WebLLM busca: configuração, tokenizer e os pesos listados no tensor-cache.json.
  const hf = new Map(info.siblings.map((s) => [s.rfilename, s]));
  const where = join(cache, llmDir(lock));
  const fetchOne = async (name) => {
    const meta = hf.get(name);
    if (!meta) throw new Error(`${repo} não tem ${name}`);
    const got = await ensure({ name, path: `resolve/main/${name}`, url: `https://huggingface.co/${repo}/resolve/${info.sha}/${name}`, size: meta.size, sha256: meta.lfs?.sha256 }, where);
    lock.files.push({ name, ...got });
  };
  for (const name of ["mlc-chat-config.json", "tensor-cache.json", "tokenizer.json"]) await fetchOne(name);
  const tensors = JSON.parse(readFileSync(join(where, "resolve/main/tensor-cache.json"), "utf8"));
  for (const name of [...new Set(tensors.records.map((r) => r.dataPath))].sort()) await fetchOne(name);
  const lib = await ensure({ name: "model.wasm", path: "model.wasm", url: `https://raw.githubusercontent.com/${LIBS}/${lock.lib.commit}/${libPath}` }, where);
  Object.assign(lock.lib, lib);
  lock.bytes = lock.files.reduce((n, f) => n + f.size, 0) + lock.lib.size;
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  return lock;
}

/** A pasta das libs wasm compiladas para o WebLLM instalado (a constante `modelVersion` dele, ex.: "v0_2_87/base"). */
export function webllmModelVersion() {
  const lib = readFileSync(join(root, "node_modules", "@mlc-ai", "web-llm", "lib", "index.js"), "utf8");
  const found = lib.match(/const modelVersion = "([^"]+)";/);
  if (!found) throw new Error("não achei `modelVersion` no WebLLM instalado");
  return found[1];
}

/** Confere uma pasta contra o lock, sem baixar nada. Devolve a lista de problemas. */
export async function check(lock, where) {
  const problems = [];
  for (const file of llmFiles(lock)) {
    const path = join(where, llmDir(lock), file.path);
    if (!existsSync(path)) problems.push(`falta ${file.path}`);
    else if (statSync(path).size !== file.size || (await sha256File(path)) !== file.sha256) problems.push(`${file.path}: diferente do lock`);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--check") {
    if (!args[1]) {
      console.error("uso: node scripts/vendor-llm.mjs --check <pasta que contém llm/>");
      process.exit(2);
    }
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    const problems = await check(lock, args[1]);
    if (problems.length) {
      console.error(problems.map((p) => `✗ ${p}`).join("\n"));
      process.exit(1);
    }
    console.log(`${lock.id}: ${lock.files.length + 1} arquivos conferem com o lock em ${join(args[1], llmDir(lock))}`);
  } else {
    if (args[0] === "--update" && !(args[1] && args[2])) {
      console.error("uso: node scripts/vendor-llm.mjs --update <repo do HF> <arquivo .wasm da lib>");
      process.exit(2);
    }
    const lock = args[0] === "--update" ? await update(args[1], args[2]) : JSON.parse(readFileSync(lockPath, "utf8"));
    const where = join(cache, llmDir(lock));
    for (const file of llmFiles(lock)) await ensure(file, where);
    console.log(`${lock.id}: ${lock.files.length + 1} arquivos, ${(lock.bytes / 1e6).toFixed(0)} MB em .cache/llm/${llmDir(lock)}/`);
  }
}
