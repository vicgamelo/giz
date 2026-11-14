<script lang="ts">
  import { app } from "../lib/state.svelte";
  import { fmtFixed, fmtInt, fmtNum, fmtPct, KINDS } from "../lib/format";
  import type { Column } from "../lib/types";
  import Alerts from "./Alerts.svelte";
  import DataTable from "./DataTable.svelte";
  import Heatmap from "./Heatmap.svelte";
  import MiniHist from "./MiniHist.svelte";

  const p = $derived(app.rawProfile!);
  let filter = $state("");
  const cols = $derived(
    p.columns.filter((c) => !filter || c.name.toLowerCase().includes(filter.toLowerCase())),
  );
  const alertsByCol = $derived(
    Object.fromEntries(p.columns.map((c) => [c.name, p.alerts.filter((a) => a.column === c.name)])),
  );

  // Lista densa (padrão) ou grade de cartões.
  let view = $state<"lista" | "grade">("lista");
  // Clique numa coluna da lista abre o detalhe dela (estatísticas e valores mais comuns).
  let open = $state<string | null>(null);
  const idLike = (c: Column) => !!c.top && c.unique >= p.rows * 0.5;
  // estatísticas do detalhe, na ordem de leitura (quartis primeiro, depois forma)
  const STATS: [string, string][] = [
    ["min", "mín"],
    ["q1", "q1"],
    ["median", "mediana"],
    ["q3", "q3"],
    ["max", "máx"],
    ["mean", "média"],
    ["std", "desvio"],
    ["skew", "assimetria"],
    ["outliers", "valores fora"],
    ["zeros", "zeros"],
  ];
  const FLAGS: Record<string, string> = {
    constant: "constante",
    date_as_text: "data como texto",
    free_text: "texto livre",
    high_cardinality: "muitas categorias",
    id_like: "parece id",
    missing: "vazios",
    missing_high: "muitos vazios",
    number_as_text: "número como texto",
    outliers: "valores fora",
  };
  const flagLabel = (code: string) => FLAGS[code] ?? code.replaceAll("_", " ");
  const sevClass = (s: string) => (s === "warn" ? "warn" : s === "danger" ? "danger" : "info");
  const worst = (name: string) => {
    const a = alertsByCol[name] ?? [];
    return a.some((x) => x.severity === "danger") ? "danger" : a.some((x) => x.severity === "warn") ? "warn" : a.length ? "info" : "";
  };
  const counts = $derived({
    danger: p.alerts.filter((a) => a.severity === "danger").length,
    warn: p.alerts.filter((a) => a.severity === "warn").length,
    info: p.alerts.filter((a) => a.severity === "info").length,
  });

  function topMax(c: Column) {
    return Math.max(...(c.top ?? []).map((t) => t[1]), 1);
  }
</script>

