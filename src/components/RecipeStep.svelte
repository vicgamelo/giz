<script lang="ts">
  import { flip } from "svelte/animate";
  import { app } from "../lib/state.svelte";
  import { move, OPS, opSpec, validate } from "../lib/recipe";
  import { fmtInt, KINDS } from "../lib/format";
  import type { Step } from "../lib/types";
  import Alerts from "./Alerts.svelte";
  import DataTable from "./DataTable.svelte";

  const p = $derived(app.profile!);
  const raw = $derived(app.rawProfile!);
  const kindOf = $derived(Object.fromEntries(p.columns.map((c) => [c.name, c.kind])));

  let draft = $state<Step>({ op: "impute", columns: [], ...OPS[0].defaults });
  const spec = $derived(opSpec(draft.op)!);
  const problem = $derived(validate(draft));
  const added = $derived(app.reports.flatMap((r) => r.added ?? []));
  const report = (i: number) => app.reports.find((r) => r.index === i);
  const remaining = $derived(app.profile?.alerts ?? []);

  function setOp(op: string) {
    const s = opSpec(op)!;
    draft = { op, ...structuredClone(s.defaults), ...(s.fields.some((f) => f.key === "columns") ? { columns: [] } : {}) };
  }

  function toggleCol(c: string) {
    const cols = draft.columns ?? [];
    draft.columns = cols.includes(c) ? cols.filter((x) => x !== c) : [...cols, c];
  }

  function togglePart(v: string) {
    const parts = draft.parts ?? [];
    draft.parts = parts.includes(v) ? parts.filter((x) => x !== v) : [...parts, v];
  }

  function add() {
    if (problem) return;
    const step = $state.snapshot(draft) as Step;
    if (step.op === "remove_outliers") step.factor = Number(step.factor) || 1.5;
    if (app.addStep(step)) setOp(draft.op);
  }

  const update = (i: number, patch: Partial<Step>) =>
    app.setSteps(app.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const remove = (i: number) => app.setSteps(app.steps.filter((_, j) => j !== i));

  let dragging = $state<number | null>(null);
  let over = $state<number | null>(null);

  function keydown(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t && ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) app.redo();
      else app.undo();
    }
  }

  const columnsFor = (kinds?: string[]) =>
    p.columns.filter((c) => !kinds || kinds.includes(c.kind)).map((c) => c.name);
</script>

<svelte:window onkeydown={keydown} />

<div class="panel-head">
  <div>
    <h2>Receita de tratamento</h2>
    <p class="muted small">
      Cada passo aprende nos dados de treino (a mediana, as categorias, os limites) e se repete igual em planilhas novas.
    </p>
  </div>
  <button class="btn primary" onclick={() => (app.current = "train")} disabled={!app.previewOk}>Escolher o alvo →</button>
</div>

