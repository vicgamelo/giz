<script lang="ts">
  import { histogramBars } from "../lib/charts";
  import { fmtInt, fmtNum } from "../lib/format";
  import { tip } from "../lib/tip";

  let {
    counts,
    edges = [],
    width = 220,
    height = 52,
    dates = false,
    compact = false,
  }: { counts: number[]; edges?: number[]; width?: number; height?: number; dates?: boolean; compact?: boolean } = $props();

  const bars = $derived(histogramBars(counts, width, height));
  const label = (v: number) => (dates ? new Date(v * 1000).toISOString().slice(0, 10) : fmtNum(v, 2));
</script>

<svg viewBox="0 0 {width} {height + (compact ? 1 : 14)}" class="hist" class:compact role="img" aria-label="Distribuição">
  {#each bars as b, i (i)}
    <rect x={b.x} y="0" width={b.w} height={height} class="hit" role="presentation"
      use:tip={`${edges.length ? `${label(edges[i])} – ${label(edges[i + 1])}\n` : ""}${fmtInt(b.value)} linhas`} />
    <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="1.5" class="bar" />
  {/each}
  <line x1="0" x2={width} y1={height + 0.5} y2={height + 0.5} class="axis" />
  {#if edges.length > 1 && !compact}
    <text x="0" y={height + 12}>{label(edges[0])}</text>
    <text x={width} y={height + 12} text-anchor="end">{label(edges[edges.length - 1])}</text>
  {/if}
</svg>

<style>
  .hist {
    width: 100%;
    height: auto;
    display: block;
  }
  .hist.compact {
    max-width: 220px;
  }
  .bar {
    fill: var(--bar);
    opacity: 0.85;
  }
  .hit {
    fill: transparent;
  }
  .hit:hover {
    fill: color-mix(in srgb, var(--accent-soft) 70%, transparent);
  }
  .hit:hover + .bar {
    opacity: 1;
    fill: var(--accent);
  }
  .bar {
    pointer-events: none;
  }
  .axis {
    stroke: var(--line-2);
  }
  text {
    font-size: 10px;
  }
</style>
