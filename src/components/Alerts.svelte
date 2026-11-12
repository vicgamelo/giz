<script lang="ts">
  import { app } from "../lib/state.svelte";
  import { sameStep } from "../lib/recipe";
  import type { Alert } from "../lib/types";

  let { alerts, limit = 12 }: { alerts: Alert[]; limit?: number } = $props();
  let all = $state(false);
  const order = { danger: 0, warn: 1, info: 2 };
  const sorted = $derived([...alerts].sort((a, b) => order[a.severity] - order[b.severity]));
  const shown = $derived(all ? sorted : sorted.slice(0, limit));
  const inRecipe = (a: Alert) => !!a.fix && app.steps.some((s) => sameStep(s, a.fix!));
</script>

{#if alerts.length === 0}
  <p class="muted small">Nenhum alerta. 🎉</p>
{:else}
  <ul>
    {#each shown as a, i (a.code + (a.column ?? "") + i)}
      <li class="alert {a.severity}">
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
  {#if sorted.length > limit}
    <button class="btn ghost sm more" onclick={() => (all = !all)}>
      {all ? "Mostrar menos" : `Mostrar todos (${sorted.length})`}
    </button>
  {/if}
{/if}

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  li {
    align-items: center;
  }
  .more {
    margin-top: 8px;
  }
</style>
