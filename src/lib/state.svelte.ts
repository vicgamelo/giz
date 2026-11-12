// Estado da tela e as ações que falam com o worker. Um único objeto reativo (runes do Svelte 5).
import { Engine } from "./engine";
import type { TrainEvent } from "./protocol";
import { forEngine, History, sameStep, withUid } from "./recipe";
import type {
  Candidate,
  Explanation,
  PredictSummary,
  Problem,
  Profile,
  Source,
  Step,
  StepReport,
  TargetInfo,
  TrainResult,
} from "./types";

export type StepKey = "import" | "profile" | "recipe" | "train" | "evaluate" | "predict" | "export";

export const STEPS: { key: StepKey; label: string; short: string }[] = [
  { key: "import", label: "Importar", short: "Dados" },
  { key: "profile", label: "Perfil dos dados", short: "Perfil" },
  { key: "recipe", label: "Receita de tratamento", short: "Receita" },
  { key: "train", label: "AutoML", short: "Treino" },
  { key: "evaluate", label: "Avaliação", short: "Avaliar" },
  { key: "predict", label: "Prever em lote", short: "Prever" },
  { key: "export", label: "Exportar e MLflow", short: "Exportar" },
];

export const SAMPLES = [
  {
    id: "credito",
    file: "credito.csv",
    title: "Crédito em reais",
    detail: "1.000 pedidos de crédito · alvo: inadimplente",
    source: "Statlog German Credit (UCI, CC BY 4.0), convertido para reais",
    target: "inadimplente",
    batch: "credito-novos.csv",
  },
  {
    id: "problemas",
    file: "credito-com-problemas.csv",
    title: "Crédito com problemas",
    detail: "O mesmo crédito com sujeira de propósito: ID, datas em texto, R$ em texto, nulos, repetidas e vazamento",
    source: "Modificado pelo Giz para a demo",
    target: "inadimplente",
    batch: "credito-com-problemas-novos.csv",
  },
  {
    id: "casas",
    file: "casas-california.xlsx",
    title: "Casas na Califórnia (Excel)",
    detail: "20.640 regiões · 2 abas · alvo: valor mediano (regressão)",
    source: "California Housing (StatLib, censo dos EUA de 1990)",
    target: "valor_mediano_100mil_usd",
    batch: "casas-california-novos.csv",
  },
];

class AppState {
  engine: Engine | null = null;
  stage = $state("boot");
  status = $state("Carregando o Python…");
  pyReady = $state(false);
  mlReady = $state(false);
  bootSeconds = $state<number | null>(null);
  mlSeconds = $state<number | null>(null);
  current = $state<StepKey>("import");
  busy = $state<string | null>(null);
  error = $state<string | null>(null);
  toast = $state<string | null>(null);

  file = $state<{ name: string; data: ArrayBuffer } | null>(null);
  sampleId = $state<string | null>(null);
  source = $state<Source | null>(null);
  rawProfile = $state<Profile | null>(null);

  steps = $state<Step[]>([]);
  reports = $state<StepReport[]>([]);
  profile = $state<Profile | null>(null);
  previewOk = $state(true);
  previewing = $state(false);
  history = new History<Step[]>();
  historyTick = $state(0);

  target = $state<string | null>(null);
  problem = $state<Problem | null>(null);
  positive = $state<string | null>(null);
  targetInfo = $state<TargetInfo | null>(null);
  budget = $state(60);

  training = $state(false);
  trainStartedAt = $state(0);
  now = $state(0);
  phase = $state<string | null>(null);
  plan = $state<{ metric: string; folds: number; cv_rows: number; rows: number; holdout_rows: number } | null>(null);
  candidates = $state<Candidate[]>([]);
  result = $state<TrainResult | null>(null);
  stale = $state(false);

  explanation = $state<Explanation | null>(null);
  explainRow = $state<Record<string, unknown> | null>(null);
  batch = $state<{ summary: PredictSummary; url: string; name: string } | null>(null);

