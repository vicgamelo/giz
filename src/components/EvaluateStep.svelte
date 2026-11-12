<script lang="ts">
  import { app } from "../lib/state.svelte";
  import { confusionAt, linear, polyline, ticks } from "../lib/charts";
  import { fmtCell, fmtFixed, fmtInt, fmtMetric, fmtNum, fmtPct, metricLabel, METRICS, PROBLEMS } from "../lib/format";
  import DataTable from "./DataTable.svelte";
  import HBars from "./HBars.svelte";
  import MiniHist from "./MiniHist.svelte";

  const r = $derived(app.result!);
  const ev = $derived(r.evaluation);
  const binary = $derived(r.problem === "binary");
  const shownMetrics = $derived(
    (r.problem === "regression"
      ? ["rmse", "mae", "r2"]
      : binary
        ? ["roc_auc", "accuracy", "precision", "recall", "f1"]
        : ["f1_macro", "accuracy", "balanced_accuracy"]
    ).filter((k) => ev.metrics[k] != null),
  );

  let threshold = $state(0.5);
  const cm = $derived(binary && ev.scores ? confusionAt(ev.scores.y, ev.scores.p, threshold) : null);
  const matrix = $derived(cm ? cm.matrix : (ev.confusion ?? []));
  const cmMax = $derived(Math.max(...matrix.flat(), 1));

  // ROC
  const W = 300;
  const H = 300;
  const P = 34;
  const sx = linear(0, 1, P, W - 8);
  const sy = linear(0, 1, H - P, 8);
  const roc = $derived(ev.roc ? polyline(ev.roc.fpr, ev.roc.tpr, sx, sy) : "");
  const fprAt = $derived(cm ? cm.matrix[0][1] / Math.max(cm.matrix[0][0] + cm.matrix[0][1], 1) : 0);

  // resíduos
  const res = $derived(ev.residuals);
  const lim = $derived.by(() => {
    if (!res) return { min: 0, max: 1 };
    const all = [...res.actual, ...res.pred];
    return { min: Math.min(...all), max: Math.max(...all) };
  });
  const rx = $derived(linear(lim.min, lim.max, P, W - 8));
  const ry = $derived(linear(lim.min, lim.max, H - P, 8));

  // explicação
  let selected = $state(0);
  const sample = $derived(r.holdout_sample);
  const form = $state<Record<string, string>>({});
  const numeric = $derived(new Set(r.features.numeric));

  function pick(i: number) {
    selected = i;
    const row = Object.fromEntries(sample.columns.map((c, j) => [c, sample.rows[i][j]]));
    for (const c of sample.columns) form[c] = row[c] == null ? "" : String(row[c]);
    void app.explain(row);
  }

  function whatIf() {
    const row: Record<string, unknown> = {};
    for (const c of sample.columns) row[c] = form[c] === "" ? null : numeric.has(c) ? Number(form[c]) : form[c];
    void app.explain(row);
  }

  let started = false;
  $effect(() => {
    if (!started && !app.explanation && sample.rows.length) {
      started = true;
      pick(0);
    }
  });

  const exp = $derived(app.explanation);
  const effectFmt = (v: number) =>
    r.problem === "regression" ? (v > 0 ? "+" : "") + fmtNum(v, 3) : (v > 0 ? "+" : "") + fmtNum(v * 100, 1) + " p.p.";
  const levels = $derived.by(() => {
    const out: Record<string, string[]> = {};
    for (const c of r.features.categorical) {
      const j = sample.columns.indexOf(c);
      out[c] = [...new Set(sample.rows.map((row) => row[j]).filter((v) => v != null).map(String))].sort();
    }
    return out;
  });
</script>

