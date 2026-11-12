<script lang="ts">
  import { app, SAMPLES } from "../lib/state.svelte";
  import { fmtInt } from "../lib/format";
  import Dropzone from "./Dropzone.svelte";
</script>

<section class="hero">
  <h1>Machine learning com planilha, <span>direto no navegador</span>.</h1>
  <p class="lead">
    Importe um CSV ou Excel, veja o perfil dos dados, monte a receita de tratamento, compare modelos com AutoML e
    exporte o código Python. O Python (pandas, scikit-learn, LightGBM e XGBoost) roda aqui, em WebAssembly: o arquivo
    não é enviado a servidor nenhum.
  </p>
</section>

<div class="panel">
  <Dropzone onfile={(name, data) => app.loadFile(name, data)} disabled={!app.pyReady || !!app.busy} />
  {#if !app.pyReady}
    <p class="small muted wait"><span class="spinner"></span> {app.status} Na primeira visita são ~30 MB; depois fica em cache.</p>
  {/if}
</div>

<div class="panel">
  <div class="panel-head">
    <h3>Ou comece por um exemplo</h3>
  </div>
  <div class="samples">
    {#each SAMPLES as s (s.id)}
      <button class="sample" disabled={!app.pyReady || !!app.busy} onclick={() => app.loadSample(s.id)}>
        <strong>{s.title}</strong>
        <span class="small">{s.detail}</span>
        <span class="small muted src">{s.source}</span>
      </button>
    {/each}
  </div>
</div>

{#if app.source?.format === "excel" && app.source.sheets && app.source.sheets.length > 1}
  <div class="panel">
    <h3>Abas da planilha</h3>
    <p class="small muted">Escolhi a maior. Troque se quiser outra.</p>
    <div class="sheets">
      {#each app.source.sheets as sh (sh.name)}
        <button class="btn sm" class:primary={sh.name === app.source.sheet} onclick={() => app.chooseSheet(sh.name)}>
          {sh.name} · {fmtInt(sh.rows)} linhas
        </button>
      {/each}
    </div>
  </div>
{/if}

<div class="how">
  <div><strong>1. Perfil</strong><span>tipos, nulos, distribuições, correlações e alertas com correção em um clique</span></div>
  <div><strong>2. Receita</strong><span>passos que dá para desfazer e reordenar, com prévia ao vivo</span></div>
  <div><strong>3. AutoML</strong><span>validação cruzada com orçamento de tempo e ranking ao vivo</span></div>
  <div><strong>4. Código</strong><span>script ou notebook que refaz tudo, e registro no MLflow</span></div>
</div>

<style>
  .hero {
    padding: 8px 2px 18px;
  }
  h1 {
    font-size: clamp(1.6rem, 3.2vw, 2.3rem);
    letter-spacing: -0.03em;
    max-width: 22ch;
  }
  h1 span {
    color: var(--accent);
  }
  .lead {
    margin-top: 10px;
    max-width: 70ch;
    color: var(--muted);
  }
  .wait {
    margin-top: 10px;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .samples {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  }
  .sample {
    display: grid;
    gap: 4px;
    text-align: left;
    padding: 14px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--panel-2);
    color: var(--ink);
  }
  .sample:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .sample:disabled {
    opacity: 0.55;
    cursor: wait;
  }
  .src {
    margin-top: 4px;
  }
  .sheets {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }
  .how {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
    margin-top: 18px;
  }
  .how div {
    display: grid;
    gap: 2px;
    padding: 12px 14px;
    border-left: 3px solid var(--accent);
  }
  .how span {
    color: var(--muted);
    font-size: 0.88rem;
  }
</style>
