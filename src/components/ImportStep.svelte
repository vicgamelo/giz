<script lang="ts">
  import { app, SAMPLES } from "../lib/state.svelte";
  import { fmtInt } from "../lib/format";
  import Dropzone from "./Dropzone.svelte";
</script>

<section class="hero">
  <h1>Machine learning com planilha, <span class="mark">direto no navegador</span>.</h1>
  <p class="lead">
    Importe um CSV ou Excel, veja o perfil dos dados, monte a receita de tratamento, compare modelos com AutoML e
    exporte o código Python. O Python (pandas, scikit-learn, LightGBM e XGBoost) roda aqui, em WebAssembly: o arquivo
    não é enviado a servidor nenhum.
  </p>
</section>

<div class="panel drop">
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

<ol class="how">
  <li><strong>Perfil</strong><span>tipos, nulos, distribuições, correlações e alertas com correção em um clique</span></li>
  <li><strong>Receita</strong><span>passos que dá para desfazer e reordenar, com prévia ao vivo</span></li>
  <li><strong>AutoML</strong><span>validação cruzada com orçamento de tempo e ranking ao vivo</span></li>
  <li><strong>Código</strong><span>script ou notebook que refaz tudo, e registro no MLflow</span></li>
</ol>

<style>
  .hero {
    padding: 16px 2px 28px;
  }
  h1 {
    font-size: clamp(2rem, 4.6vw, 3.4rem);
    line-height: 1.04;
    letter-spacing: -0.03em;
    font-weight: 750;
    max-width: 18ch;
    text-wrap: balance;
  }
  .mark {
    color: var(--accent);
  }
  .lead {
    margin-top: 16px;
    max-width: 62ch;
    color: var(--muted);
    font-size: 1.05rem;
    text-wrap: pretty;
  }
  .drop {
    padding: 8px;
    margin-bottom: 16px;
  }
  .wait {
    margin: 8px 12px 6px;
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
    align-content: start;
    text-align: left;
    padding: 16px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--panel-2);
    color: var(--ink);
    transition:
      border-color 0.2s,
      transform 0.3s var(--ease-out),
      box-shadow 0.3s var(--ease-out);
  }
  .sample:hover:not(:disabled) {
    border-color: var(--accent);
    transform: translateY(-2px);
    box-shadow: var(--shadow-lift);
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
    list-style: none;
    counter-reset: how;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 20px;
    margin: 28px 0 0;
    padding: 0;
  }
  .how li {
    counter-increment: how;
    display: grid;
    gap: 2px;
    align-content: start;
  }
  .how li::before {
    content: counter(how);
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    margin-bottom: 8px;
    border-radius: 50%;
    background: var(--accent-fill);
    color: var(--accent-ink);
    font-family: var(--display);
    font-weight: 700;
    font-size: 0.9rem;
  }
  .how span {
    color: var(--muted);
    font-size: 0.88rem;
  }
  @media (max-width: 560px) {
    .how {
      gap: 14px;
    }
    .how li {
      grid-template-columns: 28px minmax(0, 1fr);
      column-gap: 12px;
    }
    .how li::before {
      grid-row: span 2;
      margin: 0;
    }
  }
</style>
