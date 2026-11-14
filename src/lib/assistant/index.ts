// Liga o assistente à tela de verdade: o estado do Giz, o modelo local e o portal.
import { assistantChat, assistantInfo, me } from "../portal";
import { app } from "../state.svelte";
import type { Action } from "./actions";
import type { Snapshot } from "./context";
import { LocalEngine, LOCAL_MODEL } from "./local";
import { Assistant } from "./store.svelte";

/** Cópia do que o assistente pode ver. Lida dentro de um $derived, acompanha a tela. */
export function snapshotOf(): Snapshot {
  return {
    current: app.current,
    source: app.source,
    rawColumns: app.rawProfile?.columns.map((c) => c.name) ?? null,
    profile: app.profile,
    steps: app.steps,
    reports: app.reports,
    previewOk: app.previewOk,
    target: app.target,
    problem: app.problem,
    targetInfo: app.targetInfo,
    budget: app.budget,
    training: app.training,
    metric: app.plan?.metric ?? app.result?.metric ?? null,
    candidates: app.candidates,
    result: app.result,
    stale: app.stale,
    batch: app.batch?.summary ?? null,
    mlReady: app.mlReady,
    busy: app.busy !== null,
    previewing: app.previewing,
  };
}

export function apply(action: Action) {
  if (action.kind === "fix") {
    app.addStep(JSON.parse(JSON.stringify(action.step)));
  } else if (action.kind === "target") {
    app.current = "train";
    void app.chooseTarget(action.column);
  } else {
    app.current = action.step;
  }
}

const engine = new LocalEngine();

export const assistant = new Assistant(
  { snapshot: snapshotOf, apply },
  {
    bytes: LOCAL_MODEL.bytes,
    detect: () => engine.detect(),
    published: () => engine.published(),
    cached: () => engine.cached(),
    room: () => engine.room(),
    load: (onProgress) => engine.load(onProgress),
    send: (messages, opts) => engine.send(messages, opts),
    unload: () => engine.unload(),
    remove: () => engine.remove(),
  },
  { info: assistantInfo, me, chat: assistantChat },
);
