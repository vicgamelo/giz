<script lang="ts">
  import { app } from "../lib/state.svelte";
  import { fmtInt, fmtNum, fmtPct, KINDS } from "../lib/format";
  import type { Column } from "../lib/types";
  import Alerts from "./Alerts.svelte";
  import DataTable from "./DataTable.svelte";
  import Heatmap from "./Heatmap.svelte";
  import MiniHist from "./MiniHist.svelte";

  const p = $derived(app.rawProfile!);
  let filter = $state("");
  const cols = $derived(
    p.columns.filter((c) => !filter || c.name.toLowerCase().includes(filter.toLowerCase())),
  );
  const alertsByCol = $derived(
    Object.fromEntries(p.columns.map((c) => [c.name, p.alerts.filter((a) => a.column === c.name)])),
  );

  function topMax(c: Column) {
    return Math.max(...(c.top ?? []).map((t) => t[1]), 1);
  }
</script>

<div class="panel-head">
  <div>
    <h2>Perfil dos dados</h2>
    <p class="muted small">
      {app.source?.filename}{#if app.source?.sheet}{" · "}aba “{app.source.sheet}”{/if}
      {#if app.source?.format === "csv"}
        · separador “{app.source.sep === "\t" ? "tab" : app.source.sep}”, decimal “{app.source.decimal}”, {app.source.encoding}
      {/if}
    </p>
  </div>
  <button class="btn primary" onclick={() => (app.current = "recipe")}>Montar a receita →</button>
</div>

<div class="kpis">
  <div class="kpi"><div class="v">{fmtInt(p.rows)}</div><div class="l">linhas</div></div>
  <div class="kpi"><div class="v">{fmtInt(p.cols)}</div><div class="l">colunas</div></div>
  <div class="kpi">
    <div class="v">{fmtPct(p.missing_cells / Math.max(p.rows * p.cols, 1))}</div>
    <div class="l">células vazias ({fmtInt(p.missing_cells)})</div>
  </div>
  <div class="kpi"><div class="v">{fmtInt(p.duplicates)}</div><div class="l">linhas repetidas</div></div>
  <div class="kpi"><div class="v">{fmtNum(p.memory_mb, 1)} MB</div><div class="l">na memória do navegador</div></div>
</div>

<div class="panel alerts">
  <div class="panel-head">
    <h3>Alertas <span class="chip">{p.alerts.length}</span></h3>
    <span class="small muted">“Corrigir” adiciona o passo na receita; nada muda nos dados originais.</span>
  </div>
  <Alerts alerts={p.alerts} />
</div>

<div class="panel">
  <div class="panel-head">
    <h3>Colunas</h3>
    <input type="text" placeholder="Filtrar colunas…" bind:value={filter} aria-label="Filtrar colunas" />
  </div>
  <div class="cols">
    {#each cols as c (c.name)}
      <article class="col">
        <header>
          <strong title={c.name}>{c.name}</strong>
          <span class="chip">{KINDS[c.kind]}</span>
        </header>
        <div class="meta small muted">
          <span>{fmtInt(c.unique)} distintos</span>
          <span class:bad={c.missing_pct > 0}>{c.missing ? `${fmtNum(c.missing_pct, 1)}% vazios` : "sem vazios"}</span>
        </div>
        {#if c.missing}
          <div class="miss"><div class="fill" style:width="{Math.min(c.missing_pct, 100)}%"></div></div>
        {/if}
        {#if c.hist}
          <MiniHist counts={c.hist.counts} edges={c.hist.edges} dates={c.kind === "datetime"} />
          {#if c.stats && c.kind === "numeric"}
            <div class="stats small">
              <span>média <b>{fmtNum(c.stats.mean as number)}</b></span>
              <span>mediana <b>{fmtNum(c.stats.median as number)}</b></span>
              <span>máx <b>{fmtNum(c.stats.max as number)}</b></span>
            </div>
          {/if}
        {:else if c.top}
          <ul class="top">
            {#each c.top.slice(0, 5) as [v, n] (v)}
              <li>
                <span class="tv" title={v}>{v}</span>
                <span class="tb"><span class="tf" style:width="{(n / topMax(c)) * 100}%"></span></span>
                <span class="tn num">{fmtInt(n)}</span>
              </li>
            {/each}
            {#if c.top.length > 5 || c.other}
              <li class="small muted">+ {fmtInt(c.unique - 5)} outras</li>
            {/if}
          </ul>
        {/if}
        {#if alertsByCol[c.name]?.length}
          <div class="flags">
            {#each alertsByCol[c.name] as a (a.code)}
              <span class="chip {a.severity === 'warn' ? 'warn' : a.severity === 'danger' ? 'danger' : 'info'}"
                >{a.code.replaceAll("_", " ")}</span
              >
            {/each}
          </div>
        {/if}
      </article>
    {/each}
  </div>
</div>

{#if p.correlations.columns.length >= 2}
  <div class="panel">
    <div class="panel-head">
      <h3>Correlações entre colunas numéricas</h3>
      <span class="small muted">Pares muito correlacionados carregam a mesma informação.</span>
    </div>
    <Heatmap columns={p.correlations.columns} matrix={p.correlations.matrix} />
  </div>
{/if}

<div class="panel">
  <div class="panel-head">
    <h3>Primeiras linhas</h3>
    <span class="small muted">{Math.min(50, p.rows)} de {fmtInt(p.rows)}</span>
  </div>
  <DataTable table={p.head} />
</div>

<style>
  .kpis {
    margin: 4px 0 16px;
  }
  .alerts {
    margin-bottom: 16px;
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 12px;
  }
  .col {
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 12px;
    background: var(--panel-2);
    display: grid;
    gap: 8px;
    align-content: start;
  }
  .col header {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: center;
  }
  .col header strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    display: flex;
    justify-content: space-between;
  }
  .meta .bad {
    color: var(--warn);
    font-weight: 600;
  }
  .miss {
    height: 4px;
    background: var(--line);
    border-radius: 2px;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--warn);
  }
  .stats {
    display: flex;
    justify-content: space-between;
    color: var(--muted);
    gap: 6px;
  }
  .stats b {
    color: var(--ink);
    font-weight: 600;
  }
  .top {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 3px;
    font-size: 0.8rem;
  }
  .top li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 70px 42px;
    gap: 6px;
    align-items: center;
  }
  .tv {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tb {
    height: 6px;
    background: var(--line);
    border-radius: 3px;
    overflow: hidden;
  }
  .tf {
    display: block;
    height: 100%;
    background: var(--bar);
  }
  .tn {
    text-align: right;
    color: var(--muted);
  }
  .flags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
</style>
