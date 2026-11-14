// Estado do painel do assistente. Tudo o que fala com o mundo (tela do Giz, modelo local, portal) entra pelo
// construtor, para os testes trocarem por versões falsas.
import type { Quota } from "../portal";
import { availableActions, contextWithActions, isDone, parseActions, shownActions, stillValid, type Action } from "./actions";
import { clip, maskDerived, type Snapshot } from "./context";
import type { ChatResult, LlmErrorCode } from "./llm-protocol";
import { localMessages, MAX_QUESTION, trimHistory, type ChatMessage } from "./prompt";
import { visibleText } from "./think";
import type { GpuCheck } from "./webgpu";

export type EngineKind = "local" | "online";

export type LocalStatus =
  | { state: "unknown" | "checking" | "available" | "cached" | "ready" | "unpublished" | "removing" }
  | { state: "unsupported"; message: string }
  | { state: "loading"; progress: number; text: string }
  | { state: "error"; message: string };

export type OnlineStatus = "idle" | "checking" | "off" | "logged_out" | "needs_consent" | "ready" | "error";

export type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** Em que ponto do fluxo a pergunta foi feita (passo, alvo, treino). */
  phase?: string;
  pending?: boolean;
  stopped?: boolean;
  error?: string;
  /** Ações citadas na resposta. Se já foram feitas sai do estado da tela; aqui fica só o motivo de uma recusa. */
  actions: Action[];
  refused: Record<string, string>;
};

export type { Quota };
export type Provider = { provider: string; model: string; policy_url: string | null };
export type OnlineInfo = { enabled: boolean } & Provider;
export type Account = { user: { name?: string | null; email?: string | null } | null; quotas: Record<string, Quota>; tokens?: Quota; budget_exhausted?: boolean };
/**
 * O que sai do navegador numa pergunta online. `provider` e `model` são os que a pessoa aceitou: se o portal estiver
 * usando outro, ele recusa (409 `model_changed`) em vez de repassar.
 */
export type OnlinePayload = {
  provider: string;
  model: string;
  context: string;
  messages: { role: "user" | "assistant"; content: string }[];
};
export type OnlineReply = { reply: string; model: string; quota: Quota; tokens?: Quota };

export type Host = {
  snapshot(): Snapshot;
  /** Executa a ação na tela (receita, alvo, passo). Só é chamado pelo clique da pessoa. */
  apply(action: Action): void;
};

export type LocalPort = {
  bytes: number;
  detect(): Promise<GpuCheck>;
  published(): Promise<boolean>;
  cached(): Promise<boolean>;
  room(): Promise<number | null>;
  load(onProgress: (p: { progress: number; text: string }) => void): Promise<void>;
  send(messages: ChatMessage[], opts: { signal: AbortSignal; onToken: (delta: string) => void; maxTokens: number }): Promise<ChatResult>;
  unload(): Promise<void>;
  remove(): Promise<void>;
};

export type OnlinePort = {
  /** Qual provedor e modelo o portal usa hoje. Não leva dado nenhum da pessoa. */
  info(): Promise<OnlineInfo>;
  me(): Promise<Account>;
  /** Rejeita com um Error; o motivo do portal (ex.: "model_changed"), quando houver, vem em `reason`. */
  chat(payload: OnlinePayload, signal: AbortSignal): Promise<OnlineReply>;
};

// A janela do modelo local é de 4.096 tokens e estourar dá erro (o WebLLM não corta): resumo curto, só a última
// troca de histórico e espaço reservado para a resposta.
export const LOCAL_CONTEXT_CHARS = 3500;
export const LOCAL_HISTORY_CHARS = 1200;
export const LOCAL_MAX_TOKENS = 350;
// Os limites do portal (POST /api/ml/assistant).
export const ONLINE_CONTEXT_CHARS = 6000;
export const ONLINE_MESSAGES = 6;
export const ONLINE_MESSAGE_CHARS = 2000;

const LOAD_ERRORS: Partial<Record<LlmErrorCode, string>> = {
  integrity: "Os arquivos do modelo chegaram diferentes do esperado. Apaguei o que tinha baixado; tente de novo.",
  storage: "O navegador não deu espaço para guardar o modelo (acontece em janela anônima ou com o disco cheio).",
  device: "A placa de vídeo não deu conta de carregar o modelo (pode faltar memória). Feche outras abas pesadas e tente de novo.",
  network: "A conexão caiu no meio do download. O que já baixou fica guardado: tente de novo quando a internet voltar.",
};

