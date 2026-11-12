/// <reference lib="webworker" />
// Worker do assistente local: o WebLLM (modelo de linguagem em WebGPU) roda aqui, fora da thread da página, e é o
// único lugar que importa a biblioteca. Os pesos vêm do próprio domínio (/llm/…) e ficam no Cache API do navegador;
// nada é enviado a servidor nenhum.
import { deleteModelAllInfoInCache, hasModelInCache, MLCEngine, prebuiltAppConfig, type AppConfig } from "@mlc-ai/web-llm";
import lock from "../scripts/llm-lock.json";
import { classify, sri, staleModelUrls } from "./lib/assistant/llm-errors";
import type { ChatResult, LlmMessage, LlmRequest } from "./lib/assistant/llm-protocol";
import { modelDir } from "./lib/assistant/model";
import { visibleText } from "./lib/assistant/think";

declare const self: DedicatedWorkerGlobalScope;

const post = (msg: LlmMessage) => self.postMessage(msg);

const sha = (name: string) => lock.files.find((f) => f.name === name)!.sha256;

function appConfig(): AppConfig {
  // Parte do registro do WebLLM (janela de contexto, tokens de parada) e troca só de onde vêm os arquivos.
  const base = prebuiltAppConfig.model_list.find((m) => m.model_id === lock.id);
  if (!base) throw new Error(`O WebLLM não conhece o modelo ${lock.id}.`);
  // URLs absolutas: o WebLLM faz `new URL(model)` sem base e só guarda a lib wasm no cache se a URL começar com http.
  const dir = `${self.location.origin}${modelDir(lock)}`;
  return {
    model_list: [
      {
        ...base,
        model: dir,
        model_lib: `${dir}model.wasm`,
        // O navegador confere a configuração, a lib wasm e o tokenizer. Os pesos (params_shard_*) o WebLLM não
        // confere; quem garante que são os do lock é o `vendor-llm --check` na pasta publicada.
        integrity: {
          config: sri(sha("mlc-chat-config.json")),
          model_lib: sri(lock.lib.sha256),
          tokenizer: { "tokenizer.json": sri(sha("tokenizer.json")) },
          onFailure: "error",
        },
      },
    ],
  };
}

let engine: MLCEngine | null = null;
let loaded = false;

/** Trocou de modelo ou de revisão: os pesos antigos ficariam esquecidos no cache (~1 GB). Apaga o que não é o atual. */
async function dropOldModels() {
  for (const name of await caches.keys()) {
    if (!name.startsWith("webllm/")) continue;
    const cache = await caches.open(name);
    const urls = (await cache.keys()).map((req) => req.url);
    for (const url of staleModelUrls(urls, modelDir(lock))) await cache.delete(url);
  }
}

let loadingId: number | null = null;
// A pessoa clicou em Cancelar durante o download. O WebLLM às vezes rejeita o `reload` com o motivo do abort e às
// vezes volta normalmente; nos dois casos o resultado para a tela é "cancelado", nunca "pronto".
let cancelling = false;

async function load(id: number) {
  if (loaded) return true;
  engine ??= new MLCEngine({ appConfig: appConfig() });
  engine.setInitProgressCallback((r) => {
    if (loadingId !== null) post({ type: "progress", id: loadingId, progress: r.progress, text: r.text });
  });
  loadingId = id;
  cancelling = false;
  try {
    await engine.reload(lock.id);
    if (cancelling) throw new Error("cancelado");
    loaded = true;
    void dropOldModels().catch(() => {});
    return true;
  } catch (e) {
    const { code } = classify(e, cancelling);
    // Arquivo que não bate com o lock (deploy pela metade, proxy no caminho): o WebLLM já gravou no cache antes de
    // conferir. Apaga tudo para a próxima tentativa baixar de novo.
    if (code === "integrity") await deleteModelAllInfoInCache(lock.id, appConfig()).catch(() => {});
    throw Object.assign(new Error(String((e as Error)?.message ?? e)), { cancelled: cancelling, name: (e as Error)?.name });
  } finally {
    loadingId = null;
    cancelling = false;
  }
}

async function chat(req: Extract<LlmRequest, { cmd: "chat" }>): Promise<ChatResult> {
  if (!engine || !loaded) throw new Error("O modelo local ainda não foi carregado.");
  const stream = await engine.chat.completions.create({
    messages: req.messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.2,
    // Modelo pequeno entra em laço repetindo a mesma frase; a penalidade segura isso.
    frequency_penalty: 0.5,
    presence_penalty: 0,
    max_tokens: req.maxTokens,
    extra_body: { enable_thinking: false },
  });
  let raw = "";
  let text = "";
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;
  for await (const chunk of stream) {
    raw += chunk.choices[0]?.delta?.content ?? "";
    const visible = visibleText(raw);
    if (visible.length > text.length) {
      post({ type: "token", id: req.id, delta: visible.slice(text.length) });
      text = visible;
    }
    if (chunk.usage) {
      promptTokens = chunk.usage.prompt_tokens;
      completionTokens = chunk.usage.completion_tokens;
    }
  }
  return { text, promptTokens, completionTokens };
}

async function handle(req: LlmRequest): Promise<unknown> {
  switch (req.cmd) {
    case "cached":
      return hasModelInCache(lock.id, appConfig());
    case "load":
      return load(req.id);
    case "chat":
      return chat(req);
    case "stop":
      engine?.interruptGenerate();
      return true;
    case "unload":
      // Também cancela um download em andamento (o `reload` aborta).
      if (loadingId !== null) cancelling = true;
      await engine?.unload();
      loaded = false;
      return true;
    case "remove":
      await engine?.unload();
      loaded = false;
      await deleteModelAllInfoInCache(lock.id, appConfig());
      return true;
  }
}

self.onmessage = async (ev: MessageEvent<LlmRequest>) => {
  const req = ev.data;
  try {
    post({ type: "result", id: req.id, ok: true, result: await handle(req) });
  } catch (e) {
    post({ type: "result", id: req.id, ok: false, ...classify(e, (e as { cancelled?: boolean })?.cancelled === true) });
  }
};
