<script lang="ts">
  import { Plus, Trash2 } from '@lucide/svelte';
  import type { KeyValue } from '../lib/types';
  import { blankRow } from '../lib/types';

  export let rows: KeyValue[];
  export let keyPlaceholder = 'Key';
  export let valuePlaceholder = 'Value';
  export let onChange: () => void = () => {};

  function update() {
    rows = [...rows];
    onChange();
  }

  function updateAndGrow(index: number) {
    if (index === rows.length - 1 && (rows[index].key || rows[index].value)) {
      rows = [...rows, blankRow()];
    } else {
      rows = [...rows];
    }
    onChange();
  }

  function remove(id: string) {
    rows = rows.filter((row) => row.id !== id);
    if (!rows.length || rows.at(-1)?.key || rows.at(-1)?.value) rows = [...rows, blankRow()];
    onChange();
  }
</script>

<div class="kv-editor">
  <div class="kv-header">
    <span></span>
    <span>{keyPlaceholder}</span>
    <span>{valuePlaceholder}</span>
    <span>Description</span>
    <span></span>
  </div>
  {#each rows as row, index (row.id)}
    <div class="kv-row" class:empty={!row.key && !row.value}>
      <label class="check-wrap" title={row.enabled ? 'Disable row' : 'Enable row'}>
        <input type="checkbox" bind:checked={row.enabled} on:change={update} />
        <span class="custom-check"></span>
      </label>
      <input bind:value={row.key} on:input={() => updateAndGrow(index)} placeholder={keyPlaceholder} aria-label={keyPlaceholder} />
      <input bind:value={row.value} on:input={() => updateAndGrow(index)} placeholder={valuePlaceholder} aria-label={valuePlaceholder} />
      <input bind:value={row.description} on:input={update} placeholder="Optional description" aria-label="Description" />
      <button class="icon-button subtle delete" on:click={() => remove(row.id)} title="Delete row" aria-label="Delete row">
        <Trash2 size={14} />
      </button>
    </div>
  {/each}
  <button class="add-row" on:click={() => { rows = [...rows, blankRow()]; onChange(); }}>
    <Plus size={14} /> Add row
  </button>
</div>
