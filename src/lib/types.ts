export type KeyValue = {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
};

export type FormDataRow = KeyValue & {
  kind: 'text' | 'file';
  fileName?: string;
  mimeType?: string;
  dataBase64?: string;
};

export type BinaryFile = {
  fileName: string;
  mimeType: string;
  dataBase64: string;
};

export type BodyMode = 'none' | 'json' | 'text' | 'javascript' | 'html' | 'xml' | 'form' | 'urlencoded' | 'binary' | 'graphql';
export type AuthType = 'inherit' | 'none' | 'bearer' | 'jwt-bearer' | 'basic' | 'api-key' | 'oauth2';

export type RequestAuth = {
  type: AuthType;
  token?: string;
  username?: string;
  password?: string;
  key?: string;
  value?: string;
  placement?: 'header' | 'query';
  prefix?: string;
};

export type ApiRequest = {
  id: string;
  name: string;
  method: string;
  url: string;
  params: KeyValue[];
  pathParams: KeyValue[];
  headers: KeyValue[];
  bodyMode: BodyMode;
  body: string;
  formData: FormDataRow[];
  binaryFile?: BinaryFile;
  graphqlVariables: string;
  auth: RequestAuth;
  preRequestScript: string;
  testScript: string;
  timeoutMs: number;
  followRedirects: boolean;
  validateCertificates: boolean;
};

export type CollectionFolder = {
  id: string;
  name: string;
  expanded: boolean;
  variables: KeyValue[];
  auth: RequestAuth;
  requests: ApiRequest[];
};

export type Collection = {
  id: string;
  name: string;
  description: string;
  expanded: boolean;
  variables: KeyValue[];
  auth: RequestAuth;
  requests: ApiRequest[];
  folders: CollectionFolder[];
};

export type Environment = {
  id: string;
  name: string;
  variables: KeyValue[];
};

export type ResponseData = {
  status: number;
  statusText: string;
  headers: KeyValue[];
  body: string;
  contentType: string;
  elapsedMs: number;
  sizeBytes: number;
  url: string;
  timings?: {
    ttfbMs?: number;
    dnsMs?: number;
    connectMs?: number;
    tlsMs?: number;
  };
};

export type HistoryEntry = {
  id: string;
  request: ApiRequest;
  status?: number;
  elapsedMs?: number;
  createdAt: string;
};

export type JourneyExtractionSource = 'json' | 'header' | 'body' | 'status';

export type JourneyExtraction = {
  id: string;
  name: string;
  source: JourneyExtractionSource;
  path: string;
  template: string;
};

export type JourneyStep = {
  id: string;
  requestId: string;
  extractions: JourneyExtraction[];
};

export type Journey = {
  id: string;
  name: string;
  steps: JourneyStep[];
  stopOnError: boolean;
};

export type WorkspaceState = {
  collections: Collection[];
  environments: Environment[];
  activeEnvironmentId: string | null;
  history: HistoryEntry[];
  journeys: Journey[];
};

export type PostcallWorkspace = WorkspaceState & {
  id: string;
  name: string;
};

export type WorkspaceStore = {
  activeWorkspaceId: string;
  workspaces: PostcallWorkspace[];
};

export type RequestInput = {
  method: string;
  url: string;
  headers: Array<[string, string]>;
  body?: string;
  multipart?: Array<{
    name: string;
    value: string;
    kind: 'text' | 'file';
    fileName?: string;
    mimeType?: string;
    dataBase64?: string;
  }>;
  binary?: BinaryFile;
  timeoutMs: number;
  followRedirects: boolean;
  validateCertificates: boolean;
};

export const uid = () => crypto.randomUUID();

export const blankRow = (): KeyValue => ({
  id: uid(),
  key: '',
  value: '',
  enabled: true
});

export const blankFormRow = (): FormDataRow => ({
  ...blankRow(),
  kind: 'text'
});

export const blankRequest = (name = 'Untitled Request'): ApiRequest => ({
  id: uid(),
  name,
  method: 'GET',
  url: '',
  params: [blankRow()],
  pathParams: [blankRow()],
  headers: [blankRow()],
  bodyMode: 'none',
  body: '{\n  \n}',
  formData: [blankFormRow()],
  graphqlVariables: '{\n  \n}',
  auth: { type: 'inherit' },
  preRequestScript: '',
  testScript: '',
  timeoutMs: 30000,
  followRedirects: true,
  validateCertificates: true
});
