<script lang="ts">
  import { flip } from "svelte/animate";
  import { candidateScore, leaderKey, rankCandidates } from "../lib/ranking";
  import { app, SAMPLES } from "../lib/state.svelte";
  import { fmtFixed, fmtInt, fmtMetric, fmtNum, fmtSeconds, metricLabel, METRICS, PROBLEMS } from "../lib/format";
  import type { Problem } from "../lib/types";
  import Alerts from "./Alerts.svelte";
  import HBars from "./HBars.svelte";
  import { tip } from "../lib/tip";

  const cols = $derived(app.profile?.columns ?? []);
  const info = $derived(app.targetInfo);
  const suggested = $derived(SAMPLES.find((s) => s.id === app.sampleId)?.target ?? null);

  $effect(() => {
    if (!app.target && suggested && cols.some((c) => c.name === suggested) && app.mlReady && !app.busy) {
      void app.chooseTarget(suggested);
    }
  });

  const metric = $derived(app.plan?.metric ?? app.result?.metric ?? "roc_auc");
  const lower = $derived(!!METRICS[metric]?.lower);
  const elapsed = $derived(app.training ? (app.now - app.trainStartedAt) / 1000 : (app.result?.seconds ?? 0));

  const score = candidateScore;
  const ranked = $derived(rankCandidates(app.candidates, lower));
  const scale = $derived.by(() => {
    const vals = app.candidates.flatMap((c) => c.folds);
    if (!vals.length) return { min: 0, max: 1 };
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (metric === "roc_auc") min = Math.min(min, 0.5);
    const pad = (max - min) * 0.08 || 0.05;
    return { min: Math.max(min - pad, lower ? 0 : -Infinity), max: max + pad };
  });
  const pos = (v: number) => ((v - scale.min) / (scale.max - scale.min || 1)) * 100;
  const leader = $derived(leaderKey(ranked));

  const STATUS: Record<string, string> = {
    pending: "na fila",
    running: "validando",
    done: "pronto",
    skipped: "pulado",
    failed: "falhou",
    stopped: "parado",
  };

  function onTarget(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    if (v) void app.chooseTarget(v);
  }
</script>

