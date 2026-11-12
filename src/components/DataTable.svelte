<script lang="ts">
  import { fmtCell } from "../lib/format";
  import type { Table } from "../lib/types";

  let {
    table,
    highlight = [],
    extra = null,
    selected = -1,
    onrow,
    maxRows = 50,
  }: {
    table: Table;
    highlight?: string[];
    extra?: { label: string; values: unknown[] }[] | null;
    selected?: number;
    onrow?: (i: number) => void;
    maxRows?: number;
  } = $props();

  const rows = $derived(table.rows.slice(0, maxRows));
</script>

<div class="table-wrap">
  <table class="data">
    <thead>
      <tr>
        {#if onrow}<th>#</th>{/if}
        {#each extra ?? [] as e (e.label)}<th class="added">{e.label}</th>{/each}
        {#each table.columns as c (c)}
          <th class:added={highlight.includes(c)} title={c}>{c}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each rows as r, i (i)}
        <tr
          class:clickable={!!onrow}
          class:selected={i === selected}
          onclick={() => onrow?.(i)}
          onkeydown={(ev) => ev.key === "Enter" && onrow?.(i)}
          tabindex={onrow ? 0 : undefined}
        >
          {#if onrow}<td class="muted">{i + 1}</td>{/if}
          {#each extra ?? [] as e (e.label)}<td class="added"><strong>{fmtCell(e.values[i])}</strong></td>{/each}
          {#each r as v, j (j)}
            <td class:n={typeof v === "number"} class:null={v === null}>{v === null ? "vazio" : fmtCell(v)}</td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>
