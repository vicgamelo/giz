// Motor local: um modelo de linguagem pequeno rodando neste navegador (WebLLM + WebGPU) num Web Worker.
// Os pesos vêm do próprio domínio (pasta /llm, ver scripts/vendor-llm.mjs) e ficam no cache do navegador depois do
// primeiro download; a conversa não sai do aparelho. O worker só nasce quando a pessoa abre o assistente.
import type { ChatResult, LlmErrorCode, LlmMessage, LlmRequest } from "./llm-protocol";
import type { ChatMessage } from "./prompt";
import { detectGpu, type GpuCheck } from "./webgpu";

// Do scripts/llm-lock.json, pelo vite.config.ts: só o nome, o tamanho e a pasta entram no pacote da página (a lista
// de arquivos com os SHA-256 fica no worker, que é quem confere).
declare const __LLM_MODEL__: { id: string; bytes: number; dir: string };
export const LOCAL_MODEL = __LLM_MODEL__;

export class LlmError extends Error {
  constructor(
    public code: LlmErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type Pending = {
  resolve: (v: never) => void;
  reject: (e: Error) => void;
  onProgress?: (p: { progress: number; text: string }) => void;
  onToken?: (delta: string) => void;
};
type Call = LlmRequest extends infer R ? (R extends unknown ? Omit<R, "id"> : never) : never;

export class LocalEngine {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();

  private call<T>(req: Call, handlers: Omit<Pending, "resolve" | "reject"> = {}): Promise<T> {
    if (!this.worker) {
      this.worker = new Worker(new URL("../../llm.worker.ts", import.meta.url), { type: "module", name: "giz-llm" });
      this.worker.onmessage = (ev: MessageEvent<LlmMessage>) => this.receive(ev.data);
      this.worker.onerror = (ev) => this.crash(`O worker do assistente caiu${ev.message ? `: ${ev.message}` : "."}`);
    }
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: never) => void, reject, ...handlers });
      this.worker!.postMessage({ ...req, id });
    });
  }

  private receive(msg: LlmMessage) {
    const p = this.pending.get(msg.id);
    if (!p) return;
    if (msg.type === "progress") p.onProgress?.({ progress: msg.progress, text: msg.text });
    else if (msg.type === "token") p.onToken?.(msg.delta);
    else {
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result as never);
      else p.reject(new LlmError(msg.code, msg.error));
    }
  }

  private crash(message: string) {
    for (const p of this.pending.values()) p.reject(new LlmError("error", message));
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }

  detect(): Promise<GpuCheck> {
    return detectGpu();
  }

  /** O servidor publicou os pesos? (um deploy sem a pasta /llm responde 404) */
  async published(): Promise<boolean> {
    try {
      const resp = await fetch(`${LOCAL_MODEL.dir}resolve/main/mlc-chat-config.json`, { cache: "no-store" });
      if (!resp.ok) return false;
      const data = await resp.json();
      return typeof data === "object" && data !== null;
    } catch {
      return false;
    }
  }

  cached(): Promise<boolean> {
    return this.call<boolean>({ cmd: "cached" });
  }

  /** Espaço livre que o navegador dá a este site, em bytes (null: o navegador não informa). */
  async room(): Promise<number | null> {
    try {
      const est = await navigator.storage.estimate();
      return est.quota != null && est.usage != null ? est.quota - est.usage : null;
    } catch {
      return null;
    }
  }

  async load(onProgress: (p: { progress: number; text: string }) => void): Promise<void> {
    await this.call({ cmd: "load" }, { onProgress });
  }

  async send(messages: ChatMessage[], opts: { signal: AbortSignal; onToken: (delta: string) => void; maxTokens: number }): Promise<ChatResult> {
    const stop = () => void this.call({ cmd: "stop" }).catch(() => {});
    opts.signal.addEventListener("abort", stop, { once: true });
    try {
      return await this.call<ChatResult>({ cmd: "chat", messages, maxTokens: opts.maxTokens }, { onToken: opts.onToken });
    } finally {
      opts.signal.removeEventListener("abort", stop);
    }
  }

  /** Tira o modelo da memória da placa de vídeo (os pesos continuam no cache). Também cancela um download. */
  async unload(): Promise<void> {
    if (this.worker) await this.call({ cmd: "unload" });
  }

  /** Apaga os pesos do cache deste navegador. */
  async remove(): Promise<void> {
    await this.call({ cmd: "remove" });
  }
}
