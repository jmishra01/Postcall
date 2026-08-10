import { blankFormRow, blankRequest, blankRow, uid } from './types';
import type { ApiRequest, Collection, FormDataRow, Journey, PostcallWorkspace, WorkspaceState, WorkspaceStore } from './types';

export const starterRequest = (): ApiRequest => ({
  id: uid(),
  name: 'Echo request',
  method: 'GET',
  url: 'https://httpbin.org/anything',
  params: [
    { id: uid(), key: 'source', value: 'postcall', enabled: true },
    blankRow()
  ],
  pathParams: [blankRow()],
  headers: [
    { id: uid(), key: 'Accept', value: 'application/json', enabled: true },
    blankRow()
  ],
  bodyMode: 'none',
  body: '{\n  "hello": "world"\n}',
  formData: [blankFormRow()],
  graphqlVariables: '{\n  \n}',
  auth: { type: 'none' },
  preRequestScript: '// Runs before the request\n',
  testScript: '// Add response assertions here\n// pm.test("Status is 200", () => pm.response.to.have.status(200));\n',
  timeoutMs: 30000,
  followRedirects: true,
  validateCertificates: true
});

export const initialWorkspace = (): PostcallWorkspace => ({
  id: uid(),
  name: 'My Workspace',
  collections: [
    {
      id: uid(),
      name: 'Postcall examples',
      description: 'A starter collection to explore Postcall.',
      expanded: true,
      variables: [blankRow()],
      auth: { type: 'none' },
      requests: [starterRequest()],
      folders: []
    }
  ],
  environments: [
    {
      id: uid(),
      name: 'Development',
      variables: [
        { id: uid(), key: 'baseUrl', value: 'https://httpbin.org', enabled: true },
        blankRow()
      ]
    }
  ],
  activeEnvironmentId: null,
  history: [],
  journeys: []
});

export const blankWorkspace = (name: string): PostcallWorkspace => ({
  id: uid(),
  name,
  collections: [],
  environments: [],
  activeEnvironmentId: null,
  history: [],
  journeys: []
});

export const initialWorkspaceStore = (): WorkspaceStore => {
  const workspace = initialWorkspace();
  return { activeWorkspaceId: workspace.id, workspaces: [workspace] };
};

export function normalizeWorkspace(value: WorkspaceState, fallbackName = 'My Workspace'): PostcallWorkspace {
  const stored = value as Partial<PostcallWorkspace>;
  return {
    id: stored.id ?? uid(),
    name: stored.name?.trim() || fallbackName,
    collections: (value.collections ?? []).map(normalizeCollection),
    environments: value.environments ?? [],
    activeEnvironmentId: value.activeEnvironmentId ?? null,
    history: (value.history ?? []).slice(0, 200),
    journeys: ((stored.journeys ?? []) as Journey[]).map((journey) => ({
      id: journey.id ?? uid(),
      name: journey.name?.trim() || 'Untitled journey',
      stopOnError: journey.stopOnError ?? true,
      steps: (journey.steps ?? []).map((step) => ({
        id: step.id ?? uid(),
        requestId: step.requestId ?? '',
        extractions: (step.extractions ?? []).map((extraction) => ({
          id: extraction.id ?? uid(),
          name: extraction.name ?? '',
          source: extraction.source ?? 'json',
          path: extraction.path ?? '',
          template: extraction.template ?? '{{value}}'
        }))
      }))
    }))
  };
}

export function normalizeWorkspaceStore(value: WorkspaceStore | WorkspaceState | null): WorkspaceStore {
  if (!value) return initialWorkspaceStore();
  const possibleStore = value as Partial<WorkspaceStore>;
  if (Array.isArray(possibleStore.workspaces)) {
    const workspaces = possibleStore.workspaces.map((workspace, index) => normalizeWorkspace(workspace, `Workspace ${index + 1}`));
    if (!workspaces.length) return initialWorkspaceStore();
    const activeWorkspaceId = workspaces.some((workspace) => workspace.id === possibleStore.activeWorkspaceId)
      ? possibleStore.activeWorkspaceId!
      : workspaces[0].id;
    return { activeWorkspaceId, workspaces };
  }
  const migrated = normalizeWorkspace(value as WorkspaceState, 'My Workspace');
  return { activeWorkspaceId: migrated.id, workspaces: [migrated] };
}

function normalizeCollection(collection: Collection): Collection {
  return {
    ...collection,
    variables: collection.variables?.length ? collection.variables : [blankRow()],
    auth: collection.auth ?? { type: 'none' },
    requests: (collection.requests ?? []).map(normalizeRequest),
    folders: (collection.folders ?? []).map((folder) => ({
      ...folder,
      expanded: folder.expanded ?? true,
      variables: folder.variables?.length ? folder.variables : [blankRow()],
      auth: folder.auth ?? { type: 'inherit' },
      requests: (folder.requests ?? []).map(normalizeRequest)
    }))
  };
}

export function normalizeRequest(request: ApiRequest): ApiRequest {
  const defaults = blankRequest(request.name);
  return {
    ...defaults,
    ...request,
    params: request.params?.length ? request.params : [blankRow()],
    pathParams: request.pathParams?.length ? request.pathParams : [blankRow()],
    headers: request.headers?.length ? request.headers : [blankRow()],
    formData: request.formData?.length
      ? request.formData.map((row) => ({ ...row, kind: (row as FormDataRow).kind ?? 'text' }))
      : [blankFormRow()],
    graphqlVariables: request.graphqlVariables ?? '{\n  \n}',
    auth: request.auth ?? { type: 'inherit' }
  };
}
