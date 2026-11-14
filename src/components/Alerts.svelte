<script lang="ts">
  import { app } from "../lib/state.svelte";
  import { sameStep } from "../lib/recipe";
  import type { Alert } from "../lib/types";

  let { alerts, limit = 12, foldInfo = false }: { alerts: Alert[]; limit?: number; foldInfo?: boolean } = $props();
  let all = $state(false);
  const order = { danger: 0, warn: 1, info: 2 };
  const sorted = $derived([...alerts].sort((a, b) => order[a.severity] - order[b.severity]));
  // Com foldInfo, as dicas ficam recolhidas embaixo e os de atenção/graves vêm primeiro, sem empurrar o resto da tela.
  const main = $derived(foldInfo && sorted.some((a) => a.severity !== "info") ? sorted.filter((a) => a.severity !== "info") : sorted);
  const tips = $derived(main.length === sorted.length ? [] : sorted.filter((a) => a.severity === "info"));
  const shown = $derived(all ? main : main.slice(0, limit));
  const inRecipe = (a: Alert) => !!a.fix && app.steps.some((s) => sameStep(s, a.fix!));
</script>

{#if alerts.length === 0}
  <p class="muted small">Nenhum alerta. 🎉</p>
{:else}
  <ul>
    {#each shown as a, i (a.code + (a.column ?? "") + i)}
      <li class="row {a.severity}" class:first={i === 0 || shown[i - 1].severity !== a.severity}>
        <span class="chip {a.severity === 'danger' ? 'danger' : a.severity === 'warn' ? 'warn' : 'info'}">
          {a.severity === "danger" ? "grave" : a.severity === "warn" ? "atenção" : "dica"}
        </span>
        <span class="msg">{a.message}</span>
        {#if a.fix}
          {#if inRecipe(a)}
            <span class="chip accent">na receita</span>
          {:else}
            <button class="btn sm" onclick={() => app.addStep({ ...a.fix! })}>Corrigir</button>
          {/if}
        {/if}
      </li>
    {/each}
  </ul>
  {#if main.length > limit}
    <button class="btn ghost sm more" onclick={() => (all = !all)}>
      {all ? "Mostrar menos" : `Mostrar todos (${main.length})`}
    </button>
  {/if}
  {#if tips.length}
    <details class="tips">
      <summary>{tips.length} {tips.length === 1 ? "dica" : "dicas"} de tratamento</summary>
      <ul>
        {#each tips as a, i (a.code + (a.column ?? "") + i)}
          <li class="row info">
            <span class="chip info">dica</span>
            <span class="msg">{a.message}</span>
            {#if a.fix}
              {#if inRecipe(a)}
                <span class="chip accent">na receita</span>
              {:else}
                <button class="btn sm" onclick={() => app.addStep({ ...a.fix! })}>Corrigir</button>
              {/if}
            {/if}
          </li>
        {/each}
      </ul>
    </details>
  {/if}
{/if}

<style>
  .tips {
    margin-top: 10px;
  }
  .tips summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 0.88rem;
    color: var(--accent);
    padding: 6px 2px;
  }
  .tips ul {
    margin-top: 6px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 12px;
    overflow: hidden;
  }
  /* Uma linha por alerta, com a cor só na borda e no selo; grupos separados por uma linha mais forte. */
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 12px 9px 14px;
    border-top: 1px solid var(--line);
    border-left: 3px solid var(--sev);
    background: var(--panel);
  }
  .row:first-child {
    border-top: 0;
  }
  .row.first:not(:first-child) {
    border-top: 1px solid var(--line-2);
  }
  .row.danger {
    --sev: var(--danger);
    background: color-mix(in srgb, var(--danger-soft) 55%, var(--panel));
  }
  .row.warn {
    --sev: var(--warn);
  }
  .row.info {
    --sev: var(--info);
  }
  .row .chip {
    min-width: 64px;
    justify-content: center;
  }
  .msg {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .more {
    margin-top: 8px;
  }
  @media (max-width: 560px) {
    .row {
      flex-wrap: wrap;
      gap: 6px 10px;
    }
    .msg {
      flex-basis: calc(100% - 80px);
    }
    .row .btn,
    .row > .chip.accent {
      margin-left: 76px;
    }
  }
</style>
