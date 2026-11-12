// Mensagens entre a página e o worker do assistente local (src/llm.worker.ts).
import type { ChatMessage } from "./prompt";

export type LlmRequest = { id: number } & (
  | { cmd: "cached" }
  | { cmd: "load" }
  | { cmd: "chat"; messages: ChatMessage[]; maxTokens: number }
  | { cmd: "stop" }
  | { cmd: "unload" }
  | { cmd: "remove" }
);

/** Erros que a tela trata de um jeito próprio; o resto é "error". */
export type LlmErrorCode = "context" | "integrity" | "storage" | "device" | "network" | "cancelled" | "error";

export type LlmMessage =
  | { type: "progress"; id: number; progress: number; text: string }
  | { type: "token"; id: number; delta: string }
  | { type: "result"; id: number; ok: true; result: unknown }
  | { type: "result"; id: number; ok: false; code: LlmErrorCode; error: string };

export type ChatResult = { text: string; promptTokens: number | null; completionTokens: number | null };
