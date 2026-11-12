<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "../lib/state.svelte";
  import { fmtMetric, fmtNum, metricLabel } from "../lib/format";
  import { logRun, me, myRuns, PORTAL, type Me, type MLRunResult, type MyRun } from "../lib/portal";

  type Kind = "script" | "notebook" | "recipe";
  const FILES: Record<Kind, { name: string; label: string; type: string }> = {
    script: { name: "lousa_modelo.py", label: "Script Python", type: "text/x-python" },
    notebook: { name: "lousa_modelo.ipynb", label: "Notebook Jupyter", type: "application/x-ipynb+json" },
    recipe: { name: "receita.json", label: "Receita (JSON)", type: "application/json" },
  };

  let kind = $state<Kind>("script");
  let code = $state<string>("");
  const r = $derived(app.result!);

  async function show(k: Kind) {
    kind = k;
    code = (await app.exportFile(k)) ?? "";
  }

  async function download(k: Kind) {
    const text = await app.exportFile(k);
    if (!text) return;
    const url = URL.createObjectURL(new Blob([text], { type: `${FILES[k].type};charset=utf-8` }));
    const a = document.createElement("a");
    a.href = url;
    a.download = FILES[k].name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // --- MLflow ---------------------------------------------------------------------------------------------------
  let account = $state<Me | null>(null);
  let checking = $state(false);
  let accountError = $state<string | null>(null);
  let includeModel = $state(true);
  let summary = $state<{ params: Record<string, string>; metrics: Record<string, number>; artifacts: Record<string, number> } | null>(null);
  let payload: unknown = null;
  let sending = $state(false);
  let sent = $state<MLRunResult | null>(null);
  let sendError = $state<string | null>(null);
  let runs = $state<MyRun[]>([]);
  const storesData = $derived(r.best.stores_data);

  async function checkLogin() {
    checking = true;
    accountError = null;
    try {
      account = await me();
      if (account.user) runs = (await myRuns()).runs;
    } catch (e) {
      accountError = (e as Error).message;
    } finally {
      checking = false;
    }
  }

  async function prepare() {
    sendError = null;
    sent = null;
    try {
      const res = await app.engine!.call<{ payload: unknown; summary: typeof summary }>({
        cmd: "mlflow",
        includeModel: includeModel && !storesData,
      });
      payload = res.payload;
      summary = res.summary;
    } catch (e) {
      sendError = (e as Error).message;
    }
  }

  async function send() {
    if (!payload) return;
    sending = true;
    sendError = null;
    try {
      sent = await logRun(payload);
      [account, runs] = await Promise.all([me(), myRuns().then((r) => r.runs)]);
    } catch (e) {
      sendError = (e as Error).message;
    } finally {
      sending = false;
    }
  }

  onMount(() => {
    void show("script");
    void checkLogin();
  });

  $effect(() => {
    void includeModel;
    void app.result;
    void prepare();
  });

  // a métrica principal de cada run (AUC, F1 macro ou RMSE), não a primeira que aparecer
  function holdoutMetric(metrics: Record<string, number>): [string, number] | undefined {
    for (const k of ["roc_auc", "f1_macro", "rmse"]) if (`holdout_${k}` in metrics) return [`holdout_${k}`, metrics[`holdout_${k}`]];
    return Object.entries(metrics).find(([k]) => k.startsWith("holdout_"));
  }

  const kb = (n: number) => (n < 1024 ? `${n} B` : `${fmtNum(n / 1024, 1)} KB`);
  const quota = $derived(account?.quotas?.ml);
</script>

<div class="panel-head">
  <div>
    <h2>Exportar e registrar</h2>
    <p class="muted small">
      O código refaz a receita (com os valores aprendidos) e treina o mesmo modelo, com os mesmos hiperparâmetros e a mesma
      semente. Rode na sua máquina com o arquivo original.
    </p>
  </div>
</div>

<div class="panel">
  <div class="panel-head">
    <div class="tabs" role="tablist">
      {#each Object.entries(FILES) as [k, f] (k)}
        <button class="btn sm" class:primary={kind === k} role="tab" aria-selected={kind === k} onclick={() => show(k as Kind)}
          >{f.label}</button
        >
      {/each}
    </div>
    <div class="dl">
      <button class="btn sm" onclick={() => navigator.clipboard?.writeText(code)}>Copiar</button>
      <button class="btn primary sm" onclick={() => download(kind)}>⬇ {FILES[kind].name}</button>
    </div>
  </div>
  <pre class="code">{code}</pre>
  <p class="small muted req">
    Requer Python 3.10+ com pandas, scikit-learn{r.best.cls.startsWith("lightgbm") ? ", lightgbm" : ""}{r.best.cls.startsWith("xgboost")
      ? ", xgboost"
      : ""} e joblib{app.source?.format === "excel" ? " (e openpyxl para ler o Excel)" : ""}.
  </p>
</div>

<div class="panel mlflow">
  <div class="panel-head">
    <h3>Registrar no MLflow</h3>
    <span class="chip info">via portal vgmelo.tech</span>
  </div>
  <p class="small">
    Vai para o MLflow privado do Victor um resumo do experimento: parâmetros, métricas, a receita e o código exportado
    {#if includeModel && !storesData}e o modelo salvo com <a href="https://skops.readthedocs.io" rel="noopener">skops</a> (sem pickle){/if}.
    <b>Nenhuma linha dos dados vai junto.</b> Vão valores derivados deles: as categorias e medianas que a receita aprendeu
    e os cortes das árvores do modelo.
  </p>

  {#if checking}
    <p class="small muted"><span class="spinner"></span> Conferindo o login…</p>
  {:else if accountError}
    <div class="alert warn"><span class="msg">{accountError}</span><button class="btn sm" onclick={checkLogin}>Tentar de novo</button></div>
  {:else if !account?.user}
    <div class="alert info">
      <span class="msg">
        Precisa entrar no vgmelo.tech (Google, GitHub ou e-mail). O login abre em outra aba, para você não perder o que
        treinou aqui.
      </span>
      <a class="btn sm" href="{PORTAL}/entrar/" target="_blank" rel="noopener">Entrar</a>
      <button class="btn sm" onclick={checkLogin}>Já entrei</button>
    </div>
  {:else}
    <p class="small muted">
      Conectado como <b>{account.user.name ?? account.user.email ?? "você"}</b>{#if quota}{" · "}{quota.remaining} de {quota.limit}
        registros hoje{/if}.
    </p>
  {/if}

  <label class="check">
    <input type="checkbox" bind:checked={includeModel} disabled={storesData} />
    Incluir o modelo treinado (skops)
    {#if storesData}<span class="small muted">— o k vizinhos guarda as linhas de treino, então não vai</span>{/if}
  </label>

  {#if summary}
    <details>
      <summary class="small">Ver exatamente o que será enviado</summary>
      <div class="what">
        <div>
          <h4 class="small">Parâmetros ({Object.keys(summary.params).length})</h4>
          <ul class="small mono">
            {#each Object.entries(summary.params) as [k, v] (k)}<li>{k} = {v}</li>{/each}
          </ul>
        </div>
        <div>
          <h4 class="small">Métricas</h4>
          <ul class="small mono">
            {#each Object.entries(summary.metrics) as [k, v] (k)}<li>{k} = {fmtNum(v, 4)}</li>{/each}
          </ul>
          <h4 class="small">Artefatos</h4>
          <ul class="small mono">
            {#each Object.entries(summary.artifacts) as [k, v] (k)}<li>{k} · {kb(v)}</li>{/each}
          </ul>
        </div>
      </div>
    </details>
  {/if}

  <div class="go">
    <button class="btn primary" disabled={!account?.user || !summary || sending || !!sent || quota?.remaining === 0} onclick={send}>
      {#if sending}<span class="spinner"></span> Enviando…{:else}Registrar experimento{/if}
    </button>
    {#if sent}
      <span class="ok small">✓ Registrado no experimento “{sent.experiment}” · run <span class="mono">{sent.run_id.slice(0, 12)}</span> ·
        {sent.artifacts.length} artefatos</span>
    {/if}
    {#if sendError}<span class="bad small">{sendError}</span>{/if}
  </div>

  {#if runs.length}
    <h4 class="small muted runs-h">Seus registros</h4>
    <table class="data">
      <thead><tr><th>quando</th><th>run</th><th>modelo</th><th>alvo</th><th>holdout</th></tr></thead>
      <tbody>
        {#each runs as run (run.run_id)}
          {@const h = holdoutMetric(run.metrics)}
          <tr>
            <td>{new Date(run.start_time).toLocaleString("pt-BR")}</td>
            <td class="mono">{run.run_id.slice(0, 10)}</td>
            <td>{run.model ?? "–"}</td>
            <td>{run.target ?? "–"}</td>
            <td>{h ? `${metricLabel(h[0].replace("holdout_", ""))} ${fmtMetric(h[0].replace("holdout_", ""), h[1])}` : "–"}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .tabs,
  .dl {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .req {
    margin-top: 8px;
  }
  .mlflow {
    display: grid;
    gap: 12px;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 0.92rem;
  }
  details summary {
    cursor: pointer;
    color: var(--accent);
  }
  .what {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-top: 10px;
  }
  .what ul {
    margin: 4px 0 10px;
    padding-left: 16px;
    max-height: 220px;
    overflow: auto;
    overflow-wrap: anywhere;
  }
  .go {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }
  .ok {
    color: var(--good);
  }
  .bad {
    color: var(--danger);
  }
  .runs-h {
    margin-top: 6px;
  }
  @media (max-width: 700px) {
    .what {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
