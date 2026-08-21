<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    Activity, AlertTriangle, Braces, Check, Cloud, CodeXml as Code2, Command, Download, Eye, FileUp,
    Earth as Globe2, Github, CircleQuestionMark as HelpCircle, Moon, PanelLeftClose, Play, Plus, RefreshCw, Save, Settings2,
    Sparkles, Sun, X, Route, Trash2, ChevronUp, ChevronDown
  } from '@lucide/svelte';
  import Sidebar from './components/Sidebar.svelte';
  import KeyValueEditor from './components/KeyValueEditor.svelte';
  import FormDataEditor from './components/FormDataEditor.svelte';
  import CodeEditor from './components/CodeEditor.svelte';
  import ResponseViewer from './components/ResponseViewer.svelte';
  import PostcallIcon from './components/postcall.svelte';
  import SyncSettings from './components/SyncSettings.svelte';
  import { executeRequest, getProcessMetrics, loadBrowserWorkspace, loadWorkspace, openStorageLocation, saveWorkspace } from './lib/bridge';
  import type { ProcessMetrics } from './lib/bridge';
  import { parseCurlCommand, parsePostmanCollection } from './lib/importers';
  import { codeLanguageOptions, generateRequestCode } from './lib/codegen';
  import type { CodeLanguage } from './lib/codegen';
  import { blankWorkspace, initialWorkspaceStore, normalizeRequest, normalizeWorkspaceStore } from './lib/workspace';
  import { blankRequest, blankRow, uid } from './lib/types';
  import type { ApiRequest, Collection, CollectionFolder, Environment, HistoryEntry, Journey, JourneyExtraction, KeyValue, PostcallWorkspace, RequestAuth, RequestInput, ResponseData } from './lib/types';
  import { getLinkedRepository, type SyncConflict, type SyncError } from './lib/sync';

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
  type LoadSample = { index: number; elapsedMs: number; status?: number; sizeBytes: number; error?: string; timeout: boolean; networkError: boolean; timings?: ResponseData['timings']; finishedAtMs: number };
  type LoadSnapshot = { rps: number; average: number; p95: number; errorRate: number; completed: number; elapsedMs: number };
  type JourneyStepResult = {
    stepId: string;
    requestName: string;
    state: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
    response?: ResponseData;
    error?: string;
    extracted: Record<string, string>;
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
  type AppTheme = 'dark' | 'light' | 'midnight' | 'forest' | 'ocean';
  let theme: AppTheme = 'dark';
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
  let codeLanguage: CodeLanguage = 'curl';
  let toast = '';
  let toastTimer: number | undefined;
  let processMetrics: ProcessMetrics | null = null;
  let metricsTimer: number | undefined;
  let syncSettingsRef: SyncSettings;
  let gitLinkedRepo: { owner: string; repo: string; branch: string } | null = null;
  let gitSyncing = false;
  let gitLastSyncLabel = '';
  let gitConflicts: SyncConflict[] = [];
  let gitErrors: SyncError[] = [];
  let curlImportOpen = false;
  let curlText = '';
  let curlImportError = '';
  let loadTestOpen = false;
  let loadTestTotal = 100;
  let loadTestRunMode: 'requests' | 'duration' = 'requests';
  let loadTestDurationHours = 1;
  let loadTestConcurrency = 10;
  let loadTestRunning = false;
  let loadTestStopRequested = false;
  let loadTestStartedAt = 0;
  let loadTestElapsedMs = 0;
  let loadTestCompleted = 0;
  let loadTestScheduled = 0;
  let loadTestSucceeded = 0;
  let loadTestFailed = 0;
  let loadTestLatencies: number[] = [];
  let loadTestStatusCounts: Record<string, number> = {};
  let loadTestErrors: Record<string, number> = {};
  let loadTestSamples: LoadSample[] = [];
  let loadTestSeries: LoadSnapshot[] = [];
  let loadTestPrevious: LoadSnapshot | null = null;
  let loadTestMaxP95 = 1000;
  let loadTestMinRps = 1;
  let loadTestMaxErrorRate = 1;
  let loadTestRequestId: string | null = null;
  let journeyOpen = false;
  let journeyEditor: Journey | null = null;
  let journeyRunning = false;
  let journeyResults: JourneyStepResult[] = [];
  let journeyRunVariables: Record<string, string> = {};

  $: activeRequest = openRequests.find((request) => request.id === activeRequestId) ?? openRequests[0];
  $: activeEnvironment = workspace.environments.find((environment) => environment.id === workspace.activeEnvironmentId);
  $: environmentLabel = activeEnvironment?.name ?? 'No environment';
  $: parameterCount = activeRequest?.params.filter((row) => row.enabled && row.key).length ?? 0;
  $: headerCount = activeRequest?.headers.filter((row) => row.enabled && row.key).length ?? 0;
  $: savedRequestCount = workspace.collections.reduce((total, collection) => total + collection.requests.length + collection.folders.reduce((folderTotal, folder) => folderTotal + folder.requests.length, 0), 0);
  $: loadTestSortedLatencies = [...loadTestLatencies].sort((a, b) => a - b);
  $: loadTestAverage = loadTestLatencies.length ? Math.round(loadTestLatencies.reduce((sum, value) => sum + value, 0) / loadTestLatencies.length) : 0;
  $: loadTestP50 = percentile(loadTestSortedLatencies, .5);
  $: loadTestP95 = percentile(loadTestSortedLatencies, .95);
  $: loadTestRps = loadTestElapsedMs > 0 ? loadTestCompleted / (loadTestElapsedMs / 1000) : 0;
  $: loadTestInFlight = Math.max(0, loadTestScheduled - loadTestCompleted);
  $: loadTestQueued = loadTestRunMode === 'requests' ? Math.max(0, loadTestTotal - loadTestScheduled) : 0;
  $: loadTestTargetMs = Math.max(.001, Number(loadTestDurationHours) || 1) * 60 * 60 * 1000;
  $: loadTestProgressMax = loadTestRunMode === 'requests' ? loadTestTotal : loadTestTargetMs;
  $: loadTestProgressValue = loadTestRunMode === 'requests' ? loadTestCompleted : Math.min(loadTestElapsedMs, loadTestTargetMs);
  $: loadTestRunStatus = loadTestRunning
    ? (loadTestStopRequested ? 'Stopping' : 'Running')
    : loadTestCompleted
      ? (loadTestStopRequested ? 'Stopped' : 'Completed')
      : 'Ready';
  $: loadTestErrorRate = loadTestCompleted ? loadTestFailed / loadTestCompleted * 100 : 0;
  $: loadTestMin = loadTestSortedLatencies[0] ?? 0;
  $: loadTestMax = loadTestSortedLatencies.at(-1) ?? 0;
  $: loadTestP75 = percentile(loadTestSortedLatencies, .75);
  $: loadTestP90 = percentile(loadTestSortedLatencies, .90);
  $: loadTestP99 = percentile(loadTestSortedLatencies, .99);
  $: loadTestTotalBytes = loadTestSamples.reduce((sum, sample) => sum + sample.sizeBytes, 0);
  $: loadTestAverageBytes = loadTestCompleted ? Math.round(loadTestTotalBytes / loadTestCompleted) : 0;
  $: loadTestBytesPerSecond = loadTestElapsedMs ? loadTestTotalBytes / (loadTestElapsedMs / 1000) : 0;
  $: loadTestTimeouts = loadTestSamples.filter((sample) => sample.timeout).length;
  $: loadTestNetworkErrors = loadTestSamples.filter((sample) => sample.networkError).length;
  $: loadTestRateLimited = loadTestSamples.filter((sample) => sample.status === 429).length;
  $: loadTestPeakActive = Math.min(loadTestConcurrency, loadTestScheduled);
  $: loadTestStatusClasses = [2, 3, 4, 5].map((group) => ({ group: `${group}xx`, count: loadTestSamples.filter((sample) => sample.status && Math.floor(sample.status / 100) === group).length }));
  $: loadTestSlowest = [...loadTestSamples].sort((a, b) => b.elapsedMs - a.elapsedMs).slice(0, 5);
  $: loadTestHistogram = Array.from({ length: 10 }, (_, index) => {
    const ceiling = Math.max(loadTestMax, 1);
    const from = Math.round(index * ceiling / 10);
    const to = Math.round((index + 1) * ceiling / 10);
    return { from, to, count: loadTestLatencies.filter((value) => value >= from && (index === 9 ? value <= to : value < to)).length };
  });
  $: loadTestTimingAverages = ['ttfbMs', 'dnsMs', 'connectMs', 'tlsMs'].map((key) => {
    const values = loadTestSamples.map((sample) => sample.timings?.[key as keyof NonNullable<ResponseData['timings']>]).filter((value): value is number => typeof value === 'number');
    return { key, value: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null };
  });
  $: loadTestThresholdPassed = loadTestP95 <= loadTestMaxP95 && loadTestRps >= loadTestMinRps && loadTestErrorRate <= loadTestMaxErrorRate;
  $: savedRequests = workspace.collections.flatMap((collection) => [
    ...collection.requests.map((request) => ({ request, label: `${collection.name} / ${request.name}` })),
    ...collection.folders.flatMap((folder) => folder.requests.map((request) => ({ request, label: `${collection.name} / ${folder.name} / ${request.name}` })))
  ]);

  onMount(async () => {
    const savedTheme = localStorage.getItem('postcall.theme');
    if (['dark', 'light', 'midnight', 'forest', 'ocean'].includes(savedTheme ?? '')) theme = savedTheme as AppTheme;
    const refreshMetrics = () => getProcessMetrics().then((value) => processMetrics = value).catch(() => processMetrics = null);
    refreshMetrics();
    metricsTimer = window.setInterval(refreshMetrics, 3000);
    const stored = (await loadWorkspace().catch(() => null)) ?? loadBrowserWorkspace();
    const store = normalizeWorkspaceStore(stored);
    workspaces = store.workspaces;
    activeWorkspaceId = store.activeWorkspaceId;
    workspace = workspaces.find((item) => item.id === activeWorkspaceId) ?? workspaces[0];
    resetRequestSession(workspace);
    hydrated = true;
    saveWorkspace({ workspaces, activeWorkspaceId }).catch(console.error);
    gitLinkedRepo = await getLinkedRepository().catch(() => null);
  });

  onDestroy(() => window.clearInterval(metricsTimer));

  function selectTheme(value: AppTheme) {
    theme = value;
    localStorage.setItem('postcall.theme', value);
  }

  async function revealStorage() {
    try { await openStorageLocation(); }
    catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
  }

  async function triggerGitSync() {
    if (!gitLinkedRepo || gitSyncing) return;
    await syncSettingsRef?.handleSync();
  }

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

  function mergeSyncedCollections(merged: Collection[]) {
    if (!merged.length) return;
    const byId = new Map(workspace.collections.map((collection) => [collection.id, collection]));
    for (const collection of merged) byId.set(collection.id, collection);
    workspace.collections = Array.from(byId.values());
    commitWorkspace();
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

  function resolvedVariables(request: ApiRequest, runtimeVariables: Record<string, string> = {}) {
    const variables = new Map<string, { key: string; value: string; source: string }>();
    const scope = requestScope(request);
    const apply = (rows: KeyValue[], source: string) => rows
      .filter((item) => item.enabled && item.key)
      .forEach((item) => variables.set(item.key, { key: item.key, value: item.value, source }));
    if (scope) apply(scope.collection.variables, `Collection · ${scope.collection.name}`);
    if (scope?.folder) apply(scope.folder.variables, `Folder · ${scope.folder.name}`);
    if (activeEnvironment) apply(activeEnvironment.variables, `Environment · ${activeEnvironment.name}`);
    Object.entries(runtimeVariables).forEach(([key, value]) => variables.set(key, { key, value, source: 'Journey output' }));
    return [...variables.values()];
  }

  function resolveVariables(input: string, request: ApiRequest, runtimeVariables: Record<string, string> = {}) {
    const variables = new Map(resolvedVariables(request, runtimeVariables).map((item) => [item.key, item.value]));
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

  function buildUrl(request: ApiRequest, runtimeVariables: Record<string, string> = {}) {
    const auth = effectiveAuth(request);
    let value = resolveVariables(request.url.trim(), request, runtimeVariables);
    const inferredProtocol = !/^https?:\/\//i.test(value);
    request.pathParams.filter((row) => row.enabled && row.key).forEach((row) => {
      value = value.replace(new RegExp(`:${row.key}(?=/|$|\\?|#)`, 'g'), encodeURIComponent(resolveVariables(row.value, request, runtimeVariables)));
    });
    if (inferredProtocol) value = `https://${value}`;
    const url = new URL(value);
    request.params.filter((row) => row.enabled && row.key).forEach((row) => {
      url.searchParams.set(resolveVariables(row.key, request, runtimeVariables), resolveVariables(row.value, request, runtimeVariables));
    });
    if (auth.type === 'api-key' && auth.placement === 'query' && auth.key) {
      url.searchParams.set(resolveVariables(auth.key, request, runtimeVariables), resolveVariables(auth.value ?? '', request, runtimeVariables));
    }
    return { url: url.toString(), inferredProtocol };
  }

  function buildPayload(request: ApiRequest, runtimeVariables: Record<string, string> = {}) {
    const auth = effectiveAuth(request);
    const headers: Array<[string, string]> = request.headers
      .filter((row) => row.enabled && row.key)
      .map((row) => [resolveVariables(row.key, request, runtimeVariables), resolveVariables(row.value, request, runtimeVariables)]);
    let body: string | undefined;
    let multipart: RequestInput['multipart'];
    let binary: RequestInput['binary'];

    if (['json', 'text', 'javascript', 'html', 'xml'].includes(request.bodyMode)) body = resolveVariables(request.body, request, runtimeVariables);
    if (request.bodyMode === 'graphql') {
      body = JSON.stringify({ query: resolveVariables(request.body, request, runtimeVariables), variables: JSON.parse(resolveVariables(request.graphqlVariables || '{}', request, runtimeVariables)) });
    }
    if (request.bodyMode === 'urlencoded') {
      const values = new URLSearchParams();
      request.formData.filter((row) => row.enabled && row.key).forEach((row) => values.append(resolveVariables(row.key, request, runtimeVariables), resolveVariables(row.value, request, runtimeVariables)));
      body = values.toString();
    }
    if (request.bodyMode === 'form') {
      const formRows = request.formData.filter((row) => row.enabled && row.key);
      const missingFile = formRows.find((row) => row.kind === 'file' && !row.dataBase64);
      if (missingFile) throw new Error(`Select a local file for the “${missingFile.key}” form field before sending.`);
      multipart = formRows.map((row) => ({
        name: resolveVariables(row.key, request, runtimeVariables), value: resolveVariables(row.value, request, runtimeVariables), kind: row.kind ?? 'text',
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
      headers.push(['Authorization', `${auth.prefix || 'Bearer'} ${resolveVariables(auth.token, request, runtimeVariables)}`]);
    }
    if (auth.type === 'basic') {
      headers.push(['Authorization', `Basic ${btoa(`${resolveVariables(auth.username ?? '', request, runtimeVariables)}:${resolveVariables(auth.password ?? '', request, runtimeVariables)}`)}`]);
    }
    if (auth.type === 'api-key' && auth.placement !== 'query' && auth.key) {
      headers.push([resolveVariables(auth.key, request, runtimeVariables), resolveVariables(auth.value ?? '', request, runtimeVariables)]);
    }
    return { headers, body, multipart, binary };
  }

  function buildRequestInput(request: ApiRequest, runtimeVariables: Record<string, string> = {}) {
    const target = buildUrl(request, runtimeVariables);
    const { headers, body, multipart, binary } = buildPayload(request, runtimeVariables);
    const input: RequestInput = {
      method: request.method, url: target.url, headers, body, multipart, binary,
      timeoutMs: request.timeoutMs, followRedirects: request.followRedirects,
      validateCertificates: request.validateCertificates
    };
    return { input, inferredProtocol: target.inferredProtocol };
  }

  async function executeResolvedRequest(input: RequestInput, inferredProtocol: boolean) {
    try {
      return await executeRequest(input);
    } catch (httpsError) {
      if (!inferredProtocol) throw httpsError;
      return executeRequest({ ...input, url: input.url.replace(/^https:\/\//i, 'http://') });
    }
  }

  async function sendRequest() {
    if (!activeRequest || executing) return;
    requestError = '';
    response = null;
    executing = true;
    let historyEntry: HistoryEntry | null = null;
    try {
      const { input, inferredProtocol } = buildRequestInput(activeRequest);
      response = await executeResolvedRequest(input, inferredProtocol);
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

  function blankJourneyExtraction(): JourneyExtraction {
    return { id: uid(), name: '', source: 'json', path: '', template: '{{value}}' };
  }

  function blankJourney(): Journey {
    return {
      id: uid(),
      name: `Journey ${workspace.journeys.length + 1}`,
      stopOnError: true,
      steps: savedRequests[0] ? [{ id: uid(), requestId: savedRequests[0].request.id, extractions: [] }] : []
    };
  }

  function openJourneys() {
    journeyEditor = structuredClone(workspace.journeys[0] ?? blankJourney());
    journeyResults = [];
    journeyRunVariables = {};
    journeyOpen = true;
  }

  function editJourney(id: string) {
    const journey = workspace.journeys.find((item) => item.id === id);
    if (!journey || journeyRunning) return;
    journeyEditor = structuredClone(journey);
    journeyResults = [];
    journeyRunVariables = {};
  }

  function createJourney() {
    if (journeyRunning) return;
    journeyEditor = blankJourney();
    journeyResults = [];
    journeyRunVariables = {};
  }

  function saveJourney(showConfirmation = true) {
    if (!journeyEditor) return false;
    journeyEditor.name = journeyEditor.name.trim() || 'Untitled journey';
    const savedJourney = structuredClone(journeyEditor);
    const index = workspace.journeys.findIndex((item) => item.id === savedJourney.id);
    if (index === -1) workspace.journeys.push(savedJourney);
    else workspace.journeys[index] = savedJourney;
    commitWorkspace();
    if (showConfirmation) showToast('Journey saved locally');
    return true;
  }

  function deleteJourney() {
    if (!journeyEditor || journeyRunning) return;
    const existing = workspace.journeys.find((item) => item.id === journeyEditor?.id);
    if (existing && !window.confirm(`Delete “${existing.name}”?`)) return;
    workspace.journeys = workspace.journeys.filter((item) => item.id !== journeyEditor?.id);
    commitWorkspace();
    journeyEditor = structuredClone(workspace.journeys[0] ?? blankJourney());
    journeyResults = [];
    journeyRunVariables = {};
  }

  function addJourneyStep() {
    if (!journeyEditor || !savedRequests.length) return;
    journeyEditor.steps = [...journeyEditor.steps, { id: uid(), requestId: savedRequests[0].request.id, extractions: [] }];
    journeyEditor = { ...journeyEditor };
  }

  function removeJourneyStep(stepId: string) {
    if (!journeyEditor) return;
    journeyEditor.steps = journeyEditor.steps.filter((step) => step.id !== stepId);
    journeyEditor = { ...journeyEditor };
    journeyResults = journeyResults.filter((result) => result.stepId !== stepId);
  }

  function moveJourneyStep(index: number, direction: -1 | 1) {
    if (!journeyEditor) return;
    const target = index + direction;
    if (target < 0 || target >= journeyEditor.steps.length) return;
    const steps = [...journeyEditor.steps];
    [steps[index], steps[target]] = [steps[target], steps[index]];
    journeyEditor.steps = steps;
    journeyEditor = { ...journeyEditor };
  }

  function addJourneyExtraction(stepId: string) {
    if (!journeyEditor) return;
    const step = journeyEditor.steps.find((item) => item.id === stepId);
    if (!step) return;
    step.extractions = [...step.extractions, blankJourneyExtraction()];
    journeyEditor = { ...journeyEditor };
  }

  function removeJourneyExtraction(stepId: string, extractionId: string) {
    if (!journeyEditor) return;
    const step = journeyEditor.steps.find((item) => item.id === stepId);
    if (!step) return;
    step.extractions = step.extractions.filter((item) => item.id !== extractionId);
    journeyEditor = { ...journeyEditor };
  }

  function savedRequestById(id: string) {
    return savedRequests.find((item) => item.request.id === id)?.request;
  }

  function readJsonPath(value: unknown, path: string) {
    const normalized = path.trim().replace(/^\$\.?/, '');
    if (!normalized) return value;
    const tokens: string[] = [];
    const pattern = /(?:^|\.)([^.[\]]+)|\[(?:"([^"]+)"|'([^']+)'|(\d+))\]/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalized))) tokens.push(match[1] ?? match[2] ?? match[3] ?? match[4]);
    if (!tokens.length) throw new Error(`Invalid JSON path “${path}”`);
    let current = value;
    for (const token of tokens) {
      if (current === null || current === undefined || (typeof current !== 'object' && !Array.isArray(current)) || !(token in current)) {
        throw new Error(`JSON path “${path}” was not found`);
      }
      current = (current as Record<string, unknown>)[token];
    }
    return current;
  }

  function extractionValue(responseData: ResponseData, extraction: JourneyExtraction) {
    let raw: unknown;
    if (extraction.source === 'json') {
      let parsed: unknown;
      try { parsed = JSON.parse(responseData.body); }
      catch { throw new Error('Response body is not valid JSON'); }
      raw = readJsonPath(parsed, extraction.path);
    } else if (extraction.source === 'header') {
      const header = responseData.headers.find((item) => item.key.toLowerCase() === extraction.path.trim().toLowerCase());
      if (!header) throw new Error(`Response header “${extraction.path}” was not found`);
      raw = header.value;
    } else if (extraction.source === 'status') raw = responseData.status;
    else raw = responseData.body;
    const value = typeof raw === 'string' ? raw : JSON.stringify(raw);
    return (extraction.template || '{{value}}').replaceAll('{{value}}', value ?? '');
  }

  function updateJourneyResult(stepId: string, patch: Partial<JourneyStepResult>) {
    journeyResults = journeyResults.map((result) => result.stepId === stepId ? { ...result, ...patch } : result);
  }

  async function runJourney() {
    if (!journeyEditor || journeyRunning || !journeyEditor.steps.length) return;
    const invalidStep = journeyEditor.steps.find((step) => !savedRequestById(step.requestId));
    if (invalidStep) { showToast('Choose a saved request for every step'); return; }
    const invalidExtraction = journeyEditor.steps.flatMap((step) => step.extractions).find((item) => !item.name.trim() || (item.source === 'header' && !item.path.trim()));
    if (invalidExtraction) { showToast('Every output needs a variable name and every header output needs a header name'); return; }
    saveJourney(false);
    journeyRunning = true;
    journeyRunVariables = {};
    journeyResults = journeyEditor.steps.map((step) => ({
      stepId: step.id,
      requestName: savedRequestById(step.requestId)?.name ?? 'Missing request',
      state: 'pending',
      extracted: {}
    }));
    const historyEntries: HistoryEntry[] = [];
    let stopped = false;
    for (const step of journeyEditor.steps) {
      if (stopped) { updateJourneyResult(step.id, { state: 'skipped' }); continue; }
      const request = savedRequestById(step.requestId)!;
      updateJourneyResult(step.id, { state: 'running' });
      try {
        const { input, inferredProtocol } = buildRequestInput(request, journeyRunVariables);
        const stepResponse = await executeResolvedRequest(input, inferredProtocol);
        const extracted: Record<string, string> = {};
        for (const extraction of step.extractions) {
          const name = extraction.name.trim();
          extracted[name] = extractionValue(stepResponse, extraction);
          journeyRunVariables = { ...journeyRunVariables, [name]: extracted[name] };
        }
        const succeeded = stepResponse.status < 400;
        updateJourneyResult(step.id, {
          state: succeeded ? 'passed' : 'failed',
          response: stepResponse,
          error: succeeded ? undefined : `HTTP ${stepResponse.status} ${stepResponse.statusText}`,
          extracted
        });
        historyEntries.push({ id: uid(), request: structuredClone(request), status: stepResponse.status, elapsedMs: stepResponse.elapsedMs, createdAt: new Date().toISOString() });
        if (!succeeded && journeyEditor.stopOnError) stopped = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateJourneyResult(step.id, { state: 'failed', error: message });
        historyEntries.push({ id: uid(), request: structuredClone(request), createdAt: new Date().toISOString() });
        if (journeyEditor.stopOnError) stopped = true;
      }
    }
    if (historyEntries.length) {
      workspace.history = [...historyEntries.reverse(), ...workspace.history].slice(0, 200);
      commitWorkspace();
    }
    journeyRunning = false;
  }

  function percentile(values: number[], fraction: number) {
    if (!values.length) return 0;
    return values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)];
  }

  function formatBytes(value: number) {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  function comparison(current: number, previous: number, lowerIsBetter = false) {
    if (!previous) return '—';
    const change = (current - previous) / previous * 100;
    const good = lowerIsBetter ? change <= 0 : change >= 0;
    return `${good ? '✓' : '△'} ${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
  }

  function downloadLoadTestReport() {
    if (!activeRequest || !loadTestCompleted) return;
    const clean = (value: unknown) => String(value).normalize('NFKD').replace(/[^\x20-\x7E]/g, '').replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
    const text = (x: number, y: number, value: unknown, size = 9, color = '.18 .2 .24') => `BT /F1 ${size} Tf ${color} rg ${x} ${y} Td (${clean(value)}) Tj ET\n`;
    const heading = (y: number, value: string) => text(42, y, value, 14, '.12 .22 .36');
    const rule = (y: number) => `.82 .85 .89 RG 42 ${y} m 570 ${y} l S\n`;
    const metric = (x: number, y: number, label: string, value: string) => `.96 .97 .98 rg ${x} ${y - 36} 122 48 re f\n${text(x + 8, y, label, 7, '.4 .44 .5')}${text(x + 8, y - 18, value, 12, '.12 .2 .3')}`;
    const bars = (values: number[], x: number, y: number, width: number, height: number, color: string) => {
      const max = Math.max(...values, 1);
      const gap = 2;
      const barWidth = Math.max(1, (width - gap * Math.max(0, values.length - 1)) / Math.max(values.length, 1));
      return values.map((value, index) => `${color} rg ${x + index * (barWidth + gap)} ${y} ${barWidth} ${Math.max(1, value / max * height)} re f`).join('\n') + '\n';
    };
    let page1 = text(42, 750, 'POSTcall', 18, '.95 .34 .12') + text(145, 752, 'LOAD TEST REPORT', 11, '.35 .39 .45');
    page1 += text(42, 724, `${activeRequest.method}  ${activeRequest.name}`, 15) + text(42, 708, activeRequest.url.slice(0, 100), 8, '.35 .39 .45');
    page1 += text(42, 691, `Generated ${new Date().toLocaleString()}  |  ${loadTestRunMode === 'requests' ? `${loadTestTotal} requested` : `${loadTestDurationHours} hours`}  |  Concurrency ${loadTestConcurrency}`, 8, '.35 .39 .45') + rule(680);
    page1 += heading(655, 'Executive summary');
    page1 += metric(42, 635, 'THROUGHPUT', `${loadTestRps.toFixed(1)} req/s`) + metric(176, 635, 'COMPLETED', `${loadTestCompleted}`) + metric(310, 635, 'SUCCESS RATE', `${(100 - loadTestErrorRate).toFixed(2)}%`) + metric(444, 635, 'DURATION', `${(loadTestElapsedMs / 1000).toFixed(1)} s`);
    page1 += metric(42, 570, 'AVERAGE', `${loadTestAverage} ms`) + metric(176, 570, 'P95', `${loadTestP95} ms`) + metric(310, 570, 'P99', `${loadTestP99} ms`) + metric(444, 570, 'DATA RECEIVED', formatBytes(loadTestTotalBytes));
    page1 += heading(500, 'Latency distribution');
    page1 += `.82 .85 .89 RG 42 378 m 570 378 l S\n` + bars(loadTestHistogram.map((item) => item.count), 46, 379, 520, 92, '.48 .32 .82');
    loadTestHistogram.forEach((bucket, index) => page1 += text(48 + index * 52, 364, bucket.to, 6, '.4 .44 .5'));
    page1 += text(42, 340, `Latency ms: min ${loadTestMin} | p50 ${loadTestP50} | p75 ${loadTestP75} | p90 ${loadTestP90} | p95 ${loadTestP95} | p99 ${loadTestP99} | max ${loadTestMax}`, 8);
    page1 += heading(305, 'Reliability and thresholds');
    page1 += text(42, 280, `Successful ${loadTestSucceeded}  |  Failed ${loadTestFailed}  |  Timeouts ${loadTestTimeouts}  |  Network errors ${loadTestNetworkErrors}  |  HTTP 429 ${loadTestRateLimited}`, 9);
    page1 += text(42, 260, `Status classes: ${loadTestStatusClasses.map((item) => `${item.group} ${item.count}`).join('  |  ')}`, 9);
    page1 += text(42, 235, `Threshold result: ${loadTestThresholdPassed ? 'PASS' : 'FAIL'}  |  P95 <= ${loadTestMaxP95} ms  |  Throughput >= ${loadTestMinRps} req/s  |  Error rate <= ${loadTestMaxErrorRate}%`, 9, loadTestThresholdPassed ? '.12 .5 .3' : '.75 .16 .2');
    page1 += heading(195, 'Network and response data');
    page1 += text(42, 170, `${loadTestTimingAverages.map((item) => `${item.key.replace('Ms', '').toUpperCase()} ${item.value === null ? 'N/A' : `${item.value} ms`}`).join('  |  ')}`, 9);
    page1 += text(42, 150, `Average response ${formatBytes(loadTestAverageBytes)}  |  Transfer rate ${formatBytes(loadTestBytesPerSecond)}/s  |  Peak concurrency ${loadTestPeakActive}`, 9);
    page1 += text(42, 36, 'POSTcall load test report', 7, '.45 .48 .52') + text(540, 36, '1 / 2', 7, '.45 .48 .52');

    let page2 = text(42, 750, 'POSTcall', 18, '.95 .34 .12') + text(145, 752, 'PERFORMANCE DETAILS', 11, '.35 .39 .45') + rule(730);
    page2 += heading(705, 'Performance over time');
    const series = loadTestSeries.length ? loadTestSeries : [{ rps: loadTestRps, p95: loadTestP95, errorRate: loadTestErrorRate } as LoadSnapshot];
    page2 += text(42, 680, 'Throughput (requests/second)', 8) + bars(series.map((item) => item.rps), 42, 585, 528, 80, '.95 .34 .12');
    page2 += text(42, 560, 'P95 latency (milliseconds)', 8) + bars(series.map((item) => item.p95), 42, 465, 528, 80, '.2 .48 .85');
    page2 += text(42, 440, 'Error rate (percent)', 8) + bars(series.map((item) => item.errorRate), 42, 345, 528, 80, '.82 .2 .28');
    page2 += heading(310, 'Slowest requests');
    loadTestSlowest.forEach((sample, index) => page2 += text(48, 286 - index * 20, `#${sample.index}    ${sample.status ?? 'ERROR'}    ${sample.elapsedMs} ms${sample.error ? `    ${sample.error.slice(0, 65)}` : ''}`, 8));
    page2 += heading(170, 'Status and error breakdown');
    page2 += text(42, 146, `HTTP: ${Object.entries(loadTestStatusCounts).map(([status, count]) => `${status}: ${count}`).join('  | ') || 'No HTTP responses'}`, 8);
    Object.entries(loadTestErrors).slice(0, 3).forEach(([message, count], index) => page2 += text(42, 124 - index * 18, `${count}x  ${message.slice(0, 90)}`, 7, '.65 .18 .22'));
    page2 += text(42, 36, 'Charts use one-second samples. Network phases may be unavailable in some runtimes.', 7, '.45 .48 .52') + text(540, 36, '2 / 2', 7, '.45 .48 .52');

    const stream = (content: string) => `<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}endstream`;
    const objects = ['', '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>', stream(page1), '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>', stream(page2), '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (let index = 1; index < objects.length; index += 1) { offsets[index] = new TextEncoder().encode(pdf).length; pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`; }
    const xref = new TextEncoder().encode(pdf).length;
    pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const blob = new Blob([pdf], { type: 'application/pdf' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const safeName = activeRequest.name.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'request';
    link.download = `${safeName}-load-test-${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function openLoadTest() {
    if (!activeRequest) return;
    if (loadTestRequestId !== activeRequest.id) {
      resetLoadTestResults();
      loadTestRequestId = activeRequest.id;
    }
    loadTestOpen = true;
    loadTestStopRequested = false;
  }

  function resetLoadTestResults() {
    loadTestRunning = false;
    loadTestStopRequested = false;
    loadTestStartedAt = 0;
    loadTestElapsedMs = 0;
    loadTestCompleted = 0;
    loadTestScheduled = 0;
    loadTestSucceeded = 0;
    loadTestFailed = 0;
    loadTestLatencies = [];
    loadTestStatusCounts = {};
    loadTestErrors = {};
    loadTestSamples = [];
    loadTestSeries = [];
    loadTestPrevious = null;
  }

  async function runLoadTest() {
    if (!activeRequest || loadTestRunning) return;
    loadTestRequestId = activeRequest.id;
    const total = Math.max(1, Math.min(10000, Math.floor(Number(loadTestTotal) || 1)));
    const durationMs = Math.max(1000, Math.min(168, Number(loadTestDurationHours) || 1) * 60 * 60 * 1000);
    const concurrency = Math.max(1, Math.min(100, loadTestRunMode === 'requests' ? total : 100, Math.floor(Number(loadTestConcurrency) || 1)));
    loadTestTotal = total;
    loadTestConcurrency = concurrency;
    if (loadTestCompleted) loadTestPrevious = { rps: loadTestRps, average: loadTestAverage, p95: loadTestP95, errorRate: loadTestErrorRate, completed: loadTestCompleted, elapsedMs: loadTestElapsedMs };
    loadTestCompleted = 0;
    loadTestScheduled = 0;
    loadTestSucceeded = 0;
    loadTestFailed = 0;
    loadTestLatencies = [];
    loadTestStatusCounts = {};
    loadTestErrors = {};
    loadTestSamples = [];
    loadTestSeries = [];
    loadTestStopRequested = false;
    loadTestRunning = true;
    loadTestStartedAt = performance.now();
    loadTestElapsedMs = 0;
    let claimed = 0;
    let lastBucket = -1;
    let timer = window.setInterval(() => {
      loadTestElapsedMs = performance.now() - loadTestStartedAt;
      const bucket = Math.floor(loadTestElapsedMs / 1000);
      if (bucket !== lastBucket) {
        lastBucket = bucket;
        const sorted = [...loadTestLatencies].sort((a, b) => a - b);
        loadTestSeries = [...loadTestSeries, { rps: loadTestElapsedMs ? loadTestCompleted / (loadTestElapsedMs / 1000) : 0, average: loadTestLatencies.length ? loadTestLatencies.reduce((sum, value) => sum + value, 0) / loadTestLatencies.length : 0, p95: percentile(sorted, .95), errorRate: loadTestCompleted ? loadTestFailed / loadTestCompleted * 100 : 0, completed: loadTestCompleted, elapsedMs: loadTestElapsedMs }];
      }
    }, 100);
    try {
      const { input, inferredProtocol } = buildRequestInput(activeRequest);
      const worker = async () => {
        while (!loadTestStopRequested) {
          const index = claimed++;
          if ((loadTestRunMode === 'requests' && index >= total) || (loadTestRunMode === 'duration' && performance.now() - loadTestStartedAt >= durationMs)) break;
          loadTestScheduled += 1;
          const started = performance.now();
          try {
            const result = await executeResolvedRequest(input, inferredProtocol);
            const elapsedMs = Math.round(performance.now() - started);
            const status = String(result.status);
            loadTestStatusCounts = { ...loadTestStatusCounts, [status]: (loadTestStatusCounts[status] ?? 0) + 1 };
            if (result.status >= 200 && result.status < 400) loadTestSucceeded += 1;
            else loadTestFailed += 1;
            loadTestSamples = [...loadTestSamples, { index: index + 1, elapsedMs, status: result.status, sizeBytes: result.sizeBytes, timeout: false, networkError: false, timings: result.timings, finishedAtMs: performance.now() - loadTestStartedAt }];
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            loadTestErrors = { ...loadTestErrors, [message]: (loadTestErrors[message] ?? 0) + 1 };
            loadTestFailed += 1;
            const normalized = message.toLowerCase();
            loadTestSamples = [...loadTestSamples, { index: index + 1, elapsedMs: Math.round(performance.now() - started), sizeBytes: 0, error: message, timeout: normalized.includes('timeout') || normalized.includes('timed out') || normalized.includes('abort'), networkError: normalized.includes('connect') || normalized.includes('network') || normalized.includes('fetch'), finishedAtMs: performance.now() - loadTestStartedAt }];
          } finally {
            loadTestLatencies = [...loadTestLatencies, Math.round(performance.now() - started)];
            loadTestCompleted += 1;
          }
        }
      };
      await Promise.all(Array.from({ length: concurrency }, worker));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      loadTestErrors = { [message]: 1 };
    } finally {
      window.clearInterval(timer);
      loadTestElapsedMs = performance.now() - loadTestStartedAt;
      loadTestRunning = false;
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

  function generatedRequestCode(language: CodeLanguage) {
    if (!activeRequest) return '';
    try {
      const { input } = buildRequestInput(activeRequest);
      return generateRequestCode(language, input);
    } catch (error) {
      return `// Could not generate code: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async function copyGeneratedCode() {
    await navigator.clipboard.writeText(generatedRequestCode(codeLanguage));
    codeCopied = true;
    setTimeout(() => codeCopied = false, 1400);
  }

  function selectCodeLanguage(language: CodeLanguage) {
    codeLanguage = language;
    codeCopied = false;
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

<div class="app-shell theme-{theme}" class:light={theme === 'light'}>
  <header class="topbar" data-tauri-drag-region>
    <div class="brand">
      <div class="brand-mark">
      <PostcallIcon width=24 height=24/>
      </div>
      <div>
      <span>POST</span><span class="app-call">call</span>
      </div>
      <span class="version-badge" title={`Postcall version ${__APP_VERSION__}`}>v{__APP_VERSION__}</span>
      <span class="local-badge">LOCAL</span>
    </div>
    <nav class="topnav"><span class="active">Workspace</span></nav>
    <div class="top-actions">
      <div class="sync-state"><Cloud size={15} /><span>Saved locally</span></div>
      <div class="divider"></div>
      <button class="icon-button" on:click={() => utilityModal = 'command'} title="Command palette"><Command size={16} /></button>
      <button class="icon-button" on:click={() => selectTheme(theme === 'light' ? 'dark' : 'light')} title="Toggle light and dark theme">{#if theme === 'light'}<Moon size={16} />{:else}<Sun size={16} />{/if}</button>
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
              <button class="secondary-button" on:click={openJourneys} disabled={!savedRequests.length}><Route size={15} /> Journeys</button>
              <button class="secondary-button" on:click={openLoadTest} disabled={!activeRequest.url.trim()}><Activity size={15} /> Load test</button>
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

  <footer class="app-status-bar">
    <span class="status-workspace"><i class="status-dot"></i>Local workspace</span>
    <span>Collections <strong>{workspace.collections.length}</strong></span>
    <span>Requests <strong>{savedRequestCount}</strong></span>
    <div class="status-spacer"></div>
    {#if processMetrics}<span title="Local SQLite database, WAL, and shared-memory files">SQLite <strong>{formatBytes(processMetrics.storageBytes)}</strong></span><span title="Memory used by Postcall">RAM <strong>{(processMetrics.memoryBytes / 1024 / 1024).toFixed(0)} MB</strong></span><span title="CPU used by Postcall">CPU <strong>{processMetrics.cpuPercent.toFixed(1)}%</strong></span>{/if}
    {#if gitLinkedRepo}
      <span
        class="status-git"
        class:has-conflict={gitConflicts.length || gitErrors.length}
        title={`${gitLinkedRepo.owner}/${gitLinkedRepo.repo} · Branch ${gitLinkedRepo.branch}${gitLastSyncLabel ? ` · Last synced ${gitLastSyncLabel}` : ''}`}
      >
        <Github size={12} />
        <span>
          {#if gitSyncing}Syncing…
          {:else if gitConflicts.length}{gitConflicts.length} conflict{gitConflicts.length > 1 ? 's' : ''}
          {:else if gitErrors.length}<AlertTriangle size={11} />Sync error
          {:else if gitLastSyncLabel}Synced {gitLastSyncLabel}
          {:else}{gitLinkedRepo.owner}/{gitLinkedRepo.repo}{/if}
        </span>
      </span>
      <button class="icon-button subtle" disabled={gitSyncing} on:click={triggerGitSync} title="Sync collections with GitHub">
        <RefreshCw size={13} class={gitSyncing ? 'spinning' : ''} />
      </button>
    {:else}
      <button class="status-git muted" on:click={() => utilityModal = 'settings'} title="Link a GitHub repository to sync collections">
        <Github size={12} /><span>Not linked</span>
      </button>
    {/if}
    <button class="icon-button subtle" on:click={() => utilityModal = 'settings'} title="Application settings"><Settings2 size={14} /></button>
  </footer>

  {#if journeyOpen && journeyEditor}
    <div class="modal-backdrop" role="presentation" on:click={(event) => { if (event.target === event.currentTarget && !journeyRunning) journeyOpen = false; }}>
      <div class="modal journey-modal" role="dialog" aria-modal="true" aria-label="API journeys">
        <div class="modal-header">
          <div><span class="modal-icon"><Route size={18} /></span><div><strong>API Journeys</strong><p>Chain saved requests and pass response values into the next steps.</p></div></div>
          <button class="icon-button" disabled={journeyRunning} on:click={() => journeyOpen = false} aria-label="Close dialog"><X size={17} /></button>
        </div>
        <div class="journey-layout">
          <aside class="journey-sidebar">
            <div class="journey-sidebar-heading"><span>Saved journeys</span><button on:click={createJourney} disabled={journeyRunning} title="New journey"><Plus size={14} /></button></div>
            <div class="journey-saved-list">
              {#each workspace.journeys as journey}
                <button class:active={journey.id === journeyEditor.id} disabled={journeyRunning} on:click={() => editJourney(journey.id)}>
                  <Route size={13} /><span><strong>{journey.name}</strong><small>{journey.steps.length} {journey.steps.length === 1 ? 'step' : 'steps'}</small></span>
                </button>
              {/each}
              {#if !workspace.journeys.length}<p>No saved journeys yet.</p>{/if}
            </div>
          </aside>
          <div class="journey-editor">
            <fieldset class="journey-config-fields" disabled={journeyRunning}>
              <div class="journey-name-row">
                <label><span>Journey name</span><input bind:value={journeyEditor.name} placeholder="Sign up and create project" /></label>
                <label class="journey-stop-option"><input type="checkbox" bind:checked={journeyEditor.stopOnError} /><span><strong>Stop on error</strong><small>Skip remaining steps after a failure</small></span></label>
              </div>
              <div class="journey-help">
                <Sparkles size={15} />
                <span>Extract an output from one response, then use it anywhere in later requests as <code>{'{{variableName}}'}</code>.</span>
              </div>
              <div class="journey-steps">
                {#each journeyEditor.steps as step, index (step.id)}
                  {@const result = journeyResults.find((item) => item.stepId === step.id)}
                  <section class="journey-step" class:running={result?.state === 'running'} class:passed={result?.state === 'passed'} class:failed={result?.state === 'failed'} class:skipped={result?.state === 'skipped'}>
                    <div class="journey-step-header">
                      <span class="journey-step-number">{index + 1}</span>
                      <div><strong>{savedRequestById(step.requestId)?.name ?? 'Choose a request'}</strong><small>{result ? result.state : 'Ready'}</small></div>
                      <button on:click={() => moveJourneyStep(index, -1)} disabled={index === 0} title="Move step up"><ChevronUp size={14} /></button>
                      <button on:click={() => moveJourneyStep(index, 1)} disabled={index === journeyEditor.steps.length - 1} title="Move step down"><ChevronDown size={14} /></button>
                      <button class="journey-remove" on:click={() => removeJourneyStep(step.id)} title="Remove step"><Trash2 size={13} /></button>
                    </div>
                    <label class="journey-request-select"><span>Saved request</span><select bind:value={step.requestId}>{#each savedRequests as option}<option value={option.request.id}>{option.label}</option>{/each}</select></label>
                    <div class="journey-output-heading"><div><strong>Response outputs</strong><small>Available only to the steps below this one</small></div><button on:click={() => addJourneyExtraction(step.id)}><Plus size={12} /> Add output</button></div>
                    {#each step.extractions as extraction (extraction.id)}
                      <div class="journey-extraction">
                        <input bind:value={extraction.name} placeholder="variableName" aria-label="Output variable name" />
                        <select bind:value={extraction.source} aria-label="Output source">
                          <option value="json">JSON path</option><option value="header">Header</option><option value="body">Full body</option><option value="status">Status code</option>
                        </select>
                        <input bind:value={extraction.path} disabled={extraction.source === 'body' || extraction.source === 'status'} placeholder={extraction.source === 'header' ? 'Header name' : '$.data.id'} aria-label="JSON path or header name" />
                        <input bind:value={extraction.template} placeholder={'{{value}}'} title={'Optional template, for example user-{{value}}'} aria-label="Output value template" />
                        <button on:click={() => removeJourneyExtraction(step.id, extraction.id)} title="Remove output"><X size={13} /></button>
                      </div>
                    {/each}
                    {#if !step.extractions.length}<p class="journey-no-outputs">No outputs. Add one if a later request needs data from this response.</p>{/if}
                    {#if result}
                      <div class="journey-step-result">
                        <div><span class="journey-result-state {result.state}">{result.state}</span>{#if result.response}<strong>HTTP {result.response.status}</strong><span>{result.response.elapsedMs} ms</span>{/if}</div>
                        {#if result.error}<p>{result.error}</p>{/if}
                        {#if Object.keys(result.extracted).length}<div class="journey-result-vars">{#each Object.entries(result.extracted) as [key, value]}<span><code>{key}</code><b>{value}</b></span>{/each}</div>{/if}
                      </div>
                    {/if}
                  </section>
                {/each}
                {#if !journeyEditor.steps.length}<div class="journey-empty"><Route size={25} /><strong>Add the first request</strong><p>A journey runs saved requests one after another.</p></div>{/if}
              </div>
              <button class="journey-add-step" on:click={addJourneyStep} disabled={!savedRequests.length}><Plus size={14} /> Add request step</button>
            </fieldset>
          </div>
        </div>
        <div class="modal-footer journey-footer">
          <button class="journey-delete-button" on:click={deleteJourney} disabled={journeyRunning}><Trash2 size={13} /> Delete</button>
          {#if Object.keys(journeyRunVariables).length}<span class="journey-variable-count">{Object.keys(journeyRunVariables).length} runtime {Object.keys(journeyRunVariables).length === 1 ? 'variable' : 'variables'}</span>{/if}
          <div></div>
          <button class="secondary-button" on:click={() => journeyOpen = false} disabled={journeyRunning}>Close</button>
          <button class="secondary-button" on:click={() => saveJourney()} disabled={journeyRunning}>Save</button>
          <button class="primary-button" on:click={runJourney} disabled={journeyRunning || !journeyEditor.steps.length}>{journeyRunning ? 'Running…' : 'Run journey'}</button>
        </div>
      </div>
    </div>
  {/if}

  {#if loadTestOpen}
    <div class="modal-backdrop" role="presentation" on:click={(event) => { if (event.target === event.currentTarget && !loadTestRunning) loadTestOpen = false; }}>
      <div class="modal load-test-modal" role="dialog" aria-modal="true" aria-label="Load test request">
        <div class="modal-header"><div><span class="modal-icon"><Activity size={18} /></span><div><strong>Load test · {activeRequest?.name}</strong><p>Run this request repeatedly with controlled concurrency.</p></div></div><button class="icon-button" disabled={loadTestRunning} on:click={() => loadTestOpen = false} aria-label="Close dialog"><X size={17} /></button></div>
        <div class="load-test-config">
          <label>
            <span>
              Run by
              <small>
                Choose a request count or elapsed time
              </small>
          </span>
          <select bind:value={loadTestRunMode} disabled={loadTestRunning}>
            <option value="requests">Number of requests</option>
            <option value="duration">Duration in hours</option>
          </select>
        </label>
          {#if loadTestRunMode === 'requests'}<label><span>Total requests<small>Maximum 10,000 per run</small></span><input type="number" min="1" max="10000" step="1" bind:value={loadTestTotal} disabled={loadTestRunning} /></label>
          {:else}<label><span>Duration<small>0.001 to 168 hours</small></span><input type="number" min="0.001" max="168" step="0.25" bind:value={loadTestDurationHours} disabled={loadTestRunning} /></label>{/if}
          <label><span>Concurrency<small>Maximum 100 workers</small></span><input type="number" min="1" max="100" step="1" bind:value={loadTestConcurrency} disabled={loadTestRunning} /></label>
        </div>
        <div class="load-test-progress">
          <div><span class="load-test-state" class:running={loadTestRunning}>{loadTestRunStatus}</span><strong>{loadTestRunMode === 'requests' ? `${loadTestCompleted} / ${loadTestTotal}` : `${(loadTestElapsedMs / 3600000).toFixed(3)} / ${loadTestDurationHours} hours`}</strong></div>
          <progress max={loadTestProgressMax} value={loadTestProgressValue}></progress>
        </div>
        <div class="load-test-run-details">
          <span><i class="queued"></i>Queued <strong>{loadTestQueued}</strong></span>
          <span><i class="active"></i>In flight <strong>{loadTestInFlight}</strong></span>
          <span><i class="done"></i>Completed <strong>{loadTestCompleted}</strong></span>
          <span>Elapsed <strong>{(loadTestElapsedMs / 1000).toFixed(1)}s</strong></span>
        </div>
        <div class="load-test-metrics">
          <div><span>Throughput</span><strong>{loadTestRps.toFixed(1)} <small>req/s</small></strong></div>
          <div><span>Average</span><strong>{loadTestAverage} <small>ms</small></strong></div>
          <div><span>P50</span><strong>{loadTestP50} <small>ms</small></strong></div>
          <div><span>P95</span><strong>{loadTestP95} <small>ms</small></strong></div>
          <div class="success"><span>Successful</span><strong>{loadTestSucceeded}</strong></div>
          <div class:error={loadTestFailed > 0}><span>Failed</span><strong>{loadTestFailed}</strong></div>
        </div>
        <div class="load-test-scroll">
          <div class="load-test-stat-grid">
            <div><span>Min / Max</span><strong>{loadTestMin} / {loadTestMax} ms</strong></div>
            <div><span>P75 / P90 / P99</span><strong>{loadTestP75} / {loadTestP90} / {loadTestP99} ms</strong></div>
            <div><span>Error rate</span><strong>{loadTestErrorRate.toFixed(2)}%</strong></div>
            <div><span>Peak concurrency</span><strong>{loadTestPeakActive}</strong></div>
            <div><span>Timeouts / network</span><strong>{loadTestTimeouts} / {loadTestNetworkErrors}</strong></div>
            <div><span>Rate limited (429)</span><strong>{loadTestRateLimited}</strong></div>
            <div><span>Response data</span><strong>{formatBytes(loadTestTotalBytes)} total</strong></div>
            <div><span>Average response</span><strong>{formatBytes(loadTestAverageBytes)}</strong></div>
            <div><span>Data rate</span><strong>{formatBytes(loadTestBytesPerSecond)}/s</strong></div>
          </div>

          <div class="load-test-section">
            <div class="load-test-section-title"><strong>Response status</strong><span>{loadTestStatusClasses.map((item) => `${item.group} ${item.count}`).join(' · ')}</span></div>
          </div>

          <div class="load-test-section">
            <div class="load-test-section-title"><strong>Network timing averages</strong><span>Unavailable phases are shown as —</span></div>
            <div class="timing-row">{#each loadTestTimingAverages as timing}<span>{timing.key.replace('Ms', '').toUpperCase()} <strong>{timing.value === null ? '—' : `${timing.value} ms`}</strong></span>{/each}</div>
          </div>

          {#if loadTestSeries.length > 1}
            <div class="load-test-section">
              <div class="load-test-section-title"><strong>Performance over time</strong><span>Each column represents one second</span></div>
              <div class="mini-charts">
                {#each [['Throughput', 'rps'], ['Latency P95', 'p95'], ['Error rate', 'errorRate']] as chart}
                  <div><span>{chart[0]}</span><div class="spark-bars">{#each loadTestSeries as point}<i title={`${chart[0]}: ${Number(point[chart[1] as keyof LoadSnapshot]).toFixed(1)}`} style={`height:${Math.max(2, Number(point[chart[1] as keyof LoadSnapshot]) / Math.max(...loadTestSeries.map((entry) => Number(entry[chart[1] as keyof LoadSnapshot])), 1) * 100)}%`}></i>{/each}</div></div>
                {/each}
              </div>
            </div>
          {/if}

          {#if loadTestLatencies.length}
            <div class="load-test-section">
              <div class="load-test-section-title"><strong>Latency distribution</strong><span>{loadTestMin}–{loadTestMax} ms</span></div>
              <div class="histogram">{#each loadTestHistogram as bucket}<div title={`${bucket.from}–${bucket.to} ms: ${bucket.count}`}><i style={`height:${Math.max(2, bucket.count / Math.max(...loadTestHistogram.map((entry) => entry.count), 1) * 100)}%`}></i><span>{bucket.to}</span></div>{/each}</div>
            </div>
          {/if}

          <div class="load-test-section threshold-section" class:passed={loadTestThresholdPassed && loadTestCompleted > 0} class:failed={!loadTestThresholdPassed && loadTestCompleted > 0}>
            <div class="load-test-section-title"><strong>Performance thresholds {loadTestCompleted ? (loadTestThresholdPassed ? '· Passed' : '· Failed') : ''}</strong><span>Evaluated during and after the run</span></div>
            <div class="threshold-inputs"><label>P95 ≤ <input type="number" min="1" bind:value={loadTestMaxP95} /> ms</label><label>Throughput ≥ <input type="number" min="0" step=".1" bind:value={loadTestMinRps} /> req/s</label><label>Error rate ≤ <input type="number" min="0" max="100" step=".1" bind:value={loadTestMaxErrorRate} />%</label></div>
          </div>

          {#if loadTestPrevious && loadTestCompleted}
            <div class="load-test-section">
              <div class="load-test-section-title"><strong>Compared with previous run</strong><span>{loadTestPrevious.completed} requests in {(loadTestPrevious.elapsedMs / 1000).toFixed(1)}s</span></div>
              <div class="comparison-row"><span>Throughput <strong>{comparison(loadTestRps, loadTestPrevious.rps)}</strong></span><span>Average <strong>{comparison(loadTestAverage, loadTestPrevious.average, true)}</strong></span><span>P95 <strong>{comparison(loadTestP95, loadTestPrevious.p95, true)}</strong></span><span>Error rate <strong>{comparison(loadTestErrorRate, loadTestPrevious.errorRate, true)}</strong></span></div>
            </div>
          {/if}

          {#if loadTestSlowest.length}
            <div class="load-test-section">
              <div class="load-test-section-title"><strong>Slowest requests</strong><span>Top five by total latency</span></div>
              <div class="slow-list">{#each loadTestSlowest as sample}<span><b>#{sample.index}</b><code>{sample.status ?? 'ERR'}</code><strong>{sample.elapsedMs} ms</strong></span>{/each}</div>
            </div>
          {/if}
        {#if Object.keys(loadTestStatusCounts).length || Object.keys(loadTestErrors).length}
          <div class="load-test-breakdown">
            {#if Object.keys(loadTestStatusCounts).length}<div><strong>Status codes</strong><p>{Object.entries(loadTestStatusCounts).sort().map(([status, count]) => `${status}: ${count}`).join(' · ')}</p></div>{/if}
            {#each Object.entries(loadTestErrors).slice(0, 3) as [message, count]}<div class="error-row"><strong>Error × {count}</strong><p>{message}</p></div>{/each}
          </div>
        {/if}
        </div>
        <div class="load-test-warning">Only load test systems you own or have permission to test. High concurrency can overwhelm a service.</div>
        <div class="modal-footer">
          {#if loadTestRunning}<button class="danger-button" on:click={() => loadTestStopRequested = true} disabled={loadTestStopRequested}>{loadTestStopRequested ? 'Stopping…' : 'Stop scheduling'}</button>
          {:else}<button class="secondary-button" on:click={() => loadTestOpen = false}>Close</button>{#if loadTestCompleted}<button class="secondary-button" on:click={downloadLoadTestReport}><Download size={14} /> Download PDF report</button>{/if}<button class="primary-button" on:click={runLoadTest} disabled={!activeRequest?.url.trim()}>Start load test</button>{/if}
        </div>
      </div>
    </div>
  {/if}

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
      <div class="modal utility-modal" class:code-generator-modal={utilityModal === 'code'} role="dialog" aria-modal="true" aria-label={`${utilityModal} dialog`}>
        <div class="modal-header">
          <div><span class="modal-icon">{#if utilityModal === 'code'}<Code2 size={18} />{:else if utilityModal === 'variables'}<Braces size={18} />{:else if utilityModal === 'help'}<HelpCircle size={18} />{:else if utilityModal === 'settings'}<Settings2 size={18} />{:else}<Command size={18} />{/if}</span><div><strong>{utilityModal === 'code' ? 'Generate code' : utilityModal === 'variables' ? 'Resolved variables' : utilityModal === 'help' ? 'Postcall help' : utilityModal === 'settings' ? 'Application settings' : 'Command palette'}</strong><p>{utilityModal === 'code' ? 'Ready-to-run examples using the resolved URL, headers, authorization, and body.' : utilityModal === 'variables' ? 'Merged values and the scope supplying each one.' : utilityModal === 'help' ? 'Keyboard shortcuts and local workspace behavior.' : utilityModal === 'settings' ? 'Configure your local Postcall experience.' : 'Jump directly to a Postcall action.'}</p></div></div>
          <button class="icon-button" on:click={() => utilityModal = null} aria-label="Close dialog"><X size={17} /></button>
        </div>
        {#if utilityModal === 'code'}
          <div class="code-generator-body">
            <nav class="code-language-list" aria-label="Code language">
              {#each codeLanguageOptions as option}
                <button class:active={codeLanguage === option.id} on:click={() => selectCodeLanguage(option.id)}>
                  <span>{option.label}</span><small>{option.detail}</small>
                </button>
              {/each}
            </nav>
            <textarea class="generated-code" readonly wrap="off" spellcheck="false" value={generatedRequestCode(codeLanguage)} aria-label={`Generated ${codeLanguageOptions.find((option) => option.id === codeLanguage)?.label ?? 'request'} code`}></textarea>
          </div>
          <div class="modal-footer"><span class="code-generator-note">Generated from the fully resolved active request.</span><button class="secondary-button" on:click={() => utilityModal = null}>Close</button><button class="primary-button" on:click={copyGeneratedCode}>{codeCopied ? 'Copied' : `Copy ${codeLanguageOptions.find((option) => option.id === codeLanguage)?.label ?? 'code'}`}</button></div>
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
            <section><div class="settings-section-heading"><strong>Appearance</strong><small>Your selection is remembered on this device.</small></div><div class="theme-grid">{#each [['dark','Dark','#17191d'], ['light','Light','#f4f5f6'], ['midnight','Midnight','#0a1020'], ['forest','Forest','#0d1813'], ['ocean','Ocean','#091820']] as option}<button class:active={theme === option[0]} on:click={() => selectTheme(option[0] as AppTheme)}><i style={`background:${option[2]}`}></i><span>{option[1]}</span>{#if theme === option[0]}<Check size={13} />{/if}</button>{/each}</div></section>
            <section><div class="settings-section-heading"><strong>Local data</strong><small>Workspace content stays on this device.</small></div><div class="settings-action-row"><span><strong>Application data folder</strong><small>Reveal the database in your system file browser.</small></span><button class="secondary-button" on:click={revealStorage}>Open folder</button></div><div class="settings-action-row"><span><strong>Request history</strong><small>{workspace.history.length} locally stored requests.</small></span><button class="secondary-button" disabled={!workspace.history.length} on:click={() => { workspace.history = []; commitWorkspace(); showToast('History cleared'); }}>Clear history</button></div></section>
            <SyncSettings
              bind:this={syncSettingsRef}
              collections={workspace.collections}
              onMergeCollections={mergeSyncedCollections}
              onToast={showToast}
              bind:linkedRepo={gitLinkedRepo}
              bind:syncing={gitSyncing}
              bind:lastSyncLabel={gitLastSyncLabel}
              bind:conflicts={gitConflicts}
              bind:errors={gitErrors}
            />
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
