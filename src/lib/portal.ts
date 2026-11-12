import type { OnlineInfo, OnlinePayload, OnlineReply } from "./assistant/store.svelte";

// Ligação com o portal do vgmelo.tech (login, cota e repasse): registro no MLflow e assistente online.
// O navegador manda só resumos; nunca fala com o MLflow nem com o provedor do assistente, e não guarda credencial.

export const PORTAL = (import.meta.env.VITE_PORTAL_URL as string | undefined) ?? "https://vgmelo.tech";

export type Quota = { limit: number; used: number; remaining: number };

export type Me = {
  user: { id: string; name?: string | null; email?: string | null } | null;
  quotas: Record<string, Quota>;
  /** Teto diário de tokens da pessoa no vgmelo.tech, dividido entre as demos que usam LLM. */
  tokens?: Quota;
  budget_exhausted?: boolean;
};

export type MLRunResult = { run_id: string; experiment_id: string; experiment: string; artifacts: string[] };

export type MyRun = {
  run_id: string;
  name: string;
  status: string;
  start_time: number;
  model?: string;
  target?: string;
  metrics: Record<string, number>;
};

/** Erro do portal com o motivo que ele deu ("daily_quota", "model_changed"…), para quem precisa reagir a ele. */
export class PortalError extends Error {
  constructor(
    message: string,
    public reason?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, messages: Record<string, string> = MESSAGES): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`${PORTAL}${path}`, { ...init, credentials: "include", mode: "cors" });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new PortalError("Não consegui falar com o portal do vgmelo.tech.");
  }
  let data: unknown;
  try {
    data = await resp.json();
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e; // cancelado enquanto o corpo chegava
    // 200 sem JSON (um proxy ou portal cativo no caminho) não é uma resposta do portal.
    if (resp.ok) throw new PortalError("O portal devolveu uma resposta que não entendi.");
    data = {};
  }
  if (!resp.ok) {
    // 4xx do FastAPI: {"detail": "motivo"}; 429 do portal: {"reason": "daily_quota", "retry_at": ...}
    const d = (data ?? {}) as { detail?: unknown; reason?: string };
    const reason = typeof d.detail === "string" ? d.detail : d.reason;
    throw new PortalError(messages[reason ?? ""] ?? `O portal respondeu ${resp.status}.`, reason);
  }
  return data as T;
}

const MESSAGES: Record<string, string> = {
  login_required: "Entre no vgmelo.tech para registrar no MLflow.",
  daily_quota: "A cota de registros de hoje acabou. Ela volta à meia-noite.",
  mlflow_off: "O MLflow está desligado agora.",
  upstream_unavailable: "O MLflow não respondeu. Tente de novo em instantes.",
  model_not_skops: "O modelo precisa estar no formato skops.",
  model_too_large: "O modelo passou de 4 MB; registre sem ele.",
  body_too_large: "O pacote passou do limite do portal; registre sem o modelo.",
  bad_origin: "O portal recusou a origem desta página.",
};

export const me = () => request<Me>("/api/me");

export const logRun = (payload: unknown) =>
  request<MLRunResult>("/api/ml/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

export const myRuns = () => request<{ runs: MyRun[] }>("/api/ml/runs");

// --- assistente online ------------------------------------------------------------------------------------------


const ASSISTANT_MESSAGES: Record<string, string> = {
  login_required: "Entre no vgmelo.tech para usar o assistente online.",
  daily_quota: "Suas perguntas de hoje acabaram. Elas voltam à meia-noite.",
  user_tokens: "Seu teto de uso de hoje no vgmelo.tech acabou. Ele volta à meia-noite.",
  global_budget: "O teto de uso de hoje do vgmelo.tech acabou. Ele volta à meia-noite.",
  rate_limited: "Muitas perguntas em pouco tempo. Espere um pouco e tente de novo.",
  busy: "O assistente online está ocupado. Tente de novo em instantes.",
  assistant_off: "O assistente online está desligado agora.",
  upstream_unavailable: "O provedor do assistente não respondeu. Tente de novo em instantes.",
  empty_reply: "O provedor devolveu uma resposta vazia. Tente de novo.",
  body_too_large: "A pergunta e o resumo passaram do limite do portal.",
  model_changed: "O assistente online mudou de modelo.",
  assistant_daily: "O assistente online atingiu o limite de uso de hoje. Tente de novo mais tarde.",
  invalid_request: "O portal não aceitou o pedido do assistente.",
  bad_origin: "O portal recusou a origem desta página.",
};

/** Qual provedor e modelo o portal usa. Não leva nada da pessoa além do cookie de sessão. */
export const assistantInfo = () => request<OnlineInfo>("/api/ml/assistant", {}, ASSISTANT_MESSAGES);

export async function assistantChat(payload: OnlinePayload, signal?: AbortSignal): Promise<OnlineReply> {
  const res = await request<OnlineReply>(
    "/api/ml/assistant",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal },
    ASSISTANT_MESSAGES,
  );
  if (typeof res?.reply !== "string") throw new PortalError("O portal devolveu uma resposta que não entendi.");
  return res;
}
