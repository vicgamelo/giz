/// <reference types="node" />
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
// @ts-expect-error: módulo .mjs de script, sem tipos
import { headers } from "../scripts/headers.mjs";
import lock from "../scripts/llm-lock.json";
// @ts-expect-error: módulo .mjs de script, sem tipos
import { llmDir, llmFiles, webllmModelVersion } from "../scripts/vendor-llm.mjs";
// @ts-expect-error: módulo .mjs de script, sem tipos
import { createHandler, resolveUnder } from "../scripts/serve-dist.mjs";
import { megabytes } from "../src/lib/assistant/format";
import { classify, sri, staleModelUrls } from "../src/lib/assistant/llm-errors";
import { modelDir } from "../src/lib/assistant/model";
import { detectGpu, GPU_MESSAGES } from "../src/lib/assistant/webgpu";
import { assistantChat, assistantInfo, me, PORTAL } from "../src/lib/portal";

describe("WebGPU", () => {
  const adapter = (f16: boolean) => ({ features: { has: (name: string) => f16 && name === "shader-f16" } });

  it("navegador sem WebGPU", async () => {
    expect(await detectGpu(undefined)).toEqual({ ok: false, reason: "no_webgpu", message: GPU_MESSAGES.no_webgpu });
  });

  it("WebGPU sem placa utilizável", async () => {
    expect(await detectGpu({ requestAdapter: async () => null })).toMatchObject({ ok: false, reason: "no_adapter" });
  });

  it("placa sem shader-f16 (os pesos são de 16 bits)", async () => {
    expect(await detectGpu({ requestAdapter: async () => adapter(false) })).toMatchObject({ ok: false, reason: "no_f16" });
  });

  it("consulta que falha não derruba o painel", async () => {
    const gpu = { requestAdapter: () => Promise.reject(new Error("GPU process crashed")) };
    expect(await detectGpu(gpu)).toMatchObject({ ok: false, reason: "error" });
  });

  it("tudo certo", async () => {
    expect(await detectGpu({ requestAdapter: async () => adapter(true) })).toEqual({ ok: true });
  });
});

describe("modelo local: lock e endereços", () => {
  const webllm = JSON.parse(readFileSync(new URL("../node_modules/@mlc-ai/web-llm/package.json", import.meta.url), "utf8")).version as string;
  const lib = readFileSync(new URL("../node_modules/@mlc-ai/web-llm/lib/index.js", import.meta.url), "utf8");

  it("o modelo do lock existe no WebLLM instalado, e a lib wasm é a compilada para essa versão", () => {
    expect(lib).toContain(`model_id: "${lock.id}"`);
    // a pasta das libs é a constante `modelVersion` do WebLLM, não a versão do pacote (hoje coincidem)
    expect(webllmModelVersion()).toMatch(/^v\d+_\d+_\d+\/base$/);
    expect(lock.lib.path.startsWith(`web-llm-models/${webllmModelVersion()}/`)).toBe(true);
    expect(webllm).toBe("0.2.87");
    expect(lock.repo).toBe(`mlc-ai/${lock.id}`);
  });

  it("revisão e commit fixos, cada arquivo com tamanho e SHA-256", () => {
    expect(lock.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(lock.lib.commit).toMatch(/^[0-9a-f]{40}$/);
    const files = llmFiles(lock) as { name: string; size: number; sha256: string; url: string; path: string }[];
    for (const f of files) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.size).toBeGreaterThan(0);
      expect(f.url).toMatch(new RegExp(`^https://(huggingface\\.co/${lock.repo}/resolve/${lock.revision}|raw\\.githubusercontent\\.com/mlc-ai/binary-mlc-llm-libs/${lock.lib.commit})/`));
    }
    expect(files.map((f) => f.name)).toEqual(expect.arrayContaining(["mlc-chat-config.json", "tensor-cache.json", "tokenizer.json", "model.wasm"]));
    expect(files.filter((f) => f.name.startsWith("params_shard_")).length).toBeGreaterThan(5);
    expect(lock.bytes).toBe(files.reduce((n, f) => n + f.size, 0));
  });

  it("a página e o script de publicação usam a mesma pasta, que muda com a revisão", () => {
    expect(modelDir(lock)).toBe(`/${llmDir(lock)}/`);
    expect(modelDir({ ...lock, revision: "f".repeat(40) })).not.toBe(modelDir(lock));
    expect(modelDir({ ...lock, lib: { commit: "e".repeat(40) } })).not.toBe(modelDir(lock));
  });

  it("tamanho em pt-BR", () => {
    expect(megabytes(1_079_540_000)).toBe("1,1 GB");
    expect(megabytes(880_000_000)).toBe("880 MB");
  });
});

