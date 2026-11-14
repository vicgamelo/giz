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
      <strong>Assistente</strong>
      {#if a.sendsData}
        <span class="chip warn" title="Suas perguntas e um resumo do passo vão ao vgmelo.tech">online · resumos saem</span>
      {:else if a.kind === "online"}
        <span class="chip" title="Nada sai do navegador antes de você concordar">online · nada enviado</span>
      {:else}
        <span class="chip accent" title="O modelo roda neste navegador; nada é enviado">neste navegador</span>
      {/if}
    </div>
    <button class="btn ghost sm" onclick={() => (a.open = false)} aria-label="Fechar o assistente">✕</button>
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
        <p class="muted"><span class="spinner"></span> Conferindo o navegador…</p>
      {:else if a.local.state === "unsupported"}
        <p><strong>O assistente local não roda neste navegador.</strong></p>
        <p class="muted small">{a.local.message}</p>
        <button class="btn sm" onclick={() => a.choose("online")}>Usar o modo online</button>
      {:else if a.local.state === "unpublished"}
        <p><strong>O modelo local não foi publicado neste servidor.</strong></p>
        <p class="muted small">Quem publicou esta cópia do Giz não incluiu os arquivos do modelo. O modo online continua disponível.</p>
        <button class="btn sm" onclick={() => a.choose("online")}>Usar o modo online</button>
      {:else if a.local.state === "available" || a.local.state === "cached"}
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
        <p>Preparando o modelo… {Math.round(a.local.progress * 100)}%</p>
        <progress value={a.local.progress} max="1" aria-label="Progresso do download do modelo"></progress>
        <p class="muted small status">{a.local.text}</p>
        <button class="btn sm" onclick={() => a.cancelLoad()}>Cancelar</button>
      {:else if a.local.state === "removing"}
        <p class="muted"><span class="spinner"></span> Apagando o modelo…</p>
      {:else if a.local.state === "error"}
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
        <p class="muted"><span class="spinner"></span> Conferindo o vgmelo.tech…</p>
      {:else if a.online === "off"}
        <p><strong>O assistente online está desligado agora.</strong></p>
        <button class="btn sm" onclick={() => a.choose("local")}>Usar o assistente do navegador</button>
      {:else if a.online === "logged_out"}
        <p><strong>O modo online pede login no vgmelo.tech</strong> (é grátis e tem cota diária).</p>
        <div class="row">
          <a class="btn sm primary" href={`${PORTAL}/entrar/`} target="_blank" rel="noopener">Entrar</a>
          <button class="btn sm" onclick={() => a.checkOnline()}>Já entrei</button>
        </div>
      {:else if a.online === "error"}
        <p class="alert danger small" role="alert">{a.onlineError}</p>
        <button class="btn sm" onclick={() => a.checkOnline()}>Tentar de novo</button>
      {:else if a.online === "needs_consent" && a.provider}
        <div class="consent">
          {#if a.consentNote}<p class="alert warn small" role="alert">{a.consentNote}</p>{/if}
          <p><strong>Antes de ligar o modo online</strong></p>
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
          <p class="small">
            <strong>Não saem</strong>: as linhas do arquivo, o nome do arquivo e das abas, mínimos e máximos, valores de
            exemplo, textos de erro.
          </p>
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
          <label class="check small">
            <input type="checkbox" bind:checked={agreed} /> Li e concordo em enviar a pergunta e esse resumo
          </label>
          <div class="row">
            <button class="btn primary sm" disabled={!agreed} onclick={agree}>Ligar o modo online</button>
            <button class="btn ghost sm" onclick={() => a.choose("local")}>Ficar no navegador</button>
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <div class="chat" bind:this={list} aria-live="polite">
      {#if a.messages.length === 0}
        <p class="muted small hello">
          Pergunte sobre o passo em que você está. Eu vejo um resumo ({STEP_NAMES[app.current].replace(/^\d de 7, /, "")}), não as
          linhas do arquivo.
        </p>
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
  .assist {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    height: 100%;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 12px;
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
  .engines {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .engines button {
    border: 1px solid var(--line-2);
    background: var(--panel-2);
    border-radius: 9px;
    padding: 6px 8px;
    font-weight: 600;
    font-size: 0.86rem;
    color: var(--muted);
    line-height: 1.2;
  }
  .engines button.on {
    border-color: var(--accent);
    color: var(--ink);
    background: var(--accent-soft);
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
  .setup,
  .consent {
    display: grid;
    gap: 10px;
    align-content: start;
    overflow-y: auto;
    min-height: 0;
  }
  .setup {
    flex: 1;
    font-size: 0.92rem;
  }
  .consent ul {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 4px;
  }
  .row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }
  progress {
    width: 100%;
    height: 8px;
    accent-color: var(--accent);
  }
  .status {
    overflow-wrap: anywhere;
    min-height: 2.4em;
  }
  .chat {
    flex: 1;
    min-height: 120px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-right: 2px;
  }
  .hello {
    margin: auto 0;
    text-align: center;
  }
  .msg {
    max-width: 94%;
    padding: 8px 10px;
    border-radius: 10px;
    font-size: 0.9rem;
    line-height: 1.45;
    overflow-wrap: anywhere;
    display: grid;
    gap: 6px;
  }
  .msg.user {
    align-self: flex-end;
    background: var(--accent-soft);
  }
  .msg.assistant {
    align-self: flex-start;
    background: var(--panel-2);
    border: 1px solid var(--line);
  }
  .li {
    padding-left: 14px;
    position: relative;
  }
  .li::before {
    content: "•";
    position: absolute;
    left: 2px;
    color: var(--muted);
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
  }
  .q:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ask {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: end;
  }
  textarea {
    resize: none;
    border: 1px solid var(--line-2);
    background: var(--panel);
    border-radius: 8px;
    padding: 7px 10px;
    min-width: 0;
    width: 100%;
  }
  .foot {
    display: grid;
    gap: 4px;
  }
  .out {
    color: var(--warn);
  }
  .check {
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
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
    border-radius: 8px;
    padding: 8px;
    font-family: var(--mono);
    font-size: 0.72rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--ink);
  }
  .alert.small {
    padding: 6px 10px;
  }
</style>
