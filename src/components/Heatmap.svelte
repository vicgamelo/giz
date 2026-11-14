<script lang="ts">
  import { corrClass } from "../lib/charts";
  import { fmtFixed, fmtNum } from "../lib/format";
  import { tip } from "../lib/tip";

  let { columns, matrix }: { columns: string[]; matrix: (number | null)[][] } = $props();
  const cell = $derived(columns.length > 14 ? 22 : columns.length > 9 ? 30 : 46);
  let hi = $state<{ i: number; j: number } | null>(null);
  // pares mais correlacionados (fora da diagonal), do mais forte para o mais fraco
  const pairs = $derived(
    columns
      .flatMap((a, i) => columns.slice(i + 1).map((b, k) => ({ a, b, i, j: i + 1 + k, v: matrix[i][i + 1 + k] })))
      .filter((p) => p.v != null)
      .sort((x, y) => Math.abs(y.v!) - Math.abs(x.v!))
      .slice(0, 6),
  );
  const short = (s: string) => (s.length > 18 ? s.slice(0, 17) + "…" : s);
  // espaço do rótulo pelo maior nome (≈6 px por letra a 10,5 px), em vez de 150 fixos
  const label = $derived(Math.min(150, 14 + 6 * Math.max(...columns.map((c) => short(c).length))));
  const size = $derived(label + cell * columns.length);
  // rótulos de cima a 45° passam da última coluna para a direita
  const width = $derived(Math.round(size + label * 0.72));
</script>

<div class="hm">
<div class="wrap">
  <svg onpointerleave={() => (hi = null)} viewBox="0 0 {width} {size + 4}" width={width} class="heat" role="img" aria-label="Matriz de correlação">
    {#each columns as c, i (c)}
      <text x={label - 6} y={label + i * cell + cell / 2 + 4} text-anchor="end" class:on={hi?.i === i}>{short(c)}</text>
      <text
        class:on={hi?.j === i}
        x={label + i * cell + cell / 2 + 4}
        y={label - 6}
        transform="rotate(-45 {label + i * cell + cell / 2 + 4} {label - 6})">{short(c)}</text
      >
      {#each matrix[i] as v, j (j)}
        <rect
          x={label + j * cell}
          y={label + i * cell}
          width={cell - 1.5}
          height={cell - 1.5}
          rx="3"
          class="{i === j ? 'c-na' : corrClass(v)} cell"
          class:dim={hi && hi.i !== i && hi.j !== j}
          class:pick={hi?.i === i && hi?.j === j}
          role="presentation"
          onpointerenter={() => (hi = { i, j })}
          use:tip={`${columns[i]} × ${columns[j]}\nPearson ${v == null ? "–" : fmtNum(v, 2)}`}
        />
        {#if v != null && i !== j && Math.abs(v) >= (cell >= 30 ? 0.3 : 0.5)}
          <text x={label + j * cell + cell / 2 - 0.75} y={label + i * cell + cell / 2 + 3.5} text-anchor="middle" class="v" class:tiny={cell < 30}
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
{#if pairs.length}
  <div class="pairs">
    <p class="small muted">Pares mais correlacionados</p>
    <ol>
      {#each pairs as p (p.a + p.b)}
        <li>
          <button
            class:on={hi?.i === p.i && hi?.j === p.j}
            onpointerenter={() => (hi = { i: p.i, j: p.j })}
            onpointerleave={() => (hi = null)}
            onfocus={() => (hi = { i: p.i, j: p.j })}
            onblur={() => (hi = null)}
          >
            <span class="pn mono">{p.a} × {p.b}</span>
            <span class="pv num" class:neg={p.v! < 0}>{fmtFixed(p.v!, 2)}</span>
          </button>
        </li>
      {/each}
    </ol>
  </div>
{/if}
</div>

<style>
  .hm {
    display: flex;
    flex-wrap: wrap;
    gap: 24px 40px;
    align-items: flex-start;
  }
  .wrap {
    max-width: 100%;
    overflow-x: auto;
  }
  .cell {
    transition: opacity 0.15s;
  }
  .cell.dim {
    opacity: 0.35;
  }
  .cell.pick {
    stroke: var(--ink);
    stroke-width: 1.5;
  }
  text.on {
    fill: var(--ink);
    font-weight: 700;
  }
  .pairs {
    flex: 1 1 260px;
    max-width: 420px;
  }
  .pairs ol {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .pairs button {
    width: 100%;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 7px 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    text-align: left;
    font-size: 0.84rem;
  }
  .pairs button:hover,
  .pairs button.on {
    background: var(--accent-soft);
  }
  .pn {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pv {
    font-weight: 700;
    color: var(--pos);
  }
  .pv.neg {
    color: var(--neg);
  }
  .heat {
    display: block;
    max-width: 100%;
    height: auto;
  }
  text {
    font-size: 10.5px;
    font-family: var(--mono);
    fill: var(--muted);
  }
  .v {
    fill: var(--ink);
    font-size: 9.5px;
    font-weight: 600;
  }
  .v.tiny {
    font-size: 8px;
  }
  .legend {
    margin-top: 8px;
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