<div class="panel-head">
  <div>
    <h2>Perfil dos dados</h2>
    <p class="muted small">
      {app.source?.filename}{#if app.source?.sheet}{" · "}aba “{app.source.sheet}”{/if}
      {#if app.source?.format === "csv"}
        · separador “{app.source.sep === "\t" ? "tab" : app.source.sep}”, decimal “{app.source.decimal}”, {app.source.encoding}
      {/if}
    </p>
  </div>
  <button class="btn primary" onclick={() => (app.current = "recipe")}>Montar a receita →</button>
</div>

<dl class="strip panel">
  <div><dt>linhas</dt><dd>{fmtInt(p.rows)}</dd></div>
  <div><dt>colunas</dt><dd>{fmtInt(p.cols)}</dd></div>
  <div class:hot={p.missing_cells > 0}>
    <dt>células vazias</dt><dd>{fmtPct(p.missing_cells / Math.max(p.rows * p.cols, 1))} <small>{fmtInt(p.missing_cells)}</small></dd>
  </div>
  <div class:hot={p.duplicates > 0}><dt>linhas repetidas</dt><dd>{fmtInt(p.duplicates)}</dd></div>
  <div><dt>na memória do navegador</dt><dd>{fmtNum(p.memory_mb, 1)} MB</dd></div>
</dl>

<div class="panel alerts">
  <div class="panel-head">
    <h3>Alertas <span class="chip">{p.alerts.length}</span></h3>
    <span class="small muted">“Corrigir” adiciona o passo na receita; nada muda nos dados originais.</span>
  </div>
  {#if p.alerts.length}
    <p class="summary">
      {#if counts.danger}<span class="sum danger"><b>{counts.danger}</b> {counts.danger === 1 ? "grave" : "graves"}</span>{/if}
      {#if counts.warn}<span class="sum warn"><b>{counts.warn}</b> de atenção</span>{/if}
      {#if counts.info}<span class="sum info"><b>{counts.info}</b> {counts.info === 1 ? "dica" : "dicas"}</span>{/if}
    </p>
  {/if}
  <Alerts alerts={p.alerts} foldInfo />
</div>

<div class="panel">
  <div class="panel-head">
    <h3>Colunas</h3>
    <div class="tools">
      <input type="text" placeholder="Filtrar colunas…" bind:value={filter} aria-label="Filtrar colunas" />
      <div class="seg" role="group" aria-label="Como mostrar as colunas">
        <button aria-pressed={view === "lista"} class:on={view === "lista"} onclick={() => (view = "lista")}>Lista</button>
        <button aria-pressed={view === "grade"} class:on={view === "grade"} onclick={() => (view = "grade")}>Grade</button>
      </div>
    </div>
  </div>
  {#if view === "lista"}
    <div class="clist">
      <div class="chead small muted" aria-hidden="true">
        <span>Coluna</span><span>Distribuição</span><span class="r">Distintos</span><span>Vazios</span><span>Alertas</span>
      </div>
      <ul>
        {#each cols as c (c.name)}
          {@const w = worst(c.name)}
          <!-- clique em qualquer ponto da linha abre o detalhe; o botão é o mesmo atalho para teclado e leitor de tela -->
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
          <li
            class="crow {w}"
            class:open={open === c.name}
            onclick={(e) => {
              if (!(e.target as Element).closest(".detail")) open = open === c.name ? null : c.name;
            }}
          >
            <button
              class="hit"
              aria-expanded={open === c.name}
              aria-label="Detalhes de {c.name}"
              onclick={(e) => {
                e.stopPropagation();
                open = open === c.name ? null : c.name;
              }}
            ></button>
            <div class="cname">
              <strong title={c.name}>{c.name}</strong>
              <span class="chip">{KINDS[c.kind]}</span>
            </div>
            <div class="cdist">
              {#if c.hist}
                <MiniHist counts={c.hist.counts} edges={c.hist.edges} dates={c.kind === "datetime"} height={30} width={200} compact />
              {:else if idLike(c)}
                <span class="muted small">{fmtInt(c.unique)} valores únicos</span>
              {:else if c.top}
                <ul class="top mini">
                  {#each c.top.slice(0, 3) as [v, n] (v)}
                    <li>
                      <span class="tv" title={v}>{v}</span>
                      <span class="tb"><span class="tf" style:width="{(n / topMax(c)) * 100}%"></span></span>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
            <div class="cuniq num r"><span class="lbl">distintos</span>{fmtInt(c.unique)}</div>
            <div class="cmiss">
              {#if c.missing}
                <span class="num bad">{fmtNum(c.missing_pct, 1)}%</span>
                <span class="miss"><span class="fill" style:width="{Math.min(c.missing_pct, 100)}%"></span></span>
              {:else}
                <span class="muted none" aria-label="sem vazios">—</span>
              {/if}
            </div>
            <div class="flags">
              {#each alertsByCol[c.name] ?? [] as a (a.code)}
                <span class="chip {sevClass(a.severity)}" title={a.message}>{flagLabel(a.code)}</span>
              {/each}
            </div>
            {#if open === c.name}
              <div class="detail">
                {#if c.hist}
                  <div class="dh"><MiniHist counts={c.hist.counts} edges={c.hist.edges} dates={c.kind === "datetime"} height={70} width={360} /></div>
                {/if}
                {#if c.stats}
                  <dl class="dstats">
                    {#each STATS.filter(([k]) => typeof c.stats?.[k] === "number") as [k, name] (k)}
                      <div>
                        <dt>{name}</dt>
                        <dd class="num">{k === "outliers" || k === "zeros" ? fmtInt(c.stats[k] as number) : fmtFixed(c.stats[k] as number, 2)}</dd>
                      </div>
                    {/each}
                  </dl>
                {/if}
                {#if c.top}
                  <ul class="top dtop">
                    {#each c.top.slice(0, 8) as [v, n] (v)}
                      <li>
                        <span class="tv" title={v}>{v}</span>
                        <span class="tb"><span class="tf" style:width="{(n / topMax(c)) * 100}%"></span></span>
                        <span class="tn num">{fmtInt(n)}</span>
                      </li>
                    {/each}
                  </ul>
                {/if}
                {#each alertsByCol[c.name] ?? [] as a (a.code)}
                  <p class="small dmsg"><span class="chip {sevClass(a.severity)}">{flagLabel(a.code)}</span> {a.message}</p>
                {/each}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {:else}
  <div class="cols">
    {#each cols as c (c.name)}
      <article class="col">
        <header>
          <strong title={c.name}>{c.name}</strong>
          <span class="chip">{KINDS[c.kind]}</span>
        </header>
        <div class="meta small muted">
          <span>{fmtInt(c.unique)} distintos</span>
          <span class:bad={c.missing_pct > 0}>{c.missing ? `${fmtNum(c.missing_pct, 1)}% vazios` : "sem vazios"}</span>
        </div>
        {#if c.missing}
          <div class="miss"><div class="fill" style:width="{Math.min(c.missing_pct, 100)}%"></div></div>
        {/if}
        {#if c.hist}
          <MiniHist counts={c.hist.counts} edges={c.hist.edges} dates={c.kind === "datetime"} />
          {#if c.stats && c.kind === "numeric"}
            <div class="stats small">
              <span>média <b>{fmtNum(c.stats.mean as number)}</b></span>
              <span>mediana <b>{fmtNum(c.stats.median as number)}</b></span>
              <span>máx <b>{fmtNum(c.stats.max as number)}</b></span>
            </div>
          {/if}
        {:else if c.top}
          <ul class="top">
            {#each c.top.slice(0, 5) as [v, n] (v)}
              <li>
                <span class="tv" title={v}>{v}</span>
                <span class="tb"><span class="tf" style:width="{(n / topMax(c)) * 100}%"></span></span>
                <span class="tn num">{fmtInt(n)}</span>
              </li>
            {/each}
            {#if c.top.length > 5 || c.other}
              <li class="small muted">+ {fmtInt(c.unique - 5)} outras</li>
            {/if}
          </ul>
        {/if}
        {#if alertsByCol[c.name]?.length}
          <div class="flags">
            {#each alertsByCol[c.name] as a (a.code)}
              <span class="chip {sevClass(a.severity)}" title={a.message}>{flagLabel(a.code)}</span>
            {/each}
          </div>
        {/if}
      </article>
    {/each}
  </div>
  {/if}
</div>

{#if p.correlations.columns.length >= 2}
  <div class="panel">
    <div class="panel-head">
      <h3>Correlações entre colunas numéricas</h3>
      <span class="small muted">Pares muito correlacionados carregam a mesma informação.</span>
    </div>
    <Heatmap columns={p.correlations.columns} matrix={p.correlations.matrix} />
  </div>
{/if}

<div class="panel">
  <div class="panel-head">
    <h3>Primeiras linhas</h3>
    <span class="small muted">{Math.min(50, p.rows)} de {fmtInt(p.rows)}</span>
  </div>
  <DataTable table={p.head} />
</div>

<style>
  /* KPIs numa faixa só, com divisórias */
  .strip {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    margin: 4px 0 16px;
    padding: 0;
  }
  .strip > div {
    padding: 14px 18px;
    border-left: 1px solid var(--line);
  }
  .strip > div:first-child {
    border-left: 0;
  }
  .strip dt {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--muted);
  }
  .strip dd {
    margin: 2px 0 0;
    font-size: 1.6rem;
    font-weight: 720;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }
  .strip dd small {
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--muted);
    letter-spacing: 0;
  }
  /* número em tinta neutra com um ponto âmbar: âmbar grande ficava perto demais do laranja do botão */
  .strip .hot dd::before {
    content: "";
    display: inline-block;
    width: 9px;
    height: 9px;
    margin-right: 8px;
    border-radius: 50%;
    background: var(--warn);
    vertical-align: 0.2em;
  }
  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: -4px 0 12px;
  }
  .sum {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 0.85rem;
    background: var(--panel-2);
    border: 1px solid var(--line);
  }
  .sum b {
    font-size: 1rem;
  }
  .sum.danger b {
    color: var(--danger);
  }
  .sum.warn b {
    color: var(--warn);
  }
  .sum.info b {
    color: var(--info);
  }
  .tools {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .seg {
    display: inline-flex;
    padding: 3px;
    gap: 2px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--panel-2);
  }
  .seg button {
    border: 0;
    background: transparent;
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 0.84rem;
    font-weight: 600;
    color: var(--muted);
  }
  .seg button.on {
    background: var(--panel);
    color: var(--ink);
    box-shadow: var(--shadow);
  }

  /* Lista densa de colunas: uma linha por coluna, com a distribuição embutida */
  .clist {
    --grid: minmax(170px, 1.1fr) minmax(180px, 1.8fr) 80px minmax(90px, 0.6fr) minmax(120px, 0.9fr);
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
  }
  .chead,
  .crow {
    display: grid;
    grid-template-columns: var(--grid);
    gap: 16px;
    align-items: center;
    padding: 8px 14px;
  }
  .chead {
    background: var(--panel-2);
    border-bottom: 2px solid var(--line-2);
    font-weight: 700;
    font-size: 0.78rem;
  }
  .clist > ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .crow {
    position: relative;
    border-bottom: 1px solid var(--line);
    border-left: 3px solid transparent;
    padding-left: 11px;
    cursor: pointer;
  }
  /* botão da linha: camada por baixo do conteúdo (foco por teclado mostra o contorno da linha inteira) */
  .crow > .hit {
    position: absolute;
    inset: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }
  .crow > .hit:focus-visible {
    outline-offset: -3px;
  }
  .crow > :not(.hit) {
    position: relative;
  }
  .crow.open {
    background: color-mix(in srgb, var(--accent-soft) 40%, transparent);
  }
  .none {
    padding-left: 2px;
  }
  .detail {
    position: relative;
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px 24px;
    padding: 10px 0 6px;
    cursor: auto;
  }
  .dh {
    max-width: 380px;
  }
  .dstats {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px 12px;
    margin: 0;
    align-content: start;
  }
  @media (max-width: 560px) {
    .dstats {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  @media (min-width: 900px) {
    .dstats {
      grid-column: span 2;
    }
  }
  .dstats dt {
    white-space: nowrap;
    font-size: 0.74rem;
    color: var(--muted);
  }
  .dstats dd {
    margin: 0;
    font-weight: 650;
  }
  .dtop {
    align-content: start;
  }
  .dmsg {
    grid-column: 1 / -1;
    margin: 0;
  }
  .crow:last-child {
    border-bottom: 0;
  }
  .crow:hover {
    background: color-mix(in srgb, var(--accent-soft) 40%, transparent);
  }
  .crow.warn {
    border-left-color: var(--warn);
  }
  .crow.danger {
    border-left-color: var(--danger);
  }
  .crow.info {
    border-left-color: color-mix(in srgb, var(--info) 60%, transparent);
  }
  .cname {
    display: grid;
    gap: 3px;
    justify-items: start;
    min-width: 0;
  }
  .cname strong {
    font-family: var(--mono);
    font-size: 0.85rem;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cdist {
    min-width: 0;
  }
  .r {
    text-align: right;
  }
  .lbl {
    display: none;
    margin-right: 4px;
  }
  .cmiss {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 8px;
    align-items: center;
    font-size: 0.85rem;
  }
  .cmiss .miss {
    display: block;
  }
  .bad {
    color: var(--warn);
    font-weight: 600;
  }
  .top.mini {
    gap: 2px;
    font-size: 0.74rem;
  }
  .top.mini li {
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1fr);
  }
  @media (max-width: 900px) {
    .strip {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .strip > div:nth-child(4) {
      border-left: 0;
    }
    .strip > div:nth-child(n + 4) {
      border-top: 1px solid var(--line);
    }
    .chead {
      display: none;
    }
    /* no celular cada coluna vira um cartão compacto */
    .crow {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        "name uniq"
        "dist dist"
        "miss flags";
      gap: 6px 12px;
      padding: 10px 12px 10px 9px;
    }
    .cname {
      grid-area: name;
    }
    .cdist {
      grid-area: dist;
    }
    .cuniq {
      grid-area: uniq;
      font-size: 0.8rem;
      color: var(--muted);
    }
    .lbl {
      display: inline;
    }
    .cmiss {
      grid-area: miss;
    }
    .flags {
      grid-area: flags;
      justify-content: flex-end;
    }
  }
  @media (max-width: 560px) {
    .strip {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .strip > div {
      padding: 10px 14px;
    }
    .strip > div:nth-child(odd) {
      border-left: 0;
    }
    .strip > div:nth-child(4) {
      border-left: 1px solid var(--line);
    }
    .strip > div:nth-child(n + 3) {
      border-top: 1px solid var(--line);
    }
    .strip dd {
      font-size: 1.3rem;
    }
    .strip > div:last-child {
      grid-column: 1 / -1;
    }
  }
  .alerts {
    margin-bottom: 16px;
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 12px;
  }
  .col {
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 14px;
    background: var(--panel-2);
    min-width: 0;
    grid-template-columns: minmax(0, 1fr);
    display: grid;
    gap: 8px;
    align-content: start;
  }
  .col header {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: center;
  }
  .col header strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    display: flex;
    justify-content: space-between;
  }
  .meta .bad {
    color: var(--warn);
    font-weight: 600;
  }
  .miss {
    height: 4px;
    background: var(--line);
    border-radius: 2px;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--warn);
  }
  .stats {
    display: flex;
    justify-content: space-between;
    color: var(--muted);
    gap: 6px;
  }
  .stats b {
    color: var(--ink);
    font-weight: 600;
  }
  .top {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 3px;
    font-size: 0.8rem;
  }
  .top li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 70px 42px;
    gap: 6px;
    align-items: center;
  }
  .tv {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tb {
    height: 6px;
    background: var(--line);
    border-radius: 3px;
    overflow: hidden;
  }
  .tf {
    display: block;
    height: 100%;
    background: var(--bar);
  }
  .tn {
    text-align: right;
    color: var(--muted);
  }
  .flags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .col header strong {
    font-family: var(--mono);
    font-size: 0.86rem;
  }
  @media (max-width: 560px) {
    .cols {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .col {
      padding: 10px;
      gap: 6px;
    }
    .col header {
      flex-wrap: wrap;
      gap: 4px;
    }
    .meta,
    .stats {
      flex-wrap: wrap;
      gap: 0 6px;
    }
    .top li {
      grid-template-columns: minmax(0, 1fr) 34px;
    }
    .tb {
      display: none;
    }
  }
</style>
