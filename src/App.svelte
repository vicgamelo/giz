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

  $effect(() => {
    if (!app.toast) return;
    const t = setTimeout(() => (app.toast = null), 2600);
    return () => clearTimeout(t);
  });
</script>

<header class="top">
  <div class="brand">
    <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
      <rect width="32" height="32" rx="7" class="logo-bg" />
      <path d="M7 22l6-6 4 3 8-9" class="logo-line" />
      <circle cx="25" cy="10" r="2.2" class="logo-dot" />
    </svg>
    <div>
      <strong>Giz</strong>
      <span class="tag">AutoML no navegador · open source</span>
    </div>
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
    <button class="btn sm assist-btn" class:on={assistant.open} onclick={toggleAssistant} aria-expanded={assistant.open} aria-controls={assistant.open ? "assistente" : undefined}>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
        ><path d="M4 5h16v11H9l-5 4V5z" class="moon" /></svg
      >
      Assistente
    </button>
    <button class="btn ghost sm" onclick={toggleTheme} aria-label="Alternar tema claro/escuro">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
        ><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" class="moon" /></svg
      >
    </button>
  </div>
</header>

<div class="layout" class:with-assistant={assistant.open}>
  <nav class="steps" aria-label="Etapas">
    <ol>
      {#each STEPS as s, i (s.key)}
        <li>
          <button
            class:current={app.current === s.key}
            class:done={i < index && app.reached[s.key]}
            disabled={!app.reached[s.key]}
            onclick={() => go(s.key)}
            aria-current={app.current === s.key ? "step" : undefined}
          >
            <span class="n">{i + 1}</span>
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
  </nav>

  <main>
    {#if app.error}
      <div class="alert danger err" role="alert">
        <div class="msg">{app.error}</div>
        <button class="btn ghost sm" onclick={() => (app.error = null)}>Fechar</button>
      </div>
    {/if}
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
  .top {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 20px;
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--line);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .brand strong {
    font-size: 1.1rem;
    letter-spacing: -0.02em;
    display: block;
    line-height: 1.1;
  }
  .tag {
    font-size: 0.75rem;
    color: var(--muted);
  }
  .logo-bg {
    fill: var(--chalk);
  }
  .logo-line {
    fill: none;
    stroke: #e8f5f2;
    stroke-width: 2.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .logo-dot {
    fill: #2dd4bf;
  }
  .right {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .privacy {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--good);
    background: color-mix(in srgb, var(--good) 10%, transparent);
    padding: 4px 10px;
    border-radius: 999px;
  }
  .privacy.out {
    color: var(--warn);
    background: var(--warn-soft);
  }
  .assist-btn.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .shield {
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
  .moon {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
  }
  .py {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .py.ok {
    color: var(--good);
  }
  .py.err {
    color: var(--danger);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }
  .layout {
    display: grid;
    grid-template-columns: 230px minmax(0, 1fr);
    gap: 24px;
    max-width: 1320px;
    margin: 0 auto;
    padding: 20px;
  }
  .steps {
    position: sticky;
    top: 74px;
    align-self: start;
  }
  /* Assistente: até 1.180 px fica por cima da tela (a coluna do meio ficaria estreita demais); acima disso vira a
     terceira coluna. */
  .assistant {
    position: fixed;
    z-index: 25;
    top: 62px;
    right: 12px;
    bottom: 12px;
    width: min(400px, calc(100vw - 24px));
  }
  @media (min-width: 1181px) {
    .layout.with-assistant {
      grid-template-columns: 230px minmax(0, 1fr) 380px;
      max-width: 1700px;
    }
    .assistant {
      position: sticky;
      top: 74px;
      right: auto;
      bottom: auto;
      width: auto;
      height: calc(100vh - 94px);
      align-self: start;
    }
  }
  .steps ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  .steps button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px;
    border-radius: 10px;
    border: 1px solid transparent;
    background: transparent;
    text-align: left;
    color: var(--muted);
    font-weight: 600;
  }
  .steps button:hover:not(:disabled) {
    background: var(--panel);
    border-color: var(--line);
  }
  .steps button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .steps button.current {
    background: var(--panel);
    border-color: var(--line);
    color: var(--ink);
    box-shadow: var(--shadow);
  }
  .n {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 0.78rem;
    border: 1.5px solid var(--line-2);
    flex: none;
  }
  .current .n {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  .done .n {
    border-color: var(--accent);
    color: var(--accent);
  }
  .s {
    display: none;
  }
  .boot {
    margin-top: 14px;
    padding: 0 10px;
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
    background: var(--ink);
    color: var(--bg);
    padding: 9px 16px;
    border-radius: 999px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.88rem;
    box-shadow: var(--shadow);
    z-index: 30;
  }
  .toast {
    bottom: 62px;
  }
  .foot {
    max-width: 1320px;
    margin: 0 auto;
    padding: 8px 20px 40px;
    text-align: center;
  }
  @media (max-width: 900px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
      padding: 12px 16px;
      gap: 12px;
    }
    .steps {
      position: static;
      overflow-x: auto;
    }
    .steps ol {
      grid-auto-flow: column;
      grid-auto-columns: max-content;
    }
    .l {
      display: none;
    }
    .s {
      display: inline;
    }
    .boot,
    .tag {
      display: none;
    }
    .top {
      padding: 8px 16px;
    }
  }
  @media (max-width: 560px) {
    .privacy {
      display: none;
    }
  }
</style>