  get reached(): Record<StepKey, boolean> {
    return {
      import: true,
      profile: !!this.rawProfile,
      recipe: !!this.rawProfile,
      train: !!this.rawProfile,
      evaluate: !!this.result,
      predict: !!this.result,
      export: !!this.result,
    };
  }

  start() {
    if (this.engine) return;
    this.engine = new Engine();
    this.engine.onStatus = (stage, message, seconds) => {
      this.stage = stage;
      this.status = message;
      if (stage === "ready") {
        this.pyReady = true;
        this.bootSeconds = seconds ?? null;
      }
      if (stage === "ml-ready") {
        this.mlReady = true;
        this.mlSeconds = seconds ?? null;
      }
      if (stage === "error") this.error = message;
    };
  }

  private async run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    this.busy = label;
    this.error = null;
    try {
      return await fn();
    } catch (e) {
      this.error = (e as Error).message;
      return undefined;
    } finally {
      this.busy = null;
    }
  }

  async loadFile(name: string, data: ArrayBuffer, sheet: string | null = null, sampleId: string | null = null) {
    this.file = { name, data };
    const copy = data.slice(0);
    const res = await this.run("Lendo o arquivo…", () =>
      this.engine!.call<{ source: Source; profile: Profile }>(
        { cmd: "load", data: copy, filename: name, sheet },
        undefined,
        [copy],
      ),
    );
    if (!res) return;
    this.sampleId = sampleId;
    this.source = res.source;
    this.rawProfile = res.profile;
    this.profile = res.profile;
    this.steps = [];
    this.reports = [];
    this.history = new History();
    this.historyTick++;
    this.resetModel();
    this.target = null;
    this.targetInfo = null;
    this.problem = null;
    this.positive = null;
    this.current = "profile";
  }

  async loadSample(id: string) {
    const s = SAMPLES.find((x) => x.id === id)!;
    const data = await this.run("Baixando o exemplo…", async () => {
      const r = await fetch(`/samples/${s.file}`);
      if (!r.ok) throw new Error(`Não consegui baixar o exemplo (${r.status}).`);
      return r.arrayBuffer();
    });
    if (data) await this.loadFile(s.file, data, null, id);
  }

  async chooseSheet(sheet: string) {
    if (this.file) await this.loadFile(this.file.name, this.file.data, sheet, this.sampleId);
  }

  resetModel() {
    this.result = null;
    this.candidates = [];
    this.explanation = null;
    this.explainRow = null;
    if (this.batch) URL.revokeObjectURL(this.batch.url);
    this.batch = null;
    this.stale = false;
  }

  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private previewSeq = 0;

  setSteps(next: Step[], record = true) {
    if (record) {
      this.history.push($state.snapshot(this.steps));
      this.historyTick++;
    }
    this.steps = next.map(withUid);
    if (this.result) this.stale = true;
    this.targetInfo = null;
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => void this.preview(), 200);
  }

  addStep(step: Step) {
    if (this.steps.some((s) => sameStep(s, step))) {
      this.toast = "Esse passo já está na receita.";
      return false;
    }
    this.setSteps([...this.steps, step]);
    this.toast = "Passo adicionado à receita.";
    return true;
  }

  undo() {
    const prev = this.history.undo($state.snapshot(this.steps));
    if (prev) {
      this.historyTick++;
      this.setSteps(prev, false);
    }
  }

  redo() {
    const next = this.history.redo($state.snapshot(this.steps));
    if (next) {
      this.historyTick++;
      this.setSteps(next, false);
    }
  }

  async preview() {
    const seq = ++this.previewSeq;
    this.previewing = true;
    try {
      const res = await this.engine!.call<{ ok: boolean; reports: StepReport[]; profile: Profile }>({
        cmd: "preview",
        steps: forEngine($state.snapshot(this.steps)),
      });
      if (seq !== this.previewSeq) return;
      this.reports = res.reports;
      this.previewOk = res.ok;
      this.profile = res.profile;
      if (this.target && !res.profile.columns.some((c) => c.name === this.target)) this.target = null;
      // A receita mudou: a análise do alvo (vazamento, classes) precisa refletir as colunas novas.
      if (this.target && res.ok && this.reached.train) void this.chooseTarget(this.target, this.problem, this.positive);
    } catch (e) {
      if (seq === this.previewSeq) this.error = (e as Error).message;
    } finally {
      if (seq === this.previewSeq) this.previewing = false;
    }
  }

  async chooseTarget(target: string, problem: Problem | null = null, positive: string | null = null) {
    this.target = target;
    this.problem = problem;
    this.positive = positive;
    this.targetInfo = null;
    const info = await this.run(this.mlReady ? "Analisando o alvo…" : "Esperando o scikit-learn carregar…", () =>
      this.engine!.call<TargetInfo>({ cmd: "target", target, problem, positive }),
    );
    if (info && this.target === target) {
      this.targetInfo = info;
      this.problem = info.problem;
    }
  }

  async train() {
    if (!this.target) return;
    this.resetModel();
    this.training = true;
    this.trainStartedAt = performance.now();
    this.now = this.trainStartedAt;
    this.phase = "cv";
    const tick = setInterval(() => (this.now = performance.now()), 100);
    const onEvent = (e: TrainEvent) => this.onTrainEvent(e);
    const res = await this.run("Treinando…", () =>
      this.engine!.call<TrainResult>(
        { cmd: "train", target: this.target!, problem: this.problem, positive: this.positive, budget: this.budget },
        onEvent,
      ),
    );
    clearInterval(tick);
    this.training = false;
    this.phase = null;
    if (res) {
      this.result = res;
      this.candidates = res.ranking;
      const first = res.holdout_sample.rows[0];
      if (first) this.explainRow = Object.fromEntries(res.holdout_sample.columns.map((c, i) => [c, first[i]]));
    }
  }

  private onTrainEvent(e: TrainEvent) {
    if (e.type === "start") {
      this.plan = { metric: e.metric, folds: e.folds, cv_rows: e.cv_rows, rows: e.rows, holdout_rows: e.holdout_rows };
      this.candidates = e.candidates.map((c) => ({ ...c, status: "pending", folds: [] }));
    } else if (e.type === "candidate") {
      this.candidates = this.candidates.map((c) => (c.key === e.key ? { ...c, ...e, status: e.status as Candidate["status"] } : c));
    } else if (e.type === "fold") {
      this.candidates = this.candidates.map((c) =>
        c.key === e.key ? { ...c, folds: [...c.folds, e.score], seconds: (c.seconds ?? 0) + e.seconds } : c,
      );
    } else if (e.type === "phase") {
      this.phase = e.phase;
    }
  }

  stopTraining() {
    this.engine?.stop();
  }

  async explain(row: Record<string, unknown>) {
    this.explainRow = row;
    const res = await this.run("Explicando…", () => this.engine!.call<Explanation>({ cmd: "explain", row }));
    if (res) this.explanation = res;
  }

  async predict(name: string, data: ArrayBuffer, sheet: string | null = null) {
    const copy = data.slice(0);
    const res = await this.run("Prevendo…", () =>
      this.engine!.call<{ summary: PredictSummary; csv: ArrayBuffer }>(
        { cmd: "predict", data: copy, filename: name, sheet },
        undefined,
        [copy],
      ),
    );
    if (!res) return;
    if (this.batch) URL.revokeObjectURL(this.batch.url);
    const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
    const base = name.replace(/\.[^.]+$/, "");
    this.batch = { summary: res.summary, url: URL.createObjectURL(blob), name: `${base}-previsoes.csv` };
  }

  async exportFile(kind: "script" | "notebook" | "recipe"): Promise<string | undefined> {
    return this.run("Gerando…", () => this.engine!.call<string>({ cmd: "export", kind }));
  }
}

export const app = new AppState();
