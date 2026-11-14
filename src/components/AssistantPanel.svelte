<script lang="ts">
  import { tick } from "svelte";
  import { assistant as a } from "../lib/assistant";
  import { STEP_NAMES, type StepKey } from "../lib/assistant/context";
  import { blocks, megabytes } from "../lib/assistant/format";
  import { LOCAL_MODEL } from "../lib/assistant/local";
  import { PORTAL } from "../lib/portal";
  import { app } from "../lib/state.svelte";

  let draft = $state("");
  let showContext = $state(false);
  let agreed = $state(false);
  let confirmRemove = $state(false);
  let list = $state<HTMLElement | null>(null);
  let panel = $state<HTMLElement | null>(null);

  // Abriu o painel: o foco vai para ele (quem navega por teclado ou leitor de tela cai no lugar certo).
  $effect(() => {
    panel?.focus();
  });

  // O "Li e concordo" vale para uma tela de consentimento: arquivo novo ou "parar de enviar" começam desmarcados.
  $effect(() => {
    if (a.online !== "needs_consent") agreed = false;
  });

  const size = megabytes(LOCAL_MODEL.bytes);
  const modelName = LOCAL_MODEL.id.replace(/-q4.*$/, "").replaceAll("-", " ");
  const lowMemory = ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) < 8;

  const QUESTIONS: Record<StepKey, string[]> = {
    import: ["O que é o Giz e por onde eu começo?", "Que tipo de arquivo eu posso usar?"],
    profile: ["Explique os alertas", "O que eu devo corrigir primeiro?", "Qual coluna faz sentido prever?"],
    recipe: ["O que falta tratar nos dados?", "Para que serve cada passo da receita?"],
    train: ["Como eu leio o ranking?", "O que é validação cruzada?", "Tem risco de vazamento do alvo?"],
    evaluate: ["O modelo está bom?", "Explique as métricas", "Quais colunas mais pesam na previsão?"],
    predict: ["Como funciona a previsão em lote?", "O que significam os números do lote?"],
    export: ["O que eu faço com o script exportado?", "O que vai para o MLflow?"],
  };

  const ready = $derived(a.kind === "local" ? a.local.state === "ready" : a.online === "ready");
  const preview = $derived(showContext || a.online === "needs_consent" ? a.preview(draft) : null);
  const outgoing = $derived(a.kind === "online" ? a.preview(draft) : null);
  const outgoingChars = $derived(outgoing ? outgoing.context.length + outgoing.messages.reduce((n, m) => n + m.content.length, 0) : 0);

  $effect(() => {
    if (a.open && a.kind === "local") void a.checkLocal();
  });

  // Acompanha a resposta enquanto ela chega.
  $effect(() => {
    void a.messages.length;
    void a.messages[a.messages.length - 1]?.text;
    void tick().then(() => list?.scrollTo({ top: list.scrollHeight }));
  });

  async function send(text = draft) {
    if (!text.trim() || !a.canAsk) return;
    if (text === draft) draft = ""; // uma pergunta pronta não apaga o que a pessoa estava escrevendo
    await a.ask(text);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  function agree() {
    a.agree();
    agreed = false;
  }
</script>

<aside class="assist" aria-label="Assistente" tabindex="-1" bind:this={panel}>
  <header>
    <div class="title">
      <strong class="name"><span class="dot" aria-hidden="true"></span>Assistente</strong>
      {#if a.sendsData}
        <span class="chip warn" title="Suas perguntas e um resumo do passo vão ao vgmelo.tech">online · resumos saem</span>
      {:else if a.kind === "online"}
        <span class="chip" title="Nada sai do navegador antes de você concordar">online · nada enviado</span>
      {:else}
        <span class="chip good" title="O modelo roda neste navegador; nada é enviado">neste navegador</span>
      {/if}
    </div>
    <button class="btn ghost sm close" onclick={() => (a.open = false)} aria-label="Fechar o assistente">✕</button>
  </header>

  <div class="engines" role="group" aria-label="Onde o assistente roda">
    <button aria-pressed={a.kind === "local"} class:on={a.kind === "local"} disabled={a.generating} onclick={() => a.choose("local")}>
      No navegador <small>privado, offline</small>
    </button>
    <button aria-pressed={a.kind === "online"} class:on={a.kind === "online"} disabled={a.generating} onclick={() => a.choose("online")}>
      Online <small>mais esperto</small>
    </button>
  </div>

  {#if a.kind === "local" && !ready}
    <div class="setup">
      {#if a.local.state === "unknown" || a.local.state === "checking"}
        <p class="muted wait"><span class="spinner"></span> Conferindo o navegador…</p>
      {:else if a.local.state === "unsupported"}
        <span class="st-icon warn" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></svg></span>
        <p class="st-title">O assistente local não roda neste navegador.</p>
        <p class="muted small">{a.local.message}</p>
        <button class="btn sm" onclick={() => a.choose("online")}>Usar o modo online</button>
      {:else if a.local.state === "unpublished"}
        <span class="st-icon warn" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></svg></span>
        <p class="st-title">O modelo local não foi publicado neste servidor.</p>
        <p class="muted small">Quem publicou esta cópia do Giz não incluiu os arquivos do modelo. O modo online continua disponível.</p>
        <button class="btn sm" onclick={() => a.choose("online")}>Usar o modo online</button>
      {:else if a.local.state === "available" || a.local.state === "cached"}
        <span class="st-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2.5" /><path d="M9.5 2.5v3.5M14.5 2.5v3.5M9.5 18v3.5M14.5 18v3.5M2.5 9.5H6M2.5 14.5H6M18 9.5h3.5M18 14.5h3.5" /></svg></span>
        <p>
          Um modelo de linguagem pequeno ({modelName}) roda na placa de vídeo deste aparelho.
          <strong>Suas perguntas e seus dados não saem do navegador.</strong>
        </p>
        {#if a.local.state === "cached"}
          <p class="muted small">O modelo já está guardado neste navegador.</p>
          <button class="btn primary" onclick={() => a.loadLocal()}>Ligar o assistente</button>
          <p class="muted small">
            <button class="link" onclick={() => a.removeLocal()}>apagar o modelo deste navegador ({size})</button>
          </p>
        {:else}
          <p class="muted small">
            É um download de {size}, uma vez só; depois funciona sem internet. Modelo pequeno erra: confira os números na tela.
          </p>
          {#if lowMemory}
            <p class="alert warn small">Este aparelho tem pouca memória; o modelo pode não carregar ou deixar o treino lento.</p>
          {/if}
          <button class="btn primary" onclick={() => a.loadLocal()}>Baixar o assistente ({size})</button>
        {/if}
      {:else if a.local.state === "loading"}
        <span class="st-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v11M7 10l5 5 5-5M4.5 20h15" /></svg></span>
        <p class="st-title">Preparando o modelo… <span class="pct">{Math.round(a.local.progress * 100)}%</span></p>
        <progress value={a.local.progress} max="1" aria-label="Progresso do download do modelo"></progress>
        <p class="muted small status">{a.local.text}</p>
        <button class="btn sm" onclick={() => a.cancelLoad()}>Cancelar</button>
      {:else if a.local.state === "removing"}
        <p class="muted wait"><span class="spinner"></span> Apagando o modelo…</p>
      {:else if a.local.state === "error"}
        <span class="st-icon danger" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 2.5 20h19Z" /><path d="M12 10v4.5M12 17.2v.3" /></svg></span>
        <p class="alert danger small" role="alert">{a.local.message}</p>
        <div class="row">
          <button class="btn sm" onclick={() => a.loadLocal()}>Tentar de novo</button>
          <button class="btn ghost sm" onclick={() => a.choose("online")}>Usar o modo online</button>
        </div>
      {/if}
      {#if a.localNote}<p class="alert warn small" role="alert">{a.localNote}</p>{/if}
    </div>
  {:else if a.kind === "online" && !ready}
    <div class="setup">
      {#if a.online === "idle" || a.online === "checking"}
        <p class="muted wait"><span class="spinner"></span> Conferindo o vgmelo.tech…</p>
      {:else if a.online === "off"}
        <span class="st-icon warn" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></svg></span>
        <p class="st-title">O assistente online está desligado agora.</p>
        <button class="btn sm" onclick={() => a.choose("local")}>Usar o assistente do navegador</button>
      {:else if a.online === "logged_out"}
        <span class="st-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4.5" /><path d="m11.2 11.8 8.3-8.3M16.5 6.5l2.5 2.5M14 9l2 2" /></svg></span>
        <p class="st-title">O modo online pede login no vgmelo.tech</p>
        <p class="muted">É grátis e tem cota diária.</p>
        <div class="row stack">
          <a class="btn primary" href={`${PORTAL}/entrar/`} target="_blank" rel="noopener">Entrar</a>
          <button class="btn" onclick={() => a.checkOnline()}>Já entrei</button>
        </div>
      {:else if a.online === "error"}
        <span class="st-icon danger" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 2.5 20h19Z" /><path d="M12 10v4.5M12 17.2v.3" /></svg></span>
        <p class="alert danger small" role="alert">{a.onlineError}</p>
        <button class="btn sm" onclick={() => a.checkOnline()}>Tentar de novo</button>
      {:else if a.online === "needs_consent" && a.provider}
        <div class="consent">
          {#if a.consentNote}<p class="alert warn small" role="alert">{a.consentNote}</p>{/if}
          <div class="c-head">
            <span class="st-icon sm" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 10Z" /></svg></span>
            <p class="st-title">Antes de ligar o modo online</p>
          </div>
          <section class="box out-box">
          <p class="small">Neste modo, a cada pergunta <strong>saem do seu navegador</strong>:</p>
          <ul class="small">
            <li>o texto da pergunta e as últimas perguntas e respostas desta conversa;</li>
            <li>
              um resumo do passo atual: nomes das colunas, tipos, contagens, médias e medianas, alertas, a receita, o
              ranking e as métricas dos modelos;
            </li>
            <li>
              da coluna alvo: os valores distintos (as classes, com a contagem de cada uma) ou a média e o desvio; e, se
              você previu um lote, o resumo das previsões dele.
            </li>
          </ul>
          </section>
          <section class="box keep-box">
          <p class="small">
            <strong>Não saem</strong>: as linhas do arquivo, o nome do arquivo e das abas, mínimos e máximos, valores de
            exemplo, textos de erro.
          </p>
          </section>
          <p class="small">
            Vai para o vgmelo.tech, que repassa a <strong>{a.provider.provider}</strong> (modelo
            <span class="mono">{a.provider.model}</span>). O que o provedor faz com o texto segue a política dele{#if a.provider.policy_url}
              {" "}(<a href={a.provider.policy_url} target="_blank" rel="noopener noreferrer">ler</a>){/if}.
            Vale para este arquivo; se você abrir outro, eu pergunto de novo.
          </p>
          <details>
            <summary class="small">Ver exatamente o que sairia agora</summary>
            <pre class="ctx">{preview?.context}</pre>
          </details>
          <div class="consent-foot">
          <label class="check small agree" class:on={agreed}>
            <input type="checkbox" bind:checked={agreed} /> Li e concordo em enviar a pergunta e esse resumo
          </label>
          <div class="row">
            <button class="btn primary" disabled={!agreed} onclick={agree}>Ligar o modo online</button>
            <button class="btn ghost" onclick={() => a.choose("local")}>Ficar no navegador</button>
          </div>
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <div class="chat" bind:this={list} aria-live="polite">
      {#if a.messages.length === 0}
        <div class="hello">
        <span class="st-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 5.5h15v10h-8l-4.5 3.5v-3.5h-2.5Z" /></svg></span>
        <p class="muted small">
          Pergunte sobre o passo em que você está. Eu vejo um resumo ({STEP_NAMES[app.current].replace(/^\d de 7, /, "")}), não as
          linhas do arquivo.
        </p>
        </div>
      {/if}
      {#each a.messages as m (m.id)}
        <div class="msg {m.role}">
          {#if m.pending && !m.text}
            <span class="spinner"></span>
          {/if}
          {#each blocks(m.text) as b, i (i)}
            {#if b.kind === "li"}
              <p class="li">{#each b.segments as s, j (j)}{#if s.bold}<strong>{s.text}</strong>{:else}{s.text}{/if}{/each}</p>
            {:else}
              <p>{#each b.segments as s, j (j)}{#if s.bold}<strong>{s.text}</strong>{:else}{s.text}{/if}{/each}</p>
            {/if}
          {/each}
          {#if m.stopped}<p class="muted small">(parado)</p>{/if}
          {#if m.error}<p class="alert danger small" role="alert">{m.error}</p>{/if}
          {#if m.actions.length}
            <div class="actions">
              {#each m.actions as act (act.code)}
                {@const st = a.actionState(m, act)}
                <button class="btn sm act" disabled={st.done} onclick={() => a.apply(m.id, act.code)}>
                  {#if st.done}✓{/if}
                  {act.label}
                </button>
                {#if st.note}<span class="muted small">{st.note}</span>{/if}
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>

    {#if a.suggestions.length}
      <details class="sug">
        <summary class="small">Sugestões do Giz para este passo ({a.suggestions.length})</summary>
        <div class="actions">
          {#each a.suggestions as act (act.code)}
            <button class="btn sm act" onclick={() => a.applySuggestion(act)}>{act.label}</button>
          {/each}
          {#if a.suggestionNote}<span class="muted small">{a.suggestionNote}</span>{/if}
        </div>
      </details>
    {/if}

    <div class="quick">
      {#each QUESTIONS[app.current] as q (q)}
        <button class="chip q" disabled={!a.canAsk} onclick={() => send(q)}>{q}</button>
      {/each}
    </div>

    {#if a.kind === "online" && a.onlineWaiting && !a.onlineBlocked}
      <p class="muted small">Esperando a prévia da receita para montar o resumo…</p>
    {/if}
    {#if a.localNote}<p class="alert warn small" role="alert">{a.localNote}</p>{/if}
    {#if a.kind === "online" && a.onlineBlocked}
      <p class="alert warn small">
        <span class="msg">{a.onlineBlocked}</span>
        <button class="link" onclick={() => a.checkOnline()}>conferir de novo</button>
      </p>
    {/if}

    <form
      class="ask"
      class:busy={a.generating}
      onsubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <textarea
        bind:value={draft}
        onkeydown={onKey}
        rows="2"
        maxlength="1000"
        placeholder="Pergunte sobre este passo…"
        aria-label="Pergunta para o assistente"
      ></textarea>
      {#if a.generating}
        <button type="button" class="btn sm danger" onclick={() => a.stop()}>Parar</button>
      {:else}
        <button type="submit" class="btn sm primary" disabled={!a.canAsk || !draft.trim()}>Enviar</button>
      {/if}
    </form>

    <div class="foot small muted">
      {#if a.kind === "online"}
        <p class="out">
          <strong>Sai do navegador:</strong> a pergunta + o resumo ({outgoingChars.toLocaleString("pt-BR")} caracteres) →
          {a.consent?.provider}.
          <button class="link" onclick={() => (showContext = !showContext)}>{showContext ? "esconder" : "ver"}</button>
        </p>
        <p>
          {a.account?.name}
          {#if a.quota}· {a.quota.remaining} de {a.quota.limit} perguntas hoje{/if}
          · <button class="link" onclick={() => a.revoke()}>parar de enviar</button>
        </p>
        {#if a.generating}<p>Parar descarta a resposta, mas a pergunta já foi contada na cota.</p>{/if}
      {:else}
        <p>
          Nada sai do navegador.
          <button class="link" onclick={() => (showContext = !showContext)}>{showContext ? "esconder o resumo" : "ver o resumo que o modelo recebe"}</button>
        </p>
        <label class="check">
          <input type="checkbox" bind:checked={a.examples} /> incluir as 5 primeiras linhas do arquivo no resumo
        </label>
        <p>
          <button class="link" disabled={a.generating} onclick={() => a.unloadLocal()}>desligar</button> ·
          {#if confirmRemove}
            apagar {size} deste navegador?
            <button
              class="link"
              onclick={() => {
                confirmRemove = false;
                void a.removeLocal();
              }}>sim, apagar</button
            >
            · <button class="link" onclick={() => (confirmRemove = false)}>não</button>
          {:else}
            <button class="link" disabled={a.generating} onclick={() => (confirmRemove = true)}>apagar o modelo ({size})</button>
          {/if}
        </p>
      {/if}
      {#if showContext && preview}
        <pre class="ctx">{preview.context}{#each preview.messages as m, i (i)}{"\n\n"}[{m.role === "user" ? "você" : "assistente"}] {m.content}{/each}</pre>
      {/if}
    </div>
  {/if}
</aside>

<style>
  /* sem conversa (escolha de modo, login, avisos) o painel fica da altura do conteúdo, sem vazio embaixo */
  .assist:not(:has(.chat)) {
    height: auto;
    max-height: 100%;
  }
  .assist {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    height: 100%;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 18px;
    box-shadow: var(--shadow-lift, var(--shadow));
    padding: 14px;
  }
  .assist:focus {
    outline: none;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .name {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: var(--display);
    font-size: 1.12rem;
    letter-spacing: -0.01em;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    background: var(--accent-fill);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-fill) 28%, transparent);
  }
  .close {
    width: 34px;
    height: 34px;
    padding: 0;
    justify-content: center;
    border-radius: 999px;
  }

  /* onde roda: controle segmentado */
  .engines {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    padding: 4px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 14px;
  }
  .engines button {
    border: 0;
    background: transparent;
    border-radius: 10px;
    padding: 7px 8px;
    font-weight: 600;
    font-size: 0.86rem;
    color: var(--muted);
    line-height: 1.2;
    transition:
      background 0.18s ease,
      color 0.18s ease,
      box-shadow 0.18s ease;
  }
  .engines button:hover:not(:disabled):not(.on) {
    color: var(--ink);
  }
  .engines button.on {
    color: var(--ink);
    background: var(--panel);
    box-shadow:
      0 1px 2px rgb(0 0 0 / 0.12),
      inset 0 -2px 0 var(--accent-fill);
  }
  .engines button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
  .engines small {
    display: block;
    font-weight: 500;
    font-size: 0.72rem;
    color: var(--muted);
  }

  /* estados antes da conversa: ícone, título, texto e ações no centro */
  .setup {
    flex: 1;
    display: grid;
    gap: 10px;
    align-content: start;
    justify-items: center;
    text-align: center;
    overflow-y: auto;
    padding-top: 20px !important;
    padding-bottom: 12px;
    min-height: 0;
    font-size: 0.92rem;
    padding: 8px 6px;
    animation: rise 0.28s var(--ease-out, ease-out) both;
  }
  .setup > p {
    margin: 0;
    max-width: 34ch;
  }
  .st-icon {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    border-radius: 16px;
    background: var(--accent-soft);
    color: var(--accent);
    margin-bottom: 2px;
  }
  .st-icon.warn {
    background: color-mix(in srgb, var(--warn) 14%, transparent);
    color: var(--warn);
  }
  .st-icon.danger {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    color: var(--danger);
  }
  .st-icon.sm {
    width: 36px;
    height: 36px;
    border-radius: 11px;
    margin: 0;
  }
  .st-title {
    margin: 0;
    font-family: var(--display);
    font-weight: 650;
    font-size: 1.06rem;
    line-height: 1.3;
    color: var(--ink);
    text-wrap: balance;
  }
  .pct {
    font-variant-numeric: tabular-nums;
    color: var(--accent);
  }
  .wait {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
  }
  .row.stack {
    display: grid;
    grid-template-columns: 1fr 1fr;
    width: min(100%, 300px);
    margin-top: 4px;
  }
  .row.stack .btn {
    justify-content: center;
  }
  .setup .alert {
    text-align: left;
    width: 100%;
  }
  progress {
    appearance: none;
    width: min(100%, 300px);
    height: 10px;
    border: 0;
    border-radius: 999px;
    overflow: hidden;
    background: var(--panel-2);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  progress::-webkit-progress-bar {
    background: var(--panel-2);
    border-radius: 999px;
  }
  progress::-webkit-progress-value {
    background: var(--accent-fill);
    border-radius: 999px;
    transition: width 0.3s ease;
  }
  progress::-moz-progress-bar {
    background: var(--accent-fill);
    border-radius: 999px;
  }
  .status {
    overflow-wrap: anywhere;
    min-height: 2.4em;
    font-family: var(--mono);
    font-size: 0.74rem;
  }

  /* consentimento: o que sai e o que fica, em caixas separadas */
  .consent {
    display: grid;
    gap: 10px;
    align-content: start;
    justify-items: stretch;
    text-align: left;
    width: 100%;
  }
  .setup:has(.consent) {
    align-content: start;
    padding-top: 8px !important;
  }
  .c-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .box {
    display: grid;
    gap: 6px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--panel-2);
    border-left: 3px solid var(--warn);
  }
  .box p {
    margin: 0;
  }
  .keep-box {
    border-left-color: var(--good);
  }
  .consent ul {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 4px;
  }
  .consent details {
    font-size: 0.9rem;
  }
  .consent summary {
    cursor: pointer;
    color: var(--accent);
    font-weight: 600;
  }
  .agree {
    padding: 10px 12px;
    border: 1px solid var(--line-2);
    border-radius: 12px;
    cursor: pointer;
    transition:
      border-color 0.18s ease,
      background 0.18s ease;
  }
  .agree.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .agree input {
    accent-color: var(--accent);
    margin-top: 2px;
  }
  .consent .row {
    justify-content: flex-start;
  }
  /* concordar e ligar ficam sempre à vista, mesmo com o texto rolando (celular) */
  .consent-foot {
    position: sticky;
    bottom: -8px;
    display: grid;
    gap: 10px;
    padding: 10px 0 8px;
    background: var(--panel);
  }
  .consent-foot::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    top: -28px;
    height: 28px;
    background: linear-gradient(transparent, var(--panel));
    pointer-events: none;
  }

  /* conversa */
  .chat {
    flex: 1;
    min-height: 120px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 2px 2px 2px 0;
  }
  .hello {
    margin: auto 0;
    display: grid;
    justify-items: center;
    gap: 8px;
    text-align: center;
    padding: 12px;
  }
  .hello p {
    margin: 0;
    max-width: 32ch;
  }
  .msg {
    max-width: 92%;
    padding: 9px 12px;
    border-radius: 14px;
    font-size: 0.9rem;
    line-height: 1.5;
    overflow-wrap: anywhere;
    display: grid;
    gap: 6px;
    animation: rise 0.22s var(--ease-out, ease-out) both;
  }
  .msg p {
    margin: 0;
  }
  .msg.user {
    align-self: flex-end;
    background: var(--accent-fill);
    color: var(--accent-ink);
    border-bottom-right-radius: 4px;
  }
  .msg.assistant {
    align-self: flex-start;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-bottom-left-radius: 4px;
  }
  .li {
    padding-left: 14px;
    position: relative;
  }
  .li::before {
    content: "";
    position: absolute;
    left: 2px;
    top: 0.62em;
    width: 5px;
    height: 5px;
    border-radius: 2px;
    background: var(--accent);
  }
  .actions {
    display: grid;
    gap: 6px;
    justify-items: start;
  }
  .act {
    text-align: left;
    white-space: normal;
    border-color: var(--accent);
  }
  .sug {
    border-top: 1px dashed var(--line-2);
    padding-top: 8px;
  }
  .sug summary {
    cursor: pointer;
    color: var(--muted);
    font-weight: 600;
  }
  .sug .actions {
    margin-top: 6px;
    max-height: 170px;
    overflow-y: auto;
  }
  .quick {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .q {
    cursor: pointer;
    white-space: normal;
    text-align: left;
    transition:
      border-color 0.15s ease,
      transform 0.15s ease;
  }
  .q:hover:not(:disabled) {
    border-color: var(--accent);
    transform: translateY(-1px);
  }
  .q:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ask {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6px;
    align-items: end;
    padding: 6px;
    border: 1px solid var(--line-2);
    border-radius: 16px;
    background: var(--panel);
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease;
  }
  .ask:focus-within {
    border-color: var(--accent);
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  textarea {
    resize: none;
    border: 0;
    background: transparent;
    border-radius: 10px;
    padding: 6px 8px;
    min-width: 0;
    width: 100%;
    color: var(--ink);
    font: inherit;
    font-size: 0.92rem;
  }
  textarea:focus,
  textarea:focus-visible {
    outline: none;
  }
  .foot {
    display: grid;
    gap: 4px;
  }
  .foot p {
    margin: 0;
  }
  .out {
    color: var(--warn);
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
    font-size: inherit;
  }
  .link:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ctx {
    margin: 0;
    max-height: 220px;
    overflow: auto;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 8px;
    font-family: var(--mono);
    font-size: 0.72rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--ink);
    text-align: left;
  }
  .alert.small {
    padding: 6px 10px;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>
