<script lang="ts">
  let {
    onfile,
    title = "Arraste um CSV ou Excel aqui",
    hint = "ou clique para escolher · .csv, .xlsx, .xls, .ods",
    disabled = false,
  }: { onfile: (name: string, data: ArrayBuffer) => void; title?: string; hint?: string; disabled?: boolean } =
    $props();

  let over = $state(false);
  let input: HTMLInputElement;
  const MAX = 200 * 1024 * 1024;
  let error = $state<string | null>(null);

  async function take(file: File | undefined | null) {
    if (!file) return;
    error = null;
    if (file.size > MAX) {
      error = `O arquivo tem ${(file.size / 1e6).toFixed(0)} MB; o limite é 200 MB.`;
      return;
    }
    onfile(file.name, await file.arrayBuffer());
  }

  function drop(e: DragEvent) {
    e.preventDefault();
    over = false;
    if (!disabled) void take(e.dataTransfer?.files?.[0]);
  }
</script>

<button
  type="button"
  class="zone"
  class:over
  {disabled}
  onclick={() => input.click()}
  ondragover={(e) => {
    e.preventDefault();
    over = true;
  }}
  ondragleave={() => (over = false)}
  ondrop={drop}
>
  <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"
    ><path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" /></svg
  >
  <strong>{title}</strong>
  <span class="muted small">{hint}</span>
</button>
<input
  bind:this={input}
  type="file"
  accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls,.xlsb,.ods"
  class="sr-only"
  tabindex="-1"
  onchange={(e) => {
    void take((e.currentTarget as HTMLInputElement).files?.[0]);
    (e.currentTarget as HTMLInputElement).value = "";
  }}
/>
{#if error}<p class="small err">{error}</p>{/if}

<style>
  .zone {
    width: 100%;
    display: grid;
    justify-items: center;
    gap: 6px;
    padding: 34px 20px;
    border: 2px dashed var(--line-2);
    border-radius: var(--radius);
    background: var(--panel-2);
    color: var(--ink);
    transition:
      border-color 0.15s,
      background 0.15s;
  }
  .zone:hover:not(:disabled),
  .zone.over {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent-soft) 45%, var(--panel-2));
  }
  svg path {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .err {
    color: var(--danger);
    margin-top: 6px;
  }
</style>
