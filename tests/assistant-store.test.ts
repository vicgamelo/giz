import { describe, expect, it } from "vitest";
import type { Action } from "../src/lib/assistant/actions";
import type { Snapshot } from "../src/lib/assistant/context";
import type { ChatResult, LlmErrorCode } from "../src/lib/assistant/llm-protocol";
import type { ChatMessage } from "../src/lib/assistant/prompt";
import {
  Assistant,
  LOCAL_CONTEXT_CHARS,
  ONLINE_CONTEXT_CHARS,
  type Account,
  type Host,
  type LocalPort,
  type OnlineInfo,
  type OnlinePayload,
  type OnlinePort,
  type OnlineReply,
  type Quota,
} from "../src/lib/assistant/store.svelte";
import { GPU_MESSAGES, type GpuCheck } from "../src/lib/assistant/webgpu";
import { fixture, snapshot } from "./helpers";

const f = fixture("credito-problemas");
const fresh = { profile: f.rawProfile, steps: [], reports: [], result: null, target: null, targetInfo: null, batch: null, candidates: [] };
const coded = (code: LlmErrorCode, message: string) => Object.assign(new Error(message), { code });

class FakeHost implements Host {
  state: Snapshot = snapshot(f, "profile", fresh);
  applied: Action[] = [];
  snapshot() {
    return this.state;
  }
  apply(action: Action) {
    this.applied.push(action);
    if (action.kind === "fix") this.state = { ...this.state, steps: [...this.state.steps, action.step] };
    if (action.kind === "target") this.state = { ...this.state, target: action.column };
    if (action.kind === "goto") this.state = { ...this.state, current: action.step };
  }
}

type Call = { resolve: (text: string) => void; reject: (e: Error) => void; token: (t: string) => void; signal: AbortSignal; messages: ChatMessage[]; maxTokens: number };

class FakeLocal implements LocalPort {
  bytes = 1_000_000_000;
  gpu: GpuCheck = { ok: true };
  isPublished = true;
  isCached = false;
  free: number | null = 50_000_000_000;
  loadError: Error | null = null;
  holdLoad = false;
  loads = 0;
  unloads = 0;
  removes = 0;
  calls: Call[] = [];
  /** Erros que as próximas chamadas de send devolvem na hora (antes de qualquer token). */
  failNext: Error[] = [];
  private cancelLoad: (() => void) | null = null;
  removeError: Error | null = null;
  detect = async () => this.gpu;
  published = async () => this.isPublished;
  cached = async () => this.isCached;
  room = async () => this.free;
  async load(onProgress: (p: { progress: number; text: string }) => void) {
    this.loads++;
    onProgress({ progress: 0.5, text: "metade" });
    if (this.holdLoad) await new Promise<void>((_, reject) => (this.cancelLoad = () => reject(coded("cancelled", "aborted"))));
    if (this.loadError) throw this.loadError;
    this.isCached = true;
  }
  send(messages: ChatMessage[], opts: { signal: AbortSignal; onToken: (d: string) => void; maxTokens: number }) {
    return new Promise<ChatResult>((resolve, reject) => {
      const call: Call = {
        messages,
        maxTokens: opts.maxTokens,
        signal: opts.signal,
        token: (t) => {
          text += t;
          opts.onToken(t);
        },
        resolve: (t) => resolve({ text: t, promptTokens: 1000, completionTokens: 50 }),
        reject,
      };
      let text = "";
      this.calls.push(call);
      const fail = this.failNext.shift();
      if (fail) return reject(fail);
      // Como o WebLLM: ao parar, a geração termina e devolve o que já saiu.
      opts.signal.addEventListener("abort", () => resolve({ text, promptTokens: null, completionTokens: null }));
    });
  }
  async unload() {
    this.unloads++;
    this.cancelLoad?.();
  }
  async remove() {
    this.removes++;
    if (this.removeError) throw this.removeError;
    this.isCached = false;
  }
}

class FakeOnline implements OnlinePort {
  details: OnlineInfo = { enabled: true, provider: "Provedor X (plano grátis)", model: "modelo-x", policy_url: "https://exemplo.com/politica" };
  user: Account["user"] = { name: "Ana" };
  quota: Quota = { limit: 20, used: 3, remaining: 17 };
  tokens: Quota = { limit: 50_000, used: 1000, remaining: 49_000 };
  budgetExhausted = false;
  infoCalls = 0;
  meCalls = 0;
  meError: Error | null = null;
  chats: OnlinePayload[] = [];
  refused: OnlinePayload[] = [];
  next: Partial<OnlineReply> | Error = { reply: "ok" };
  async info() {
    this.infoCalls++;
    return this.details;
  }
  async me(): Promise<Account> {
    this.meCalls++;
    if (this.meError) throw this.meError;
    return { user: this.user, quotas: { assistant: this.quota, ml: { limit: 20, used: 0, remaining: 20 } }, tokens: this.tokens, budget_exhausted: this.budgetExhausted };
  }
  async chat(payload: OnlinePayload, signal: AbortSignal): Promise<OnlineReply> {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    // Como o portal: se o que a pessoa aceitou não é o que está em uso, recusa sem repassar nada.
    if (payload.provider !== this.details.provider || payload.model !== this.details.model) {
      this.refused.push(payload);
      throw Object.assign(new Error("O assistente online mudou de modelo."), { reason: "model_changed" });
    }
    this.chats.push(payload);
    if (this.next instanceof Error) throw this.next;
    this.quota = { ...this.quota, used: this.quota.used + 1, remaining: this.quota.remaining - 1 };
    return { reply: "ok", model: this.details.model, quota: this.quota, ...this.next };
  }
}

