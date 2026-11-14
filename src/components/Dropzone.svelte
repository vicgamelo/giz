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
  <span class="icon"
    ><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"
      ><path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" /></svg
    ></span
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
    padding: 40px 20px;
    border: 2px dashed var(--line-2);
    border-radius: 12px;
    background: var(--panel-2);
    color: var(--ink);
    font-size: 1.05rem;
    transition:
      border-color 0.2s,
      background 0.2s;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    margin-bottom: 6px;
    border-radius: 50%;
    background: var(--accent-fill);
    color: var(--accent-ink);
    transition: transform 0.35s var(--ease-out);
  }
  .zone:hover:not(:disabled),
  .zone.over {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent-soft) 40%, var(--panel-2));
  }
  .zone:hover:not(:disabled) .icon,
  .zone.over .icon {
    transform: translateY(-4px);
  }
  .zone:disabled {
    cursor: wait;
  }
  .zone:disabled .icon {
    background: var(--line);
    color: var(--muted);
  }
  svg path {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .err {
    color: var(--danger);
    margin-top: 6px;
  }
</style>