<div class="panel-head">
  <div>
    <h2>Avaliação · {r.best.label}</h2>
    <p class="muted small">
      {PROBLEMS[r.problem]} · alvo <b>{r.target}</b> · medido em {fmtInt(r.holdout_rows)} linhas que o treino nunca viu.
      {#if app.stale}<span class="chip warn">a receita mudou desde o treino</span>{/if}
    </p>
  </div>
  <button class="btn primary" onclick={() => (app.current = "predict")}>Prever em lote →</button>
</div>

<div class="kpis">
  {#each shownMetrics as k (k)}
    <div class="kpi" title={METRICS[k]?.help}>
      <div class="v">{fmtMetric(k, ev.metrics[k])}</div>
      <div class="l">{metricLabel(k)}</div>
    </div>
  {/each}
  {#if r.baseline?.score != null}
    <div class="kpi ref" title="O modelo que sempre chuta a classe mais comum (ou a média), na validação cruzada.">
      <div class="v">{fmtMetric(r.metric, r.baseline.score)}</div>
      <div class="l">{metricLabel(r.metric)} da referência</div>
    </div>
  {/if}
</div>

<div class="charts">
  {#if r.problem !== "regression"}
    <div class="panel">
      <div class="panel-head">
        <h3>Matriz de confusão</h3>
        {#if cm}<span class="small muted">corte em {fmtNum(threshold, 2)}</span>{/if}
      </div>
      <div class="cm" style:grid-template-columns="auto repeat({matrix.length}, minmax(0, 1fr))">
        <span></span>
        {#each r.classes ?? [] as c (c)}<span class="h small muted">previsto<br /><b>{c}</b></span>{/each}
        {#each matrix as row, i (i)}
          <span class="h small muted side">real<br /><b>{r.classes?.[i]}</b></span>
          {#each row as v, j (j)}
            <span class="cell" class:diag={i === j} style:--a={v / cmMax}>
              <b class="num">{fmtInt(v)}</b>
              <small>{fmtPct(v / Math.max(row.reduce((a, b) => a + b, 0), 1), 0)}</small>
            </span>
          {/each}
        {/each}
      </div>
      {#if cm}
        <label class="field thr">
          <span>Corte de probabilidade para “{r.classes?.[1]}”</span>
          <input type="range" min="0.05" max="0.95" step="0.01" bind:value={threshold} />
        </label>
        <p class="small">
          acurácia <b>{fmtPct(cm.accuracy)}</b> · precisão <b>{fmtPct(cm.precision)}</b> · recall
          <b>{fmtPct(cm.recall)}</b> · marca <b>{fmtPct(cm.flagged)}</b> das linhas
        </p>
      {/if}
    </div>
  {/if}

  {#if ev.roc}
    <div class="panel">
      <div class="panel-head">
        <h3>Curva ROC</h3>
        <span class="small muted">AUC {fmtNum(ev.metrics.roc_auc, 3)}</span>
      </div>
      <svg viewBox="0 0 {W} {H}" class="plot" role="img" aria-label="Curva ROC">
        {#each ticks(0, 1, 4) as t (t)}
          <line x1={sx(t)} x2={sx(t)} y1={sy(0)} y2={sy(1)} class="grid" />
          <line x1={sx(0)} x2={sx(1)} y1={sy(t)} y2={sy(t)} class="grid" />
          <text x={sx(t)} y={H - P + 14} text-anchor="middle">{fmtNum(t, 2)}</text>
          <text x={P - 6} y={sy(t) + 4} text-anchor="end">{fmtNum(t, 2)}</text>
        {/each}
        <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} class="diag" />
        <polyline points={roc} class="curve" />
        {#if cm}<circle cx={sx(fprAt)} cy={sy(cm.recall)} r="5" class="pt" />{/if}
        <text x={(P + W) / 2} y={H - 2} text-anchor="middle">falsos positivos</text>
        <text x="10" y={H / 2} transform="rotate(-90 10 {H / 2})" text-anchor="middle">verdadeiros positivos</text>
      </svg>
    </div>
  {/if}

  {#if res}
    <div class="panel">
      <div class="panel-head"><h3>Previsto × real</h3><span class="small muted">R² {fmtNum(ev.metrics.r2, 3)}</span></div>
      <svg viewBox="0 0 {W} {H}" class="plot" role="img" aria-label="Previsto contra real">
        {#each ticks(lim.min, lim.max, 4) as t (t)}
          <line x1={rx(t)} x2={rx(t)} y1={ry(lim.min)} y2={ry(lim.max)} class="grid" />
          <line x1={rx(lim.min)} x2={rx(lim.max)} y1={ry(t)} y2={ry(t)} class="grid" />
          <text x={rx(t)} y={H - P + 14} text-anchor="middle">{fmtNum(t, 2)}</text>
          <text x={P - 6} y={ry(t) + 4} text-anchor="end">{fmtNum(t, 2)}</text>
        {/each}
        <line x1={rx(lim.min)} y1={ry(lim.min)} x2={rx(lim.max)} y2={ry(lim.max)} class="diag" />
        {#each res.actual as a, i (i)}
          <circle cx={rx(a)} cy={ry(res.pred[i])} r="2" class="dot" />
        {/each}
        <text x={(P + W) / 2} y={H - 2} text-anchor="middle">real</text>
        <text x="10" y={H / 2} transform="rotate(-90 10 {H / 2})" text-anchor="middle">previsto</text>
      </svg>
    </div>
    {#if ev.error_hist}
      <div class="panel">
        <div class="panel-head"><h3>Erros (previsto − real)</h3><span class="small muted">RMSE {fmtNum(ev.metrics.rmse)}</span></div>
        <MiniHist counts={ev.error_hist.counts} edges={ev.error_hist.edges} height={150} width={300} />
      </div>
    {/if}
  {/if}
</div>

<div class="panel">
  <div class="panel-head">
    <h3>O que mais pesa no modelo</h3>
    <span class="small muted">Importância por permutação no holdout: quanto a {metricLabel(r.metric)} piora ao embaralhar a coluna.</span>
  </div>
  <HBars
    items={ev.importance.slice(0, 15).map((d) => ({ label: d.column, value: d.importance, sub: `± ${fmtFixed(d.std, 3)}` }))}
    format={(v) => fmtFixed(v, 3)}
    highlight={ev.importance[0]?.column}
  />
</div>

<div class="panel">
  <div class="panel-head">
    <h3>Explicar uma previsão</h3>
    <span class="small muted">Escolha uma linha do holdout ou mude os valores e veja a previsão mudar.</span>
  </div>
  <div class="explain">
    <div class="formcol">
      {#if exp}
        <div class="verdict">
          {#if r.problem === "regression"}
            <span class="small muted">previsão</span>
            <b class="big num">{fmtNum(exp.value, 3)}</b>
          {:else}
            <span class="small muted">previsão</span>
            <b class="big">{exp.label}</b>
            {#if binary && exp.positive}
              <span class="small">probabilidade de “{exp.positive}”: <b>{fmtPct(exp.value)}</b></span>
              <div class="gauge"><div class="gfill" style:width="{exp.value * 100}%"></div></div>
            {/if}
          {/if}
          <span class="small muted">real: <b>{sample.actual[selected] ?? "–"}</b></span>
        </div>
      {/if}
      <form
        class="whatif"
        onsubmit={(e) => {
          e.preventDefault();
          whatIf();
        }}
      >
        {#each sample.columns as c (c)}
          <label class="field">
            <span>{c}</span>
            {#if levels[c]}
              <select bind:value={form[c]} onchange={whatIf}>
                <option value="">vazio</option>
                {#each levels[c] as l (l)}<option value={l}>{l}</option>{/each}
              </select>
            {:else}
              <input type="text" inputmode="decimal" bind:value={form[c]} onchange={whatIf} />
            {/if}
          </label>
        {/each}
      </form>
    </div>
    <div class="contrib">
      {#if exp}
        <p class="small muted">
          Efeito de cada variável: quanto a {r.problem === "regression" ? "previsão" : "probabilidade"} muda em relação a
          trocar só ela pelo valor típico do treino (mediana ou moda). Laranja empurra para cima, azul para baixo.
        </p>
        <HBars
          items={exp.contributions.slice(0, 14).map((c) => ({
            label: `${c.column} = ${c.value == null ? "vazio" : fmtCell(c.value)}`,
            value: c.effect,
            sub: `típico: ${c.reference == null ? "vazio" : fmtCell(c.reference)}`,
          }))}
          format={effectFmt}
          signColors
          labelWidth={220}
        />
      {/if}
      <h4 class="small muted pick">Linhas do holdout</h4>
      <DataTable
        table={sample}
        maxRows={60}
        selected={selected}
        onrow={pick}
        extra={[
          { label: "real", values: sample.actual },
          { label: "previsto", values: sample.pred },
        ]}
      />
    </div>
  </div>
</div>

<style>
  .kpis {
    margin: 4px 0 16px;
  }
  .ref {
    border-style: dashed;
  }
  .ref .v {
    color: var(--muted);
  }
  .charts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 16px;
    margin-bottom: 16px;
  }
  .charts .panel + .panel {
    margin-top: 0;
  }
  .cm {
    display: grid;
    gap: 4px;
  }
  .h {
    text-align: center;
    align-self: end;
  }
  .side {
    text-align: right;
    align-self: center;
    padding-right: 6px;
  }
  .cell {
    display: grid;
    place-items: center;
    padding: 14px 6px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--neg) calc(var(--a) * 55%), var(--panel-2));
    border: 1px solid var(--line);
  }
  .cell.diag {
    background: color-mix(in srgb, var(--accent) calc(var(--a) * 70%), var(--panel-2));
  }
  .cell b {
    font-size: 1.2rem;
  }
  .cell small {
    color: var(--muted);
  }
  .thr {
    margin-top: 12px;
  }
  .plot {
    width: 100%;
    max-width: 360px;
    height: auto;
    display: block;
    margin: 0 auto;
  }
  .grid {
    stroke: var(--line);
  }
  .diag {
    stroke: var(--line-2);
    stroke-dasharray: 4 4;
  }
  .curve {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2.5;
    stroke-linejoin: round;
  }
  .pt {
    fill: var(--pos);
    stroke: var(--panel);
    stroke-width: 2;
  }
  .dot {
    fill: var(--accent);
    opacity: 0.45;
  }
  .explain {
    display: grid;
    grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
    gap: 18px;
  }
  .verdict {
    display: grid;
    gap: 4px;
    padding: 12px;
    border-radius: 10px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    margin-bottom: 12px;
  }
  .big {
    font-size: 1.6rem;
    letter-spacing: -0.02em;
  }
  .gauge {
    height: 8px;
    background: var(--line);
    border-radius: 4px;
    overflow: hidden;
  }
  .gfill {
    height: 100%;
    background: var(--pos);
    transition: width 0.3s;
  }
  .whatif {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    max-height: 520px;
    overflow: auto;
    padding-right: 4px;
  }
  .whatif .field span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .contrib {
    min-width: 0;
  }
  .pick {
    margin: 16px 0 6px;
  }
  @media (max-width: 900px) {
    .explain {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
