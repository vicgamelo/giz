// Ligação com o MLflow pelo portal do vgmelo.tech (login, cota e repasse pela rede interna).
// O navegador manda só o resumo do experimento; nunca fala com o MLflow nem guarda credencial dele.

export const PORTAL = (import.meta.env.VITE_PORTAL_URL as string | undefined) ?? "https://vgmelo.tech";

export type Me = {
  user: { id: string; name?: string | null; email?: string | null } | null;
  quotas: Record<string, { limit: number; used: number; remaining: number }>;
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`${PORTAL}${path}`, { ...init, credentials: "include", mode: "cors" });
  } catch {
    throw new Error("Não consegui falar com o portal do vgmelo.tech.");
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    // 4xx do FastAPI: {"detail": "motivo"}; 429 do portal: {"reason": "daily_quota", "retry_at": ...}
    const d = data as { detail?: unknown; reason?: string };
    const reason = typeof d.detail === "string" ? d.detail : d.reason;
    throw new Error(MESSAGES[reason ?? ""] ?? `O portal respondeu ${resp.status}.`);
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
