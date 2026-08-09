<script lang="ts">
  import { FileUp, Plus, Trash2 } from '@lucide/svelte';
  import type { FormDataRow } from '../lib/types';
  import { blankFormRow } from '../lib/types';

  export let rows: FormDataRow[];
  export let onChange: () => void = () => {};

  function commit(index?: number) {
    if (index === rows.length - 1 && (rows[index].key || rows[index].value || rows[index].fileName)) {
      rows = [...rows, blankFormRow()];
    } else rows = [...rows];
    onChange();
  }

  function setKind(row: FormDataRow, kind: 'text' | 'file') {
    row.kind = kind;
    if (kind === 'text') {
      row.fileName = undefined;
      row.mimeType = undefined;
      row.dataBase64 = undefined;
    } else row.value = '';
    commit();
  }

  async function chooseFile(row: FormDataRow, files: FileList | null, index: number) {
    const file = files?.[0];
    if (!file) return;
    row.fileName = file.name;
    row.mimeType = file.type || 'application/octet-stream';
    row.dataBase64 = toBase64(await file.arrayBuffer());
    commit(index);
  }

  function toBase64(buffer: ArrayBuffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
  }

  function remove(id: string) {
    rows = rows.filter((row) => row.id !== id);
    if (!rows.length || rows.at(-1)?.key || rows.at(-1)?.fileName) rows = [...rows, blankFormRow()];
    onChange();
  }
</script>

<div class="kv-editor form-data-editor">
  <div class="kv-header form-kv-header">
    <span></span><span>Type</span><span>Key</span><span>Value</span><span>Description</span><span></span>
  </div>
  {#each rows as row, index (row.id)}
    <div class="kv-row form-kv-row" class:empty={!row.key && !row.value && !row.fileName}>
      <label class="check-wrap" title={row.enabled ? 'Disable row' : 'Enable row'}>
        <input type="checkbox" bind:checked={row.enabled} on:change={() => commit()} /><span class="custom-check"></span>
      </label>
      <select value={row.kind} on:change={(event) => setKind(row, event.currentTarget.value as 'text' | 'file')} aria-label="Field type">
        <option value="text">Text</option><option value="file">File</option>
      </select>
      <input bind:value={row.key} on:input={() => commit(index)} placeholder="Key" aria-label="Form key" />
      {#if row.kind === 'file'}
        <label class="file-cell" title={row.fileName ?? 'Choose file'}>
          <input type="file" on:change={(event) => chooseFile(row, event.currentTarget.files, index)} />
          <FileUp size={13} /><span>{row.fileName ?? 'Select file'}</span>
        </label>
      {:else}
        <input bind:value={row.value} on:input={() => commit(index)} placeholder="Value" aria-label="Form value" />
      {/if}
      <input bind:value={row.description} on:input={() => commit()} placeholder="Optional description" aria-label="Description" />
      <button class="icon-button subtle delete" on:click={() => remove(row.id)} title="Delete row" aria-label="Delete row"><Trash2 size={14} /></button>
    </div>
  {/each}
  <button class="add-row" on:click={() => { rows = [...rows, blankFormRow()]; onChange(); }}><Plus size={14} /> Add row</button>
</div>
