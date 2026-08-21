<script lang="ts">
  import { onMount } from 'svelte';
  import { AlertTriangle, Github, RefreshCw, Unlink2 } from '@lucide/svelte';
  import type { Collection } from '../lib/types';
  import { pushCollections } from '../lib/github';
  import { getLinkedRepository, link, resolveConflict, sync, unlink, type SyncConflict, type SyncError } from '../lib/sync';

  export let collections: Collection[];
  export let onMergeCollections: (merged: Collection[]) => void;
  export let onToast: (message: string) => void;

  export let linkedRepo: { owner: string; repo: string; branch: string } | null = null;
  export let syncing = false;
  export let lastSyncLabel = '';
  export let conflicts: SyncConflict[] = [];
  export let errors: SyncError[] = [];

  let repoOwner = '';
  let repoName = '';
  let repoBranch = 'main';
  let repoToken = '';
  let linking = false;
  let linkError = '';

  function collectionName(collectionId: string): string {
    if (collectionId === '__manifest__') return 'Collection manifest';
    return collections.find((item) => item.id === collectionId)?.name ?? collectionId;
  }

  onMount(async () => {
    linkedRepo = await getLinkedRepository().catch(() => null);
  });

  async function handleLink() {
    const owner = repoOwner.trim();
    const repo = repoName.trim();
    const branch = repoBranch.trim();
    const token = repoToken.trim();
    if (!owner || !repo || !branch || !token) {
      linkError = 'Fill in owner, repository, branch, and a token.';
      return;
    }
    linking = true;
    linkError = '';
    try {
      await link({ owner, repo, branch }, token);
      linkedRepo = { owner, repo, branch };
      repoToken = '';
      onToast('GitHub linked');
    } catch (error) {
      linkError = error instanceof Error ? error.message : 'Could not link this repository.';
    } finally {
      linking = false;
    }
  }

  async function handleUnlink() {
    await unlink();
    linkedRepo = null;
    conflicts = [];
    errors = [];
    lastSyncLabel = '';
    onToast('GitHub unlinked');
  }

  export async function handleSync() {
    syncing = true;
    try {
      const result = await sync(collections);
      if (result.merged.length) onMergeCollections(result.merged);
      const mergedIds = new Set(result.merged.map((collection) => collection.id));
      conflicts = [...conflicts.filter((conflict) => !mergedIds.has(conflict.collectionId)), ...result.conflicts];
      errors = result.errors;
      lastSyncLabel = new Date().toLocaleTimeString();

      const parts: string[] = [];
      if (result.merged.length) parts.push(`${result.merged.length} pulled`);
      if (result.pushed.length) parts.push(`${result.pushed.length} pushed`);
      if (result.conflicts.length) parts.push(`${result.conflicts.length} conflict${result.conflicts.length > 1 ? 's' : ''}`);
      if (result.errors.length) parts.push(`${result.errors.length} failed`);
      onToast(parts.length ? `Sync complete · ${parts.join(' · ')}` : 'Already up to date');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Sync failed');
    } finally {
      syncing = false;
    }
  }

  async function keepLocal(conflict: SyncConflict) {
    const collection = collections.find((item) => item.id === conflict.collectionId) ?? conflict.local;
    const results = await pushCollections([{ id: collection.id, name: collection.name, data: collection }]);
    if (results[0]?.outcome === 'pushed') {
      await resolveConflict(collection);
      conflicts = conflicts.filter((item) => item.collectionId !== conflict.collectionId);
      onToast(`Kept your version of "${collection.name}"`);
    } else {
      onToast('GitHub changed again — sync once more.');
    }
  }

  async function keepRemote(conflict: SyncConflict) {
    onMergeCollections([conflict.remote]);
    await resolveConflict(conflict.remote);
    conflicts = conflicts.filter((item) => item.collectionId !== conflict.collectionId);
    onToast(`Replaced "${conflict.remote.name}" with GitHub's version`);
  }
</script>

<section>
  <div class="settings-section-heading">
    <strong>Cloud sync</strong>
    <small>Store collections in a GitHub repository and sync them across devices.</small>
  </div>

  {#if !linkedRepo}
    <div class="gh-sync-fields">
      <div class="gh-sync-fields-row">
        <label class="field-label">Repository owner<input bind:value={repoOwner} placeholder="octocat" disabled={linking} /></label>
        <label class="field-label">Repository name<input bind:value={repoName} placeholder="postcall-collections" disabled={linking} /></label>
      </div>
      <label class="field-label">Branch<input bind:value={repoBranch} placeholder="main" disabled={linking} /></label>
      <label class="field-label">Personal access token<input type="password" bind:value={repoToken} placeholder="github_pat_…" disabled={linking} /></label>
    </div>
    {#if linkError}<p class="gh-sync-error"><AlertTriangle size={13} /> {linkError}</p>{/if}
    <div class="settings-action-row">
      <span>
        <strong>Fine-grained token</strong>
        <small>Grant read/write access to "Contents" on this one repository. The token is stored in your OS keychain, never in the workspace file.</small>
      </span>
      <button class="primary-button" disabled={linking} on:click={handleLink}><Github size={13} /> {linking ? 'Linking…' : 'Link repository'}</button>
    </div>
  {:else}
    <div class="settings-action-row">
      <span>
        <strong class="gh-sync-repo-name"><i class="status-dot"></i> {linkedRepo.owner}/{linkedRepo.repo}</strong>
        <small>Branch {linkedRepo.branch}{lastSyncLabel ? ` · Last synced ${lastSyncLabel}` : ''}</small>
      </span>
      <button class="secondary-button" disabled={syncing} on:click={handleSync}><RefreshCw size={13} /> {syncing ? 'Syncing…' : 'Sync now'}</button>
      <button class="secondary-button" on:click={handleUnlink}><Unlink2 size={13} /> Unlink</button>
    </div>
    {#if conflicts.length}
      <div class="gh-sync-conflicts">
        {#each conflicts as conflict (conflict.collectionId)}
          <div class="gh-sync-conflict-row">
            <span><strong class="gh-sync-conflict-title"><AlertTriangle size={13} /> {collectionName(conflict.collectionId)}</strong><small>Changed here and on GitHub — choose which version to keep.</small></span>
            <button class="secondary-button" on:click={() => keepLocal(conflict)}>Keep mine</button>
            <button class="secondary-button" on:click={() => keepRemote(conflict)}>Keep GitHub's</button>
          </div>
        {/each}
      </div>
    {/if}
    {#if errors.length}
      <div class="gh-sync-conflicts">
        {#each errors as syncError (syncError.collectionId)}
          <div class="gh-sync-conflict-row">
            <span><strong class="gh-sync-conflict-title"><AlertTriangle size={13} /> {collectionName(syncError.collectionId)}</strong><small>{syncError.message}</small></span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</section>
