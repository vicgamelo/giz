// Cliente do worker: cada chamada vira uma Promise; eventos de treino e de status chegam por callback.
import type { Request, TrainEvent, WorkerMessage } from "./protocol";

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (e: TrainEvent) => void };
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
export type Call = DistributiveOmit<Request, "id">;

export class Engine {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private interrupt: Uint8Array | null = null;
  onStatus: (stage: string, message: string, seconds?: number) => void = () => {};

  constructor() {
    this.worker = new Worker(new URL("../worker.ts", import.meta.url), { type: "module", name: "giz-python" });
    this.worker.onmessage = (ev: MessageEvent<WorkerMessage>) => this.receive(ev.data);
    this.worker.onerror = (ev) => this.onStatus("error", `O worker do Python caiu: ${ev.message}`);
    if (globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined") {
      const buffer = new SharedArrayBuffer(1);
      this.interrupt = new Uint8Array(buffer);
      void this.call({ cmd: "setInterrupt", buffer });
    }
  }

  get canStop() {
    return this.interrupt !== null;
  }

  /** Interrompe o Python no meio do treino (SIGINT = 2). O AutoML devolve o que já terminou. */
  stop() {
    if (this.interrupt) Atomics.store(this.interrupt, 0, 2);
  }

  call<T = unknown>(req: Call, onProgress?: (e: TrainEvent) => void, transfer: Transferable[] = []): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ ...req, id }, transfer);
    });
  }

  private receive(msg: WorkerMessage) {
    if (msg.type === "status") {
      this.onStatus(msg.stage, msg.message, msg.seconds);
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    if (msg.type === "progress") {
      p.onProgress?.(msg.event);
      return;
    }
    this.pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error));
  }
}
