// Copia o Pyodide e só os pacotes que o Giz usa para public/pyodide/, para tudo sair do próprio domínio.
// Os wheels vêm do CDN oficial uma vez, ficam em .cache/ e cada um é conferido pelo SHA-256 do pyodide-lock.json.
// O lock publicado é cortado para conter só esses pacotes (o Pyodide não tenta buscar nada fora da lista).
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pyodide");
const version = JSON.parse(readFileSync(join(src, "package.json"), "utf8")).version;
// Pasta com a versão no nome: o Caddy serve /pyodide/* como imutável, e trocar de versão troca a URL.
const out = join(root, "public", "pyodide", `v${version}`);
const cache = join(root, ".cache", "pyodide");

// Pacotes que o worker carrega. "ml" fica separado para o perfil aparecer antes do scikit-learn chegar.
export const GROUPS = {
  core: ["numpy", "pandas"],
  ml: ["scikit-learn", "lightgbm", "xgboost"],
  excel: ["python-calamine"],
  skops: ["packaging", "wcwidth"],
};

// Wheels puros do PyPI que não estão no lock do Pyodide (só para salvar o modelo com skops, sem pickle).
// Versão e SHA-256 fixos; o worker carrega pela URL do próprio domínio.
export const PYPI = [
  {
    file_name: "skops-0.16.0-py3-none-any.whl",
    url: "https://files.pythonhosted.org/packages/py3/s/skops/skops-0.16.0-py3-none-any.whl",
    sha256: "5b2eb1bc49392c74a38db04481e2d110f97d9a72d6ae38fbd698aa7a865a9070",
  },
  {
    file_name: "prettytable-3.18.0-py3-none-any.whl",
    url: "https://files.pythonhosted.org/packages/py3/p/prettytable/prettytable-3.18.0-py3-none-any.whl",
    sha256: "b3346e0e6f79180833aebaac088ae926340586cf6d7d991b9eb125b65f72313a",
  },
];

// Só para os testes (pytest dentro do Pyodide no Node): vai para .cache/, não para o site.
export const TEST_ONLY = ["pytest"];

const CORE_FILES = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip"];

const lock = JSON.parse(readFileSync(join(src, "pyodide-lock.json"), "utf8"));
const cdn = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;

export function closure(names, packages = lock.packages) {
  const seen = new Set();
  const stack = [...names];
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n)) continue;
    if (!packages[n]) throw new Error(`pacote ${n} não existe no lock do Pyodide ${version}`);
    seen.add(n);
    stack.push(...packages[n].depends);
  }
  return [...seen].sort();
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function fetchWheel(pkg) {
  const file = join(cache, pkg.file_name);
  if (existsSync(file) && sha256(readFileSync(file)) === pkg.sha256) return file;
  const res = await fetch(pkg.url ?? cdn + pkg.file_name);
  if (!res.ok) throw new Error(`${pkg.file_name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== pkg.sha256) throw new Error(`${pkg.file_name}: SHA-256 ${got} diferente do lock`);
  writeFileSync(file, buf);
  return file;
}

async function main() {
  mkdirSync(out, { recursive: true });
  mkdirSync(cache, { recursive: true });
  for (const f of CORE_FILES) copyFileSync(join(src, f), join(out, f));

  const wanted = closure(Object.values(GROUPS).flat());
  const packages = {};
  let bytes = 0;
  for (const name of wanted) {
    const pkg = lock.packages[name];
    const file = await fetchWheel(pkg);
    copyFileSync(file, join(out, pkg.file_name));
    bytes += readFileSync(file).length;
    packages[name] = pkg;
  }
  writeFileSync(join(out, "pyodide-lock.json"), JSON.stringify({ info: lock.info, packages }));
  for (const pkg of PYPI) {
    copyFileSync(await fetchWheel(pkg), join(out, pkg.file_name));
  }
  writeFileSync(join(out, "extra-wheels.json"), JSON.stringify(PYPI.map((p) => p.file_name)));
  for (const name of closure(TEST_ONLY)) await fetchWheel(lock.packages[name]);
  console.log(`pyodide ${version}: ${wanted.length} pacotes, ${(bytes / 1e6).toFixed(1)} MB em wheels → public/pyodide/v${version}/`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
