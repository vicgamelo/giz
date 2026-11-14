<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { assistant } from "./lib/assistant";
  import { app, STEPS, type StepKey } from "./lib/state.svelte";
  import { fmtSeconds } from "./lib/format";
  import ImportStep from "./components/ImportStep.svelte";
  import ProfileStep from "./components/ProfileStep.svelte";
  import RecipeStep from "./components/RecipeStep.svelte";
  import TrainStep from "./components/TrainStep.svelte";
  import EvaluateStep from "./components/EvaluateStep.svelte";
  import PredictStep from "./components/PredictStep.svelte";
  import ExportStep from "./components/ExportStep.svelte";
  import AssistantPanel from "./components/AssistantPanel.svelte";

  let theme = $state<"light" | "dark" | null>(null);

  onMount(() => {
    app.start();
    const t = document.documentElement.dataset.theme;
    theme = t === "light" || t === "dark" ? t : null;
    try {
      assistant.open = localStorage.getItem("giz-assistente") === "aberto";
    } catch {
      /* modo privado */
    }
  });

  function toggleAssistant() {
    assistant.open = !assistant.open;
    try {
      localStorage.setItem("giz-assistente", assistant.open ? "aberto" : "fechado");
    } catch {
      /* modo privado */
    }
  }

  // Arquivo ou aba nova: a conversa e o consentimento do modo online valiam para os dados anteriores.
  $effect(() => {
    void app.source;
    untrack(() => assistant.reset());
  });

  function toggleTheme() {
    const dark = theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    theme = dark ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("giz-tema", theme);
    } catch {
      /* modo privado */
    }
  }

  function go(key: StepKey) {
    if (app.reached[key]) {
      app.current = key;
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const index = $derived(STEPS.findIndex((s) => s.key === app.current));

  // No celular a trilha de passos rola de lado: mantém o passo atual à vista.
  let stepsList = $state<HTMLOListElement>();
  $effect(() => {
    void app.current;
    const el = stepsList?.querySelector<HTMLElement>('[aria-current="step"]');
    if (el && stepsList && stepsList.scrollWidth > stepsList.clientWidth) {
      stepsList.scrollTo({ left: el.offsetLeft - 16, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  });

  $effect(() => {
    if (!app.toast) return;
    const t = setTimeout(() => (app.toast = null), 2600);
    return () => clearTimeout(t);
  });
</script>

<header class="top">
  <div class="brand">
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
      <rect width="32" height="32" rx="7" class="logo-bg" />
      <path d="M7 22l6-6 4 3 8-9" class="logo-line" />
      <circle cx="25" cy="10" r="2.2" class="logo-dot" />
    </svg>
    <strong>Giz</strong>
    <span class="tag">AutoML no navegador · open source</span>
  </div>
  <div class="right">
    {#if assistant.sendsData}
      <span
        class="privacy out"
        title="O arquivo continua só neste navegador. Com o assistente online ligado, suas perguntas e um resumo do passo (nomes de colunas, contagens, métricas) vão ao vgmelo.tech."
      >
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"
          ><path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" class="shield" /></svg
        >
        Assistente online: resumos saem do navegador
      </span>
    {:else}
      <span
        class="privacy"
        title="O Python roda neste navegador (WebAssembly) e o arquivo não é enviado a nenhum servidor. Resumos só saem se você pedir: ao registrar no MLflow ou ao ligar o assistente online."
      >
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"
          ><path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" class="shield" /><path
            d="M9 12l2 2 4-4"
            class="check"
          /></svg
        >
        O arquivo não sai do navegador
      </span>
    {/if}
    <span class="py" class:ok={app.mlReady} class:err={app.stage === "error"} title={app.status}>
      {#if app.stage === "error"}
        Python com erro
      {:else if app.mlReady}
        <span class="dot"></span> Python pronto
      {:else if app.pyReady}
        <span class="spinner"></span> Carregando modelos…
      {:else}
        <span class="spinner"></span> Carregando Python…
      {/if}
    </span>
    <button class="tb-btn assist-btn" class:on={assistant.open} onclick={toggleAssistant} aria-expanded={assistant.open} aria-controls={assistant.open ? "assistente" : undefined}>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
        ><path d="M4 5h16v11H9l-5 4V5z" class="moon" /></svg
      >
      Assistente
    </button>
    <button class="tb-btn icon" onclick={toggleTheme} aria-label="Alternar tema claro/escuro">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
        ><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" class="moon" /></svg
      >
    </button>
  </div>
</header>

<nav class="steps" aria-label="Etapas">
  <div class="steps-in">
    {#if app.file}
      <p class="project">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"
          ><path d="M4 1.5h5.5L13 5v9.5H4z M9.5 1.5V5H13" class="moon" /></svg
        >
        <span class="fname">{app.file.name}</span>
        {#if app.target}<span class="sep" aria-hidden="true">/</span> alvo <b>{app.target}</b>{/if}
      </p>
    {/if}
    <div class="tabs-row">
      <ol bind:this={stepsList}>
        {#each STEPS as s, i (s.key)}
          <li>
            <button
              class:current={app.current === s.key}
              class:done={i < index && app.reached[s.key]}
              disabled={!app.reached[s.key]}
              onclick={() => go(s.key)}
              aria-current={app.current === s.key ? "step" : undefined}
            >
              <span class="n">{#if i < index && app.reached[s.key]}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg><span class="sr-only">{i + 1}</span>{:else}{i + 1}{/if}</span>
              <span class="l">{s.label}</span>
              <span class="s">{s.short}</span>
            </button>
          </li>
        {/each}
      </ol>
      <div class="boot small muted">
        {#if app.bootSeconds}
          Python em {fmtSeconds(app.bootSeconds)}{#if app.mlSeconds}; modelos em {fmtSeconds(app.mlSeconds)}{/if}
        {:else}
          {app.status}
        {/if}
      </div>
    </div>
  </div>
  <div class="progress" aria-hidden="true"><span class="fill fill-{index}"></span></div>
</nav>

<div class="layout" class:with-assistant={assistant.open}>
  <main>
    {#if app.error}
      <div class="alert danger err" role="alert">
        <div class="msg">{app.error}</div>
        <button class="btn ghost sm" onclick={() => (app.error = null)}>Fechar</button>
      </div>
    {/if}
    {#key app.current}
    <div class="step-in">
    {#if app.current === "import"}
      <ImportStep />
    {:else if app.current === "profile"}
      <ProfileStep />
    {:else if app.current === "recipe"}
      <RecipeStep />
    {:else if app.current === "train"}
      <TrainStep />
    {:else if app.current === "evaluate"}
      <EvaluateStep />
    {:else if app.current === "predict"}
      <PredictStep />
    {:else}
      <ExportStep />
    {/if}
    </div>
    {/key}
  </main>

  {#if assistant.open}
    <div class="assistant" id="assistente">
      <AssistantPanel />
    </div>
  {/if}
</div>

{#if app.busy}
  <div class="busy" role="status"><span class="spinner"></span> {app.busy}</div>
{/if}
{#if app.toast}
  <div class="toast" role="status">{app.toast}</div>
{/if}

<footer class="foot small muted">
  Giz · alternativa open source ao SageMaker Canvas, feita por
  <a href="https://vgmelo.tech" rel="noopener">Victor Melo</a> · Python {app.pyReady ? "3.14 (Pyodide)" : ""} com pandas,
  scikit-learn, LightGBM e XGBoost ·
  <a href="https://github.com/vicgamelo/giz" rel="noopener">código</a>
</footer>

<style>
  /* Barra de console: escura nos dois temas, como a de um console de nuvem. */
  .top {
    position: sticky;
    top: 0;
    z-index: 21;
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 20px;
    background: var(--console);
    color: var(--console-ink);
    border-bottom: 1px solid var(--console-line);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .brand strong {
    font-size: 1.12rem;
    font-weight: 750;
    letter-spacing: -0.02em;
  }
  .tag {
    font-size: 0.78rem;
    color: var(--console-muted);
    padding-left: 10px;
    border-left: 1px solid var(--console-line);
    white-space: nowrap;
  }
  .logo-bg {
    fill: var(--accent-fill);
  }
  .logo-line {
    fill: none;
    stroke: var(--accent-ink);
    stroke-width: 2.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .logo-dot {
    fill: var(--accent-ink);
  }
  .right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .privacy {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--console-good);
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--console-good) 35%, transparent);
  }
  .privacy.out {
    color: var(--console-warn);
    border-color: color-mix(in srgb, var(--console-warn) 40%, transparent);
  }
  .tb-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 34px;
    padding: 0 12px;
    border-radius: 8px;
    border: 1px solid var(--console-line);
    background: transparent;
    color: var(--console-ink);
    font-weight: 600;
    font-size: 0.86rem;
    cursor: pointer;
    transition:
      background 0.15s,
      border-color 0.15s;
  }
  .tb-btn:hover {
    background: rgb(255 255 255 / 8%);
    border-color: var(--console-muted);
  }
  .tb-btn:focus-visible {
    outline: 2px solid var(--console-focus);
    outline-offset: 2px;
  }
  .tb-btn.icon {
    width: 34px;
    padding: 0;
    justify-content: center;
  }
  .assist-btn.on {
    border-color: var(--accent-fill);
    background: var(--accent-fill);
    color: var(--accent-ink);
  }
  .shield,
  .moon {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
  }
  .check {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }
  .py {
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.78rem;
    color: var(--console-muted);
    padding: 0 4px;
  }
  .py.ok {
    color: var(--console-good);
  }
  .py.err {
    color: var(--console-danger);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }

  /* Faixa do projeto: arquivo, alvo e as etapas como abas */
  .steps {
    position: sticky;
    top: 52px;
    z-index: 20;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
  }
  .steps-in {
    max-width: 1440px;
    margin: 0 auto;
    padding: 0 24px;
  }
  .project {
    margin: 0;
    padding-top: 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
    color: var(--muted);
    min-width: 0;
  }
  .project b {
    color: var(--ink);
    font-family: var(--mono);
    font-weight: 600;
  }
  .fname {
    color: var(--ink);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sep {
    color: var(--line-2);
    padding: 0 2px;
  }
  .tabs-row {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .steps ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    gap: 2px;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .steps ol::-webkit-scrollbar {
    display: none;
  }
  .steps button {
    display: flex;
    align-items: center;
    gap: 8px;
    position: relative;
    padding: 12px 12px 13px;
    border: 0;
    background: transparent;
    color: var(--muted);
    font-weight: 600;
    font-size: 0.9rem;
    white-space: nowrap;
    border-radius: 0;
    cursor: pointer;
    transition: color 0.15s;
  }
  .steps button::after {
    content: "";
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 0;
    height: 3px;
    border-radius: 3px 3px 0 0;
    background: var(--accent);
    transform: scaleX(0);
    transition: transform 0.25s var(--ease-out);
  }
  .steps button:hover:not(:disabled) {
    color: var(--ink);
  }
  .steps button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -4px;
    border-radius: 8px;
  }
  .steps button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .steps button.current {
    color: var(--ink);
  }
  .steps button.current::after {
    transform: scaleX(1);
  }
  .steps button.done {
    color: var(--ink);
  }
  .n {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
    border: 1.5px solid var(--line-2);
    flex: none;
    transition:
      background 0.2s,
      border-color 0.2s;
  }
  .n svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .current .n {
    background: var(--accent-fill);
    border-color: var(--accent-fill);
    color: var(--accent-ink);
  }
  .done .n {
    border-color: var(--good);
    background: var(--good);
    color: var(--panel);
  }
  .s {
    display: none;
  }
  /* progresso: linha preenchida até a etapa atual, na base da faixa */
  .progress {
    height: 2px;
    background: transparent;
  }
  .progress .fill {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, var(--good), var(--accent-fill));
    transform-origin: left;
    transition: transform 0.5s var(--ease-out);
  }
  .fill-0 { transform: scaleX(calc(1 / 7)); }
  .fill-1 { transform: scaleX(calc(2 / 7)); }
  .fill-2 { transform: scaleX(calc(3 / 7)); }
  .fill-3 { transform: scaleX(calc(4 / 7)); }
  .fill-4 { transform: scaleX(calc(5 / 7)); }
  .fill-5 { transform: scaleX(calc(6 / 7)); }
  .fill-6 { transform: scaleX(1); }
  .boot {
    margin-left: auto;
    white-space: nowrap;
    font-size: 0.78rem;
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 24px;
    max-width: 1440px;
    margin: 0 auto;
    padding: 24px;
  }
  /* Assistente: até 1.180 px fica por cima da tela; acima disso vira a segunda coluna. */
  .assistant {
    position: fixed;
    z-index: 25;
    top: 64px;
    right: 12px;
    bottom: 12px;
    width: min(400px, calc(100vw - 24px));
  }
  @media (min-width: 1181px) {
    .layout.with-assistant {
      grid-template-columns: minmax(0, 1fr) 380px;
      max-width: 1760px;
    }
    .assistant {
      position: sticky;
      top: 132px;
      right: auto;
      bottom: auto;
      width: auto;
      height: calc(100vh - 152px);
      align-self: start;
    }
  }
  main {
    min-width: 0;
  }
  .err {
    margin-bottom: 16px;
  }
  .busy,
  .toast {
    position: fixed;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--console);
    color: var(--console-ink);
    padding: 9px 16px;
    border-radius: 999px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.88rem;
    box-shadow: var(--shadow-lift);
    z-index: 30;
  }
  .toast {
    bottom: 62px;
  }
  .foot {
    max-width: 1440px;
    margin: 0 auto;
    padding: 8px 24px 40px;
    text-align: center;
  }
  @media (max-width: 1100px) {
    .boot {
      display: none;
    }
  }
  @media (max-width: 900px) {
    .layout {
      padding: 16px;
      gap: 12px;
    }
    .steps-in {
      padding: 0;
    }
    .project {
      padding: 8px 16px 0;
    }
    .steps ol {
      padding: 0 8px;
      mask-image: linear-gradient(90deg, transparent, #000 12px, #000 calc(100% - 28px), transparent);
    }
    .steps button {
      padding: 10px 10px 11px;
    }
    .l {
      display: none;
    }
    .s {
      display: inline;
    }
    .tag {
      display: none;
    }
    .top {
      padding: 0 12px;
    }
  }
  @media (max-width: 640px) {
    .privacy {
      display: none;
    }
  }
</style>