/** Passo, alvo e situação do treino: quando isso muda, a conversa anterior falava de outra tela. */
const phaseOf = (s: Snapshot) => [s.current, s.target ?? "", s.training ? "treinando" : s.result ? "treinado" : "sem treino"].join("|");

const codeOf = (e: unknown) => (e as { code?: LlmErrorCode } | null)?.code;
const reasonOf = (e: unknown) => (e as { reason?: string } | null)?.reason;
const CHANGED = "O assistente online passou a usar outro provedor ou modelo. Nada foi enviado; confira abaixo e concorde de novo.";
const httpsOnly = (url: string | null) => (url && /^https:\/\//i.test(url) ? url : null);

export class Assistant {
  open = $state(false);
  kind = $state<EngineKind>("local");
  messages = $state<Message[]>([]);
  generating = $state(false);
  /** Incluir as primeiras linhas no resumo. Só vale no motor local. */
  examples = $state(false);
  local = $state<LocalStatus>({ state: "unknown" });
  /** O que a pessoa aceitou mandar para fora, nesta página aberta e para o arquivo atual. Não fica salvo. */
  consent = $state<Provider | null>(null);
  provider = $state<Provider | null>(null);
  account = $state<{ name: string } | null>(null);
  quota = $state<Quota | null>(null);
  tokens = $state<Quota | null>(null);
  budgetExhausted = $state(false);
  online = $state<OnlineStatus>("idle");
  onlineError = $state<string | null>(null);
  /** Por que o consentimento está sendo pedido de novo (o portal trocou de provedor ou de modelo). */
  consentNote = $state<string | null>(null);

  suggestionNote = $state<string | null>(null);
  /** Recado sobre o modelo local que não muda o estado dele (ex.: não deu para apagar). */
  localNote = $state<string | null>(null);

  private seq = 0;
  private abort: AbortController | null = null;
  private checking: Promise<void> | null = null;
  private onlineCheck = 0;

  constructor(
    private host: Host,
    private localPort: LocalPort,
    private onlinePort: OnlinePort,
  ) {}

  /** Algo sai do navegador neste modo? (o selo do topo muda) */
  get sendsData() {
    return this.kind === "online" && this.consent !== null && this.online === "ready";
  }

  /** O limite que vale de verdade no online: a cota de perguntas ou o teto de tokens do dia, o que acabar antes. */
  get onlineBlocked(): string | null {
    if (this.budgetExhausted) return "O teto de uso de hoje do vgmelo.tech acabou. Ele volta à meia-noite.";
    if (this.quota && this.quota.remaining <= 0) return "Suas perguntas de hoje acabaram. Elas voltam à meia-noite.";
    if (this.tokens && this.tokens.remaining <= 0) return "Seu teto de uso de hoje no vgmelo.tech acabou. Ele volta à meia-noite.";
    return null;
  }

  /**
   * A receita acabou de mudar e a prévia ainda não voltou: o perfil na tela é o de antes. O resumo que sai do
   * navegador espera a tela se alinhar.
   */
  get onlineWaiting(): boolean {
    return this.host.snapshot().previewing;
  }

  get canAsk() {
    if (this.generating) return false;
    if (this.kind === "local") return this.local.state === "ready";
    return this.online === "ready" && this.consent !== null && !this.onlineBlocked && !this.onlineWaiting;
  }

  // ---------------------------------------------------------------------------------------------- motor local

  checkLocal(): Promise<void> {
    if (this.local.state !== "unknown") return this.checking ?? Promise.resolve();
    this.local = { state: "checking" };
    this.checking = (async () => {
      const gpu = await this.localPort.detect();
      if (!gpu.ok) {
        this.local = { state: "unsupported", message: gpu.message };
        return;
      }
      if (!(await this.localPort.published())) {
        this.local = { state: "unpublished" };
        return;
      }
      this.local = { state: (await this.localPort.cached().catch(() => false)) ? "cached" : "available" };
    })().finally(() => (this.checking = null));
    return this.checking;
  }

  /** Baixa (ou tira do cache) e carrega o modelo. Só roda por clique: é ~1 GB. */
  async loadLocal() {
    const st = this.local.state;
    if (st !== "available" && st !== "cached" && st !== "error") return;
    // O estado muda antes de qualquer espera: um segundo clique não dispara outro carregamento.
    this.local = { state: "loading", progress: 0, text: "" };
    this.localNote = null;
    if (st !== "cached") {
      const room = await this.localPort.room();
      if (room !== null && room < this.localPort.bytes * 1.05) {
        const mb = (n: number) => Math.round(n / 1e6).toLocaleString("pt-BR");
        this.local = {
          state: "error",
          message: `O navegador só libera ${mb(room)} MB para este site e o modelo precisa de ${mb(this.localPort.bytes)} MB. Libere espaço em disco ou saia da janela anônima.`,
        };
        return;
      }
    }
    try {
      await this.localPort.load((p) => {
        if (this.local.state === "loading") this.local = { state: "loading", progress: p.progress, text: p.text };
      });
      this.local = { state: "ready" };
    } catch (e) {
      if (codeOf(e) === "cancelled") {
        this.local = { state: (await this.localPort.cached().catch(() => false)) ? "cached" : "available" };
        return;
      }
      const known = LOAD_ERRORS[codeOf(e) ?? "error"];
      const detail = (e as Error).message;
      this.local = { state: "error", message: known ?? `Não consegui carregar o modelo.${detail ? ` (${detail})` : ""}` };
    }
  }

  /** Cancela o download em andamento; o que já baixou fica no cache e a próxima tentativa continua de onde parou. */
  async cancelLoad() {
    if (this.local.state === "loading") await this.localPort.unload().catch(() => {});
  }

  /** Tira o modelo da memória (ele continua no cache do navegador). */
  async unloadLocal() {
    if (this.local.state !== "ready" || this.generating) return;
    this.local = { state: "cached" }; // antes da espera: ninguém pergunta a um modelo que está saindo da memória
    await this.localPort.unload().catch(() => {});
  }

  /** Apaga o modelo deste navegador (~1 GB). */
  async removeLocal() {
    const before = this.local;
    if ((before.state !== "ready" && before.state !== "cached" && before.state !== "error") || this.generating) return;
    this.local = { state: "removing" };
    this.localNote = null;
    try {
      await this.localPort.remove();
      this.local = { state: "available" };
    } catch (e) {
      // Não apagou: o modelo continua onde estava (fora da memória), e o recado não vira um "tentar de novo" que baixa.
      this.local = before.state === "ready" ? { state: "cached" } : before;
      this.localNote = `Não consegui apagar o modelo. (${(e as Error).message})`;
    }
  }

  // ---------------------------------------------------------------------------------------------- modo online

  /** Trocar de motor começa uma conversa nova: o que foi dito a um não vai para o outro. */
  choose(kind: EngineKind) {
    if (this.generating || kind === this.kind) return;
    this.kind = kind;
    this.messages = [];
    if (kind === "local") void this.checkLocal();
    else void this.checkOnline();
  }

  /** Confere se o assistente online existe, qual provedor ele usa e se a pessoa está logada. Não manda dado nenhum. */
  async checkOnline() {
    const check = ++this.onlineCheck;
    this.online = "checking";
    this.onlineError = null;
    try {
      const [info, me] = await Promise.all([this.onlinePort.info(), this.onlinePort.me()]);
      if (check !== this.onlineCheck) return; // outra conferência começou depois: vale a mais nova
      if (!info.enabled) {
        this.online = "off";
        return;
      }
      this.provider = { provider: info.provider, model: info.model, policy_url: httpsOnly(info.policy_url) };
      // O consentimento vale para um provedor e um modelo: se o portal trocou, pergunta de novo.
      if (this.consent && (this.consent.provider !== info.provider || this.consent.model !== info.model)) {
        this.consent = null;
        this.consentNote = CHANGED;
      }
      if (!me.user) {
        this.online = "logged_out";
        return;
      }
      this.account = { name: me.user.name || me.user.email || "sua conta" };
      this.quota = me.quotas.assistant ?? null;
      this.tokens = me.tokens ?? null;
      this.budgetExhausted = !!me.budget_exhausted;
      this.online = this.consent ? "ready" : "needs_consent";
    } catch (e) {
      if (check !== this.onlineCheck) return;
      this.online = "error";
      this.onlineError = (e as Error).message;
    }
  }

  /** Atualiza a cota e os tetos mostrados, sem mexer no estado do modo online (não pisca a tela). */
  private async refreshUsage() {
    try {
      const me = await this.onlinePort.me();
      if (!me.user) return void this.checkOnline(); // a sessão caiu: aí o estado muda mesmo
      this.quota = me.quotas.assistant ?? this.quota;
      this.tokens = me.tokens ?? this.tokens;
      this.budgetExhausted = !!me.budget_exhausted;
    } catch {
      /* fica o que estava; a próxima pergunta mostra o erro */
    }
  }

  /** O clique em "Concordo". Sem ele nenhuma pergunta e nenhum resumo saem do navegador. */
  agree() {
    if (this.online !== "needs_consent" || !this.provider) return;
    this.consent = { ...this.provider };
    this.consentNote = null;
    this.online = "ready";
  }

  revoke() {
    this.stop();
    this.consent = null;
    if (this.online === "ready") this.online = "needs_consent";
  }

  // ---------------------------------------------------------------------------------------------- conversa

  /**
   * As trocas completas (pergunta + resposta que chegou inteira ou parada com texto) e, no fim, a pergunta nova.
   * Com `phase`, só as trocas feitas naquele ponto do fluxo: o modelo local repete a resposta anterior quando ela
   * falava de outro passo (ex.: "o treino está em andamento" depois que o treino acabou).
   */
  private history(question: string, phase?: string): ChatMessage[] {
    const past: ChatMessage[] = [];
    for (let i = 0; i + 1 < this.messages.length; i += 2) {
      const [asked, reply] = [this.messages[i], this.messages[i + 1]];
      if (reply.pending || reply.error || !reply.text.trim()) continue;
      if (phase !== undefined && asked.phase !== phase) continue;
      past.push({ role: "user", content: asked.text }, { role: "assistant", content: reply.text });
    }
    return [...past, { role: "user", content: question }];
  }

  private payload(snap: Snapshot, actions: Action[], question: string): OnlinePayload {
    // As respostas antigas citam rótulos de ações com o nome da coluna: passam pela mesma máscara do resumo.
    const messages = trimHistory(this.history(question), ONLINE_MESSAGES * ONLINE_MESSAGE_CHARS, ONLINE_MESSAGES).map((m) => ({
      role: m.role as "user" | "assistant",
      content: clip(maskDerived(m.content, snap), ONLINE_MESSAGE_CHARS),
    }));
    const context = contextWithActions(snap, actions, { maxChars: ONLINE_CONTEXT_CHARS, redact: true });
    return { provider: this.consent?.provider ?? "", model: this.consent?.model ?? "", context, messages };
  }

  /** O que o assistente recebe com esta pergunta. No modo online é exatamente o que sai do navegador. */
  preview(question: string): { context: string; messages: { role: string; content: string }[]; provider?: string; model?: string } {
    const snap = this.host.snapshot();
    const actions = availableActions(snap);
    const q = clip(question.trim(), MAX_QUESTION) || "(sua pergunta)";
    if (this.kind === "online") return this.payload(snap, actions, q);
    const context = contextWithActions(snap, actions, { maxChars: LOCAL_CONTEXT_CHARS, examples: this.examples, compact: true });
    return { context, messages: trimHistory(this.history(q, phaseOf(snap)), LOCAL_HISTORY_CHARS, 3) };
  }

  /** Devolve o texto e o resumo que o modelo de fato recebeu (as tentativas mudam o resumo). */
  private async askLocal(
    snap: Snapshot,
    offered: Action[],
    history: ChatMessage[],
    reply: Message,
    signal: AbortSignal,
    sent: { context: string },
  ): Promise<string> {
    // Se a janela estourar mesmo assim: tenta sem histórico, depois com metade do resumo.
    const attempts = [
      { history: true, chars: LOCAL_CONTEXT_CHARS },
      { history: false, chars: LOCAL_CONTEXT_CHARS },
      { history: false, chars: LOCAL_CONTEXT_CHARS / 2 },
    ];
    for (const [i, attempt] of attempts.entries()) {
      sent.context = contextWithActions(snap, offered, { maxChars: attempt.chars, examples: this.examples, compact: true });
      const past = attempt.history ? trimHistory(history, LOCAL_HISTORY_CHARS, 3) : history.slice(-1);
      try {
        const res = await this.localPort.send(localMessages(sent.context, past), {
          signal,
          maxTokens: LOCAL_MAX_TOKENS,
          onToken: (delta) => {
            reply.text += delta;
          },
        });
        return res.text;
      } catch (e) {
        if (codeOf(e) !== "context" || i === attempts.length - 1 || reply.text || signal.aborted) throw e;
      }
    }
    return reply.text;
  }

  async ask(raw: string) {
    const question = clip(raw.trim(), MAX_QUESTION);
    if (!question || !this.canAsk) return;
    const kind = this.kind;
    const snap = this.host.snapshot();
    const offered = availableActions(snap);
    // Antes de a pergunta entrar na lista de mensagens: o histórico é o que veio antes dela.
    const online = kind === "online" ? this.payload(snap, offered, question) : null;
    const history = this.history(question, phaseOf(snap));
    const sent = { context: online?.context ?? "" };

    this.suggestionNote = null;
    this.messages.push({ id: ++this.seq, role: "user", text: question, phase: phaseOf(snap), actions: [], refused: {} });
    this.messages.push({ id: ++this.seq, role: "assistant", text: "", pending: true, actions: [], refused: {} });
    const reply = this.messages[this.messages.length - 1];
    const abort = new AbortController();
    this.abort = abort;
    this.generating = true;
    let text = "";
    try {
      if (online) {
        const res = await this.onlinePort.chat(online, abort.signal);
        if (typeof res?.reply !== "string") throw new Error("O portal devolveu uma resposta que não entendi.");
        text = visibleText(res.reply); // o portal já tira o raciocínio do modelo; aqui é a segunda conferência
        if (res.quota) this.quota = res.quota;
        if (res.tokens) this.tokens = res.tokens;
      } else {
        text = await this.askLocal(snap, offered, history, reply, abort.signal, sent);
      }
      if (!text.trim() && !abort.signal.aborted) throw new Error("O modelo não devolveu texto. Tente de novo.");
    } catch (e) {
      text = reply.text;
      if (!abort.signal.aborted) {
        reply.error = this.explain(e);
        if (kind === "online") {
          // O portal está usando outro modelo: o que foi aceito não vale mais, e nada foi repassado.
          if (reasonOf(e) === "model_changed") {
            this.consent = null;
            this.consentNote = CHANGED;
          }
          void this.checkOnline(); // a cota pode ter acabado, a sessão caído ou o provedor mudado
        } else if (codeOf(e) === "device") this.local = { state: "error", message: LOAD_ERRORS.device! };
      }
    } finally {
      if (abort.signal.aborted) {
        reply.stopped = true;
        // Parar no online não cancela a pergunta no portal: ela foi contada, então a cota mostrada é atualizada.
        if (kind === "online") void this.refreshUsage();
      }
      try {
        // Só viram botão as ações cujo código o modelo viu no resumo; o clique ainda confere de novo.
        const parsed = parseActions(text, shownActions(offered, sent.context), snap);
        reply.text = parsed.text;
        reply.actions = reply.error ? [] : parsed.actions;
      } catch {
        reply.text = String(text ?? "");
        reply.actions = [];
      }
      reply.pending = false;
      if (this.abort === abort) {
        this.abort = null;
        this.generating = false;
      }
    }
  }

  private explain(e: unknown): string {
    if (codeOf(e) === "context") return "A pergunta e o resumo não couberam na memória do modelo local. Tente uma pergunta mais curta.";
    if (codeOf(e) === "device") return "A placa de vídeo parou de responder. Carregue o assistente de novo.";
    if (reasonOf(e) === "model_changed") return "O assistente online mudou de modelo. Confira para onde o resumo vai e concorde de novo.";
    return (e as Error).message || "O assistente falhou.";
  }

  /** No motor local a geração para na hora. No online a resposta é descartada, mas a pergunta já foi contada. */
  stop() {
    this.abort?.abort();
  }

  /** O clique no botão de uma ação: é a confirmação da pessoa. Confere se a ação ainda vale antes de rodar. */
  apply(messageId: number, code: string) {
    const msg = this.messages.find((m) => m.id === messageId);
    const action = msg?.actions.find((a) => a.code === code);
    if (!msg || !action) return;
    const snap = this.host.snapshot();
    if (isDone(action, snap)) return;
    const problem = stillValid(action, snap);
    if (problem) {
      msg.refused[code] = problem;
      return;
    }
    delete msg.refused[code];
    this.host.apply(action);
  }

  /** Correções e próximo passo que o Giz calcula para a tela atual, sem depender do modelo. */
  get suggestions(): Action[] {
    return availableActions(this.host.snapshot());
  }

  /** Clique numa sugestão do Giz: mesma conferência das ações citadas pelo modelo. */
  applySuggestion(action: Action) {
    const problem = stillValid(action, this.host.snapshot());
    this.suggestionNote = problem;
    if (!problem) this.host.apply(action);
  }

  /** Estado do botão de uma ação, derivado da tela (depois de um desfazer, o botão volta a valer). */
  actionState(msg: Message, action: Action): { done: boolean; note: string | null } {
    const done = isDone(action, this.host.snapshot());
    return { done, note: done ? null : (msg.refused[action.code] ?? null) };
  }

  /**
   * Arquivo ou aba nova: a conversa falava de outros dados, e o que a pessoa aceitou mandar para fora valia para
   * aqueles dados. Para a resposta em curso, limpa a conversa e pede o consentimento de novo.
   */
  reset() {
    this.stop();
    this.messages = [];
    this.suggestionNote = null;
    this.consent = null;
    this.consentNote = null;
    if (this.online === "ready") this.online = "needs_consent";
  }
}
