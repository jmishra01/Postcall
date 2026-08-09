<script lang="ts">
  import {
    ArrowDownAZ, Check, ChevronDown, ChevronRight, Clock3, Code2, Copy, Download, Ellipsis, FilePlus2, FileUp,
    Folder, FolderPlus, Globe2, History, Layers3, MoveRight, Pencil, Plus, Search, Settings2, Trash2
  } from '@lucide/svelte';
  import type { ApiRequest, Collection, CollectionFolder, Environment, PostcallWorkspace } from '../lib/types';

  export let workspace: PostcallWorkspace;
  export let workspaces: PostcallWorkspace[];
  export let activeWorkspaceId: string;
  export let onSwitchWorkspace: (id: string) => void;
  export let onCreateWorkspace: () => void;
  export let onDeleteWorkspace: (workspace: PostcallWorkspace) => void;
  export let onImportCollections: (files: FileList | null) => void;
  export let onImportCurl: () => void;
  export let activeSection: 'collections' | 'history' | 'environments';
  export let selectedRequestId = '';
  export let onSection: (section: 'collections' | 'history' | 'environments') => void;
  export let onOpenRequest: (request: ApiRequest) => void;
  export let onNewRequest: () => void;
  export let onNewCollection: () => void;
  export let onNewEnvironment: () => void;
  export let onDeleteHistory: () => void;
  export let onToggleCollection: (collection: Collection) => void;
  export let onToggleFolder: (collection: Collection, folder: CollectionFolder) => void;
  export let onSelectEnvironment: (environment: Environment) => void;
  export let onAddRequestToCollection: (collection: Collection) => void;
  export let onAddFolder: (collection: Collection) => void;
  export let onRenameCollection: (collection: Collection, name: string) => void;
  export let onDuplicateCollection: (collection: Collection) => void;
  export let onSortCollection: (collection: Collection) => void;
  export let onExportCollection: (collection: Collection) => void;
  export let onDeleteCollection: (collection: Collection) => void;
  export let onConfigureScope: (collection: Collection, folder: CollectionFolder | null) => void;
  export let onRenameRequest: (request: ApiRequest, collection: Collection, folder: CollectionFolder | null) => void;
  export let onDuplicateRequest: (request: ApiRequest, collection: Collection, folder: CollectionFolder | null) => void;
  export let onMoveRequest: (request: ApiRequest, collection: Collection, folder: CollectionFolder | null) => void;
  export let onDeleteRequest: (request: ApiRequest, collection: Collection, folder: CollectionFolder | null) => void;
  export let onOpenSettings: () => void;

  let search = '';
  let openMenuId = '';
  let openRequestMenuId = '';
  let openFolderMenuId = '';
  let workspaceMenuOpen = false;
  let renamingId = '';
  let renameValue = '';
  let collectionFileInput: HTMLInputElement;
  $: query = search.trim().toLowerCase();

  function startRename(collection: Collection) {
    openMenuId = '';
    renamingId = collection.id;
    renameValue = collection.name;
  }

  function finishRename(collection: Collection) {
    const value = renameValue.trim();
    if (value && value !== collection.name) onRenameCollection(collection, value);
    renamingId = '';
  }

  function perform(action: () => void) {
    openMenuId = '';
    action();
  }

  function toggleRequestMenu(requestId: string) {
    openMenuId = '';
    openFolderMenuId = '';
    openRequestMenuId = openRequestMenuId === requestId ? '' : requestId;
  }

  function toggleFolderMenu(folderId: string) {
    openMenuId = '';
    openRequestMenuId = '';
    openFolderMenuId = openFolderMenuId === folderId ? '' : folderId;
  }

  function performRequest(action: () => void) {
    openRequestMenuId = '';
    action();
  }

  function closeOpenMenus() {
    openMenuId = '';
    openRequestMenuId = '';
    openFolderMenuId = '';
    workspaceMenuOpen = false;
  }
</script>

<svelte:window on:click={closeOpenMenus} />