<div class="panel-head">
  <div>
    <h2>AutoML</h2>
    <p class="muted small">
      20% das linhas ficam guardadas para a avaliação final. Nos 80% restantes, cada modelo passa por validação cruzada
      dentro do tempo escolhido.
    </p>
  </div>
  {#if app.result && !app.training}
    <button class="btn primary" onclick={() => (app.current = "evaluate")}>Ver avaliação →</button>
  {/if}
</div>

<div class="setup">
  <div class="panel">
    <h3>O que prever</h3>
    <div class="row">
      <label class="field grow">
        <span>Coluna alvo</span>
        <select value={app.target ?? ""} onchange={onTarget} disabled={app.training}>
          <option value="" disabled>Escolha…</option>
          {#each cols as c (c.name)}<option value={c.name}>{c.name}</option>{/each}
        </select>
      </label>
      {#if info}
        <label class="field">
          <span>Problema {info.detected === info.problem ? "(detectado)" : ""}</span>
          <select
            value={info.problem}
            disabled={app.training}
            onchange={(e) => app.chooseTarget(info.target, (e.currentTarget as HTMLSelectElement).value as Problem)}
          >
            {#each Object.entries(PROBLEMS) as [k, l] (k)}<option value={k}>{l}</option>{/each}
          </select>
        </label>
        {#if info.problem === "binary" && info.classes}
          <label class="field">
            <span>Classe positiva</span>
            <select
              value={info.classes[info.classes.length - 1]}
              disabled={app.training}
              onchange={(e) => app.chooseTarget(info.target, "binary", (e.currentTarget as HTMLSelectElement).value)}
            >
              {#each info.classes as c (c)}<option value={c}>{c}</option>{/each}
            </select>
          </label>
        {/if}
      {/if}
    </div>
    {#if !app.mlReady}
      <p class="small muted wait"><span class="spinner"></span> scikit-learn ainda carregando…</p>
    {/if}

    {#if info}
      <div class="summary">
        {#if info.class_counts}
          <div class="dist">
            {#each info.class_counts as [c, n] (c)}
              <div class="seg" style:flex-grow={n} title="{c}: {fmtInt(n)}">
                <span>{c}</span><b>{fmtNum((100 * n) / info.rows, 1)}%</b>
              </div>
            {/each}
          </div>
        {:else if info.target_stats}
          <p class="small">
            média <b>{fmtNum(info.target_stats.mean)}</b> · desvio <b>{fmtNum(info.target_stats.std)}</b> · de
            <b>{fmtNum(info.target_stats.min)}</b> a <b>{fmtNum(info.target_stats.max)}</b>
          </p>
        {/if}
        <p class="small muted">
          {fmtInt(info.rows)} linhas · {info.features.length} variáveis
          {#if info.ignored.length}
            · ignoradas: {info.ignored.map((i) => `${i.column} (${i.reason})`).join(", ")}
          {/if}
        </p>
      </div>
      {#if info.alerts.length}
        <div class="talerts"><Alerts alerts={info.alerts} /></div>
      {/if}
    {/if}
  </div>

  <div class="panel">
    <h3>Treino</h3>
    <label class="field">
      <span>Orçamento de tempo: <b class="num">{app.budget} s</b></span>
      <input type="range" min="10" max="180" step="5" bind:value={app.budget} disabled={app.training} />
    </label>
    <p class="small muted">
      Modelos: referência, regressão {info?.problem === "regression" ? "Ridge" : "logística"}, gradient boosting,
      LightGBM, XGBoost, Extra Trees, Random Forest e variações. Quem não cabe no tempo é pulado.
    </p>
    <div class="go">
      {#if app.training}
        <button class="btn danger" onclick={() => app.stopTraining()} disabled={!app.engine?.canStop}>■ Parar</button>
      {:else}
        <button class="btn primary big" disabled={!info || !app.mlReady || !!app.busy} onclick={() => app.train()}>
          ▶ Treinar
        </button>
      {/if}
      {#if app.training || app.result}
        <div class="clock">
          <svg viewBox="0 0 36 36" width="38" height="38" aria-hidden="true">
            <circle cx="18" cy="18" r="15" class="track" />
            <circle
              cx="18"
              cy="18"
              r="15"
              class="prog"
              stroke-dasharray="{Math.min(elapsed / app.budget, 1) * 94.2} 94.2"
              transform="rotate(-90 18 18)"
            />
          </svg>
          <div>
            <b class="num">{fmtSeconds(elapsed)}</b>
            <span class="small muted">
              {#if app.phase === "evaluate"}avaliando o vencedor no holdout…{:else if app.phase === "refit"}treinando o modelo
                final…{:else if app.training}validação cruzada{:else}total{/if}
            </span>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

{#if info && info.strength.length && !app.candidates.length}
  <div class="panel">
    <div class="panel-head">
      <h3>Força de cada coluna sozinha</h3>
      <span class="small muted">Uma árvore rasa por coluna ({info.strength_metric}). Muito alta = suspeita de vazamento.</span>
    </div>
    <HBars
      items={info.strength.slice(0, 15).map((s) => ({ label: s.column, value: s.score }))}
      format={(v) => fmtNum(v, 3)}
    />
  </div>
{/if}

{#if app.candidates.length}
  <div class="panel board">
    <div class="panel-head">
      <h3>Ranking ao vivo · {metricLabel(metric)} {lower ? "(menor é melhor)" : "(maior é melhor)"}</h3>
      {#if app.plan}
        <span class="small muted">
          {app.plan.folds} folds em {fmtInt(app.plan.cv_rows)} linhas{app.plan.cv_rows < app.plan.rows - app.plan.holdout_rows
            ? " (amostra)"
            : ""} · holdout de {fmtInt(app.plan.holdout_rows)}
        </span>
      {/if}
    </div>
    <ol>
      {#each ranked as c, i (c.key)}
        {@const s = score(c)}
        <li animate:flip={{ duration: 400 }} class={c.status} class:leader={leader === c.key && !app.training}>
          <span class="rank num">{s != null ? i + 1 : "–"}</span>
          <div class="name">
            <strong>{c.label}</strong>
            <span class="small muted">
              {[
                STATUS[c.status],
                c.status === "running" ? `fold ${c.folds.length + 1}` : null,
                c.reason,
                c.seconds ? fmtSeconds(c.seconds) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          <div
            class="track-bar"
            use:tip={() =>
              c.folds.length
                ? `${c.label}\n${c.folds.map((f, k) => `fold ${k + 1}: ${fmtMetric(metric, f)}`).join("\n")}`
                : c.label}
          >
            {#if s != null}
              <div class="fill" style:width="{Math.max(pos(s), 1)}%"></div>
            {/if}
            {#each c.folds as f, k (k)}
              <span class="foldpt" style:left="{pos(f)}%" title="fold {k + 1}: {fmtMetric(metric, f)}"></span>
            {/each}
          </div>
          <span class="score num">
            {#if s != null}
              {fmtMetric(metric, s)}{#if c.std != null}<small> ±{fmtFixed(c.std, 3)}</small>{/if}
            {:else if c.status === "running"}
              <span class="spinner"></span>
            {/if}
          </span>
        </li>
      {/each}
    </ol>
    {#if app.result && !app.training}
      <div class="winner">
        {#if app.result.stopped}<span class="chip warn">parado</span>{/if}
        Vencedor: <strong>{app.result.best.label}</strong>
        <span class="nw">com {metricLabel(metric)} <strong>{fmtMetric(metric, app.result.best.score)}</strong></span> na validação cruzada
        {#if app.result.baseline?.score != null}
          (referência: {fmtMetric(metric, app.result.baseline.score)})
        {/if}.
      </div>
    {/if}
  </div>
{/if}

<style>
  .setup {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    gap: 16px;
    margin-bottom: 16px;
  }
  .setup .panel + .panel {
    margin-top: 0;
  }
  .row {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 10px;
  }
  .grow {
    flex: 1;
    min-width: 180px;
  }
  .wait {
    margin-top: 8px;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .summary {
    margin-top: 12px;
    display: grid;
    gap: 6px;
  }
  .dist {
    display: flex;
    gap: 3px;
    height: 34px;
    border-radius: 8px;
    overflow: hidden;
  }
  .seg {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 0 10px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    color: var(--ink);
    font-size: 0.82rem;
    min-width: 70px;
    flex-basis: 0;
    border-radius: 6px;
  }
  .seg:last-child {
    background: var(--accent-fill);
    border-color: var(--accent-fill);
    color: var(--accent-ink);
  }
  .talerts {
    margin-top: 12px;
  }
  .go {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 12px;
  }
  .big {
    padding: 10px 22px;
    font-size: 1rem;
  }
  .clock {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .clock div {
    display: grid;
  }
  .track {
    fill: none;
    stroke: var(--line);
    stroke-width: 3;
  }
  .prog {
    fill: none;
    stroke: var(--accent);
    stroke-width: 3;
    stroke-linecap: round;
    transition: stroke-dasharray 0.1s linear;
  }
  .board ol {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 2px;
  }
  /* Linhas baixas, sem caixa; o líder ganha faixa de giz */
  .board li {
    display: grid;
    grid-template-columns: 28px minmax(220px, 380px) minmax(0, 1fr) 120px;
    align-items: center;
    gap: 12px;
    padding: 6px 12px;
    border: 1px solid transparent;
    border-radius: 10px;
    transition:
      background 0.3s,
      border-color 0.3s;
  }
  .board li:nth-child(even):not(.leader) {
    background: color-mix(in srgb, var(--panel-2) 70%, transparent);
  }
  .board li.running {
    border-color: var(--accent);
    background: var(--panel-2);
  }
  .board li.running .fill {
    animation: pulse 1.2s ease-in-out infinite;
  }
  .board li.pending,
  .board li.skipped,
  .board li.failed {
    opacity: 0.55;
  }
  .board li.leader {
    padding-top: 10px;
    padding-bottom: 10px;
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent-soft) 70%, var(--panel));
  }
  .rank {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    font-weight: 700;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .leader .rank {
    background: var(--accent-fill);
    color: var(--accent-ink);
  }
  .leader .name strong {
    font-size: 1.02rem;
  }
  .leader .score {
    font-family: var(--mono);
    font-size: 1.15rem;
  }
  /* nome e estado na mesma linha: linhas de ranking baixas, como uma tabela de console */
  .name {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .name .small {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1 1 auto;
    min-width: 0;
  }
  .name strong {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .track-bar {
    position: relative;
    height: 10px;
    background: var(--line);
    border-radius: 6px;
  }
  .fill {
    height: 100%;
    border-radius: 6px;
    background: var(--bar-2);
    transition: width 0.5s var(--ease-out);
  }
  .leader .fill,
  .done .fill {
    background: var(--bar);
  }
  li:not(.baseline-row) .fill {
    background: color-mix(in srgb, var(--bar) 70%, var(--bar-2));
  }
  .board li.leader .fill {
    background: var(--accent-fill);
  }
  .foldpt {
    position: absolute;
    top: 50%;
    width: 7px;
    height: 7px;
    margin: -3.5px 0 0 -3.5px;
    border-radius: 50%;
    background: var(--ink);
    opacity: 0.55;
  }
  .score {
    font-family: var(--mono);
    text-align: right;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .score small {
    font-weight: 400;
    color: var(--muted);
  }
  .nw {
    white-space: nowrap;
  }
  .winner {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
  }
  @media (max-width: 900px) {
    .setup {
      grid-template-columns: minmax(0, 1fr);
    }
    .board li {
      grid-template-columns: 22px minmax(0, 1fr) 84px;
      padding-right: 10px;
    }
    /* o ± vai para a linha de baixo, para o placar não encostar na borda */
    .score small {
      display: block;
    }
    /* no celular o nome ganha a linha toda e o estado vai embaixo */
    .name {
      flex-direction: column;
      align-items: flex-start;
      gap: 0;
    }
    .name strong {
      white-space: normal;
      overflow: visible;
    }
    .track-bar {
      grid-column: 2 / 4;
      grid-row: 2;
    }
  }
</style>
