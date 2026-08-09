<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Braces, Check, Cloud, CodeXml as Code2, Command, Eye, FileUp,
    Earth as Globe2, CircleQuestionMark as HelpCircle, Moon, PanelLeftClose, Play, Plus, Save, Settings2,
    Sparkles, Sun, X
  } from '@lucide/svelte';
  import Sidebar from './components/Sidebar.svelte';
  import KeyValueEditor from './components/KeyValueEditor.svelte';
  import FormDataEditor from './components/FormDataEditor.svelte';
  import CodeEditor from './components/CodeEditor.svelte';
  import ResponseViewer from './components/ResponseViewer.svelte';
  import PostcallIcon from './components/postcall.svelte';
  import { executeRequest, getStoragePath, loadBrowserWorkspace, loadWorkspace, saveWorkspace } from './lib/bridge';
  import { parseCurlCommand, parsePostmanCollection } from './lib/importers';
  import { blankWorkspace, initialWorkspaceStore, normalizeRequest, normalizeWorkspaceStore } from './lib/workspace';
  import { blankRequest, blankRow, uid } from './lib/types';
  import type { ApiRequest, Collection, CollectionFolder, Environment, HistoryEntry, KeyValue, PostcallWorkspace, RequestAuth, RequestInput, ResponseData } from './lib/types';

  type SidebarSection = 'collections' | 'history' | 'environments';
  type RequestTab = 'params' | 'auth' | 'headers' | 'body' | 'scripts' | 'settings';
  type UtilityModal = 'command' | 'help' | 'settings' | 'code' | 'variables' | null;
  type RequestAction = {
    kind: 'rename' | 'move' | 'delete';
    request: ApiRequest;
    collection: Collection;
    folder: CollectionFolder | null;
  };
  type ScopeSettings = {
    collection: Collection;
    folder: CollectionFolder | null;
    variables: KeyValue[];
    auth: RequestAuth;
  };

  const defaultWorkspaceStore = initialWorkspaceStore();
  let workspaces: PostcallWorkspace[] = defaultWorkspaceStore.workspaces;
  let activeWorkspaceId = defaultWorkspaceStore.activeWorkspaceId;
  let workspace: PostcallWorkspace = workspaces[0];
  let activeSection: SidebarSection = 'collections';
  let openRequests: ApiRequest[] = [];
  let activeRequestId = '';
  let requestTab: RequestTab = 'params';
  let response: ResponseData | null = null;
  let requestError = '';
  let executing = false;
  let saved = true;
  let sidebarVisible = true;
  let darkMode = true;
  let environmentEditor: Environment | null = null;
  let hydrated = false;
  let saveTimer: number | undefined;
  let requestPanelHeight = 340;
  let resizingPanel = false;
  let bulkEditor: 'params' | 'headers' | null = null;
  let bulkText = '';
  let utilityModal: UtilityModal = null;
  let pendingDeleteCollection: Collection | null = null;
  let pendingDeleteWorkspace: PostcallWorkspace | null = null;
  let createWorkspaceOpen = false;
  let workspaceNameInput = '';
  let pendingRequestAction: RequestAction | null = null;
  let scopeSettings: ScopeSettings | null = null;
  let scopeSettingsTab: 'variables' | 'authorization' = 'variables';
  let requestActionValue = '';
  let moveTarget = '';
  let codeCopied = false;
  let toast = '';
  let toastTimer: number | undefined;
  let storagePath = 'Resolving storage location…';
  let curlImportOpen = false;
  let curlText = '';
  let curlImportError = '';

  $: activeRequest = openRequests.find((request) => request.id === activeRequestId) ?? openRequests[0];
  $: activeEnvironment = workspace.environments.find((environment) => environment.id === workspace.activeEnvironmentId);
  $: environmentLabel = activeEnvironment?.name ?? 'No environment';
  $: parameterCount = activeRequest?.params.filter((row) => row.enabled && row.key).length ?? 0;
  $: headerCount = activeRequest?.headers.filter((row) => row.enabled && row.key).length ?? 0;

  onMount(async () => {
    storagePath = await getStoragePath().catch(() => 'Storage location unavailable');
    const stored = (await loadWorkspace().catch(() => null)) ?? loadBrowserWorkspace();
    const store = normalizeWorkspaceStore(stored);
    workspaces = store.workspaces;
    activeWorkspaceId = store.activeWorkspaceId;
    workspace = workspaces.find((item) => item.id === activeWorkspaceId) ?? workspaces[0];
    resetRequestSession(workspace);
    hydrated = true;
    saveWorkspace({ workspaces, activeWorkspaceId }).catch(console.error);
  });

  function markChanged() {
    openRequests = [...openRequests];
    saved = false;
  }

  function commitWorkspace() {
    workspace = { ...workspace };
    workspaces = workspaces.map((item) => item.id === workspace.id ? workspace : item);
    if (!hydrated) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saveWorkspace({ workspaces, activeWorkspaceId }).catch(console.error), 250);
  }

  function persistWorkspaceStore() {
    if (!hydrated) return;
    window.clearTimeout(saveTimer);
    saveWorkspace({ workspaces, activeWorkspaceId }).catch(console.error);
  }

  function resetRequestSession(target: PostcallWorkspace) {
    const savedRequest = target.collections[0]?.requests[0] ?? target.collections[0]?.folders[0]?.requests[0];
    const first = savedRequest ?? blankRequest();
    openRequests = [structuredClone(normalizeRequest(first))];
    activeRequestId = first.id;
    saved = Boolean(savedRequest);
    response = null;
    requestError = '';
    requestTab = 'params';
  }

  function switchWorkspace(id: string) {
    if (id === activeWorkspaceId) return;
    workspace = { ...workspace };
    workspaces = workspaces.map((item) => item.id === workspace.id ? workspace : item);
    const target = workspaces.find((item) => item.id === id);
    if (!target) return;
    activeWorkspaceId = target.id;
    workspace = target;
    activeSection = 'collections';
    environmentEditor = null;
    resetRequestSession(target);
    persistWorkspaceStore();
    showToast(`Switched to ${target.name}`);
  }

  function openCreateWorkspace() {
    workspaceNameInput = `Workspace ${workspaces.length + 1}`;
    createWorkspaceOpen = true;
  }

  function createWorkspace() {
    const name = workspaceNameInput.trim();
    if (!name) return;
    workspace = { ...workspace };
    workspaces = workspaces.map((item) => item.id === workspace.id ? workspace : item);
    const created = blankWorkspace(name);
    workspaces = [...workspaces, created];
    activeWorkspaceId = created.id;
    workspace = created;
    createWorkspaceOpen = false;
    activeSection = 'collections';
    resetRequestSession(created);
    persistWorkspaceStore();
    showToast('Workspace created');
  }

  function deleteWorkspace(target: PostcallWorkspace) {
    if (workspaces.length === 1) {
      showToast('At least one workspace is required');
      return;
    }
    pendingDeleteWorkspace = target;
  }

  function confirmDeleteWorkspace() {
    const target = pendingDeleteWorkspace;
    if (!target || workspaces.length === 1) return;
    const deletingActive = target.id === activeWorkspaceId;
    workspaces = workspaces.filter((item) => item.id !== target.id);
    if (deletingActive) {
      workspace = workspaces[0];
      activeWorkspaceId = workspace.id;
      activeSection = 'collections';
      resetRequestSession(workspace);
    }
    pendingDeleteWorkspace = null;
    persistWorkspaceStore();
    showToast('Workspace deleted');
  }

  function showToast(message: string) {
    toast = message;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast = '', 2200);
  }

  function openRequest(request: ApiRequest) {
    const open = openRequests.find((item) => item.id === request.id);
    if (!open) openRequests = [...openRequests, structuredClone(normalizeRequest(request))];
    activeRequestId = request.id;
    response = null;
    requestError = '';
  }

  async function importCollectionFiles(files: FileList | null) {
    if (!files?.length) return;
    let imported = 0;
    try {
      for (const file of Array.from(files)) {
        const collection = parsePostmanCollection(await file.text());
        workspace.collections.push(collection);
        imported += 1;
      }
      activeSection = 'collections';
      commitWorkspace();
      showToast(`${imported} collection${imported === 1 ? '' : 's'} imported`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Collection import failed');
    }
  }

  function openCurlImport() {
    curlText = '';
    curlImportError = '';
    curlImportOpen = true;
  }

  function importCurlRequest() {
    try {
      const request = parseCurlCommand(curlText);
      openRequests = [...openRequests, request];
      activeRequestId = request.id;
      saved = false;
      response = null;
      requestError = '';
      curlImportOpen = false;
      showToast('cURL imported as a new request');
    } catch (error) {
      curlImportError = error instanceof Error ? error.message : 'Could not import the cURL command.';
    }
  }

  function newRequest(collection?: Collection) {
    const request = blankRequest();
    openRequests = [...openRequests, request];
    activeRequestId = request.id;
    if (collection) {
      collection.requests.push(structuredClone(request));
      saved = true;
      commitWorkspace();
    } else saved = false;
    response = null;
    requestError = '';
  }

  function closeRequest(event: Event, id: string) {
    event.stopPropagation();
    const index = openRequests.findIndex((request) => request.id === id);
    openRequests = openRequests.filter((request) => request.id !== id);
    if (activeRequestId === id) {
      activeRequestId = openRequests[Math.max(0, index - 1)]?.id ?? '';
      response = null;
    }
    if (!openRequests.length) newRequest();
  }

  function saveActiveRequest() {
    if (!activeRequest) return;
    let collection = workspace.collections.find((item) => item.requests.some((request) => request.id === activeRequest.id) || item.folders.some((folder) => folder.requests.some((request) => request.id === activeRequest.id)));
    if (!collection) {
      if (!workspace.collections.length) {
        workspace.collections.push({ id: uid(), name: 'My Collection', description: '', expanded: true, variables: [blankRow()], auth: { type: 'none' }, requests: [], folders: [] });
      }
      collection = workspace.collections[0];
      collection.requests.push(structuredClone(activeRequest));
    } else {
      const index = collection.requests.findIndex((request) => request.id === activeRequest.id);
      if (index >= 0) collection.requests[index] = structuredClone(activeRequest);
      else {
        const folder = collection.folders.find((item) => item.requests.some((request) => request.id === activeRequest.id));
        if (folder) folder.requests[folder.requests.findIndex((request) => request.id === activeRequest.id)] = structuredClone(activeRequest);
      }
    }
    saved = true;
    commitWorkspace();
    showToast('Request saved');
  }

  function newCollection() {
    workspace.collections.push({
      id: uid(),
      name: `New Collection ${workspace.collections.length + 1}`,
      description: '',
      expanded: true,
      variables: [blankRow()],
      auth: { type: 'none' },
      requests: [],
      folders: []
    });
    activeSection = 'collections';
    commitWorkspace();
  }

  function toggleCollection(collection: Collection) {
    collection.expanded = !collection.expanded;
    commitWorkspace();
  }

  function toggleFolder(_collection: Collection, folder: CollectionFolder) {
    folder.expanded = !folder.expanded;
    commitWorkspace();
  }

  function addFolder(collection: Collection) {
    collection.folders.push({ id: uid(), name: `New Folder ${collection.folders.length + 1}`, expanded: true, variables: [blankRow()], auth: { type: 'inherit' }, requests: [] });
    collection.expanded = true;
    commitWorkspace();
  }

  function renameCollection(collection: Collection, name: string) {
    collection.name = name;
    commitWorkspace();
  }

  function configureScope(collection: Collection, folder: CollectionFolder | null) {
    const source = folder ?? collection;
    scopeSettings = {
      collection,
      folder,
      variables: structuredClone(source.variables?.length ? source.variables : [blankRow()]),
      auth: structuredClone(source.auth ?? { type: folder ? 'inherit' : 'none' })
    };
    scopeSettingsTab = 'variables';
  }

  function saveScopeSettings() {
    if (!scopeSettings) return;
    const target = scopeSettings.folder ?? scopeSettings.collection;
    target.variables = structuredClone(scopeSettings.variables);
    target.auth = structuredClone(scopeSettings.auth);
    const label = scopeSettings.folder ? 'Folder' : 'Collection';
    scopeSettings = null;
    commitWorkspace();
    showToast(`${label} settings saved`);
  }

  function cloneRequest(request: ApiRequest) {
    const clone = structuredClone(normalizeRequest(request));
    clone.id = uid();
    clone.params = clone.params.map((row) => ({ ...row, id: uid() }));
    clone.pathParams = clone.pathParams.map((row) => ({ ...row, id: uid() }));
    clone.headers = clone.headers.map((row) => ({ ...row, id: uid() }));
    clone.formData = clone.formData.map((row) => ({ ...row, id: uid() }));
    return clone;
  }

  function requestLocationValue(collection: Collection, folder: CollectionFolder | null) {
    return `${collection.id}::${folder?.id ?? ''}`;
  }

  function startRequestAction(kind: RequestAction['kind'], request: ApiRequest, collection: Collection, folder: CollectionFolder | null) {
    pendingRequestAction = { kind, request, collection, folder };
    requestActionValue = request.name;
    moveTarget = requestLocationValue(collection, folder);
  }

  function duplicateRequest(request: ApiRequest, collection: Collection, folder: CollectionFolder | null) {
    const clone = cloneRequest(request);
    clone.name = `${request.name} copy`;
    (folder?.requests ?? collection.requests).push(clone);
    collection.expanded = true;
    if (folder) folder.expanded = true;
    commitWorkspace();
    showToast('Request duplicated');
  }

  function applyRequestRename() {
    const action = pendingRequestAction;
    const name = requestActionValue.trim();
    if (!action || action.kind !== 'rename' || !name) return;
    action.request.name = name;
    const open = openRequests.find((request) => request.id === action.request.id);
    if (open) open.name = name;
    openRequests = [...openRequests];
    pendingRequestAction = null;
    commitWorkspace();
    showToast('Request renamed');
  }

  function applyRequestMove() {
    const action = pendingRequestAction;
    if (!action || action.kind !== 'move') return;
    const [collectionId, folderId = ''] = moveTarget.split('::');
    const destinationCollection = workspace.collections.find((collection) => collection.id === collectionId);
    const destinationFolder = destinationCollection?.folders.find((folder) => folder.id === folderId) ?? null;
    if (!destinationCollection || moveTarget === requestLocationValue(action.collection, action.folder)) {
      pendingRequestAction = null;
      return;
    }
    const source = action.folder?.requests ?? action.collection.requests;
    const requestIndex = source.findIndex((request) => request.id === action.request.id);
    if (requestIndex < 0) {
      pendingRequestAction = null;
      return;
    }
    const [request] = source.splice(requestIndex, 1);
    (destinationFolder?.requests ?? destinationCollection.requests).push(request);
    destinationCollection.expanded = true;
    if (destinationFolder) destinationFolder.expanded = true;
    pendingRequestAction = null;
    commitWorkspace();
    showToast('Request moved');
  }

  function confirmDeleteRequest() {
    const action = pendingRequestAction;
    if (!action || action.kind !== 'delete') return;
    const source = action.folder?.requests ?? action.collection.requests;
    const requestIndex = source.findIndex((request) => request.id === action.request.id);
    if (requestIndex >= 0) source.splice(requestIndex, 1);
    const wasActive = activeRequestId === action.request.id;
    openRequests = openRequests.filter((request) => request.id !== action.request.id);
    if (wasActive) activeRequestId = openRequests[0]?.id ?? '';
    pendingRequestAction = null;
    commitWorkspace();
    if (!openRequests.length) newRequest();
    showToast('Request deleted');
  }

  function duplicateCollection(collection: Collection) {
    const clone: Collection = {
      ...structuredClone(collection),
      id: uid(),
      name: `${collection.name} copy`,
      requests: collection.requests.map(cloneRequest),
      folders: collection.folders.map((folder) => ({ ...structuredClone(folder), id: uid(), requests: folder.requests.map(cloneRequest) }))
    };
    workspace.collections.push(clone);
    commitWorkspace();
  }

  function sortCollection(collection: Collection) {
    collection.requests.sort((a, b) => a.name.localeCompare(b.name));
    collection.folders.sort((a, b) => a.name.localeCompare(b.name));
    collection.folders.forEach((folder) => folder.requests.sort((a, b) => a.name.localeCompare(b.name)));
    commitWorkspace();
    showToast('Collection sorted A–Z');
  }

  function exportCollection(collection: Collection) {
    const toAuth = (auth: RequestAuth) => {
      const entry = (key: string, value = '') => ({ key, value, type: 'string' });
      if (auth.type === 'inherit') return undefined;
      if (auth.type === 'none') return { type: 'noauth', noauth: [] };
      if (auth.type === 'bearer' || auth.type === 'jwt-bearer') return { type: 'bearer', bearer: [entry('token', auth.token)] };
      if (auth.type === 'oauth2') return { type: 'oauth2', oauth2: [entry('accessToken', auth.token)] };
      if (auth.type === 'basic') return { type: 'basic', basic: [entry('username', auth.username), entry('password', auth.password)] };
      return { type: 'apikey', apikey: [entry('key', auth.key), entry('value', auth.value), entry('in', auth.placement ?? 'header')] };
    };
    const toBody = (request: ApiRequest) => {
      if (request.bodyMode === 'none') return undefined;
      if (request.bodyMode === 'form') return {
        mode: 'formdata',
        formdata: request.formData.filter((row) => row.key).map((row) => ({
          key: row.key, value: row.kind === 'file' ? undefined : row.value, type: row.kind,
          src: row.kind === 'file' ? row.fileName : undefined, description: row.description, disabled: !row.enabled
        }))
      };
      if (request.bodyMode === 'urlencoded') return {
        mode: 'urlencoded',
        urlencoded: request.formData.filter((row) => row.key).map((row) => ({ key: row.key, value: row.value, description: row.description, disabled: !row.enabled }))
      };
      if (request.bodyMode === 'graphql') return { mode: 'graphql', graphql: { query: request.body, variables: request.graphqlVariables } };
      if (request.bodyMode === 'binary') return { mode: 'file', file: { src: request.binaryFile?.fileName ?? '' } };
      return { mode: 'raw', raw: request.body, options: { raw: { language: request.bodyMode } } };
    };
    const toUrl = (request: ApiRequest) => {
      const query = request.params.filter((row) => row.key).map(({ key, value, description, enabled }) => ({ key, value, description, disabled: !enabled }));
      const enabledQuery = query.filter((row) => !row.disabled);
      const suffix = enabledQuery.map((row) => `${row.key}=${row.value}`).join('&');
      const raw = suffix ? `${request.url}${request.url.includes('?') ? '&' : '?'}${suffix}` : request.url;
      return {
        raw,
        query,
        variable: request.pathParams.filter((row) => row.key).map(({ key, value, description, enabled }) => ({ key, value, description, disabled: !enabled }))
      };
    };
    const toItem = (request: ApiRequest) => ({
      name: request.name,
      request: {
        method: request.method,
        header: request.headers.filter((row) => row.key).map(({ key, value, description, enabled }) => ({ key, value, description, disabled: !enabled })),
        url: toUrl(request),
        auth: toAuth(request.auth),
        body: toBody(request)
      },
      event: [
        ...(request.preRequestScript ? [{ listen: 'prerequest', script: { type: 'text/javascript', exec: request.preRequestScript.split('\n') } }] : []),
        ...(request.testScript ? [{ listen: 'test', script: { type: 'text/javascript', exec: request.testScript.split('\n') } }] : [])
      ]
    });
    const output = {
      info: { name: collection.name, description: collection.description, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      auth: toAuth(collection.auth),
      variable: collection.variables.filter((row) => row.key).map(({ key, value, description, enabled }) => ({ key, value, description, disabled: !enabled, type: 'string' })),
      item: [
        ...collection.requests.map(toItem),
        ...collection.folders.map((folder) => ({ name: folder.name, auth: toAuth(folder.auth), item: folder.requests.map(toItem) }))
      ]
    };
    const href = URL.createObjectURL(new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `${collection.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'collection'}.postman_collection.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    showToast('Collection exported');
  }

  function deleteCollection(collection: Collection) {
    pendingDeleteCollection = collection;
  }

  function confirmDeleteCollection() {
    const collection = pendingDeleteCollection;
    if (!collection) return;
    const ids = new Set([...collection.requests, ...collection.folders.flatMap((folder) => folder.requests)].map((request) => request.id));
    workspace.collections = workspace.collections.filter((item) => item.id !== collection.id);
    openRequests = openRequests.filter((request) => !ids.has(request.id));
    if (!openRequests.length) newRequest();
    else if (ids.has(activeRequestId)) activeRequestId = openRequests[0].id;
    pendingDeleteCollection = null;
    commitWorkspace();
    showToast('Collection deleted');
  }

  function newEnvironment() {
    environmentEditor = {
      id: uid(),
      name: `Environment ${workspace.environments.length + 1}`,
      variables: [blankRow()]
    };
  }

  function editEnvironment(environment: Environment) {
    environmentEditor = structuredClone(environment);
  }

  function saveEnvironment() {
    if (!environmentEditor) return;
    const index = workspace.environments.findIndex((item) => item.id === environmentEditor?.id);
    if (index === -1) workspace.environments.push(environmentEditor);
    else workspace.environments[index] = environmentEditor;
    workspace.activeEnvironmentId = environmentEditor.id;
    environmentEditor = null;
    commitWorkspace();
  }

  function requestScope(request: ApiRequest) {
    for (const collection of workspace.collections) {
      if (collection.requests.some((item) => item.id === request.id)) return { collection, folder: null as CollectionFolder | null };
      const folder = collection.folders.find((item) => item.requests.some((saved) => saved.id === request.id));
      if (folder) return { collection, folder };
    }
    return null;
  }

  function resolvedVariables(request: ApiRequest) {
    const variables = new Map<string, { key: string; value: string; source: string }>();
    const scope = requestScope(request);
    const apply = (rows: KeyValue[], source: string) => rows
      .filter((item) => item.enabled && item.key)
      .forEach((item) => variables.set(item.key, { key: item.key, value: item.value, source }));
    if (scope) apply(scope.collection.variables, `Collection · ${scope.collection.name}`);
    if (scope?.folder) apply(scope.folder.variables, `Folder · ${scope.folder.name}`);
    if (activeEnvironment) apply(activeEnvironment.variables, `Environment · ${activeEnvironment.name}`);
    return [...variables.values()];
  }

  function resolveVariables(input: string, request: ApiRequest) {
    const variables = new Map(resolvedVariables(request).map((item) => [item.key, item.value]));
    let output = input;
    for (let pass = 0; pass < 5; pass += 1) {
      const next = output.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, key: string) => variables.get(key) ?? match);
      if (next === output) break;
      output = next;
    }
    return output;
  }

  function selectActiveEnvironment(id: string) {
    workspace.activeEnvironmentId = id || null;
    response = null;
    requestError = '';
    commitWorkspace();
    showToast(id ? `Environment switched to ${workspace.environments.find((item) => item.id === id)?.name ?? 'selected environment'}` : 'Environment disabled');
  }

  function effectiveAuth(request: ApiRequest): RequestAuth {
    if (request.auth.type !== 'inherit') return request.auth;
    const scope = requestScope(request);
    if (scope?.folder && scope.folder.auth.type !== 'inherit') return scope.folder.auth;
    if (scope && scope.collection.auth.type !== 'inherit') return scope.collection.auth;
    return { type: 'none' };
  }

  function buildUrl(request: ApiRequest) {
    const auth = effectiveAuth(request);
    let value = resolveVariables(request.url.trim(), request);
    const inferredProtocol = !/^https?:\/\//i.test(value);
    request.pathParams.filter((row) => row.enabled && row.key).forEach((row) => {
      value = value.replace(new RegExp(`:${row.key}(?=/|$|\\?|#)`, 'g'), encodeURIComponent(resolveVariables(row.value, request)));
    });
    if (inferredProtocol) value = `https://${value}`;
    const url = new URL(value);
    request.params.filter((row) => row.enabled && row.key).forEach((row) => {
      url.searchParams.set(resolveVariables(row.key, request), resolveVariables(row.value, request));
    });
    if (auth.type === 'api-key' && auth.placement === 'query' && auth.key) {
      url.searchParams.set(resolveVariables(auth.key, request), resolveVariables(auth.value ?? '', request));
    }
    return { url: url.toString(), inferredProtocol };
  }

  function buildPayload(request: ApiRequest) {
    const auth = effectiveAuth(request);
    const headers: Array<[string, string]> = request.headers
      .filter((row) => row.enabled && row.key)
      .map((row) => [resolveVariables(row.key, request), resolveVariables(row.value, request)]);
    let body: string | undefined;
    let multipart: RequestInput['multipart'];
    let binary: RequestInput['binary'];

    if (['json', 'text', 'javascript', 'html', 'xml'].includes(request.bodyMode)) body = resolveVariables(request.body, request);
    if (request.bodyMode === 'graphql') {
      body = JSON.stringify({ query: resolveVariables(request.body, request), variables: JSON.parse(resolveVariables(request.graphqlVariables || '{}', request)) });
    }
    if (request.bodyMode === 'urlencoded') {
      const values = new URLSearchParams();
      request.formData.filter((row) => row.enabled && row.key).forEach((row) => values.append(resolveVariables(row.key, request), resolveVariables(row.value, request)));
      body = values.toString();
    }
    if (request.bodyMode === 'form') {
      const formRows = request.formData.filter((row) => row.enabled && row.key);
      const missingFile = formRows.find((row) => row.kind === 'file' && !row.dataBase64);
      if (missingFile) throw new Error(`Select a local file for the “${missingFile.key}” form field before sending.`);
      multipart = formRows.map((row) => ({
        name: resolveVariables(row.key, request), value: resolveVariables(row.value, request), kind: row.kind ?? 'text',
        fileName: row.fileName, mimeType: row.mimeType, dataBase64: row.dataBase64
      }));
    }
    if (request.bodyMode === 'binary') {
      if (!request.binaryFile?.dataBase64) throw new Error('Select the local binary file before sending. Collection JSON only stores its file name.');
      binary = request.binaryFile;
    }
    const hasHeader = (name: string) => headers.some(([key]) => key.toLowerCase() === name.toLowerCase());
    if (request.bodyMode === 'json' && !hasHeader('content-type')) headers.push(['Content-Type', 'application/json']);
    if (request.bodyMode === 'graphql' && !hasHeader('content-type')) headers.push(['Content-Type', 'application/json']);
    if (request.bodyMode === 'xml' && !hasHeader('content-type')) headers.push(['Content-Type', 'application/xml']);
    if (request.bodyMode === 'html' && !hasHeader('content-type')) headers.push(['Content-Type', 'text/html']);
    if (request.bodyMode === 'javascript' && !hasHeader('content-type')) headers.push(['Content-Type', 'text/javascript']);
    if (request.bodyMode === 'urlencoded' && !hasHeader('content-type')) {
      headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
    }
    if (['bearer', 'jwt-bearer', 'oauth2'].includes(auth.type) && auth.token) {
      headers.push(['Authorization', `${auth.prefix || 'Bearer'} ${resolveVariables(auth.token, request)}`]);
    }
    if (auth.type === 'basic') {
      headers.push(['Authorization', `Basic ${btoa(`${resolveVariables(auth.username ?? '', request)}:${resolveVariables(auth.password ?? '', request)}`)}`]);
    }
    if (auth.type === 'api-key' && auth.placement !== 'query' && auth.key) {
      headers.push([resolveVariables(auth.key, request), resolveVariables(auth.value ?? '', request)]);
    }
    return { headers, body, multipart, binary };
  }

  async function sendRequest() {
    if (!activeRequest || executing) return;
    requestError = '';
    response = null;
    executing = true;
    let historyEntry: HistoryEntry | null = null;
    try {
      const target = buildUrl(activeRequest);
      const { headers, body, multipart, binary } = buildPayload(activeRequest);
      const input: RequestInput = {
        method: activeRequest.method,
        url: target.url,
        headers,
        body,
        multipart,
        binary,
        timeoutMs: activeRequest.timeoutMs,
        followRedirects: activeRequest.followRedirects,
        validateCertificates: activeRequest.validateCertificates
      };
      try {
        response = await executeRequest(input);
      } catch (httpsError) {
        if (!target.inferredProtocol) throw httpsError;
        response = await executeRequest({ ...input, url: input.url.replace(/^https:\/\//i, 'http://') });
      }
      historyEntry = {
        id: uid(),
        request: structuredClone(activeRequest),
        status: response.status,
        elapsedMs: response.elapsedMs,
        createdAt: new Date().toISOString()
      };
    } catch (error) {
      requestError = error instanceof Error ? error.message : String(error);
      historyEntry = { id: uid(), request: structuredClone(activeRequest), createdAt: new Date().toISOString() };
    } finally {
      executing = false;
      if (historyEntry) {
        workspace.history = [historyEntry, ...workspace.history].slice(0, 200);
        commitWorkspace();
      }
    }
  }

  function syncPathParams() {
    if (!activeRequest) return;
    const names = [...activeRequest.url.matchAll(/:([A-Za-z_][A-Za-z0-9_-]*)(?=\/|$|\?|#)/g)].map((match) => match[1]);
    const existing = new Map(activeRequest.pathParams.filter((row) => row.key).map((row) => [row.key, row]));
    activeRequest.pathParams = [...new Set(names)].map((name) => existing.get(name) ?? { id: uid(), key: name, value: '', enabled: true });
    activeRequest.pathParams.push(blankRow());
    markChanged();
  }

  async function chooseBinaryFile(files: FileList | null) {
    const file = files?.[0];
    if (!activeRequest || !file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    activeRequest.binaryFile = { fileName: file.name, mimeType: file.type || 'application/octet-stream', dataBase64: btoa(binary) };
    markChanged();
  }

  function startResize(event: PointerEvent) {
    event.preventDefault();
    resizingPanel = true;
    const startY = event.clientY;
    const startHeight = requestPanelHeight;
    const move = (moveEvent: PointerEvent) => requestPanelHeight = Math.max(185, Math.min(window.innerHeight - 330, startHeight + moveEvent.clientY - startY));
    const stop = () => {
      resizingPanel = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  function startBulkEdit(kind: 'params' | 'headers') {
    if (!activeRequest) return;
    bulkEditor = kind;
    bulkText = activeRequest[kind].filter((row) => row.key || row.value).map((row) => `${row.key}: ${row.value}`).join('\n');
  }

  function applyBulkEdit() {
    if (!activeRequest || !bulkEditor) return;
    const rows: KeyValue[] = bulkText.split('\n').filter((line) => line.trim()).map((line) => {
      const separator = line.indexOf(':');
      return {
        id: uid(),
        key: (separator >= 0 ? line.slice(0, separator) : line).trim(),
        value: (separator >= 0 ? line.slice(separator + 1) : '').trim(),
        enabled: true
      };
    });
    activeRequest[bulkEditor] = [...rows, blankRow()];
    bulkEditor = null;
    markChanged();
  }

  function shellQuote(value: string) {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
  }

  function generateCurl() {
    if (!activeRequest) return '';
    try {
      const target = buildUrl(activeRequest);
      const payload = buildPayload(activeRequest);
      const parts = [`curl --request ${activeRequest.method}`, `  --url ${shellQuote(target.url)}`];
      payload.headers.forEach(([key, value]) => parts.push(`  --header ${shellQuote(`${key}: ${value}`)}`));
      if (payload.multipart?.length) {
        payload.multipart.forEach((field) => parts.push(`  --form ${shellQuote(`${field.name}=${field.kind === 'file' ? `@${field.fileName ?? 'upload.bin'}` : field.value}`)}`));
      } else if (payload.binary) parts.push(`  --data-binary ${shellQuote(`@${payload.binary.fileName}`)}`);
      else if (payload.body) parts.push(`  --data ${shellQuote(payload.body)}`);
      return parts.join(' \\\n');
    } catch (error) {
      return `# Could not generate cURL: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async function copyGeneratedCode() {
    await navigator.clipboard.writeText(generateCurl());
    codeCopied = true;
    setTimeout(() => codeCopied = false, 1400);
  }

  function runCommand(action: 'request' | 'collection' | 'environments' | 'settings') {
    utilityModal = null;
    if (action === 'request') newRequest();
    if (action === 'collection') newCollection();
    if (action === 'environments') activeSection = 'environments';
    if (action === 'settings') utilityModal = 'settings';
  }

  function handleKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      sendRequest();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveActiveRequest();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class:light={!darkMode} class="app-shell">
  <header class="topbar" data-tauri-drag-region>
    <div class="brand">
      <div class="brand-mark">
      <PostcallIcon width=24 height=24/>
      </div>
      <div>
      <span>POST</span><span class="app-call">call</span>
      </div>
      <span class="local-badge">LOCAL</span>
    </div>
    <nav class="topnav"><span class="active">Workspace</span></nav>
    <div class="top-actions">
      <div class="sync-state"><Cloud size={15} /><span>Saved locally</span></div>
      <div class="divider"></div>
      <button class="icon-button" on:click={() => utilityModal = 'command'} title="Command palette"><Command size={16} /></button>
      <button class="icon-button" on:click={() => darkMode = !darkMode} title="Toggle theme">{#if darkMode}<Sun size={16} />{:else}<Moon size={16} />{/if}</button>
      <button class="icon-button" on:click={() => utilityModal = 'help'} title="Help"><HelpCircle size={16} /></button>
      <!-- <div class="avatar" title="Local profile">LocalUser</div> -->
    </div>
  </header>

  <div class="workspace">
    {#if sidebarVisible}
      <Sidebar
        {workspace}
        {workspaces}
        {activeWorkspaceId}
        {activeSection}
        onSwitchWorkspace={switchWorkspace}
        onCreateWorkspace={openCreateWorkspace}
        onDeleteWorkspace={deleteWorkspace}
        onImportCollections={importCollectionFiles}
        onImportCurl={openCurlImport}
        selectedRequestId={activeRequestId}
        onSection={(section) => activeSection = section}
        onOpenRequest={openRequest}
        onNewRequest={() => newRequest()}
        onNewCollection={newCollection}
        onNewEnvironment={newEnvironment}
        onDeleteHistory={() => { workspace.history = []; commitWorkspace(); }}
        onToggleCollection={toggleCollection}
        onToggleFolder={toggleFolder}
        onSelectEnvironment={editEnvironment}
        onAddRequestToCollection={(collection) => newRequest(collection)}
        onAddFolder={addFolder}
        onRenameCollection={renameCollection}
        onDuplicateCollection={duplicateCollection}
        onSortCollection={sortCollection}
        onExportCollection={exportCollection}
        onDeleteCollection={deleteCollection}
        onConfigureScope={configureScope}
        onRenameRequest={(request, collection, folder) => startRequestAction('rename', request, collection, folder)}
        onDuplicateRequest={duplicateRequest}
        onMoveRequest={(request, collection, folder) => startRequestAction('move', request, collection, folder)}
        onDeleteRequest={(request, collection, folder) => startRequestAction('delete', request, collection, folder)}
        onOpenSettings={() => utilityModal = 'settings'}
      />
    {/if}

    <main class="main-panel">
      <div class="tab-strip">
        <button class="sidebar-toggle" on:click={() => sidebarVisible = !sidebarVisible} title="Toggle sidebar"><PanelLeftClose size={16} /></button>
        <div class="request-tabs">
          {#each openRequests as request (request.id)}
            <button class="request-tab" class:active={request.id === activeRequestId} on:click={() => { activeRequestId = request.id; response = null; requestError = ''; }}>
              <span class="method mini {request.method.toLowerCase()}">{request.method.slice(0, 3)}</span>
              <span>{request.name}</span>
              {#if request.id === activeRequestId && !saved}<i></i>{/if}
              <span
                class="close-tab"
                role="button"
                tabindex="0"
                on:click={(event) => closeRequest(event, request.id)}
                on:keydown={(event) => { if (event.key === 'Enter' || event.key === ' ') closeRequest(event, request.id); }}
              ><X size={13} /></span>
            </button>
          {/each}
          <button class="new-tab" on:click={() => newRequest()} title="New request"><Plus size={16} /></button>
        </div>
      </div>

      {#if activeRequest}
        <div class="request-workbench" class:resizing={resizingPanel} style={`--request-panel-height:${requestPanelHeight}px`}>
          <div class="request-title-row">
            <div class="request-title">
              <input bind:value={activeRequest.name} on:input={markChanged} aria-label="Request name" />
              <span class="unsaved-state">{saved ? 'Saved' : 'Unsaved changes'}</span>
            </div>
            <div class="request-actions">
              <button class="secondary-button" on:click={saveActiveRequest}><Save size={15} /> Save</button>
              <button class="icon-button bordered" on:click={() => utilityModal = 'code'} title="Generate code"><Code2 size={16} /></button>
            </div>
          </div>

          <div class="url-row">
            <div class="url-input-wrap">
              <select bind:value={activeRequest.method} on:change={markChanged} class="method-select {activeRequest.method.toLowerCase()}" aria-label="HTTP method">
                {#each ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as method}<option>{method}</option>{/each}
              </select>
              <input bind:value={activeRequest.url} on:input={syncPathParams} placeholder="Enter request URL" aria-label="Request URL" />
              <button class="variables-button" on:click={() => utilityModal = 'variables'} title="View resolved variables"><Braces size={16} /></button>
            </div>
            <button class="send-button" class:loading={executing} on:click={sendRequest} disabled={executing || !activeRequest.url.trim()}>
              {executing ? 'Sending…' : 'Send'} <span>⌘↵</span>
            </button>
          </div>

          <div class="environment-line">
            <label class="environment-selector">
              <Globe2 size={13} />
              <select aria-label="Active environment" value={workspace.activeEnvironmentId ?? ''} on:change={(event) => selectActiveEnvironment(event.currentTarget.value)}>
                <option value="">No environment</option>
                {#each workspace.environments as environment}<option value={environment.id}>{environment.name}</option>{/each}
              </select>
            </label>
            <span>{activeEnvironment ? 'Environment values override matching folder and collection variables.' : 'Using folder and collection variables.'}</span>
          </div>

          <section class="request-config">
            <div class="request-config-tabs">
              <button class:active={requestTab === 'params'} on:click={() => requestTab = 'params'}>Params {#if parameterCount}<span>{parameterCount}</span>{/if}</button>
              <button class:active={requestTab === 'auth'} on:click={() => requestTab = 'auth'}>Authorization</button>
              <button class:active={requestTab === 'headers'} on:click={() => requestTab = 'headers'}>Headers {#if headerCount}<span>{headerCount}</span>{/if}</button>
              <button class:active={requestTab === 'body'} on:click={() => requestTab = 'body'}>Body {#if activeRequest.bodyMode !== 'none'}<i></i>{/if}</button>
              <button class:active={requestTab === 'scripts'} on:click={() => requestTab = 'scripts'}>Scripts</button>
              <button class:active={requestTab === 'settings'} on:click={() => requestTab = 'settings'}>Settings</button>
            </div>

            <div class="config-content">
              {#if requestTab === 'params'}
                <div class="section-caption"><div><strong>Query parameters</strong><p>Values are appended to the request URL.</p></div><button on:click={() => startBulkEdit('params')}>Bulk edit</button></div>
                <KeyValueEditor bind:rows={activeRequest.params} onChange={markChanged} />
                {#if activeRequest.pathParams.some((row) => row.key)}
                  <div class="section-caption path-caption"><div><strong>Path variables</strong><p>Placeholders such as <code>:userId</code> are replaced before sending.</p></div></div>
                  <KeyValueEditor bind:rows={activeRequest.pathParams} keyPlaceholder="Variable" onChange={markChanged} />
                {/if}
              {:else if requestTab === 'headers'}
                <div class="section-caption"><div><strong>Request headers</strong><p>Headers describe the request and the expected response.</p></div><button on:click={() => startBulkEdit('headers')}>Bulk edit</button></div>
                <KeyValueEditor bind:rows={activeRequest.headers} onChange={markChanged} />
              {:else if requestTab === 'auth'}
                <div class="auth-editor">
                  <div class="auth-type-panel">
                    <div class="auth-type-label">Auth type</div>
                    {#each [['inherit','Inherit auth'], ['none','No Auth'], ['api-key','API Key'], ['bearer','Bearer Token'], ['jwt-bearer','JWT Bearer'], ['basic','Basic Auth'], ['oauth2','OAuth 2.0']] as option}
                      <button class:active={activeRequest.auth.type === option[0]} on:click={() => { activeRequest.auth.type = option[0] as typeof activeRequest.auth.type; markChanged(); }}>{option[1]}</button>
                    {/each}
                  </div>
                  <div class="auth-fields">
                    {#if activeRequest.auth.type === 'none' || activeRequest.auth.type === 'inherit'}
                      <div class="auth-empty"><div><Check size={18} /></div><strong>{activeRequest.auth.type === 'inherit' ? (effectiveAuth(activeRequest).type === 'none' ? 'No inherited authorization configured' : `${effectiveAuth(activeRequest).type} authorization inherited`) : 'This request does not use authentication'}</strong><p>{activeRequest.auth.type === 'inherit' ? 'Authorization resolves from the containing folder first, then the collection.' : 'Select an authentication type from the left when the API requires credentials.'}</p></div>
                    {:else if activeRequest.auth.type === 'bearer' || activeRequest.auth.type === 'jwt-bearer' || activeRequest.auth.type === 'oauth2'}
                      <label>{activeRequest.auth.type === 'oauth2' ? 'Access token' : 'Token'}<input type="password" bind:value={activeRequest.auth.token} on:input={markChanged} placeholder={activeRequest.auth.type === 'oauth2' ? 'OAuth access token' : 'Enter token'} /></label>
                      <label>Header prefix<input bind:value={activeRequest.auth.prefix} on:input={markChanged} placeholder="Bearer" /></label>
                    {:else if activeRequest.auth.type === 'basic'}
                      <label>Username<input bind:value={activeRequest.auth.username} on:input={markChanged} placeholder="Username" /></label>
                      <label>Password<input type="password" bind:value={activeRequest.auth.password} on:input={markChanged} placeholder="Password" /></label>
                    {:else}
                      <label>Key<input bind:value={activeRequest.auth.key} on:input={markChanged} placeholder="X-API-Key" /></label>
                      <label>Value<input type="password" bind:value={activeRequest.auth.value} on:input={markChanged} placeholder="API key value" /></label>
                      <label>Add to<select bind:value={activeRequest.auth.placement} on:change={markChanged}><option value="header">Header</option><option value="query">Query params</option></select></label>
                    {/if}
                  </div>
                </div>
              {:else if requestTab === 'body'}
                <div class="body-mode-tabs">
                  {#each [['none','none'], ['form','form-data'], ['urlencoded','x-www-form-urlencoded'], ['json','raw'], ['binary','binary'], ['graphql','GraphQL']] as option}
                    <label><input type="radio" name="body-mode" value={option[0]} checked={activeRequest.bodyMode === option[0] || (option[0] === 'json' && ['json', 'text', 'javascript', 'html', 'xml'].includes(activeRequest.bodyMode))} on:change={() => { activeRequest.bodyMode = option[0] as typeof activeRequest.bodyMode; markChanged(); }} /><span>{option[1]}</span></label>
                  {/each}
                </div>
                {#if activeRequest.bodyMode === 'none'}
                  <div class="no-body"><Code2 size={26} /><strong>This request has no body</strong><p>Choose a body type above to include content with the request.</p></div>
                {:else if ['json', 'text', 'javascript', 'html', 'xml'].includes(activeRequest.bodyMode)}
                  <div class="raw-language-row">
                    <span>Raw format</span>
                    <select bind:value={activeRequest.bodyMode} on:change={markChanged}>
                      <option value="text">Text</option><option value="javascript">JavaScript</option><option value="json">JSON</option><option value="html">HTML</option><option value="xml">XML</option>
                    </select>
                  </div>
                  <CodeEditor bind:value={activeRequest.body} language={activeRequest.bodyMode} onChange={markChanged} placeholder="Enter request body" />
                {:else if activeRequest.bodyMode === 'form'}
                  <div class="section-caption"><div><strong>Multipart form data</strong><p>Choose Text or File independently for each field.</p></div></div>
                  <FormDataEditor bind:rows={activeRequest.formData} onChange={markChanged} />
                {:else if activeRequest.bodyMode === 'urlencoded'}
                  <div class="section-caption"><div><strong>URL-encoded data</strong><p>Fields are encoded as application/x-www-form-urlencoded.</p></div></div>
                  <KeyValueEditor bind:rows={activeRequest.formData} onChange={markChanged} />
                {:else if activeRequest.bodyMode === 'binary'}
                  <div class="binary-picker">
                    <div class="binary-icon"><FileUp size={24} /></div>
                    <strong>{activeRequest.binaryFile?.fileName ?? 'Select a binary file'}</strong>
                    <p>{activeRequest.binaryFile?.dataBase64 ? `${activeRequest.binaryFile.mimeType} · ${(activeRequest.binaryFile.dataBase64.length * .75 / 1024).toFixed(1)} KB` : activeRequest.binaryFile ? 'File reference imported. Re-select the local file before sending.' : 'The selected file is sent as the entire request body.'}</p>
                    <label class="secondary-button"><input type="file" on:change={(event) => chooseBinaryFile(event.currentTarget.files)} />{activeRequest.binaryFile ? 'Replace file' : 'Select file'}</label>
                  </div>
                {:else if activeRequest.bodyMode === 'graphql'}
                  <div class="graphql-grid">
                    <div><div class="script-heading"><span>GraphQL query</span></div><CodeEditor bind:value={activeRequest.body} language="graphql" onChange={markChanged} placeholder={'query { ... }'} /></div>
                    <div><div class="script-heading"><span>Variables</span><small>JSON</small></div><CodeEditor bind:value={activeRequest.graphqlVariables} language="json" onChange={markChanged} placeholder={'{}'} /></div>
                  </div>
                {/if}
              {:else if requestTab === 'scripts'}
                <div class="script-grid">
                  <div><div class="script-heading"><span><Play size={13} /> Pre-request</span><small>JavaScript</small></div><CodeEditor bind:value={activeRequest.preRequestScript} language="javascript" onChange={markChanged} /></div>
                  <div><div class="script-heading"><span><Sparkles size={13} /> Post-response tests</span><small>JavaScript</small></div><CodeEditor bind:value={activeRequest.testScript} language="javascript" onChange={markChanged} /></div>
                </div>
              {:else}
                <div class="request-settings">
                  <div class="settings-heading"><strong>Request settings</strong><p>These options apply only to this request.</p></div>
                  <label><span><strong>Request timeout</strong><small>Stop waiting after this many milliseconds.</small></span><input type="number" min="100" step="100" bind:value={activeRequest.timeoutMs} on:input={markChanged} /></label>
                  <label><span><strong>Follow redirects</strong><small>Automatically follow up to ten redirect responses.</small></span><input type="checkbox" bind:checked={activeRequest.followRedirects} on:change={markChanged} /></label>
                  <label><span><strong>Validate SSL certificates</strong><small>Reject invalid or untrusted HTTPS certificates.</small></span><input type="checkbox" bind:checked={activeRequest.validateCertificates} on:change={markChanged} /></label>
                </div>
              {/if}
            </div>
          </section>

          <button type="button" class="panel-resizer" aria-label="Resize request and response panels" on:pointerdown={startResize}><span></span></button>

          <ResponseViewer {response} loading={executing} error={requestError} />
        </div>
      {/if}
    </main>
  </div>

  {#if curlImportOpen}
    <div class="modal-backdrop" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) curlImportOpen = false; }}>
      <div class="modal curl-import-modal" role="dialog" aria-modal="true" aria-label="Import cURL request">
        <div class="modal-header"><div><span class="modal-icon"><Code2 size={18} /></span><div><strong>Import cURL</strong><p>Paste a cURL command to open it as a new unsaved request.</p></div></div><button class="icon-button" on:click={() => curlImportOpen = false} aria-label="Close dialog"><X size={17} /></button></div>
        <textarea bind:value={curlText} on:input={() => curlImportError = ''} aria-label="cURL command" spellcheck="false" placeholder={'curl --request POST \\\n  --url https://api.example.com/items \\\n  --header \'Content-Type: application/json\' \\\n  --data \'{"name":"Postcall"}\''}></textarea>
        {#if curlImportError}<div class="import-error" role="alert">{curlImportError}</div>{/if}
        <div class="modal-footer"><button class="secondary-button" on:click={() => curlImportOpen = false}>Cancel</button><button class="primary-button" disabled={!curlText.trim()} on:click={importCurlRequest}>Import request</button></div>
      </div>
    </div>
  {/if}

  {#if createWorkspaceOpen}
    <div class="modal-backdrop" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) createWorkspaceOpen = false; }}>
      <div class="modal request-action-modal" role="dialog" aria-modal="true" aria-label="Create workspace">
        <div class="modal-header"><div><span class="modal-icon"><Globe2 size={18} /></span><div><strong>Create workspace</strong><p>Start an independent space for collections, environments, and history.</p></div></div><button class="icon-button" on:click={() => createWorkspaceOpen = false} aria-label="Close dialog"><X size={17} /></button></div>
        <label class="field-label">Workspace name<input bind:value={workspaceNameInput} on:keydown={(event) => { if (event.key === 'Enter') createWorkspace(); }} aria-label="New workspace name" placeholder="Team API workspace" /></label>
        <div class="modal-footer"><button class="secondary-button" on:click={() => createWorkspaceOpen = false}>Cancel</button><button class="primary-button" disabled={!workspaceNameInput.trim()} on:click={createWorkspace}>Create workspace</button></div>
      </div>
    </div>
  {/if}

  {#if pendingDeleteWorkspace}
    <div class="modal-backdrop" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) pendingDeleteWorkspace = null; }}>
      <div class="modal confirm-modal" role="alertdialog" aria-modal="true" aria-label="Delete workspace">
        <div class="confirm-mark">!</div>
        <strong>Delete “{pendingDeleteWorkspace.name}”?</strong>
        <p>This permanently removes its {pendingDeleteWorkspace.collections.length} collections, {pendingDeleteWorkspace.environments.length} environments, and request history from Postcall.</p>
        <div class="modal-footer"><button class="secondary-button" on:click={() => pendingDeleteWorkspace = null}>Cancel</button><button class="danger-button" on:click={confirmDeleteWorkspace}>Delete workspace</button></div>
      </div>
    </div>
  {/if}

  {#if scopeSettings}
    <div class="modal-backdrop" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) scopeSettings = null; }}>
      <div class="modal scope-settings-modal" role="dialog" aria-modal="true" aria-label={`${scopeSettings.folder ? 'Folder' : 'Collection'} variables and authorization`}>
        <div class="modal-header">
          <div><span class="modal-icon"><Settings2 size={18} /></span><div><strong>{scopeSettings.folder?.name ?? scopeSettings.collection.name}</strong><p>Configure variables and authorization inherited by requests in this {scopeSettings.folder ? 'folder' : 'collection'}.</p></div></div>
          <button class="icon-button" on:click={() => scopeSettings = null} aria-label="Close dialog"><X size={17} /></button>
        </div>
        <div class="scope-settings-tabs">
          <button class:active={scopeSettingsTab === 'variables'} on:click={() => scopeSettingsTab = 'variables'}>Variables</button>
          <button class:active={scopeSettingsTab === 'authorization'} on:click={() => scopeSettingsTab = 'authorization'}>Authorization</button>
        </div>
        <div class="scope-settings-content">
          {#if scopeSettingsTab === 'variables'}
            <div class="scope-note"><strong>{scopeSettings.folder ? 'Folder variables override collection defaults; the active environment has final precedence.' : 'Collection variables provide defaults that the active environment can override.'}</strong><span>Reference a variable in requests with <code>{'{{variableName}}'}</code>.</span></div>
            <KeyValueEditor bind:rows={scopeSettings.variables} keyPlaceholder="Variable" valuePlaceholder="Value" />
          {:else}
            <div class="auth-editor scope-auth-editor">
              <div class="auth-type-panel">
                <div class="auth-type-label">Auth type</div>
                {#each (scopeSettings.folder ? [['inherit','Inherit from collection'], ['none','No Auth'], ['api-key','API Key'], ['bearer','Bearer Token'], ['jwt-bearer','JWT Bearer'], ['basic','Basic Auth'], ['oauth2','OAuth 2.0']] : [['none','No Auth'], ['api-key','API Key'], ['bearer','Bearer Token'], ['jwt-bearer','JWT Bearer'], ['basic','Basic Auth'], ['oauth2','OAuth 2.0']]) as option}
                  <button class:active={scopeSettings.auth.type === option[0]} on:click={() => scopeSettings!.auth.type = option[0] as RequestAuth['type']}>{option[1]}</button>
                {/each}
              </div>
              <div class="auth-fields">
                {#if scopeSettings.auth.type === 'none' || scopeSettings.auth.type === 'inherit'}
                  <div class="auth-empty"><div><Check size={18} /></div><strong>{scopeSettings.auth.type === 'inherit' ? 'Authorization inherited from the collection' : 'No authorization configured at this level'}</strong><p>{scopeSettings.auth.type === 'inherit' ? 'Requests in this folder use collection authorization unless they define their own.' : 'Requests can still define their own authorization.'}</p></div>
                {:else if scopeSettings.auth.type === 'bearer' || scopeSettings.auth.type === 'jwt-bearer' || scopeSettings.auth.type === 'oauth2'}
                  <label>{scopeSettings.auth.type === 'oauth2' ? 'Access token' : 'Token'}<input type="password" bind:value={scopeSettings.auth.token} placeholder={'Enter token or {{variable}}'} /></label>
                  <label>Header prefix<input bind:value={scopeSettings.auth.prefix} placeholder="Bearer" /></label>
                {:else if scopeSettings.auth.type === 'basic'}
                  <label>Username<input bind:value={scopeSettings.auth.username} placeholder={'Username or {{variable}}'} /></label>
                  <label>Password<input type="password" bind:value={scopeSettings.auth.password} placeholder={'Password or {{variable}}'} /></label>
                {:else if scopeSettings.auth.type === 'api-key'}
                  <label>Key<input bind:value={scopeSettings.auth.key} placeholder="X-API-Key" /></label>
                  <label>Value<input type="password" bind:value={scopeSettings.auth.value} placeholder={'Value or {{variable}}'} /></label>
                  <label>Add to<select bind:value={scopeSettings.auth.placement}><option value="header">Header</option><option value="query">Query params</option></select></label>
                {/if}
              </div>
            </div>
          {/if}
        </div>
        <div class="modal-footer"><button class="secondary-button" on:click={() => scopeSettings = null}>Cancel</button><button class="primary-button" on:click={saveScopeSettings}>Save settings</button></div>
      </div>
    </div>
  {/if}

  {#if environmentEditor}
    <div class="modal-backdrop" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) environmentEditor = null; }}>
      <div class="modal" role="dialog" aria-modal="true" aria-label="Environment editor">
        <div class="modal-header"><div><span class="modal-icon"><Globe2 size={18} /></span><div><strong>Environment</strong><p>Define reusable variables for your requests.</p></div></div><button class="icon-button" on:click={() => environmentEditor = null}><X size={17} /></button></div>
        <label class="field-label">Environment name<input bind:value={environmentEditor.name} placeholder="Environment name" /></label>
        <div class="modal-vars"><div class="section-caption"><div><strong>Variables</strong><p>Use these values with <code>{'{{variableName}}'}</code>.</p></div><span><Eye size={14} /> Secrets stay local</span></div><KeyValueEditor bind:rows={environmentEditor.variables} /></div>
        <div class="modal-footer"><button class="secondary-button" on:click={() => environmentEditor = null}>Cancel</button><button class="primary-button" on:click={saveEnvironment}>Save environment</button></div>
      </div>
    </div>
  {/if}

  {#if bulkEditor}
    <div class="modal-backdrop" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) bulkEditor = null; }}>
      <div class="modal bulk-modal" role="dialog" aria-modal="true" aria-label="Bulk editor">
        <div class="modal-header"><div><span class="modal-icon"><Braces size={18} /></span><div><strong>Bulk edit {bulkEditor}</strong><p>Enter one key-value pair per line using <code>Key: Value</code>.</p></div></div><button class="icon-button" on:click={() => bulkEditor = null}><X size={17} /></button></div>
        <textarea bind:value={bulkText} spellcheck="false" placeholder={'Content-Type: application/json\nX-API-Key: {{apiKey}}'}></textarea>
        <div class="modal-footer"><button class="secondary-button" on:click={() => bulkEditor = null}>Cancel</button><button class="primary-button" on:click={applyBulkEdit}>Apply changes</button></div>
      </div>
    </div>
  {/if}

  {#if pendingDeleteCollection}
    <div class="modal-backdrop" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) pendingDeleteCollection = null; }}>
      <div class="modal confirm-modal" role="alertdialog" aria-modal="true" aria-label="Delete collection">
        <div class="confirm-mark">!</div>
        <strong>Delete “{pendingDeleteCollection.name}”?</strong>
        <p>This removes the collection, its {pendingDeleteCollection.requests.length + pendingDeleteCollection.folders.reduce((total, folder) => total + folder.requests.length, 0)} requests, and all folders from this local workspace.</p>
        <div class="modal-footer"><button class="secondary-button" on:click={() => pendingDeleteCollection = null}>Cancel</button><button class="danger-button" on:click={confirmDeleteCollection}>Delete collection</button></div>
      </div>
    </div>
  {/if}

  {#if pendingRequestAction?.kind === 'rename'}
    <div class="modal-backdrop" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) pendingRequestAction = null; }}>
      <div class="modal request-action-modal" role="dialog" aria-modal="true" aria-label="Rename request">
        <div class="modal-header"><div><span class="modal-icon"><FileUp size={18} /></span><div><strong>Rename request</strong><p>Choose a name that identifies this request in the collection.</p></div></div><button class="icon-button" on:click={() => pendingRequestAction = null} aria-label="Close dialog"><X size={17} /></button></div>
        <label class="field-label">Request name<input bind:value={requestActionValue} on:keydown={(event) => { if (event.key === 'Enter') applyRequestRename(); }} aria-label="Request name to rename" /></label>
        <div class="modal-footer"><button class="secondary-button" on:click={() => pendingRequestAction = null}>Cancel</button><button class="primary-button" disabled={!requestActionValue.trim()} on:click={applyRequestRename}>Rename request</button></div>
      </div>
    </div>
  {:else if pendingRequestAction?.kind === 'move'}
    <div class="modal-backdrop" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) pendingRequestAction = null; }}>
      <div class="modal request-action-modal" role="dialog" aria-modal="true" aria-label="Move request">
        <div class="modal-header"><div><span class="modal-icon"><FileUp size={18} /></span><div><strong>Move “{pendingRequestAction.request.name}”</strong><p>Select a collection or folder for this request.</p></div></div><button class="icon-button" on:click={() => pendingRequestAction = null} aria-label="Close dialog"><X size={17} /></button></div>
        <label class="field-label">Destination
          <select bind:value={moveTarget} aria-label="Request destination">
            {#each workspace.collections as collection (collection.id)}
              <option value={requestLocationValue(collection, null)}>{collection.name}</option>
              {#each collection.folders as folder (folder.id)}
                <option value={requestLocationValue(collection, folder)}>{collection.name} / {folder.name}</option>
              {/each}
            {/each}
          </select>
        </label>
        <div class="modal-footer"><button class="secondary-button" on:click={() => pendingRequestAction = null}>Cancel</button><button class="primary-button" disabled={moveTarget === requestLocationValue(pendingRequestAction.collection, pendingRequestAction.folder)} on:click={applyRequestMove}>Move request</button></div>
      </div>
    </div>
  {:else if pendingRequestAction?.kind === 'delete'}
    <div class="modal-backdrop" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) pendingRequestAction = null; }}>
      <div class="modal confirm-modal" role="alertdialog" aria-modal="true" aria-label="Delete request">
        <div class="confirm-mark">!</div>
        <strong>Delete “{pendingRequestAction.request.name}”?</strong>
        <p>This removes the request from “{pendingRequestAction.folder?.name ?? pendingRequestAction.collection.name}” and closes its open tab.</p>
        <div class="modal-footer"><button class="secondary-button" on:click={() => pendingRequestAction = null}>Cancel</button><button class="danger-button" on:click={confirmDeleteRequest}>Delete request</button></div>
      </div>
    </div>
  {/if}

  {#if utilityModal}
    <div class="modal-backdrop" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) utilityModal = null; }}>
      <div class="modal utility-modal" role="dialog" aria-modal="true" aria-label={`${utilityModal} dialog`}>
        <div class="modal-header">
          <div><span class="modal-icon">{#if utilityModal === 'code'}<Code2 size={18} />{:else if utilityModal === 'variables'}<Braces size={18} />{:else if utilityModal === 'help'}<HelpCircle size={18} />{:else}<Command size={18} />{/if}</span><div><strong>{utilityModal === 'code' ? 'Generate code' : utilityModal === 'variables' ? 'Resolved variables' : utilityModal === 'help' ? 'Postcall help' : utilityModal === 'settings' ? 'Application settings' : 'Command palette'}</strong><p>{utilityModal === 'code' ? 'A cURL representation of the active request.' : utilityModal === 'variables' ? 'Merged values and the scope supplying each one.' : utilityModal === 'help' ? 'Keyboard shortcuts and local workspace behavior.' : utilityModal === 'settings' ? 'Configure your local Postcall experience.' : 'Jump directly to a Postcall action.'}</p></div></div>
          <button class="icon-button" on:click={() => utilityModal = null} aria-label="Close dialog"><X size={17} /></button>
        </div>
        {#if utilityModal === 'code'}
          <textarea class="generated-code" readonly value={generateCurl()} aria-label="Generated cURL"></textarea>
          <div class="modal-footer"><button class="secondary-button" on:click={() => utilityModal = null}>Close</button><button class="primary-button" on:click={copyGeneratedCode}>{codeCopied ? 'Copied' : 'Copy cURL'}</button></div>
        {:else if utilityModal === 'variables'}
          <div class="variables-inspector">
            <div><span>Resolved URL</span><code>{activeRequest ? (() => { try { return buildUrl(activeRequest).url; } catch { return activeRequest.url || 'Invalid URL'; } })() : 'No active request'}</code></div>
            {#each activeRequest ? resolvedVariables(activeRequest) : [] as variable}
              <div><span>{variable.key}<small>{variable.source}</small></span><code>{variable.value}</code></div>
            {/each}
            {#if activeRequest && !resolvedVariables(activeRequest).length}<p>No enabled variables are available for this request.</p>{/if}
          </div>
          <div class="modal-footer"><button class="primary-button" on:click={() => utilityModal = null}>Done</button></div>
        {:else if utilityModal === 'command'}
          <div class="command-list">
            <button on:click={() => runCommand('request')}><Plus size={16} /><span><strong>New request</strong><small>Create an unsaved HTTP request</small></span><kbd>⌘ N</kbd></button>
            <button on:click={() => runCommand('collection')}><Plus size={16} /><span><strong>New collection</strong><small>Add a local collection</small></span></button>
            <button on:click={() => runCommand('environments')}><Globe2 size={16} /><span><strong>Environments</strong><small>Manage variables and secrets</small></span></button>
            <button on:click={() => runCommand('settings')}><Command size={16} /><span><strong>Settings</strong><small>Theme and local workspace options</small></span></button>
          </div>
        {:else if utilityModal === 'settings'}
          <div class="application-settings">
            <div><span><strong>Color theme</strong><small>Switch between dark and light appearance.</small></span><button class="secondary-button" on:click={() => darkMode = !darkMode}>{darkMode ? 'Use light theme' : 'Use dark theme'}</button></div>
            <div><span><strong>Request history</strong><small>{workspace.history.length} locally stored requests.</small></span><button class="secondary-button" disabled={!workspace.history.length} on:click={() => { workspace.history = []; commitWorkspace(); showToast('History cleared'); }}>Clear history</button></div>
            <div class="storage-setting"><span><strong>Local storage path</strong><small>Collections, environments, and history remain on this device.</small></span><code>{storagePath}</code></div>
          </div>
          <div class="modal-footer"><button class="primary-button" on:click={() => utilityModal = null}>Done</button></div>
        {:else}
          <div class="help-content">
            <div><kbd>⌘ ↵</kbd><span>Send the active request</span></div><div><kbd>⌘ S</kbd><span>Save the active request</span></div><div><kbd>Drag</kbd><span>Resize the request and response panels</span></div>
            <p>Postcall is local-first. Collections, environments, and history are stored on this device.</p>
          </div>
          <div class="modal-footer"><button class="primary-button" on:click={() => utilityModal = null}>Got it</button></div>
        {/if}
      </div>
    </div>
  {/if}

  {#if toast}<div class="toast" role="status">{toast}</div>{/if}
</div>
