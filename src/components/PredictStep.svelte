<script lang="ts">
  import { app, SAMPLES } from "../lib/state.svelte";
  import { fmtInt, fmtMetric, fmtNum, metricLabel } from "../lib/format";
  import DataTable from "./DataTable.svelte";
  import Dropzone from "./Dropzone.svelte";

  const r = $derived(app.result!);
  const sample = $derived(SAMPLES.find((s) => s.id === app.sampleId));
  const b = $derived(app.batch);
  const needed = $derived([...r.features.numeric, ...r.features.categorical]);
  const rowRemoving = $derived(app.steps.filter((s) => !s.disabled && ["filter_rows", "drop_duplicates"].includes(s.op)));
  const removeOutliers = $derived(app.steps.some((s) => !s.disabled && s.op === "remove_outliers" && s.action === "remove"));
  const trainOnly = $derived([
    ...rowRemoving.map((s) => (s.op === "filter_rows" ? "o filtro" : "a remoção de repetidas")),
    ...(removeOutliers ? ["o corte de outliers (que vira “limitar”)"] : []),
  ]);

  async function useSample() {
    if (!sample) return;
    const resp = await fetch(`/samples/${sample.batch}`);
    await app.predict(sample.batch, await resp.arrayBuffer());
  }

  const dist = $derived(b && Array.isArray(b.summary.distribution) ? (b.summary.distribution as [string, number][]) : null);
  const distMax = $derived(dist ? Math.max(...dist.map((d) => d[1]), 1) : 1);
</script>

<div class="panel-head">
  <div>
    <h2>Prever em lote</h2>
    <p class="muted small">
      Suba uma planilha nova com as mesmas colunas do arquivo original. A receita roda igual (com os valores aprendidos no
      treino) e o modelo final, treinado com todas as linhas, faz as previsões.
    </p>
  </div>
  <button class="btn primary" onclick={() => (app.current = "export")}>Exportar →</button>
</div>

<div class="cols2">
  <div class="panel">
    <Dropzone
      onfile={(name, data) => app.predict(name, data)}
      title="Arraste a planilha nova"
      hint="CSV ou Excel · a coluna alvo pode vir ou não"
      disabled={!!app.busy}
    />
    {#if sample}
      <button class="btn sm try" onclick={useSample} disabled={!!app.busy}>Usar {sample.batch} (exemplo)</button>
    {/if}
  </div>
  <div class="panel">
    <h3>O que o modelo usa</h3>
    <p class="small muted">{needed.length} colunas depois da receita:</p>
    <p class="small cols">{needed.join(", ")}</p>
    {#if rowRemoving.length || removeOutliers}
      <p class="small note">
        Na previsão nenhuma linha é removida: {trainOnly.join(" e ")}
        {trainOnly.length > 1 ? "ficam" : "fica"} só no treino.
      </p>
    {/if}
  </div>
</div>

{#if b}
  <div class="panel result">
    <div class="panel-head">
      <h3>{fmtInt(b.summary.rows)} previsões</h3>
      <a class="btn primary" href={b.url} download={b.name}>⬇ Baixar {b.name}</a>
    </div>
    <div class="kpis">
      {#if dist}
        {#each dist as [label, n] (label)}
          <div class="kpi">
            <div class="v">{fmtInt(n)}</div>
            <div class="l">previsto “{label}”</div>
            <div class="bar"><span style:width="{(n / distMax) * 100}%"></span></div>
          </div>
        {/each}
      {:else}
        {@const d = b.summary.distribution as { mean: number; min: number; max: number }}
        <div class="kpi"><div class="v">{fmtNum(d.mean)}</div><div class="l">média prevista</div></div>
        <div class="kpi"><div class="v">{fmtNum(d.min)}</div><div class="l">mínimo</div></div>
        <div class="kpi"><div class="v">{fmtNum(d.max)}</div><div class="l">máximo</div></div>
      {/if}
      {#if b.summary.rows_with_missing}
        <div class="kpi"><div class="v">{fmtInt(b.summary.rows_with_missing)}</div><div class="l">linhas com vazios (imputados)</div></div>
      {/if}
    </div>
    {#if b.summary.check}
      <p class="small check">
        A planilha tinha a coluna “{r.target}”, então dá para conferir: em {fmtInt(b.summary.check.rows)} linhas,
        {#each Object.entries(b.summary.check).filter(([k]) => k !== "rows") as [k, v], i (k)}
          {i ? " · " : ""}{metricLabel(k)} <b>{fmtMetric(k, v)}</b>
        {/each}.
      </p>
    {/if}
    <DataTable table={b.summary.preview} highlight={b.summary.columns} maxRows={20} />
    <p class="small muted foot">
      O CSV sai em UTF-8 com o separador do arquivo original. Células que começam com = + − @ ganham um ' na frente, para a
      planilha não executar fórmula.
    </p>
  </div>
{/if}

<style>
  .cols2 {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
    gap: 16px;
  }
  .cols2 .panel + .panel {
    margin-top: 0;
  }
  .try {
    margin-top: 10px;
  }
  .cols {
    overflow-wrap: anywhere;
    margin-top: 4px;
  }
  .note {
    margin-top: 10px;
    padding: 8px 10px;
    background: var(--info-soft);
    border-radius: 8px;
  }
  .result {
    margin-top: 16px;
  }
  .kpis {
    margin-bottom: 12px;
  }
  .bar {
    height: 5px;
    background: var(--line);
    border-radius: 3px;
    margin-top: 6px;
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--bar);
  }
  .check {
    margin-bottom: 12px;
  }
  .foot {
    margin-top: 8px;
  }
  @media (max-width: 900px) {
    .cols2 {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
