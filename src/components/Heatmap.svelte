<script lang="ts">
  import { corrClass } from "../lib/charts";
  import { fmtNum } from "../lib/format";

  let { columns, matrix }: { columns: string[]; matrix: (number | null)[][] } = $props();
  const cell = $derived(columns.length > 14 ? 22 : 30);
  const label = 150;
  const size = $derived(label + cell * columns.length);
  const short = (s: string) => (s.length > 22 ? s.slice(0, 21) + "…" : s);
</script>

<div class="wrap">
  <svg viewBox="0 0 {size + 4} {size + 4}" class="heat" role="img" aria-label="Matriz de correlação">
    {#each columns as c, i (c)}
      <text x={label - 6} y={label + i * cell + cell / 2 + 4} text-anchor="end">{short(c)}</text>
      <text
        x={label + i * cell + cell / 2 + 4}
        y={label - 6}
        transform="rotate(-50 {label + i * cell + cell / 2 + 4} {label - 6})">{short(c)}</text
      >
      {#each matrix[i] as v, j (j)}
        <rect
          x={label + j * cell}
          y={label + i * cell}
          width={cell - 1.5}
          height={cell - 1.5}
          rx="3"
          class={corrClass(v)}
        >
          <title>{columns[i]} × {columns[j]}: {v == null ? "–" : fmtNum(v, 2)}</title>
        </rect>
        {#if cell >= 30 && v != null && i !== j && Math.abs(v) >= 0.3}
          <text x={label + j * cell + cell / 2 - 0.75} y={label + i * cell + cell / 2 + 3.5} text-anchor="middle" class="v"
            >{fmtNum(v, 1)}</text
          >
        {/if}
      {/each}
    {/each}
  </svg>
  <div class="legend small muted">
    <span class="sw c-n5"></span> −1 <span class="sw c-n0"></span> 0 <span class="sw c-p5"></span> +1 · Pearson
  </div>
</div>

<style>
  .wrap {
    max-width: 640px;
  }
  .heat {
    width: 100%;
    height: auto;
  }
  text {
    font-size: 10.5px;
  }
  .v {
    fill: var(--ink);
    font-size: 9.5px;
    font-weight: 600;
  }
  .legend {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sw {
    width: 14px;
    height: 10px;
    border-radius: 2px;
    display: inline-block;
  }
  .sw.c-n5 {
    background: var(--neg);
  }
  .sw.c-n0 {
    background: var(--panel-2);
    border: 1px solid var(--line);
  }
  .sw.c-p5 {
    background: var(--pos);
  }
</style>