<div class="cols2">
  <div class="left">
    <div class="panel">
      <div class="panel-head">
        <h3>Passos <span class="chip">{app.steps.length}</span></h3>
        <div class="hist">
          {#key app.historyTick}
            <button class="btn ghost sm" onclick={() => app.undo()} disabled={!app.history.canUndo} title="Desfazer (⌘Z)"
              >↶ Desfazer</button
            >
            <button class="btn ghost sm" onclick={() => app.redo()} disabled={!app.history.canRedo} title="Refazer (⇧⌘Z)"
              >↷ Refazer</button
            >
          {/key}
        </div>
      </div>
      {#if app.steps.length === 0}
        <div class="empty small">
          Nenhum passo ainda. Use “Corrigir” nos alertas ou adicione abaixo.<br />Sem receita, o AutoML ainda trata nulos e
          categorias por conta própria dentro de cada modelo.
        </div>
      {:else}
        <ol class="list">
          {#each app.steps as s, i (s.uid)}
            {@const r = report(i)}
            <li
              animate:flip={{ duration: 220 }}
              class:off={s.disabled}
              class:error={r?.error}
              class:over={over === i && dragging !== i}
              draggable="true"
              ondragstart={(e) => {
                dragging = i;
                e.dataTransfer?.setData("text/plain", String(i));
              }}
              ondragover={(e) => {
                e.preventDefault();
                over = i;
              }}
              ondragleave={() => (over = null)}
              ondrop={(e) => {
                e.preventDefault();
                if (dragging !== null) app.setSteps(move(app.steps, dragging, i));
                dragging = null;
                over = null;
              }}
              ondragend={() => {
                dragging = null;
                over = null;
              }}
            >
              <span class="grip" aria-hidden="true">⋮⋮</span>
              <span class="idx">{i + 1}</span>
              <div class="body">
                <div class="label">{r?.label ?? opSpec(s.op)?.label}</div>
                {#if r?.error}
                  <div class="small errtxt">{r.error}</div>
                {:else if r?.skipped}
                  <div class="small muted">desligado</div>
                {:else if r}
                  <div class="small muted delta">
                    {#if r.rows_before !== r.rows_after}
                      <span class="chip warn">{fmtInt(r.rows_before)} → {fmtInt(r.rows_after)} linhas</span>
                    {/if}
                    {#if r.added?.length}<span class="chip accent">+{r.added.length} col.</span>{/if}
                    {#if r.removed?.length}<span class="chip">−{r.removed.length} col.</span>{/if}
                  </div>
                {:else if app.previewing}
                  <div class="small muted pulse">calculando…</div>
                {/if}
              </div>
              <div class="actions">
                <input
                  type="checkbox"
                  checked={!s.disabled}
                  title={s.disabled ? "Ligar" : "Desligar"}
                  aria-label="Ligar ou desligar o passo"
                  onchange={() => update(i, { disabled: !s.disabled })}
                />
                <button class="btn ghost sm" disabled={i === 0} onclick={() => app.setSteps(move(app.steps, i, i - 1))}
                  aria-label="Subir">↑</button
                >
                <button
                  class="btn ghost sm"
                  disabled={i === app.steps.length - 1}
                  onclick={() => app.setSteps(move(app.steps, i, i + 1))}
                  aria-label="Descer">↓</button
                >
                <button class="btn ghost sm danger" onclick={() => remove(i)} aria-label="Remover">✕</button>
              </div>
            </li>
          {/each}
        </ol>
      {/if}
    </div>

    <div class="panel add">
      <h3>Adicionar passo</h3>
      <div class="ops">
        {#each OPS as o (o.op)}
          <button class="btn sm" class:primary={draft.op === o.op} onclick={() => setOp(o.op)}>{o.label}</button>
        {/each}
      </div>
      <p class="small muted">{spec.help}</p>
      {#each spec.fields as f (f.key)}
        {#if f.key === "columns"}
          <div class="field">
            <span>{f.label} <em class="muted">({draft.columns?.length ?? 0})</em></span>
            <div class="pick">
              {#each columnsFor("kinds" in f ? f.kinds : undefined) as c (c)}
                <label class:on={draft.columns?.includes(c)}>
                  <input type="checkbox" checked={draft.columns?.includes(c)} onchange={() => toggleCol(c)} />
                  {c} <span class="muted">{KINDS[kindOf[c]]}</span>
                </label>
              {/each}
            </div>
          </div>
        {:else if f.key === "column"}
          <label class="field">
            <span>{f.label}</span>
            <select bind:value={draft.column}>
              <option value={undefined}>—</option>
              {#each p.columns as c (c.name)}<option value={c.name}>{c.name}</option>{/each}
            </select>
          </label>
        {:else if f.key === "parts"}
          <div class="field">
            <span>{f.label}</span>
            <div class="parts">
              {#each f.options as [v, l] (v)}
                <label><input type="checkbox" checked={draft.parts?.includes(v)} onchange={() => togglePart(v)} /> {l}</label>
              {/each}
            </div>
          </div>
        {:else if f.key === "value"}
          {#if !f.when || f.when(draft)}
            <label class="field"><span>{f.label}</span><input type="text" bind:value={draft.value} /></label>
          {/if}
        {:else if f.key === "factor"}
          <label class="field"><span>{f.label}</span><input type="number" step="0.5" min="0.5" bind:value={draft.factor} /></label>
        {:else}
          <label class="field">
            <span>{f.label}</span>
            <select bind:value={draft[f.key]}>
              {#each f.options as [v, l] (v)}<option value={v}>{l}</option>{/each}
            </select>
          </label>
        {/if}
      {/each}
      <div class="addrow">
        <button class="btn primary" onclick={add} disabled={!!problem}>Adicionar</button>
        {#if problem}<span class="small muted">{problem}</span>{/if}
      </div>
    </div>
  </div>

  <div class="right">
    <div class="panel">
      <div class="panel-head">
        <h3>Prévia {#if app.previewing}<span class="spinner small-spin"></span>{/if}</h3>
        <span class="small muted">
          {fmtInt(raw.rows)} × {raw.cols} → <strong class:changed={p.rows !== raw.rows}>{fmtInt(p.rows)}</strong> ×
          <strong class:changed={p.cols !== raw.cols}>{p.cols}</strong>
          · vazios {fmtInt(raw.missing_cells)} → <strong class:changed={p.missing_cells !== raw.missing_cells}
            >{fmtInt(p.missing_cells)}</strong
          >
        </span>
      </div>
      {#if !app.previewOk}
        <div class="alert danger">
          <span class="msg">A prévia parou no passo com erro. Corrija, desligue ou remova o passo.</span>
        </div>
      {/if}
      <DataTable table={p.head} highlight={added} maxRows={30} />
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Alertas depois da receita <span class="chip">{remaining.length}</span></h3></div>
      <Alerts alerts={remaining} limit={6} />
    </div>
  </div>
</div>

<style>
  .cols2 {
    display: grid;
    grid-template-columns: minmax(320px, 420px) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  .right {
    position: sticky;
    top: 74px;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    min-width: 0;
  }
  .right .panel + .panel {
    margin-top: 0;
  }
  .hist {
    display: flex;
    gap: 4px;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel-2);
  }
  .list li.over {
    border-color: var(--accent);
    box-shadow: 0 -2px 0 var(--accent);
  }
  .list li.off {
    opacity: 0.55;
  }
  .list li.off .label {
    text-decoration: line-through;
  }
  .list li.error {
    border-color: var(--danger);
    background: var(--danger-soft);
  }
  .grip {
    cursor: grab;
    color: var(--muted);
    letter-spacing: -2px;
    user-select: none;
  }
  .idx {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
    display: grid;
    place-items: center;
    font-size: 0.75rem;
    font-weight: 700;
    flex: none;
  }
  .body {
    flex: 1;
    min-width: 0;
  }
  .label {
    font-weight: 600;
    font-size: 0.9rem;
    overflow-wrap: anywhere;
  }
  .delta {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    margin-top: 2px;
  }
  .errtxt {
    color: var(--danger);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .add {
    display: grid;
    gap: 10px;
  }
  .ops {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .pick {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    max-height: 170px;
    overflow: auto;
    padding: 6px;
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .pick label {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    font-size: 0.8rem;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--line);
    cursor: pointer;
  }
  .pick label.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .pick input {
    display: none;
  }
  .parts {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .addrow {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .changed {
    color: var(--accent);
  }
  .small-spin {
    width: 12px;
    height: 12px;
    vertical-align: middle;
  }
  @media (max-width: 1000px) {
    .cols2 {
      grid-template-columns: minmax(0, 1fr);
    }
    .right {
      position: static;
    }
  }
</style>