describe("cliente do portal para o assistente", () => {
  afterEach(() => vi.unstubAllGlobals());
  const EMPTY = { provider: "X", model: "m", context: "x", messages: [] };

  function stub(status: number, body: unknown) {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    });
    return calls;
  }

  it("pergunta: POST com o cookie de sessão e só o resumo e as mensagens no corpo", async () => {
    const calls = stub(200, { reply: "ok", model: "m", quota: { limit: 20, used: 1, remaining: 19 } });
    const payload = { provider: "X", model: "m", context: "PASSO ATUAL: 2 de 7", messages: [{ role: "user" as const, content: "oi" }] };
    expect(await assistantChat(payload)).toMatchObject({ reply: "ok" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${PORTAL}/api/ml/assistant`);
    expect(calls[0].init).toMatchObject({ method: "POST", credentials: "include", mode: "cors" });
    expect(JSON.parse(calls[0].init.body as string)).toEqual(payload);
  });

  it("consulta do provedor: GET sem corpo", async () => {
    const calls = stub(200, { enabled: true, provider: "X", model: "m", policy_url: null });
    expect(await assistantInfo()).toMatchObject({ provider: "X" });
    expect(calls[0].init.method).toBeUndefined();
    expect(calls[0].init.body).toBeUndefined();
  });

  it.each([
    [401, { detail: "login_required" }, "Entre no vgmelo.tech para usar o assistente online."],
    [429, { reason: "daily_quota", retry_at: "2026-11-13T03:00:00+00:00" }, "Suas perguntas de hoje acabaram. Elas voltam à meia-noite."],
    [429, { reason: "user_tokens" }, "Seu teto de uso de hoje no vgmelo.tech acabou. Ele volta à meia-noite."],
    [429, { reason: "global_budget" }, "O teto de uso de hoje do vgmelo.tech acabou. Ele volta à meia-noite."],
    [429, { reason: "rate_limited" }, "Muitas perguntas em pouco tempo. Espere um pouco e tente de novo."],
    [429, { reason: "busy" }, "O assistente online está ocupado. Tente de novo em instantes."],
    [503, { detail: "assistant_off" }, "O assistente online está desligado agora."],
    [502, { detail: "upstream_unavailable" }, "O provedor do assistente não respondeu. Tente de novo em instantes."],
    [502, { detail: "empty_reply" }, "O provedor devolveu uma resposta vazia. Tente de novo."],
    [413, { detail: "body_too_large" }, "A pergunta e o resumo passaram do limite do portal."],
    [409, { detail: "model_changed" }, "O assistente online mudou de modelo."],
    [429, { reason: "assistant_daily" }, "O assistente online atingiu o limite de uso de hoje. Tente de novo mais tarde."],
    [422, { detail: "invalid_request" }, "O portal não aceitou o pedido do assistente."],
    [500, {}, "O portal respondeu 500."],
  ])("erro %i %j vira mensagem em português", async (status, body, message) => {
    stub(status, body);
    await expect(assistantChat(EMPTY)).rejects.toThrow(message);
  });

  it("o motivo do portal vai junto no erro, para quem precisa reagir a ele", async () => {
    stub(409, { detail: "model_changed" });
    await expect(assistantChat(EMPTY)).rejects.toMatchObject({ reason: "model_changed" });
    stub(429, { reason: "daily_quota" });
    await expect(assistantChat(EMPTY)).rejects.toMatchObject({ reason: "daily_quota" });
  });

  it("200 que não é uma resposta do portal (HTML de um proxy, JSON sem `reply`) vira erro, não resposta vazia", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>login do wifi</html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(assistantChat(EMPTY)).rejects.toThrow("O portal devolveu uma resposta que não entendi.");
    stub(200, { ok: true });
    await expect(assistantChat(EMPTY)).rejects.toThrow("O portal devolveu uma resposta que não entendi.");
    stub(200, { reply: 42 });
    await expect(assistantChat(EMPTY)).rejects.toThrow("O portal devolveu uma resposta que não entendi.");
    // vale para qualquer chamada: um HTML com 200 não pode virar "portal sem assistente" nem "sem login"
    vi.stubGlobal("fetch", async () => new Response("<html>login do wifi</html>", { status: 200 }));
    await expect(assistantInfo()).rejects.toThrow("O portal devolveu uma resposta que não entendi.");
    await expect(me()).rejects.toThrow("O portal devolveu uma resposta que não entendi.");
  });

  it("cancelado enquanto o corpo chegava: sai como cancelamento, não como resposta vazia", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, json: () => Promise.reject(new DOMException("aborted", "AbortError")) }));
    await expect(assistantChat(EMPTY)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("as mensagens do MLflow continuam as do MLflow", async () => {
    stub(401, { detail: "login_required" });
    await expect(me()).rejects.toThrow("Entre no vgmelo.tech para registrar no MLflow.");
  });

  it("portal fora do ar (ou origem recusada, que chega sem CORS) e pedido cancelado", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(assistantChat(EMPTY)).rejects.toThrow("Não consegui falar com o portal do vgmelo.tech.");
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(assistantChat(EMPTY)).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("worker do assistente: pedaços puros", () => {
  it("SRI a partir do SHA-256 em hexadecimal", () => {
    // sha256("") em hex e em base64
    expect(sri("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")).toBe("sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=");
  });

  it.each([
    [{ name: "ContextWindowSizeExceededError", message: "x" }, "context"],
    [new Error("Prompt tokens exceed context window size"), "context"],
    [{ name: "IntegrityError", message: "hash mismatch" }, "integrity"],
    [{ name: "QuotaExceededError", message: "x" }, "storage"],
    [{ name: "DeviceLostError", message: "x" }, "device"],
    [new Error("Aborted(OOM). Build with -sASSERTIONS for more info."), "device"],
    [new Error("GPUDevice: Device is lost"), "device"],
    [new TypeError("Failed to fetch"), "network"],
    [new Error("RuntimeError: abort(undefined)"), "error"],
    [new Error("qualquer outra coisa"), "error"],
    ["Engine.unload() is called.", "error"],
  ] as const)("erro %o vira %s", (e, code) => {
    expect(classify(e).code).toBe(code);
  });

  it("cancelado só quando a pessoa pediu (o texto 'abort' sozinho não basta)", () => {
    expect(classify(new Error("Aborted(OOM)"), false).code).toBe("device");
    expect(classify({ name: "AbortError", message: "The user aborted a request." }, false).code).toBe("error");
    expect(classify("Engine.unload() is called.", true)).toEqual({ code: "cancelled", error: "Engine.unload() is called." });
    expect(classify(new Error("cancelado"), true).code).toBe("cancelled");
  });

  it("limpeza do cache: só o que é de outro modelo ou de outra revisão", () => {
    const current = "/llm/Qwen3-1.7B-q4f16_1-MLC/80b3abcec6-146ed9cd4b/";
    const urls = [
      `https://ml.vgmelo.tech${current}resolve/main/params_shard_0.bin`,
      `https://ml.vgmelo.tech${current}model.wasm`,
      "https://ml.vgmelo.tech/llm/Qwen3.5-2B-q4f16_1-MLC/dd74e9c8a2-146ed9cd4b/resolve/main/params_shard_0.bin",
      "https://ml.vgmelo.tech/llm/Qwen3-1.7B-q4f16_1-MLC/0000000000-146ed9cd4b/model.wasm",
      "https://ml.vgmelo.tech/pyodide/v314.0.7/pyodide.asm.wasm",
    ];
    expect(staleModelUrls(urls, current)).toEqual([urls[2], urls[3]]);
  });
});