<aside class="sidebar">
  <div class="workspace-switcher-wrap">
    <button class="workspace-switcher" class:open={workspaceMenuOpen} on:click|stopPropagation={() => workspaceMenuOpen = !workspaceMenuOpen} aria-label="Switch workspace" aria-expanded={workspaceMenuOpen}>
      <div class="workspace-avatar">{workspace.name.slice(0, 1).toUpperCase()}</div>
      <div><span>Workspace</span><strong>{workspace.name}</strong></div>
      <ChevronDown size={15} />
    </button>
    {#if workspaceMenuOpen}
      <div class="workspace-menu">
        <div class="workspace-menu-heading"><span>Workspaces</span><small>{workspaces.length}</small></div>
        <div class="workspace-menu-list">
          {#each workspaces as item (item.id)}
            <div class="workspace-menu-row" class:active={item.id === activeWorkspaceId}>
              <button class="workspace-choice" on:click={() => { workspaceMenuOpen = false; onSwitchWorkspace(item.id); }}>
                <span class="workspace-choice-avatar">{item.name.slice(0, 1).toUpperCase()}</span>
                <span>{item.name}</span>
                {#if item.id === activeWorkspaceId}<Check size={14} />{/if}
              </button>
              <button class="icon-button workspace-delete" disabled={workspaces.length === 1} on:click={() => { workspaceMenuOpen = false; onDeleteWorkspace(item); }} title="Delete workspace" aria-label={`Delete ${item.name}`}><Trash2 size={13} /></button>
            </div>
          {/each}
        </div>
        <button class="workspace-create" on:click={() => { workspaceMenuOpen = false; onCreateWorkspace(); }}><Plus size={14} /> Create workspace</button>
      </div>
    {/if}
  </div>

  <nav class="sidebar-nav">
    <button class:active={activeSection === 'collections'} on:click={() => onSection('collections')}>
      <Layers3 size={17} /> Collections <span>{workspace.collections.length}</span>
    </button>
    <button class:active={activeSection === 'history'} on:click={() => onSection('history')}>
      <History size={17} /> History <span>{workspace.history.length}</span>
    </button>
    <button class:active={activeSection === 'environments'} on:click={() => onSection('environments')}>
      <Globe2 size={17} /> Environments <span>{workspace.environments.length}</span>
    </button>
  </nav>

  <div class="sidebar-heading">
    <strong>{activeSection}</strong>
    <div>
      {#if activeSection === 'history' && workspace.history.length}
        <button class="icon-button" on:click={onDeleteHistory} title="Clear history"><Trash2 size={14} /></button>
      {:else if activeSection === 'collections'}
        <input class="hidden-file-input" bind:this={collectionFileInput} type="file" accept="application/json,.json,.postman_collection" multiple on:change={(event) => { onImportCollections(event.currentTarget.files); event.currentTarget.value = ''; }} />
        <button class="icon-button" on:click={() => collectionFileInput.click()} title="Import collection JSON" aria-label="Import collection JSON"><FileUp size={15} /></button>
        <button class="icon-button" on:click={onImportCurl} title="Import cURL" aria-label="Import cURL"><Code2 size={15} /></button>
        <button class="icon-button" on:click={onNewCollection} title="New collection"><FolderPlus size={15} /></button>
        <button class="icon-button" on:click={() => onNewRequest()} title="New request"><Plus size={15} /></button>
      {:else}
        <button class="icon-button" on:click={onNewEnvironment} title="New environment"><Plus size={15} /></button>
      {/if}
    </div>
  </div>

  <div class="sidebar-search"><Search size={14} /><input bind:value={search} placeholder={`Search ${activeSection}`} /></div>

  <div class="sidebar-content">
    {#if activeSection === 'collections'}
      {#each workspace.collections.filter(c => !query || c.name.toLowerCase().includes(query) || c.requests.some(r => r.name.toLowerCase().includes(query)) || c.folders.some(f => f.name.toLowerCase().includes(query) || f.requests.some(r => r.name.toLowerCase().includes(query)))) as collection (collection.id)}
        <div class="collection">
          <div class="collection-row">
            <button class="chevron" on:click={() => onToggleCollection(collection)} aria-label="Toggle collection">
              {#if collection.expanded}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
            </button>
            <Folder size={15} class="folder-icon" />
            {#if renamingId === collection.id}
              <input
                class="collection-rename"
                bind:value={renameValue}
                on:blur={() => finishRename(collection)}
                on:keydown={(event) => { if (event.key === 'Enter') finishRename(collection); if (event.key === 'Escape') renamingId = ''; }}
                aria-label="Collection name"
              />
            {:else}
              <button class="collection-name" on:click={() => onToggleCollection(collection)}>{collection.name}</button>
            {/if}
            <span class="count">{collection.requests.length + collection.folders.reduce((total, folder) => total + folder.requests.length, 0)}</span>
            <button class="icon-button row-more" class:menu-open={openMenuId === collection.id} on:click|stopPropagation={() => { openRequestMenuId = ''; openFolderMenuId = ''; openMenuId = openMenuId === collection.id ? '' : collection.id; }} title="Collection actions" aria-label={`Actions for ${collection.name}`}><Ellipsis size={14} /></button>
            {#if openMenuId === collection.id}
              <div class="collection-menu">
                <button on:click={() => perform(() => onAddRequestToCollection(collection))}><FilePlus2 size={14} /> Add request</button>
                <button on:click={() => perform(() => onAddFolder(collection))}><FolderPlus size={14} /> Add folder</button>
                <button on:click={() => perform(() => onConfigureScope(collection, null))}><Settings2 size={14} /> Variables & authorization</button>
                <div class="menu-separator"></div>
                <button on:click={() => startRename(collection)}><Pencil size={14} /> Rename</button>
                <button on:click={() => perform(() => onDuplicateCollection(collection))}><Copy size={14} /> Duplicate</button>
                <button on:click={() => perform(() => onSortCollection(collection))}><ArrowDownAZ size={14} /> Sort A–Z</button>
                <button on:click={() => perform(() => onExportCollection(collection))}><Download size={14} /> Export collection JSON</button>
                <div class="menu-separator"></div>
                <button class="danger-item" on:click={() => perform(() => onDeleteCollection(collection))}><Trash2 size={14} /> Delete</button>
              </div>
            {/if}
          </div>
          {#if collection.expanded}
            <div class="request-list">
              {#each collection.requests.filter(r => !query || r.name.toLowerCase().includes(query)) as request (request.id)}
                <div class="request-row-shell" class:selected={selectedRequestId === request.id}>
                  <button class="request-row" on:click={() => onOpenRequest(request)}>
                    <span class="method mini {request.method.toLowerCase()}">{request.method.slice(0, 3)}</span>
                    <span>{request.name}</span>
                  </button>
                  <button class="icon-button request-more" class:menu-open={openRequestMenuId === request.id} on:click|stopPropagation={() => toggleRequestMenu(request.id)} title="Request actions" aria-label={`Actions for ${request.name} in ${collection.name}`}><Ellipsis size={14} /></button>
                  {#if openRequestMenuId === request.id}
                    <div class="request-menu">
                      <button on:click={() => performRequest(() => onRenameRequest(request, collection, null))}><Pencil size={14} /> Rename</button>
                      <button on:click={() => performRequest(() => onDuplicateRequest(request, collection, null))}><Copy size={14} /> Duplicate</button>
                      <button on:click={() => performRequest(() => onMoveRequest(request, collection, null))}><MoveRight size={14} /> Move</button>
                      <div class="menu-separator"></div>
                      <button class="danger-item" on:click={() => performRequest(() => onDeleteRequest(request, collection, null))}><Trash2 size={14} /> Delete</button>
                    </div>
                  {/if}
                </div>
              {/each}
              {#each collection.folders.filter(f => !query || f.name.toLowerCase().includes(query) || f.requests.some(r => r.name.toLowerCase().includes(query))) as folder (folder.id)}
                <div class="collection-folder">
                  <div class="folder-row-shell">
                    <button class="folder-row" on:click={() => onToggleFolder(collection, folder)}>
                      {#if folder.expanded}<ChevronDown size={12} />{:else}<ChevronRight size={12} />{/if}
                      <Folder size={14} /><span>{folder.name}</span><small>{folder.requests.length}</small>
                    </button>
                    <button class="icon-button row-more folder-more" class:menu-open={openFolderMenuId === folder.id} on:click|stopPropagation={() => toggleFolderMenu(folder.id)} title="Folder actions" aria-label={`Actions for ${folder.name}`}><Ellipsis size={14} /></button>
                    {#if openFolderMenuId === folder.id}
                      <div class="folder-menu">
                        <button on:click={() => { openFolderMenuId = ''; onConfigureScope(collection, folder); }}><Settings2 size={14} /> Variables & authorization</button>
                      </div>
                    {/if}
                  </div>
                  {#if folder.expanded}
                    <div class="folder-requests">
                      {#each folder.requests as request (request.id)}
                        <div class="request-row-shell" class:selected={selectedRequestId === request.id}>
                          <button class="request-row" on:click={() => onOpenRequest(request)}>
                            <span class="method mini {request.method.toLowerCase()}">{request.method.slice(0, 3)}</span><span>{request.name}</span>
                          </button>
                          <button class="icon-button request-more" class:menu-open={openRequestMenuId === request.id} on:click|stopPropagation={() => toggleRequestMenu(request.id)} title="Request actions" aria-label={`Actions for ${request.name} in ${folder.name}`}><Ellipsis size={14} /></button>
                          {#if openRequestMenuId === request.id}
                            <div class="request-menu">
                              <button on:click={() => performRequest(() => onRenameRequest(request, collection, folder))}><Pencil size={14} /> Rename</button>
                              <button on:click={() => performRequest(() => onDuplicateRequest(request, collection, folder))}><Copy size={14} /> Duplicate</button>
                              <button on:click={() => performRequest(() => onMoveRequest(request, collection, folder))}><MoveRight size={14} /> Move</button>
                              <div class="menu-separator"></div>
                              <button class="danger-item" on:click={() => performRequest(() => onDeleteRequest(request, collection, folder))}><Trash2 size={14} /> Delete</button>
                            </div>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
      {#if !workspace.collections.length}
        <div class="sidebar-empty"><Folder size={24} /><p>No collections yet</p><button on:click={onNewCollection}>Create collection</button></div>
      {/if}
    {:else if activeSection === 'history'}
      {#each workspace.history.filter(h => !query || h.request.name.toLowerCase().includes(query) || h.request.url.toLowerCase().includes(query)) as item (item.id)}
        <button class="history-row" on:click={() => onOpenRequest(item.request)}>
          <span class="method mini {item.request.method.toLowerCase()}">{item.request.method.slice(0, 3)}</span>
          <span class="history-main"><strong>{item.request.name}</strong><small>{item.request.url}</small></span>
          <span class="history-side"><small class:ok={item.status && item.status < 400}>{item.status ?? 'ERR'}</small><time>{new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></span>
        </button>
      {/each}
      {#if !workspace.history.length}
        <div class="sidebar-empty"><Clock3 size={24} /><p>Requests you send will appear here.</p></div>
      {/if}
    {:else}
      {#each workspace.environments.filter(e => !query || e.name.toLowerCase().includes(query)) as environment (environment.id)}
        <button class="environment-row" on:click={() => onSelectEnvironment(environment)}>
          <div class="environment-icon"><Globe2 size={15} /></div>
          <span><strong>{environment.name}</strong><small>{environment.variables.filter(v => v.key).length} variables</small></span>
          <ChevronRight size={14} />
        </button>
      {/each}
      {#if !workspace.environments.length}
        <div class="sidebar-empty"><Globe2 size={24} /><p>No environments yet</p><button on:click={onNewEnvironment}>Create environment</button></div>
      {/if}
    {/if}
  </div>

  <div class="sidebar-footer">
    <span><span class="status-dot"></span> Local workspace</span>
    <button class="icon-button" on:click={onOpenSettings} title="Settings"><Settings2 size={15} /></button>
  </div>
</aside>
