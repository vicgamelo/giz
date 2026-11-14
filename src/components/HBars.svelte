<script lang="ts">
  // Barras horizontais: rótulo à esquerda, barra (aceita negativo) e valor à direita.
  import { divergingBars, hasNegative } from "../lib/charts";
  import { tip } from "../lib/tip";

  let {
    items,
    format = (v: number) => v.toFixed(3),
    width = 560,
    row = 26,
    labelWidth = 170,
    highlight = null,
    signColors = false,
    foldZeros = false,
    minShown = 0,
  }: {
    items: { label: string; value: number; sub?: string }[];
    format?: (v: number) => string;
    width?: number;
    row?: number;
    labelWidth?: number;
    highlight?: string | null;
    signColors?: boolean;
    /** Junta numa linha só os itens que aparecem como zero (barra vazia não informa nada). */
    foldZeros?: boolean;
    /** Mesmo juntando os zeros, mostra pelo menos estes primeiros itens (um ranking de uma barra só fica pobre). */
    minShown?: number;
  } = $props();

  const isZero = (v: number) => format(v) === format(0) || format(v) === format(-0);
  const folded = $derived.by(() => {
    if (!foldZeros) return { shown: items, hidden: [] as typeof items };
    const keep = (i: (typeof items)[number], k: number) => !isZero(i.value) || k < minShown;
    return { shown: items.filter(keep), hidden: items.filter((i, k) => !keep(i, k)) };
  });

  // Desenha na largura real do container (no celular o texto não encolhe junto com o SVG).
  let measured = $state(0);
  const w = $derived(measured || width);
  const lw = $derived(Math.min(labelWidth, Math.round(w * 0.42)));
  const maxChars = $derived(Math.max(8, Math.floor((lw - 8) / 7.4)));
  const valueWidth = 64;
  const barWidth = $derived(Math.max(w - lw - valueWidth, 20));
  const bars = $derived(divergingBars(folded.shown.map((i) => i.value), barWidth, row));
  const hasNeg = $derived(hasNegative(folded.shown.map((i) => i.value)));
</script>

<div class="wrap" bind:clientWidth={measured}>
{#if folded.shown.length}
<svg viewBox="0 0 {w} {Math.max(folded.shown.length * row, row)}" class="hbars" role="img">
  {#each folded.shown as it, i (it.label)}
    {@const b = bars[i]}
    <g class="row" class:hl={highlight === it.label} use:tip={`${it.label}\n${format(it.value)}${it.sub ? ` · ${it.sub}` : ""}`}>
      <rect x="0" y={i * row} width={w} height={row} class="hit" />
      <rect x={lw} y={b.y} width={barWidth} height={b.h} rx="3" class="track" />
      <text x={lw - 8} y={i * row + row / 2 + 4} text-anchor="end" class="lbl">
        {it.label.length > maxChars ? it.label.slice(0, maxChars - 1) + "…" : it.label}
      </text>
      <rect
        x={lw + b.x}
        y={b.y}
        width={b.w}
        height={b.h}
        rx="3"
        class="bar"
        class:pos={signColors && it.value > 0}
        class:neg={signColors && it.value < 0}
      />
      <text x={w - 4} y={i * row + row / 2 + 4} text-anchor="end" class="val">{format(it.value)}</text>
    </g>
  {/each}
  {#if hasNeg}
    <line x1={lw + barWidth / 2} x2={lw + barWidth / 2} y1="0" y2={folded.shown.length * row} class="zero" />
  {/if}
</svg>
{/if}
{#if folded.hidden.length}
  <details class="rest small muted">
    <summary>{folded.shown.length ? "+ " : ""}{folded.hidden.length} {folded.hidden.length === 1 ? "item" : "itens"} em {format(0)}</summary>
    <p>{folded.hidden.map((i) => i.label).join(" · ")}</p>
  </details>
{/if}
</div>

<style>
  .wrap {
    min-width: 0;
  }
  .hbars {
    width: 100%;
    height: auto;
    display: block;
  }
  .track {
    fill: var(--panel-2);
  }
  .hit {
    fill: transparent;
  }
  .row {
    cursor: default;
    transition: opacity 0.15s;
  }
  /* passar o mouse numa linha apaga as outras */
  .hbars:hover .row:not(:hover) {
    opacity: 0.45;
  }
  .row:hover .hit {
    fill: color-mix(in srgb, var(--accent-soft) 60%, transparent);
  }
  .row:hover .bar {
    opacity: 1;
  }
  .bar {
    fill: var(--bar);
    opacity: 0.8;
    transition:
      width 0.35s ease,
      x 0.35s ease;
  }
  .bar.pos {
    fill: var(--pos);
  }
  .bar.neg {
    fill: var(--neg);
  }
  .lbl {
    fill: var(--ink);
    font-size: 12px;
  }
  .val {
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }
  .hl .lbl {
    font-weight: 700;
  }
  .hl .bar {
    opacity: 1;
  }
  .rest {
    margin-top: 6px;
    padding-left: 4px;
  }
  .rest summary {
    cursor: pointer;
    font-weight: 600;
  }
  .rest p {
    margin-top: 4px;
    overflow-wrap: anywhere;
  }
  .zero {
    stroke: var(--line-2);
    stroke-dasharray: 3 3;
  }
</style>
