<script lang="ts">
  export let value: unknown;
  export let query = '';
  export let wrap = true;
  export let nested = false;

  type GridRow = Record<string, unknown>;
  type GridData = { columns: string[]; rows: GridRow[]; emptyLabel: string };

  $: grid = createGrid(value);

  function createGrid(input: unknown): GridData {
    if (Array.isArray(input)) {
      if (input.length === 0) return { columns: [], rows: [], emptyLabel: '[ ]' };

      if (input.every(isRecord)) {
        const columns = Array.from(new Set(input.flatMap((item) => Object.keys(item))));
        if (columns.length > 0) return { columns, rows: input, emptyLabel: '' };
      }

      return {
        columns: ['Value'],
        rows: input.map((item) => ({ Value: item })),
        emptyLabel: ''
      };
    }

    if (isRecord(input)) {
      const columns = Object.keys(input);
      return {
        columns,
        rows: columns.length > 0 ? [input] : [],
        emptyLabel: columns.length > 0 ? '' : '{ }'
      };
    }

    return { columns: ['Value'], rows: [{ Value: input }], emptyLabel: '' };
  }

  function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
  }

  function isStructured(input: unknown) {
    return typeof input === 'object' && input !== null;
  }

  function formatValue(input: unknown) {
    if (input === undefined) return '';
    if (input === null) return 'null';
    return String(input);
  }

  function highlight(input: string, needle: string) {
    if (!needle) return [{ text: input, match: false }];
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matcher = new RegExp(`(${escaped})`, 'gi');
    return input.split(matcher).filter(Boolean).map((text) => ({ text, match: text.toLowerCase() === needle.toLowerCase() }));
  }
</script>

<div class="json-grid-table" class:nested-grid={nested}>
  {#if grid.emptyLabel}
    <div class="nested-json-empty">{grid.emptyLabel}</div>
  {:else}
    <table>
      <thead>
        <tr><th class="row-number">#</th>{#each grid.columns as column}<th>{column}</th>{/each}</tr>
      </thead>
      <tbody>
        {#each grid.rows as row, index}
          <tr>
            <th class="row-number">{index + 1}</th>
            {#each grid.columns as column}
              <td class:wrap class:structured-cell={isStructured(row[column])}>
                {#if isStructured(row[column])}
                  <svelte:self value={row[column]} {query} {wrap} nested={true} />
                {:else}
                  {#each highlight(formatValue(row[column]), query) as segment}{#if segment.match}<mark>{segment.text}</mark>{:else}{segment.text}{/if}{/each}
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
