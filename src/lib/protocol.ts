// Mensagens entre a página e o worker do Pyodide.
import type { Step } from "./types";

export type Request = { id: number } & (
  | { cmd: "setInterrupt"; buffer: SharedArrayBuffer }
  | { cmd: "load"; data: ArrayBuffer; filename: string; sheet?: string | null }
  | { cmd: "preview"; steps: Step[] }
  | { cmd: "target"; target: string; problem?: string | null; positive?: string | null }
  | { cmd: "train"; target: string; problem?: string | null; positive?: string | null; budget: number }
  | { cmd: "explain"; row: Record<string, unknown> }
  | { cmd: "predict"; data: ArrayBuffer; filename: string; sheet?: string | null }
  | { cmd: "export"; kind: "script" | "notebook" | "recipe" }
  | { cmd: "mlflow"; includeModel: boolean }
);

export type WorkerMessage =
  | { type: "status"; stage: string; message: string; seconds?: number }
  | { type: "progress"; id: number; event: TrainEvent }
  | { type: "result"; id: number; ok: true; result: unknown }
  | { type: "result"; id: number; ok: false; error: string };

export type TrainEvent =
  | {
      type: "start";
      problem: string;
      metric: string;
      rows: number;
      cv_rows: number;
      holdout_rows: number;
      folds: number;
      budget: number;
      candidates: { key: string; label: string }[];
    }
  | { type: "candidate"; key: string; label: string; status: string; folds: number[]; score?: number; std?: number; reason?: string; seconds?: number }
  | { type: "fold"; key: string; fold: number; score: number; seconds: number }
  | { type: "phase"; phase: "evaluate" | "refit"; key: string }
  | { type: "done"; best: string };
