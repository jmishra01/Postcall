<script lang="ts">
  import { Check, Clock3, Copy, Download, FileJson, Search, WrapText } from '@lucide/svelte';
  import type { ResponseData } from '../lib/types';

  export let response: ResponseData | null = null;
  export let loading = false;
  export let error = '';

  let tab: 'body' | 'headers' | 'info' = 'body';
  let view: 'pretty' | 'raw' = 'pretty';
  let copied = false;
  let downloaded = false;
  let searchOpen = false;
  let query = '';
  let wrap = true;

  $: formattedBody = formatBody(response?.body ?? '', response?.contentType ?? '', view);
  $: highlightedSegments = highlight(formattedBody, query);
  $: matchCount = highlightedSegments.filter((segment) => segment.match).length;

  function formatBody(body: string, contentType: string, mode: 'pretty' | 'raw') {
    if (mode === 'raw') return body;
    if (contentType.includes('json') || body.trim().startsWith('{') || body.trim().startsWith('[')) {
      try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; }
    }
    return body;
  }

  function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  async function copyBody() {
    await navigator.clipboard.writeText(response?.body ?? '');
    copied = true;
    setTimeout(() => (copied = false), 1200);
  }

  function downloadBody() {
    if (!response) return;
    const blob = new Blob([response.body], { type: response.contentType || 'text/plain' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = response.contentType.includes('json') ? 'response.json' : 'response.txt';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    downloaded = true;
    window.setTimeout(() => downloaded = false, 1400);
  }

  function highlight(value: string, needle: string) {
    if (!needle) return [{ text: value, match: false }];
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matcher = new RegExp(`(${escaped})`, 'gi');
    return value.split(matcher).filter(Boolean).map((text) => ({ text, match: text.toLowerCase() === needle.toLowerCase() }));
  }
</script>

<section class="response-panel">
  <div class="response-toolbar">
    <div class="response-tabs">
      <button class:active={tab === 'body'} on:click={() => tab = 'body'}>Body</button>
      <button class:active={tab === 'headers'} on:click={() => tab = 'headers'}>
        Headers {response ? `(${response.headers.length})` : ''}
      </button>
      <button class:active={tab === 'info'} on:click={() => tab = 'info'}>Info</button>
    </div>
    {#if response}
      <div class="response-meta">
        <span class:success={response.status >= 200 && response.status < 400} class:error-status={response.status >= 400}>
          {response.status} {response.statusText}
        </span>
        <span><Clock3 size={13} /> {response.elapsedMs} ms</span>
        <span>{formatBytes(response.sizeBytes)}</span>
      </div>
    {/if}
  </div>

  {#if loading}
    <div class="response-empty">
      <div class="pulse-logo"><span></span><span></span><span></span></div>
      <strong>Sending request…</strong>
      <p>Waiting for the server to respond</p>
    </div>
  {:else if error}
    <div class="response-empty response-error">
      <div class="error-mark">!</div>
      <strong>Request failed</strong>
      <p>{error}</p>
    </div>
  {:else if !response}
    <div class="response-empty">
      <div class="empty-illustration"><FileJson size={33} /></div>
      <strong>Your response will appear here</strong>
      <p>Enter a URL and click Send to make your first request.</p>
      <span class="shortcut">⌘ ↵</span>
    </div>
  {:else if tab === 'body'}
    <div class="response-body">
      <div class="body-toolbar">
        <div class="segment-control">
          <button class:active={view === 'pretty'} on:click={() => view = 'pretty'}>Pretty</button>
          <button class:active={view === 'raw'} on:click={() => view = 'raw'}>Raw</button>
        </div>
        <div class="body-actions">
          {#if searchOpen}<div class="response-search-wrap"><input class="response-search" bind:value={query} placeholder="Find in response" /><span>{query ? matchCount : ''}</span></div>{/if}
          <button class="icon-button" on:click={() => searchOpen = !searchOpen} title="Find"><Search size={15} /></button>
          <button class="icon-button" class:active={wrap} on:click={() => wrap = !wrap} aria-pressed={wrap} title="Toggle wrapping"><WrapText size={15} /></button>
          <button class="icon-button" on:click={copyBody} title="Copy">{#if copied}<Check size={15} />{:else}<Copy size={15} />{/if}</button>
          <button class="icon-button" on:click={downloadBody} title={downloaded ? 'Downloaded' : 'Download'}>{#if downloaded}<Check size={15} />{:else}<Download size={15} />{/if}</button>
        </div>
      </div>
      <pre class="response-code" class:wrap><code>{#each highlightedSegments as segment}{#if segment.match}<mark>{segment.text}</mark>{:else}{segment.text}{/if}{/each}</code></pre>
    </div>
  {:else if tab === 'headers'}
    <div class="response-headers">
      {#each response.headers as header}
        <div><span>{header.key}</span><code>{header.value}</code></div>
      {/each}
    </div>
  {:else}
    <div class="response-info">
      <div><span>Final URL</span><code>{response.url}</code></div>
      <div><span>Content type</span><code>{response.contentType || 'Not provided'}</code></div>
      <div><span>Transfer size</span><code>{formatBytes(response.sizeBytes)}</code></div>
      <div><span>Duration</span><code>{response.elapsedMs} ms</code></div>
    </div>
  {/if}
</section>