function setup() {
  const host = new FakeHost();
  const local = new FakeLocal();
  const online = new FakeOnline();
  return { host, local, online, a: new Assistant(host, local, online) };
}

async function readyLocal() {
  const ctx = setup();
  await ctx.a.checkLocal();
  await ctx.a.loadLocal();
  return ctx;
}

async function readyOnline() {
  const ctx = setup();
  ctx.a.choose("online");
  await tick();
  ctx.a.agree();
  return ctx;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("motor local: do zero até pronto", () => {
  it.each([
    ["no_webgpu", GPU_MESSAGES.no_webgpu],
    ["no_adapter", GPU_MESSAGES.no_adapter],
    ["no_f16", GPU_MESSAGES.no_f16],
  ] as const)("sem WebGPU (%s): explica e não deixa baixar", async (reason, message) => {
    const { a, local } = setup();
    local.gpu = { ok: false, reason, message };
    await a.checkLocal();
    expect(a.local).toEqual({ state: "unsupported", message });
    await a.loadLocal();
    expect(local.loads).toBe(0);
    expect(a.canAsk).toBe(false);
  });

  it("servidor sem os pesos publicados", async () => {
    const { a, local } = setup();
    local.isPublished = false;
    await a.checkLocal();
    expect(a.local.state).toBe("unpublished");
    await a.loadLocal();
    expect(local.loads).toBe(0);
  });

  it("pesos no servidor: 'available'; já no cache do navegador: 'cached'; nada baixa sem o clique", async () => {
    const one = setup();
    await one.a.checkLocal();
    expect(one.a.local.state).toBe("available");
    expect(one.local.loads).toBe(0);
    const two = setup();
    two.local.isCached = true;
    await two.a.checkLocal();
    expect(two.a.local.state).toBe("cached");
    expect(two.local.loads).toBe(0);
  });

  it("duas checagens ao mesmo tempo esperam a mesma resposta", async () => {
    const { a } = setup();
    const first = a.checkLocal();
    await a.checkLocal();
    expect(a.local.state).toBe("available");
    await first;
  });

  it("sem espaço no navegador: avisa antes de baixar; com o modelo já em cache não confere espaço", async () => {
    const { a, local } = setup();
    local.free = 200_000_000;
    await a.checkLocal();
    await a.loadLocal();
    expect(local.loads).toBe(0);
    expect(a.local).toMatchObject({ state: "error" });
    expect((a.local as { message: string }).message).toContain("só libera 200 MB");
    local.free = null; // navegador que não informa: tenta
    await a.loadLocal();
    expect(a.local.state).toBe("ready");
    const again = setup();
    again.local.isCached = true;
    again.local.free = 0;
    await again.a.checkLocal();
    await again.a.loadLocal();
    expect(again.a.local.state).toBe("ready");
  });

  it("download interrompido vira erro e dá para tentar de novo", async () => {
    const { a, local } = setup();
    await a.checkLocal();
    local.loadError = new Error("Failed to fetch");
    await a.loadLocal();
    expect(a.local).toEqual({ state: "error", message: "Não consegui carregar o modelo. (Failed to fetch)" });
    expect(a.canAsk).toBe(false);
    local.loadError = null;
    await a.loadLocal();
    expect(a.local.state).toBe("ready");
    expect(local.loads).toBe(2);
    expect(a.canAsk).toBe(true);
  });

  it.each([
    ["integrity", "Os arquivos do modelo chegaram diferentes do esperado"],
    ["storage", "O navegador não deu espaço para guardar o modelo"],
    ["device", "A placa de vídeo não deu conta de carregar o modelo"],
    ["network", "A conexão caiu no meio do download"],
  ] as const)("falha de %s ao carregar tem explicação própria", async (code, text) => {
    const { a, local } = setup();
    await a.checkLocal();
    local.loadError = coded(code, "detalhe em inglês");
    await a.loadLocal();
    expect((a.local as { message: string }).message).toContain(text);
    expect((a.local as { message: string }).message).not.toContain("detalhe em inglês");
  });

  it("dois cliques seguidos em Baixar carregam uma vez só", async () => {
    const { a, local } = setup();
    await a.checkLocal();
    const first = a.loadLocal();
    const second = a.loadLocal();
    expect(a.local.state).toBe("loading"); // o estado muda antes de qualquer espera
    await Promise.all([first, second]);
    expect(local.loads).toBe(1);
    expect(a.local.state).toBe("ready");
  });

  it("não deu para apagar: o modelo fica onde estava e o recado não vira 'tentar de novo' que baixa", async () => {
    const { a, local } = await readyLocal();
    local.removeError = new Error("cache ocupado");
    await a.removeLocal();
    expect(a.local.state).toBe("cached");
    expect(a.localNote).toBe("Não consegui apagar o modelo. (cache ocupado)");
    expect(local.loads).toBe(1);
    local.removeError = null;
    await a.removeLocal(); // do estado "cached" também dá para apagar
    expect(a.local.state).toBe("available");
    expect(a.localNote).toBeNull();
  });

  it("desligando: o estado sai de 'pronto' antes de a memória ser liberada, e ninguém pergunta nesse meio", async () => {
    const { a, local } = await readyLocal();
    const unloading = a.unloadLocal();
    expect(a.canAsk).toBe(false);
    await a.ask("oi");
    expect(local.calls).toEqual([]);
    await unloading;
  });

  it("cancelar o download volta ao botão de baixar, sem erro", async () => {
    const { a, local } = setup();
    await a.checkLocal();
    local.holdLoad = true;
    const loading = a.loadLocal();
    await tick();
    expect(a.local).toEqual({ state: "loading", progress: 0.5, text: "metade" });
    await a.cancelLoad();
    await loading;
    expect(local.unloads).toBe(1);
    expect(a.local.state).toBe("available");
  });

  it("desligar tira da memória e mantém no cache; apagar tira do navegador", async () => {
    const { a, local } = await readyLocal();
    await a.unloadLocal();
    expect(local.unloads).toBe(1);
    expect(a.local.state).toBe("cached");
    expect(a.canAsk).toBe(false);
    await a.loadLocal();
    await a.removeLocal();
    expect(local.removes).toBe(1);
    expect(a.local.state).toBe("available");
  });

  it("não desliga nem apaga no meio de uma resposta", async () => {
    const { a, local } = await readyLocal();
    void a.ask("oi");
    await a.unloadLocal();
    await a.removeLocal();
    expect(local.unloads + local.removes).toBe(0);
    expect(a.local.state).toBe("ready");
  });
});

describe("conversa no motor local", () => {
  it("a resposta chega aos poucos; no fim os códigos viram ações", async () => {
    const { a, local } = await readyLocal();
    const asking = a.ask("  o que eu faço primeiro?  ");
    expect(a.generating).toBe(true);
    expect(a.canAsk).toBe(false);
    expect(a.messages.map((m) => [m.role, m.text, !!m.pending])).toEqual([
      ["user", "o que eu faço primeiro?", false],
      ["assistant", "", true],
    ]);
    const call = local.calls[0];
    call.token("Tire as repetidas ");
    expect(a.messages[1].text).toBe("Tire as repetidas ");
    call.token("[A1].");
    call.resolve("Tire as repetidas [A1].");
    await asking;
    expect(a.generating).toBe(false);
    expect(a.messages[1]).toMatchObject({ pending: false, text: "Tire as repetidas “Adicionar à receita: Remover repetidas”." });
    expect(a.messages[1].actions.map((x) => x.code)).toEqual(["A1"]);
  });

  it("o modelo recebe a apresentação, o resumo compacto do passo e as regras; nunca os valores das linhas", async () => {
    const { a, local } = await readyLocal();
    void a.ask("explique os alertas");
    const [system, user] = local.calls[0].messages;
    expect(system.role).toBe("system");
    expect(system.content).toContain("PASSO ATUAL: 2 de 7, Perfil dos dados");
    expect(system.content).toContain("15 linhas repetidas. Correção: [A1]");
    expect(system.content).toContain("COLUNAS COM ALERTA");
    expect(system.content.trimEnd().endsWith("[alvo: nome exato da coluna].")).toBe(true);
    expect(system.content).not.toContain("EXEMPLOS");
    expect(system.content).not.toContain(String(f.rawProfile.columns[0].sample[0]));
    expect(system.content.length).toBeLessThan(LOCAL_CONTEXT_CHARS + 1200);
    expect(user).toEqual({ role: "user", content: "explique os alertas" });
    expect(local.calls[0].maxTokens).toBe(350);
    expect(a.preview("explique os alertas").context).toBe(system.content.split(":\n").slice(1).join(":\n").split("\n\nREGRAS DA RESPOSTA")[0]);
  });

  it("'incluir exemplos' é escolha da pessoa", async () => {
    const { a, local } = await readyLocal();
    a.examples = true;
    void a.ask("e as linhas?");
    expect(local.calls[0].messages[0].content).toContain("EXEMPLOS (primeiras linhas, incluídas a pedido da pessoa)");
  });

  it("a pergunta seguinte, no mesmo passo, leva só a última troca", async () => {
    const { a, local } = await readyLocal();
    for (const [q, r] of [["um", "resposta um"], ["dois", "resposta dois"]]) {
      const asking = a.ask(q);
      local.calls.at(-1)!.resolve(r);
      await asking;
    }
    void a.ask("e por quê?");
    expect(local.calls[2].messages.slice(1)).toEqual([
      { role: "user", content: "dois" },
      { role: "assistant", content: "resposta dois" },
      { role: "user", content: "e por quê?" },
    ]);
  });

  it.each([
    ["mudou de passo", { current: "recipe" as const }],
    ["o treino começou", { current: "profile" as const, training: true }],
    ["o treino terminou", { current: "profile" as const, result: f.result }],
    ["o alvo mudou", { current: "profile" as const, target: "idade" }],
  ])("%s: a resposta anterior falava de outra tela e não vai junto; o resumo é o novo", async (_name, change) => {
    const { a, local, host } = await readyLocal();
    const first = a.ask("o que está acontecendo?");
    local.calls[0].resolve("resposta sobre a tela antiga");
    await first;
    host.state = { ...host.state, ...change };
    void a.ask("e agora?");
    expect(local.calls[1].messages.slice(1)).toEqual([{ role: "user", content: "e agora?" }]);
    if (change.current === "recipe") expect(local.calls[1].messages[0].content).toContain("PASSO ATUAL: 3 de 7, Receita de tratamento");
    expect(a.messages).toHaveLength(4); // na tela a conversa continua inteira
  });

  it("janela estourou: tenta sem histórico e depois com meio resumo; se nem assim, explica", async () => {
    const { a, local } = await readyLocal();
    const first = a.ask("oi");
    local.calls[0].resolve("olá");
    await first;
    local.failNext = [coded("context", "Prompt tokens exceed context window size"), coded("context", "idem")];
    const asking = a.ask("e agora?");
    await tick();
    expect(local.calls).toHaveLength(4);
    expect(local.calls[1].messages).toHaveLength(4);
    expect(local.calls[2].messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(local.calls[3].messages[0].content.length).toBeLessThan(local.calls[2].messages[0].content.length);
    local.calls[3].resolve("resposta curta");
    await asking;
    expect(a.messages.at(-1)).toMatchObject({ text: "resposta curta", pending: false });
    expect(a.messages.at(-1)!.error).toBeUndefined();

    local.failNext = [1, 2, 3].map(() => coded("context", "idem"));
    await a.ask("de novo");
    expect(a.messages.at(-1)!.error).toBe("A pergunta e o resumo não couberam na memória do modelo local. Tente uma pergunta mais curta.");
    expect(a.generating).toBe(false);
  });

  it("o modelo não devolveu texto (bloco <think> que não fechou, por exemplo): avisa em vez de balão vazio", async () => {
    const { a, local } = await readyLocal();
    const asking = a.ask("oi");
    local.calls[0].resolve("   ");
    await asking;
    expect(a.messages[1]).toMatchObject({ error: "O modelo não devolveu texto. Tente de novo.", pending: false });
    expect(a.generating).toBe(false);
  });

  it("código de ação que o modelo não viu no resumo não vira botão", async () => {
    const { a, local, host } = await readyLocal();
    host.state = snapshot(f, "train"); // o Giz tem correções do perfil para oferecer, mas o resumo do treino não as mostra
    expect(a.suggestions.some((s) => s.code === "A3" && s.kind === "fix")).toBe(true);
    const asking = a.ask("e agora?");
    expect(local.calls[0].messages[0].content).not.toContain("[A3]");
    local.calls[0].resolve("Faça [A3] e depois [A9].");
    await asking;
    expect(a.messages[1].actions.map((x) => x.kind)).toEqual(["goto"]);
    expect(a.messages[1].text).toBe("Faça e depois “Ir para o passo 5: Avaliação”.");
  });

  it("pergunta vazia, pergunta enorme e pergunta enquanto gera", async () => {
    const { a, local } = await readyLocal();
    await a.ask("   ");
    expect(a.messages).toEqual([]);
    void a.ask("z".repeat(5000));
    expect(a.messages[0].text).toHaveLength(1000);
    void a.ask("outra");
    expect(local.calls).toHaveLength(1);
    expect(a.messages).toHaveLength(2);
  });

  it("Parar: fica o que já saiu, marcado como parado, sem erro", async () => {
    const { a, local } = await readyLocal();
    const asking = a.ask("explique");
    local.calls[0].token("Os alertas ");
    a.stop();
    await asking;
    expect(local.calls[0].signal.aborted).toBe(true);
    expect(a.messages[1]).toMatchObject({ text: "Os alertas ", stopped: true, pending: false });
    expect(a.messages[1].error).toBeUndefined();
    expect(a.generating).toBe(false);
    expect(a.canAsk).toBe(true);
  });

  it("falha do modelo: mostra o erro, sem ações, e a mensagem não entra no histórico seguinte", async () => {
    const { a, local } = await readyLocal();
    const asking = a.ask("explique");
    local.calls[0].token("Use [A1]");
    local.calls[0].reject(new Error("falhou no meio"));
    await asking;
    expect(a.messages[1]).toMatchObject({ error: "falhou no meio", pending: false, actions: [] });
    expect(a.generating).toBe(false);
    void a.ask("de novo");
    expect(local.calls[1].messages.slice(1)).toEqual([{ role: "user", content: "de novo" }]);
  });

  it("placa de vídeo perdida no meio: erro na mensagem e o motor volta a pedir para carregar", async () => {
    const { a, local } = await readyLocal();
    local.failNext = [coded("device", "GPUDevice lost")];
    await a.ask("explique");
    expect(a.messages[1].error).toBe("A placa de vídeo parou de responder. Carregue o assistente de novo.");
    expect(a.local.state).toBe("error");
    expect(a.canAsk).toBe(false);
    await a.loadLocal();
    expect(a.canAsk).toBe(true);
  });

  it("não troca de motor enquanto gera", async () => {
    const { a } = await readyLocal();
    void a.ask("explique");
    a.choose("online");
    expect(a.kind).toBe("local");
  });
});

describe("ações: nada roda sem o clique, e o clique confere de novo", () => {
  async function answered(reply: string) {
    const ctx = await readyLocal();
    const asking = ctx.a.ask("o que fazer?");
    ctx.local.calls[0].resolve(reply);
    await asking;
    return { ...ctx, msg: ctx.a.messages[1] };
  }

  it("a resposta com ação não executa nada sozinha", async () => {
    const { host } = await answered("Faça [A1] e [alvo: inadimplente].");
    expect(host.applied).toEqual([]);
  });

  it("clique aplica uma vez só, e o botão passa a 'feito' pelo estado da tela", async () => {
    const { a, host, msg } = await answered("Faça [A1].");
    expect(a.actionState(msg, msg.actions[0])).toEqual({ done: false, note: null });
    a.apply(msg.id, "A1");
    a.apply(msg.id, "A1");
    expect(host.applied.map((x) => x.kind)).toEqual(["fix"]);
    expect(a.actionState(msg, msg.actions[0])).toEqual({ done: true, note: null });
  });

  it("desfez o passo: o botão volta a valer (sem recado velho) e aplica de novo", async () => {
    const { a, host, msg } = await answered("Faça [A1].");
    a.apply(msg.id, "A1");
    a.apply(msg.id, "A1"); // clique a mais com o passo já na receita: não deixa recado para depois
    host.state = { ...host.state, steps: [] };
    expect(a.actionState(msg, msg.actions[0])).toEqual({ done: false, note: null });
    a.apply(msg.id, "A1");
    expect(host.applied).toHaveLength(2);
  });

  it("o passo entrou na receita por outro caminho: o botão já aparece feito e o clique não duplica", async () => {
    const { a, host, msg } = await answered("Faça [A1].");
    host.state = { ...host.state, steps: [{ op: "drop_duplicates" }] };
    expect(a.actionState(msg, msg.actions[0]).done).toBe(true);
    a.apply(msg.id, "A1");
    expect(host.applied).toEqual([]);
  });

  it("a receita mudou e a coluna da correção saiu: não aplica e diz por quê", async () => {
    const { a, host, msg } = await answered("Faça [A2].");
    host.state = { ...host.state, profile: { ...f.rawProfile, columns: f.rawProfile.columns.filter((c) => c.name !== "id_contrato") } };
    a.apply(msg.id, "A2");
    expect(host.applied).toEqual([]);
    expect(a.actionState(msg, msg.actions[0])).toEqual({ done: false, note: "Esse passo não vale mais: a coluna mudou ou saiu dos dados." });
  });

  it("alvo sugerido: clique escolhe; se a coluna sumiu, não", async () => {
    const one = await answered("Preveja [alvo: inadimplente].");
    one.a.apply(one.msg.id, "alvo:inadimplente");
    expect(one.host.applied).toMatchObject([{ kind: "target", column: "inadimplente" }]);
    expect(one.a.actionState(one.msg, one.msg.actions[0]).done).toBe(true);
    const two = await answered("Preveja [alvo: inadimplente].");
    two.host.state = snapshot(fixture("casas"), "profile");
    two.a.apply(two.msg.id, "alvo:inadimplente");
    expect(two.host.applied).toEqual([]);
    expect(two.a.actionState(two.msg, two.msg.actions[0]).note).toBe("Essa coluna não existe mais.");
  });

  it.each([{ training: true }, { busy: true }, { previewing: true }])("com %o o clique espera; depois vale", async (over) => {
    const { a, host, msg } = await answered("Faça [A2].");
    const before = host.state;
    host.state = { ...before, ...over };
    a.apply(msg.id, "A2");
    expect(host.applied).toEqual([]);
    expect(a.actionState(msg, msg.actions[0]).note).toMatch(/^Espere/);
    host.state = before;
    a.apply(msg.id, "A2");
    expect(host.applied).toHaveLength(1);
    expect(a.actionState(msg, msg.actions[0])).toEqual({ done: true, note: null });
  });

  it("dois cliques seguidos em ações diferentes: a segunda espera a prévia da primeira", async () => {
    const { a, host, msg } = await answered("Faça [A1] e [A2].");
    a.apply(msg.id, "A1");
    host.state = { ...host.state, previewing: true }; // o que a tela faz ao receber o passo
    a.apply(msg.id, "A2");
    expect(host.applied).toHaveLength(1);
    host.state = { ...host.state, previewing: false };
    a.apply(msg.id, "A2");
    expect(host.applied).toHaveLength(2);
  });

  it("código que não está na mensagem é ignorado", async () => {
    const { a, host, msg } = await answered("Faça [A1].");
    a.apply(msg.id, "A2");
    a.apply(999, "A1");
    expect(host.applied).toEqual([]);
  });

  it("sugestões do Giz não dependem do modelo, somem depois de aplicadas e passam pela mesma conferência", async () => {
    const { a, host } = setup();
    const before = a.suggestions.map((s) => s.code);
    expect(before).toEqual(["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9"]);
    const dedupe = a.suggestions[0];
    a.applySuggestion(dedupe);
    expect(host.applied).toEqual([dedupe]);
    expect(a.suggestions.some((s) => s.kind === "fix" && s.step.op === "drop_duplicates")).toBe(false);
    host.state = { ...host.state, training: true };
    a.applySuggestion({ kind: "fix", code: "A6", label: "x", step: { op: "impute", columns: ["idade"], strategy: "median" } });
    expect(host.applied).toHaveLength(1);
    expect(a.suggestionNote).toBe("Espere o treino terminar.");
  });
});

describe("modo online: consentimento, login e cota", () => {
  it("escolher o modo só pergunta ao portal quem é o provedor e se há login; nenhuma pergunta sai antes do 'Concordo'", async () => {
    const { a, online } = setup();
    a.choose("online");
    await tick();
    expect(online.infoCalls).toBe(1);
    expect(a.online).toBe("needs_consent");
    expect(a.provider).toEqual({ provider: "Provedor X (plano grátis)", model: "modelo-x", policy_url: "https://exemplo.com/politica" });
    expect(a.canAsk).toBe(false);
    expect(a.sendsData).toBe(false);
    await a.ask("oi");
    expect(online.chats).toEqual([]);
    expect(a.messages).toEqual([]);
  });

  it("concordou: pronto, com a conta e os limites", async () => {
    const { a } = await readyOnline();
    expect(a.online).toBe("ready");
    expect(a.consent).toEqual({ provider: "Provedor X (plano grátis)", model: "modelo-x", policy_url: "https://exemplo.com/politica" });
    expect(a.account).toEqual({ name: "Ana" });
    expect(a.quota).toEqual({ limit: 20, used: 3, remaining: 17 });
    expect(a.sendsData).toBe(true);
    expect(a.canAsk).toBe(true);
  });

  it("sessão caiu com o consentimento dado: o selo não diz que algo está saindo", async () => {
    const { a, online } = await readyOnline();
    expect(a.sendsData).toBe(true);
    online.user = null;
    await a.checkOnline();
    expect(a.online).toBe("logged_out");
    expect(a.sendsData).toBe(false);
    online.user = { name: "Ana" };
    await a.checkOnline(); // entrou de novo: mesmo provedor, mesmo arquivo, o que aceitou continua valendo
    expect(a.online).toBe("ready");
    expect(a.sendsData).toBe(true);
  });

  it("sem login: não há o que concordar nem como perguntar", async () => {
    const { a, online } = setup();
    online.user = null;
    a.choose("online");
    await tick();
    expect(a.online).toBe("logged_out");
    a.agree();
    expect(a.consent).toBeNull();
    await a.ask("oi");
    expect(online.chats).toEqual([]);
    online.user = { email: "ana@exemplo.com" };
    await a.checkOnline(); // "Já entrei"
    expect(a.online).toBe("needs_consent");
    expect(a.account).toEqual({ name: "ana@exemplo.com" });
  });

  it("assistente desligado no portal", async () => {
    const { a, online } = setup();
    online.details = { ...online.details, enabled: false };
    a.choose("online");
    await tick();
    expect(a.online).toBe("off");
    expect(a.canAsk).toBe(false);
  });

  it("portal fora do ar na checagem", async () => {
    const { a, online } = setup();
    online.meError = new Error("Não consegui falar com o portal do vgmelo.tech.");
    a.choose("online");
    await tick();
    expect(a.online).toBe("error");
    expect(a.onlineError).toBe("Não consegui falar com o portal do vgmelo.tech.");
    expect(a.canAsk).toBe(false);
  });

  it.each([
    ["cota de perguntas zerada", { quota: { limit: 20, used: 20, remaining: 0 } }, "Suas perguntas de hoje acabaram. Elas voltam à meia-noite."],
    ["teto de tokens da pessoa zerado", { tokens: { limit: 50_000, used: 50_000, remaining: 0 } }, "Seu teto de uso de hoje no vgmelo.tech acabou. Ele volta à meia-noite."],
    ["teto global zerado", { budgetExhausted: true }, "O teto de uso de hoje do vgmelo.tech acabou. Ele volta à meia-noite."],
  ])("%s: avisa antes de enviar e não envia", async (_name, change, message) => {
    const { a, online } = setup();
    Object.assign(online, change);
    a.choose("online");
    await tick();
    a.agree();
    expect(a.onlineBlocked).toBe(message);
    expect(a.canAsk).toBe(false);
    await a.ask("oi");
    expect(online.chats).toEqual([]);
  });

  it("o que sai é exatamente o que a tela mostrou antes de enviar: resumo magro e a pergunta", async () => {
    const { a, online } = await readyOnline();
    a.examples = true; // ligado no local; no online não vale
    const shown = a.preview("explique os alertas");
    online.next = { reply: "Comece por [A1]." };
    await a.ask("explique os alertas");
    expect(online.chats).toEqual([shown]);
    expect(Object.keys(shown).sort()).toEqual(["context", "messages", "model", "provider"]);
    expect(shown).toMatchObject({ provider: "Provedor X (plano grátis)", model: "modelo-x" }); // o que a pessoa aceitou
    expect(shown.messages).toEqual([{ role: "user", content: "explique os alertas" }]);
    expect(shown.context).toContain("ALERTAS DO PERFIL:");
    expect(shown.context).toContain("ARQUIVO: CSV");
    expect(shown.context).not.toContain("credito-com-problemas");
    expect(shown.context).not.toMatch(/mín |máx |EXEMPLOS/);
    expect(shown.context).not.toContain(String(f.rawProfile.columns[0].sample[0]));
    expect(shown.context.length).toBeLessThanOrEqual(ONLINE_CONTEXT_CHARS);
    expect(a.messages[1]).toMatchObject({ text: "Comece por “Adicionar à receita: Remover repetidas”." });
    expect(a.messages[1].actions).toHaveLength(1);
    expect(a.quota).toEqual({ limit: 20, used: 4, remaining: 16 });
  });

  it("histórico que sai: no máximo 6 mensagens de até 2.000 caracteres", async () => {
    const { a, online } = await readyOnline();
    for (let i = 0; i < 5; i++) {
      online.next = { reply: `resposta ${i} ${"y".repeat(3000)}` };
      await a.ask(`pergunta ${i}`);
    }
    const sent = online.chats.at(-1)!;
    expect(sent.messages.length).toBeLessThanOrEqual(6);
    expect(sent.messages[0].role).toBe("user");
    expect(sent.messages.at(-1)).toEqual({ role: "user", content: "pergunta 4" });
    expect(Math.max(...sent.messages.map((m) => m.content.length))).toBeLessThanOrEqual(2000);
  });

  it("trocar de motor começa conversa nova: o que foi dito ao modelo local não vai para o portal", async () => {
    const { a, online, local } = await readyLocal();
    a.examples = true;
    const first = a.ask("oi");
    local.calls[0].resolve("a primeira linha é C-100962");
    await first;
    a.choose("online");
    expect(a.messages).toEqual([]);
    await tick();
    a.agree();
    await a.ask("e agora?");
    expect(online.chats[0].messages).toEqual([{ role: "user", content: "e agora?" }]);
    expect(JSON.stringify(online.chats)).not.toContain("C-100962");
  });

  it("erro do portal no meio (cota, sessão caiu): mostra o motivo e confere a conta de novo", async () => {
    const { a, online } = await readyOnline();
    online.next = new Error("Suas perguntas de hoje acabaram. Elas voltam à meia-noite.");
    online.quota = { limit: 20, used: 20, remaining: 0 };
    await a.ask("oi");
    expect(a.messages[1]).toMatchObject({ error: "Suas perguntas de hoje acabaram. Elas voltam à meia-noite.", actions: [] });
    await tick();
    expect(online.meCalls).toBe(2);
    expect(a.generating).toBe(false);
    expect(a.canAsk).toBe(false);
    expect(a.onlineBlocked).toBe("Suas perguntas de hoje acabaram. Elas voltam à meia-noite.");
    online.user = null; // a sessão expirou
    online.quota = { limit: 20, used: 0, remaining: 20 };
    await a.checkOnline();
    expect(a.online).toBe("logged_out");
    expect(a.canAsk).toBe(false);
  });

  it("Parar no online descarta a resposta sem marcar erro", async () => {
    const { a, online } = await readyOnline();
    let release!: (r: OnlineReply) => void;
    online.chat = (payload, signal) =>
      new Promise((resolve, reject) => {
        online.chats.push(payload);
        release = resolve;
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const asking = a.ask("oi");
    online.quota = { limit: 20, used: 4, remaining: 16 }; // o portal não cancela a pergunta: ela foi contada
    a.stop();
    await asking;
    expect(a.messages[1]).toMatchObject({ text: "", stopped: true, pending: false });
    expect(a.messages[1].error).toBeUndefined();
    // a cota mostrada acompanha, sem a tela sair de "pronto"
    await tick();
    expect(online.meCalls).toBe(2);
    expect(a.quota).toEqual({ limit: 20, used: 4, remaining: 16 });
    expect(a.online).toBe("ready");
    void release;
  });

  it("resposta online com o raciocínio do modelo embutido: o bloco <think> não aparece", async () => {
    const { a, online } = await readyOnline();
    online.next = { reply: "<think>raciocínio</think>Resposta." };
    await a.ask("oi");
    expect(a.messages[1].text).toBe("Resposta.");
  });

  it.each([
    ["modelo", { model: "modelo-y" }],
    ["provedor", { provider: "Outro provedor" }],
  ])("o portal trocou de %s depois do 'Concordo': a pergunta é recusada lá, nada é repassado, e o consentimento é pedido de novo", async (_what, change) => {
    const { a, online } = await readyOnline();
    online.details = { ...online.details, ...change };
    await a.ask("oi");
    expect(online.chats).toEqual([]);
    expect(online.refused).toHaveLength(1);
    expect(a.messages[1].error).toBe("O assistente online mudou de modelo. Confira para onde o resumo vai e concorde de novo.");
    await tick();
    expect(a.consent).toBeNull();
    expect(a.online).toBe("needs_consent");
    expect(a.provider).toMatchObject(change);
    expect(a.sendsData).toBe(false);
    expect(a.consentNote).toMatch(/outro provedor ou modelo. Nada foi enviado/); // a tela diz por que perguntou de novo
    a.agree();
    expect(a.consentNote).toBeNull();
    await a.ask("de novo");
    expect(online.chats).toHaveLength(1);
    expect(online.chats[0]).toMatchObject({ provider: online.details.provider, model: online.details.model });
  });

  it("recusa por modelo trocado derruba o consentimento mesmo se a conferência seguinte ainda mostrar o antigo", async () => {
    const { a, online } = await readyOnline();
    online.chat = async () => {
      throw Object.assign(new Error("O assistente online mudou de modelo."), { reason: "model_changed" });
    };
    await a.ask("oi");
    await tick();
    expect(a.consent).toBeNull();
    expect(a.online).toBe("needs_consent");
    expect(a.sendsData).toBe(false);
  });

  it("o pedido leva o provedor e o modelo que a pessoa aceitou, não o que a tela soube depois", async () => {
    const { a } = await readyOnline();
    a.provider = { provider: "Outro provedor", model: "modelo-y", policy_url: null };
    expect(a.preview("oi")).toMatchObject({ provider: "Provedor X (plano grátis)", model: "modelo-x" });
  });

  it("resposta do portal sem o campo esperado: erro na mensagem, e a tela não fica presa em 'gerando'", async () => {
    const { a, online } = await readyOnline();
    online.next = { reply: undefined as unknown as string };
    await a.ask("oi");
    expect(a.messages[1]).toMatchObject({ error: "O portal devolveu uma resposta que não entendi.", pending: false, text: "" });
    expect(a.generating).toBe(false);
    online.next = { reply: "agora sim" };
    await tick();
    await a.ask("de novo");
    expect(a.messages[3].text).toBe("agora sim");
  });

  it("enquanto a prévia da receita não volta, a pergunta online espera (o perfil na tela é o de antes)", async () => {
    const { a, online, host } = await readyOnline();
    host.state = { ...host.state, previewing: true };
    expect(a.onlineWaiting).toBe(true);
    expect(a.canAsk).toBe(false);
    await a.ask("oi");
    expect(online.chats).toEqual([]);
    host.state = { ...host.state, previewing: false };
    await a.ask("oi");
    expect(online.chats).toHaveLength(1);
  });

  it("o histórico que sai também passa pela máscara do one-hot (o rótulo de uma ação antiga leva o nome da coluna)", async () => {
    const { a, online, host } = setup();
    const oh = fixture("credito-onehot");
    const alert = { code: "constant", column: "finalidade_carro novo", severity: "warn" as const, message: "'finalidade_carro novo' tem um valor só.", fix: { op: "drop_columns", columns: ["finalidade_carro novo"] } };
    host.state = snapshot(oh, "profile", { profile: { ...oh.profile, alerts: [alert] }, result: null });
    a.choose("online");
    await tick();
    a.agree();
    online.next = { reply: "Apague a coluna [A1]." };
    await a.ask("o que fazer?");
    expect(a.messages[1].text).toContain("finalidade_carro novo"); // na tela da pessoa, o nome de verdade
    online.next = { reply: "ok" };
    await a.ask("por quê?");
    const sent = JSON.stringify(online.chats[1]);
    expect(sent).not.toContain("carro novo");
    expect(online.chats[1].messages[1].content).toBe("Apague a coluna “Adicionar à receita: Apagar colunas (finalidade_*)”.");
    expect(a.preview("x").messages[1].content).not.toContain("carro novo");
  });

  it("emoji cortado no meio não sai como caractere quebrado", async () => {
    const { a, online } = await readyOnline();
    online.next = { reply: `a${"😀".repeat(1500)}` }; // o corte em 2.000 cairia no meio de um emoji
    await a.ask("oi");
    await a.ask(`${"b".repeat(999)}😀`); // e o da pergunta, em 1.000, também
    expect(a.messages[2].text).toBe("b".repeat(999));
    for (const m of online.chats[1].messages) {
      expect(m.content.length).toBeLessThanOrEqual(2000);
      expect(m.content).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
    }
  });

  it("link da política que não é https não vira link", async () => {
    const { a, online } = setup();
    online.details = { ...online.details, policy_url: "javascript:alert(1)" };
    a.choose("online");
    await tick();
    expect(a.provider?.policy_url).toBeNull();
    online.details = { ...online.details, policy_url: "http://exemplo.com/politica" };
    await a.checkOnline();
    expect(a.provider?.policy_url).toBeNull();
  });

  it("duas conferências ao mesmo tempo: vale a que começou por último", async () => {
    const { a, online } = setup();
    let releaseFirst!: () => void;
    const original = online.me.bind(online);
    let calls = 0;
    online.me = async () => {
      if (++calls === 1) {
        await new Promise<void>((r) => (releaseFirst = r));
        return { user: null, quotas: {} }; // resposta velha: "sem login"
      }
      return original();
    };
    a.kind = "online";
    const first = a.checkOnline();
    await tick();
    const second = a.checkOnline();
    await second;
    expect(a.online).toBe("needs_consent");
    releaseFirst();
    await first;
    expect(a.online).toBe("needs_consent"); // a resposta velha não sobrescreve
  });

  it("o portal trocou de provedor entre uma checagem e outra (mesmo com a sessão caída)", async () => {
    const { a, online } = await readyOnline();
    online.details = { ...online.details, provider: "Outro provedor" };
    online.user = null;
    await a.checkOnline();
    expect(a.consent).toBeNull();
    expect(a.online).toBe("logged_out");
    online.user = { name: "Ana" };
    await a.checkOnline();
    expect(a.online).toBe("needs_consent");
  });

  it("sem consentimento registrado nada sai, mesmo que o resto do estado diga 'pronto'", async () => {
    const { a, online } = await readyOnline();
    a.consent = null;
    expect(a.canAsk).toBe(false);
    expect(a.sendsData).toBe(false);
    await a.ask("oi");
    expect(online.chats).toEqual([]);
  });

  it("'parar de enviar' desfaz o consentimento", async () => {
    const { a, online } = await readyOnline();
    a.revoke();
    expect(a.sendsData).toBe(false);
    expect(a.online).toBe("needs_consent");
    await a.ask("oi");
    expect(online.chats).toEqual([]);
  });

  it("voltar para o local: o selo volta e nada vai ao portal", async () => {
    const { a, online, local } = await readyOnline();
    a.choose("local");
    await a.checkLocal();
    await a.loadLocal();
    expect(a.sendsData).toBe(false);
    void a.ask("oi");
    expect(local.calls).toHaveLength(1);
    expect(online.chats).toEqual([]);
  });
});

describe("arquivo ou aba nova", () => {
  it("no meio de uma resposta local: para e limpa a conversa", async () => {
    const { a, local } = await readyLocal();
    const asking = a.ask("explique");
    local.calls[0].token("Os alertas ");
    a.reset();
    await asking;
    expect(local.calls[0].signal.aborted).toBe(true);
    expect(a.messages).toEqual([]);
    expect(a.generating).toBe(false);
    expect(a.local.state).toBe("ready");
  });

  it("no meio de uma pergunta online: a resposta que chegar depois é descartada e o consentimento cai", async () => {
    const { a, online } = await readyOnline();
    let release!: (r: OnlineReply) => void;
    online.chat = (payload, signal) =>
      new Promise((resolve, reject) => {
        online.chats.push(payload);
        release = resolve;
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const asking = a.ask("oi");
    a.reset();
    await asking;
    release({ reply: "atrasada", model: "modelo-x", quota: online.quota });
    expect(a.messages).toEqual([]);
    expect(a.generating).toBe(false);
    expect(a.consent).toBeNull();
    expect(a.online).toBe("needs_consent");
  });

  it("no online: o consentimento era para os dados anteriores; pede de novo antes de enviar qualquer coisa", async () => {
    const { a, online, host } = await readyOnline();
    await a.ask("oi");
    host.state = snapshot(fixture("casas"), "profile");
    a.reset();
    expect(a.consent).toBeNull();
    expect(a.online).toBe("needs_consent");
    expect(a.sendsData).toBe(false);
    expect(a.messages).toEqual([]);
    await a.ask("e este arquivo?");
    expect(online.chats).toHaveLength(1);
    a.agree();
    await a.ask("e este arquivo?");
    expect(online.chats).toHaveLength(2);
    expect(online.chats[1].context).toContain("ARQUIVO: Excel");
  });

  it("consentimento dado, pessoa no local, arquivo novo: voltar ao online pede de novo", async () => {
    const { a } = await readyOnline();
    a.choose("local");
    a.reset();
    a.choose("online");
    await tick();
    expect(a.online).toBe("needs_consent");
    expect(a.sendsData).toBe(false);
  });
});