describe("servidor local do build (o mesmo roteamento do Caddy)", () => {
  let dir: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "giz-serve-"));
    for (const d of ["dist/assets", "dist/pyodide", "llm/llm/modelo/rev/resolve/main", "llm-vizinha", "dist-vizinha"]) mkdirSync(join(dir, d), { recursive: true });
    writeFileSync(join(dir, "dist/index.html"), "<html>giz</html>");
    writeFileSync(join(dir, "dist/assets/app.js"), "1");
    writeFileSync(join(dir, "llm/llm/modelo/rev/resolve/main/mlc-chat-config.json"), '{"model_type":"x"}');
    writeFileSync(join(dir, "llm/segredo.txt"), "fora de /llm/");
    writeFileSync(join(dir, "llm-vizinha/x.bin"), "pasta irmã");
    writeFileSync(join(dir, "dist-vizinha/x.txt"), "pasta irmã");
    server = createServer(createHandler({ root: join(dir, "dist"), llmRoot: join(dir, "llm") }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  });

  // pedido cru, para o caminho chegar ao servidor sem o cliente normalizar os ".."
  function raw(path: string): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(`${base}`, { path, method: "GET" }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode!, body, headers: res.headers }));
      });
      req.on("error", reject);
      req.end();
    });
  }

  it("página e rotas da página caem no index.html, com a CSP de produção", async () => {
    for (const path of ["/", "/qualquer/rota"]) {
      const r = await raw(path);
      expect([r.status, r.body, r.headers["cache-control"]]).toEqual([200, "<html>giz</html>", "no-cache"]);
      expect(r.headers["content-security-policy"]).toBe(headers()["Content-Security-Policy"]);
      expect(r.headers["cross-origin-embedder-policy"]).toBe("require-corp");
    }
  });

  it("arquivo do build com cache imutável; pesos do assistente saem da outra pasta, sem cache", async () => {
    const asset = await raw("/assets/app.js");
    expect([asset.status, asset.headers["cache-control"]]).toEqual([200, "public, max-age=31536000, immutable"]);
    const cfg = await raw("/llm/modelo/rev/resolve/main/mlc-chat-config.json");
    expect([cfg.status, cfg.body, cfg.headers["cache-control"], cfg.headers["content-type"]]).toEqual([200, '{"model_type":"x"}', "no-store", "application/json"]);
  });

  it.each(["/llm/modelo/rev/resolve/main/params_shard_0.bin", "/assets/nao-existe.js", "/pyodide/v1/numpy.whl", "/llm/"])(
    "%s que falta responde 404 sem cache, nunca o index.html",
    async (path) => {
      const r = await raw(path);
      expect([r.status, r.headers["cache-control"]]).toEqual([404, "no-store"]);
      expect(r.body).not.toContain("giz");
    },
  );

  it.each([
    "/llm/../segredo.txt",
    "/llm/%2e%2e/segredo.txt",
    "/llm/..%2f..%2fllm-vizinha/x.bin",
    "/../dist-vizinha/x.txt",
    "/..%2fdist-vizinha/x.txt",
    "/%2e%2e/%2e%2e/%2e%2e/etc/passwd",
    "/assets/%00",
    "/%E0%A4%A",
  ])("caminho %s não sai da pasta nem derruba o servidor", async (path) => {
    const r = await raw(path);
    expect(r.body).not.toMatch(/fora de|pasta irmã|root:/);
    expect([200, 400, 404]).toContain(r.status);
    if (r.status === 200) expect(r.body).toBe("<html>giz</html>");
    expect((await raw("/")).status).toBe(200); // segue de pé
  });

  it("resolveUnder: dentro da pasta, pasta irmã com o mesmo prefixo e URL inválida", () => {
    const root = join(dir, "dist");
    expect(resolveUnder(root, "/assets/app.js")).toBe(join(root, "assets/app.js"));
    expect(resolveUnder(root, "/")).toBe(root);
    expect(resolveUnder(root, "/../dist-vizinha/x.txt")).toBeNull();
    expect(resolveUnder(root, "/%E0%A4%A")).toBeNull();
    expect(resolveUnder(root, "/a%00b")).toBeNull();
  });
});
