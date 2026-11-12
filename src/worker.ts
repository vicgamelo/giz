/// <reference lib="webworker" />
// Worker do Pyodide: todo o Python (pandas, scikit-learn, LightGBM, XGBoost) roda aqui, fora da thread da página.
// Os dados ficam na memória deste worker; a página recebe só resumos em JSON.
import type { PyodideAPI } from "pyodide";
import type { Request, WorkerMessage } from "./lib/protocol";

declare const self: DedicatedWorkerGlobalScope;

const sources = import.meta.glob("../python/lousa/*.py", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

declare const __PYODIDE_VERSION__: string;
const BASE = new URL(`/pyodide/v${__PYODIDE_VERSION__}/`, self.location.origin).href;
let py: PyodideAPI | null = null;
let api: any = null;
let mlReady: Promise<void> | null = null;
let interrupt: Uint8Array | null = null;

function post(msg: WorkerMessage, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

function status(stage: string, message: string, extra: Record<string, unknown> = {}) {
  post({ type: "status", stage, message, ...extra });
}

async function boot() {
  const t0 = performance.now();
  status("boot", "Carregando o Python (WebAssembly)…");
  const { loadPyodide } = await import(/* @vite-ignore */ `${BASE}pyodide.mjs`);
  py = (await loadPyodide({ indexURL: BASE, lockFileURL: `${BASE}pyodide-lock.json` })) as PyodideAPI;
  status("boot", "Carregando pandas…");
  await py.loadPackage(["numpy", "pandas", "python-calamine"], { messageCallback: () => {} });
  py.FS.mkdirTree("/home/pyodide/lousa");
  for (const [path, code] of Object.entries(sources)) {
    py.FS.writeFile(`/home/pyodide/lousa/${path.split("/").pop()}`, code);
  }
  py.runPython("import sys; sys.path.insert(0, '/home/pyodide')");
  api = py.pyimport("lousa.api");
  status("ready", "Python pronto", { seconds: (performance.now() - t0) / 1000 });
  mlReady = (async () => {
    status("ml", "Carregando scikit-learn, LightGBM e XGBoost em segundo plano…");
    await py!.loadPackage(["scikit-learn", "lightgbm", "xgboost"], { messageCallback: () => {} });
    py!.runPython("import sklearn, lightgbm, xgboost");
    status("ml-ready", "Modelos prontos", { seconds: (performance.now() - t0) / 1000 });
  })();
}

const booting = boot().catch((e) => {
  status("error", `Não consegui iniciar o Python: ${e?.message ?? e}`);
  throw e;
});

let skops: Promise<void> | null = null;
function loadSkops() {
  // Só quando a pessoa pede o modelo no MLflow: skops (salva sem pickle) e o prettytable, servidos daqui.
  skops ??= (async () => {
    const lock = await (await fetch(`${BASE}extra-wheels.json`)).json();
    await py!.loadPackage(["packaging", "wcwidth", ...lock.map((f: string) => BASE + f)], { messageCallback: () => {} });
  })();
  return skops;
}

function parse(json: string) {
  return JSON.parse(json);
}

function cleanError(e: unknown): string {
  const text = String((e as Error)?.message ?? e);
  // Erros do Python chegam com o traceback inteiro; a tela mostra só a última linha.
  const lines = text.trim().split("\n").filter(Boolean);
  const last = lines[lines.length - 1] ?? text;
  if (last.startsWith("KeyboardInterrupt")) return "Parado.";
  return last.replace(/^[\w.]*(Error|Exception): /, "");
}

async function handle(req: Request): Promise<{ result: unknown; transfer?: Transferable[] }> {
  await booting;
  const p = py!;
  if (interrupt) interrupt[0] = 0;
  switch (req.cmd) {
    case "setInterrupt":
      interrupt = new Uint8Array(req.buffer);
      p.setInterruptBuffer(interrupt);
      return { result: true };
    case "load": {
      p.FS.writeFile("/tmp/entrada", new Uint8Array(req.data));
      return { result: parse(api.load_path("/tmp/entrada", req.filename, req.sheet ?? null)) };
    }
    case "preview":
      return { result: parse(api.preview(JSON.stringify(req.steps))) };
    case "target":
      await mlReady;
      return { result: parse(api.target(req.target, req.problem ?? null, req.positive ?? null)) };
    case "train": {
      await mlReady;
      const progress = (event: string) => post({ type: "progress", id: req.id, event: JSON.parse(event) });
      const shouldStop = () => interrupt !== null && interrupt[0] !== 0;
      const out = api.train(req.target, req.problem ?? null, req.budget, req.positive ?? null, progress, shouldStop);
      return { result: parse(out) };
    }
    case "explain":
      return { result: parse(api.explain(JSON.stringify(req.row))) };
    case "predict": {
      p.FS.writeFile("/tmp/lote", new Uint8Array(req.data));
      const summary = parse(api.predict_path("/tmp/lote", req.filename, "/tmp/previsoes.csv", req.sheet ?? null));
      const csv = p.FS.readFile("/tmp/previsoes.csv");
      const buffer = csv.buffer.slice(csv.byteOffset, csv.byteOffset + csv.byteLength) as ArrayBuffer;
      return { result: { summary, csv: buffer }, transfer: [buffer] };
    }
    case "export":
      return { result: api.export_file(req.kind) as string };
    case "mlflow":
      if (req.includeModel) await loadSkops();
      return { result: parse(api.mlflow_payload(req.includeModel)) };
  }
}

self.onmessage = async (ev: MessageEvent<Request>) => {
  const req = ev.data;
  try {
    const { result, transfer } = await handle(req);
    post({ type: "result", id: req.id, ok: true, result }, transfer ?? []);
  } catch (e) {
    post({ type: "result", id: req.id, ok: false, error: cleanError(e) });
  }
};
