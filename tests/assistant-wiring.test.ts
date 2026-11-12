import { afterEach, describe, expect, it, vi } from "vitest";
import { apply, snapshotOf } from "../src/lib/assistant";
import { LlmError, LocalEngine, LOCAL_MODEL } from "../src/lib/assistant/local";
import type { LlmMessage, LlmRequest } from "../src/lib/assistant/llm-protocol";
import { modelDir } from "../src/lib/assistant/model";
import { app } from "../src/lib/state.svelte";
import lock from "../scripts/llm-lock.json";
import { fixture } from "./helpers";

const f = fixture("credito-problemas");

/** Worker falso: guarda o que a página mandou e deixa o teste responder como o worker de verdade responderia. */
class FakeWorker {
  static last: FakeWorker;
  sent: LlmRequest[] = [];
  terminated = false;
  onmessage: ((ev: MessageEvent<LlmMessage>) => void) | null = null;
  onerror: ((ev: { message: string }) => void) | null = null;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(req: LlmRequest) {
    this.sent.push(req);
  }
  terminate() {
    this.terminated = true;
  }
  reply(msg: LlmMessage) {
    this.onmessage?.({ data: msg } as MessageEvent<LlmMessage>);
  }
}

describe("cliente do worker do assistente local", () => {
  afterEach(() => vi.unstubAllGlobals());

  function engine() {
    vi.stubGlobal("Worker", FakeWorker);
    return new LocalEngine();
  }

  it("o worker só nasce na primeira chamada, e o modelo da página é o do lock", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const before = FakeWorker.last;
    new LocalEngine();
    expect(FakeWorker.last).toBe(before);
    expect(LOCAL_MODEL).toEqual({ id: lock.id, bytes: lock.bytes, dir: modelDir(lock) });
  });

  it("carregar repassa o progresso e termina quando o worker confirma", async () => {
    const e = engine();
    const seen: number[] = [];
    const loading = e.load((p) => seen.push(p.progress));
    const w = FakeWorker.last;
    expect(w.sent).toEqual([{ cmd: "load", id: 1 }]);
    w.reply({ type: "progress", id: 1, progress: 0.25, text: "…" });
    w.reply({ type: "progress", id: 1, progress: 0.75, text: "…" });
    w.reply({ type: "result", id: 1, ok: true, result: true });
    await loading;
    expect(seen).toEqual([0.25, 0.75]);
  });

  it("pergunta: os pedaços chegam por callback; Parar manda 'stop' ao worker", async () => {
    const e = engine();
    const abort = new AbortController();
    let text = "";
    const sending = e.send([{ role: "user", content: "oi" }], { signal: abort.signal, maxTokens: 350, onToken: (d) => (text += d) });
    const w = FakeWorker.last;
    expect(w.sent[0]).toEqual({ cmd: "chat", id: 1, messages: [{ role: "user", content: "oi" }], maxTokens: 350 });
    w.reply({ type: "token", id: 1, delta: "Olá" });
    abort.abort();
    expect(w.sent[1]).toMatchObject({ cmd: "stop" });
    w.reply({ type: "result", id: 1, ok: true, result: { text: "Olá", promptTokens: 10, completionTokens: 1 } });
    expect(await sending).toMatchObject({ text: "Olá" });
    expect(text).toBe("Olá");
  });

  it("erro do worker chega com o código que a tela sabe explicar", async () => {
    const e = engine();
    const loading = e.load(() => {});
    FakeWorker.last.reply({ type: "result", id: 1, ok: false, code: "integrity", error: "hash" });
    await expect(loading).rejects.toMatchObject({ code: "integrity", message: "hash" });
    await expect(loading).rejects.toBeInstanceOf(LlmError);
  });

  it("worker que cai rejeita o que estava pendente (sem culpar a placa de vídeo) e a próxima chamada cria outro", async () => {
    const e = engine();
    const loading = e.load(() => {});
    const first = FakeWorker.last;
    first.onerror?.({ message: "Failed to load chunk" });
    await expect(loading).rejects.toMatchObject({ code: "error", message: "O worker do assistente caiu: Failed to load chunk" });
    expect(first.terminated).toBe(true);
    void e.cached();
    expect(FakeWorker.last).not.toBe(first);
  });

  it("desligar sem worker não cria um só para isso", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const before = FakeWorker.last;
    await new LocalEngine().unload();
    expect(FakeWorker.last).toBe(before);
  });

  it("pesos publicados: JSON de verdade sim; 404 ou HTML não", async () => {
    const e = engine();
    vi.stubGlobal("fetch", async () => new Response('{"model_type":"qwen3"}', { status: 200 }));
    expect(await e.published()).toBe(true);
    vi.stubGlobal("fetch", async () => new Response("404", { status: 404 }));
    expect(await e.published()).toBe(false);
    vi.stubGlobal("fetch", async () => new Response("<html></html>", { status: 200 }));
    expect(await e.published()).toBe(false);
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await e.published()).toBe(false);
  });
});

describe("ligação com a tela do Giz", () => {
  afterEach(() => {
    app.rawProfile = null;
    app.profile = null;
    app.steps = [];
    app.reports = [];
    app.target = null;
    app.targetInfo = null;
    app.result = null;
    app.current = "import";
    app.busy = null;
    app.previewing = false;
    app.toast = null;
    vi.useRealTimers();
  });

  it("o que o assistente vê sai do estado da tela, incluindo as colunas do arquivo original", () => {
    expect(snapshotOf()).toMatchObject({ current: "import", profile: null, rawColumns: null, busy: false, previewing: false });
    app.rawProfile = f.rawProfile;
    app.profile = f.profile;
    app.steps = f.steps;
    app.reports = f.reports;
    app.busy = "Analisando o alvo…";
    app.current = "recipe";
    const s = snapshotOf();
    expect(s.rawColumns).toEqual(f.rawProfile.columns.map((c) => c.name));
    expect(s).toMatchObject({ current: "recipe", busy: true, steps: f.steps, profile: f.profile });
  });

  it("clique numa correção vira passo da receita; a prévia fica pendente na hora", () => {
    vi.useFakeTimers(); // a prévia de verdade precisa do Python; aqui só importa o estado até ela
    app.rawProfile = f.rawProfile;
    app.profile = f.rawProfile;
    apply({ kind: "fix", code: "A1", label: "x", step: { op: "drop_duplicates" } });
    expect(app.steps.map((st) => st.op)).toEqual(["drop_duplicates"]);
    expect(app.toast).toBe("Passo adicionado à receita.");
    expect(snapshotOf().previewing).toBe(true);
    apply({ kind: "fix", code: "A1", label: "x", step: { op: "drop_duplicates" } });
    expect(app.steps).toHaveLength(1);
  });

  it("clique em 'ir para o passo' só troca de tela", () => {
    apply({ kind: "goto", code: "A9", label: "x", step: "recipe" });
    expect(app.current).toBe("recipe");
    expect(app.steps).toEqual([]);
  });
});
