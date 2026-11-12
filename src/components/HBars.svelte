<script lang="ts">
  // Barras horizontais: rótulo à esquerda, barra (aceita negativo) e valor à direita.
  import { divergingBars, hasNegative } from "../lib/charts";

  let {
    items,
    format = (v: number) => v.toFixed(3),
    width = 560,
    row = 26,
    labelWidth = 170,
    highlight = null,
    signColors = false,
  }: {
    items: { label: string; value: number; sub?: string }[];
    format?: (v: number) => string;
    width?: number;
    row?: number;
    labelWidth?: number;
    highlight?: string | null;
    signColors?: boolean;
  } = $props();

  // Desenha na largura real do container (no celular o texto não encolhe junto com o SVG).
  let measured = $state(0);
  const w = $derived(measured || width);
  const lw = $derived(Math.min(labelWidth, Math.round(w * 0.42)));
  const maxChars = $derived(Math.max(8, Math.floor((lw - 8) / 7.4)));
  const valueWidth = 64;
  const barWidth = $derived(Math.max(w - lw - valueWidth, 20));
  const bars = $derived(divergingBars(items.map((i) => i.value), barWidth, row));
  const hasNeg = $derived(hasNegative(items.map((i) => i.value)));
</script>

<div class="wrap" bind:clientWidth={measured}>
<svg viewBox="0 0 {w} {Math.max(items.length * row, row)}" class="hbars" role="img">
  {#each items as it, i (it.label)}
    {@const b = bars[i]}
    <g class:hl={highlight === it.label}>
      <text x={lw - 8} y={i * row + row / 2 + 4} text-anchor="end" class="lbl">
        {it.label.length > maxChars ? it.label.slice(0, maxChars - 1) + "…" : it.label}<title>{it.label}{it.sub ? ` · ${it.sub}` : ""}</title>
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
    <line x1={lw + barWidth / 2} x2={lw + barWidth / 2} y1="0" y2={items.length * row} class="zero" />
  {/if}
</svg>
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
  .bar {
    fill: var(--bar);
    opacity: 0.85;
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
  .zero {
    stroke: var(--line-2);
    stroke-dasharray: 3 3;
  }
</style>
