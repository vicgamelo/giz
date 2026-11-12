// Roda a suíte do motor (python/tests) dentro do Pyodide, no Node: as mesmas versões de pandas, scikit-learn,
// LightGBM e XGBoost que o navegador usa. Precisa de `npm run vendor` antes (baixa os wheels para .cache/).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPyodide } from "pyodide";
import { PYPI } from "./vendor-pyodide.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const py = await loadPyodide({
  indexURL: join(root, "node_modules", "pyodide") + "/",
  // caminho do disco, não URL file://: com URL o Pyodide copia cada wheel para uma pasta "file:" no diretório atual
  packageBaseUrl: join(root, ".cache", "pyodide") + "/",
});
const cache = join(root, ".cache", "pyodide");
const pypi = PYPI.map((w) => join(cache, w.file_name));
await py.loadPackage(
  ["pandas", "scikit-learn", "lightgbm", "xgboost", "python-calamine", "pytest", "packaging", "wcwidth", ...pypi],
  { messageCallback: () => {} },
);
py.FS.mkdirTree("/repo");
py.FS.mount(py.FS.filesystems.NODEFS, { root }, "/repo");
const args = process.argv.slice(2);
const code = py.runPython(`
import os, sys, pytest
os.chdir("/repo/python")
sys.path.insert(0, "/repo/python")
int(pytest.main(["-q", "-W", "ignore", "-p", "no:cacheprovider", *${JSON.stringify(args)}]))
`);
process.exit(code);
