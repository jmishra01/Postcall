import { blankFormRow, blankRequest, blankRow, uid } from './types';
import type { ApiRequest, BodyMode, Collection, CollectionFolder, FormDataRow, KeyValue, RequestAuth } from './types';

type JsonObject = Record<string, unknown>;

const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback;

function rowsWithBlank(rows: KeyValue[]): KeyValue[] {
  return [...rows, blankRow()];
}

function formRowsWithBlank(rows: FormDataRow[]): FormDataRow[] {
  return [...rows, blankFormRow()];
}

function importedName(urlValue: string) {
  try {
    const url = new URL(/^https?:\/\//i.test(urlValue) ? urlValue : `https://${urlValue}`);
    const segment = url.pathname.split('/').filter(Boolean).at(-1);
    return segment ? decodeURIComponent(segment) : url.hostname || 'Imported request';
  } catch {
    return 'Imported request';
  }
}

export function parseCurlCommand(source: string): ApiRequest {
  const tokens = shellTokens(source.replace(/\\\r?\n/g, ' '));
  if (tokens[0] === '$') tokens.shift();
  if (!tokens.length || !/(^|[\\/])curl(?:\.exe)?$/i.test(tokens[0])) {
    throw new Error('Paste a cURL command beginning with curl.');
  }
  tokens.shift();

  let method = '';
  let url = '';
  const headers: KeyValue[] = [];
  const dataParts: string[] = [];
  const formData: FormDataRow[] = [];
  let basicCredentials = '';

  const take = (index: number, option: string) => {
    if (index + 1 >= tokens.length) throw new Error(`${option} requires a value.`);
    return tokens[index + 1];
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '-X' || token === '--request') {
      method = take(index, token).toUpperCase();
      index += 1;
    } else if (/^-X.+/.test(token)) {
      method = token.slice(2).toUpperCase();
    } else if (token.startsWith('--request=')) {
      method = token.slice('--request='.length).toUpperCase();
    } else if (token === '--url') {
      url = take(index, token);
      index += 1;
    } else if (token.startsWith('--url=')) {
      url = token.slice('--url='.length);
    } else if (token === '-H' || token === '--header') {
      headers.push(headerRow(take(index, token)));
      index += 1;
    } else if (token.startsWith('--header=')) {
      headers.push(headerRow(token.slice('--header='.length)));
    } else if (['-d', '--data', '--data-raw', '--data-binary', '--data-urlencode'].includes(token)) {
      dataParts.push(take(index, token));
      index += 1;
    } else if (/^--data(?:-raw|-binary|-urlencode)?=/.test(token)) {
      dataParts.push(token.slice(token.indexOf('=') + 1));
    } else if (token === '-F' || token === '--form') {
      formData.push(formRow(take(index, token)));
      index += 1;
    } else if (token.startsWith('--form=')) {
      formData.push(formRow(token.slice('--form='.length)));
    } else if (token === '-u' || token === '--user') {
      basicCredentials = take(index, token);
      index += 1;
    } else if (token.startsWith('--user=')) {
      basicCredentials = token.slice('--user='.length);
    } else if (token === '-A' || token === '--user-agent') {
      headers.push(headerRow(`User-Agent: ${take(index, token)}`));
      index += 1;
    } else if (token === '-b' || token === '--cookie') {
      headers.push(headerRow(`Cookie: ${take(index, token)}`));
      index += 1;
    } else if (!token.startsWith('-') && !url) {
      url = token;
    }
  }

  if (!url) throw new Error('The cURL command does not contain a URL.');
  const request = blankRequest(importedName(url));
  request.url = url;
  request.method = method || (dataParts.length || formData.length ? 'POST' : 'GET');
  request.headers = rowsWithBlank(headers);

  const authorizationIndex = headers.findIndex((row) => row.key.toLowerCase() === 'authorization');
  const authorization = authorizationIndex >= 0 ? headers[authorizationIndex].value : '';
  if (/^bearer\s+/i.test(authorization)) {
    request.auth = { type: 'bearer', token: authorization.replace(/^bearer\s+/i, ''), prefix: 'Bearer' };
    request.headers = rowsWithBlank(headers.filter((_, index) => index !== authorizationIndex));
  } else if (basicCredentials) {
    const separator = basicCredentials.indexOf(':');
    request.auth = {
      type: 'basic',
      username: separator >= 0 ? basicCredentials.slice(0, separator) : basicCredentials,
      password: separator >= 0 ? basicCredentials.slice(separator + 1) : ''
    };
  } else request.auth = { type: 'none' };

  if (formData.length) {
    request.bodyMode = 'form';
    request.formData = formRowsWithBlank(formData);
  } else if (dataParts.length) {
    request.body = dataParts.join('&');
    const contentType = headers.find((row) => row.key.toLowerCase() === 'content-type')?.value.toLowerCase() ?? '';
    request.bodyMode = contentType.includes('application/x-www-form-urlencoded') ? 'urlencoded' : inferRawMode(request.body, contentType);
    if (request.bodyMode === 'urlencoded') {
      request.formData = formRowsWithBlank([...new URLSearchParams(request.body)].map(([key, value]) => ({ ...blankFormRow(), key, value })));
    }
  }
  return request;
}

function shellTokens(source: string) {
  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | '' = '';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
      else if (character === '\\' && quote === '"' && index + 1 < source.length) current += source[++index];
      else current += character;
    } else if (character === "'" || character === '"') quote = character;
    else if (character === '\\' && index + 1 < source.length) current += source[++index];
    else if (/\s/.test(character)) {
      if (current) tokens.push(current);
      current = '';
    } else current += character;
  }
  if (quote) throw new Error('The cURL command contains an unclosed quote.');
  if (current) tokens.push(current);
  return tokens;
}

function headerRow(value: string): KeyValue {
  const separator = value.indexOf(':');
  if (separator < 1) throw new Error(`Invalid header: ${value}`);
  return { id: uid(), key: value.slice(0, separator).trim(), value: value.slice(separator + 1).trim(), enabled: true };
}

function formRow(value: string): FormDataRow {
  const separator = value.indexOf('=');
  if (separator < 1) throw new Error(`Invalid form field: ${value}`);
  const fieldValue = value.slice(separator + 1);
  const file = fieldValue.startsWith('@');
  return {
    id: uid(), key: value.slice(0, separator), value: file ? '' : fieldValue, enabled: true,
    kind: file ? 'file' : 'text', fileName: file ? fieldValue.slice(1) : undefined
  };
}

function inferRawMode(body: string, contentType: string): BodyMode {
  if (contentType.includes('json')) return 'json';
  if (contentType.includes('xml')) return 'xml';
  if (contentType.includes('html')) return 'html';
  if (contentType.includes('javascript')) return 'javascript';
  try { JSON.parse(body); return 'json'; } catch { return 'text'; }
}

export function parsePostmanCollection(source: string): Collection {
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { throw new Error('The selected file is not valid JSON.'); }
  const root = object(parsed);
  const info = object(root.info);
  const name = string(info.name, string(root.name, 'Imported Collection')).trim() || 'Imported Collection';
  if (!Array.isArray(root.item) && !Array.isArray(root.requests)) {
    throw new Error('This JSON file is not a Postman Collection v2 or v2.1 file.');
  }

  const collection: Collection = {
    id: uid(), name, description: descriptionText(info.description ?? root.description), expanded: true,
    variables: rowsWithBlank(variableRows(root.variable)), auth: postmanAuth(root.auth, false), requests: [], folders: []
  };
  visitItems(array(root.item), collection, []);
  return collection;
}

function visitItems(items: unknown[], collection: Collection, parents: string[]) {
  for (const itemValue of items) {
    const item = object(itemValue);
    const itemName = string(item.name, 'Imported request');
    if (Array.isArray(item.item)) {
      const path = [...parents, itemName];
      ensureFolder(collection, path, item);
      visitItems(item.item, collection, path);
    } else if (item.request) {
      const request = postmanRequest(itemName, item);
      if (!parents.length) collection.requests.push(request);
      else ensureFolder(collection, parents).requests.push(request);
    }
  }
}

function ensureFolder(collection: Collection, path: string[], item?: JsonObject): CollectionFolder {
  const name = path.join(' / ');
  let folder = collection.folders.find((candidate) => candidate.name === name);
  if (!folder) {
    folder = {
      id: uid(), name, expanded: true, variables: rowsWithBlank(variableRows(item?.variable)),
      auth: postmanAuth(item?.auth, true), requests: []
    };
    collection.folders.push(folder);
  }
  return folder;
}

function postmanRequest(name: string, item: JsonObject): ApiRequest {
  const source = item.request;
  const definition = typeof source === 'string' ? { url: source } : object(source);
  const request = blankRequest(name);
  request.method = string(definition.method, 'GET').toUpperCase();
  const importedUrl = postmanUrl(definition.url);
  request.url = stripQuery(importedUrl);
  request.params = rowsWithBlank(postmanQueryRows(definition.url, importedUrl));
  request.pathParams = rowsWithBlank(variableRows(object(definition.url).variable));
  request.headers = rowsWithBlank(array(definition.header).map((value) => {
    const header = object(value);
    return { id: uid(), key: string(header.key), value: string(header.value), description: descriptionText(header.description), enabled: !header.disabled };
  }).filter((row) => row.key));
  request.auth = postmanAuth(definition.auth, true);
  applyPostmanBody(request, object(definition.body));
  for (const eventValue of array(item.event)) {
    const event = object(eventValue);
    const script = object(event.script);
    const code = Array.isArray(script.exec) ? script.exec.map((line) => string(line)).join('\n') : string(script.exec);
    if (event.listen === 'prerequest') request.preRequestScript = code;
    if (event.listen === 'test') request.testScript = code;
  }
  return request;
}

function postmanUrl(value: unknown): string {
  if (typeof value === 'string') return value;
  const url = object(value);
  if (typeof url.raw === 'string') return url.raw;
  const protocol = string(url.protocol, 'https');
  const host = array(url.host).map((part) => string(part)).join('.');
  const path = array(url.path).map((part) => string(part)).join('/');
  const query = array(url.query).map((value) => object(value)).filter((item) => !item.disabled && item.key)
    .map((item) => `${encodeURIComponent(string(item.key))}=${encodeURIComponent(string(item.value))}`).join('&');
  return `${protocol}://${host}${path ? `/${path}` : ''}${query ? `?${query}` : ''}`;
}

function stripQuery(value: string): string {
  const queryIndex = value.indexOf('?');
  if (queryIndex < 0) return value;
  const hashIndex = value.indexOf('#', queryIndex);
  return `${value.slice(0, queryIndex)}${hashIndex >= 0 ? value.slice(hashIndex) : ''}`;
}

function postmanQueryRows(value: unknown, raw: string): KeyValue[] {
  const url = object(value);
  const defined = array(url.query).map((entry) => {
    const row = object(entry);
    return {
      id: uid(), key: string(row.key), value: string(row.value),
      description: descriptionText(row.description), enabled: !row.disabled
    };
  }).filter((row) => row.key);
  if (defined.length) return defined;
  const query = raw.split('?')[1]?.split('#')[0];
  if (!query) return [];
  return [...new URLSearchParams(query)].map(([key, value]) => ({ id: uid(), key, value, enabled: true }));
}

function applyPostmanBody(request: ApiRequest, body: JsonObject) {
  const mode = string(body.mode);
  if (mode === 'raw') {
    request.body = string(body.raw);
    const language = string(object(object(body.options).raw).language).toLowerCase();
    request.bodyMode = ({ json: 'json', xml: 'xml', html: 'html', javascript: 'javascript', text: 'text' } as Record<string, BodyMode>)[language]
      ?? inferRawMode(request.body, '');
  } else if (mode === 'urlencoded') {
    request.bodyMode = 'urlencoded';
    request.formData = formRowsWithBlank(postmanFormRows(body.urlencoded));
  } else if (mode === 'formdata') {
    request.bodyMode = 'form';
    request.formData = formRowsWithBlank(postmanFormRows(body.formdata));
  } else if (mode === 'graphql') {
    request.bodyMode = 'graphql';
    const graphql = object(body.graphql);
    request.body = string(graphql.query);
    request.graphqlVariables = string(graphql.variables, '{}');
  } else if (mode === 'file') {
    const source = string(object(body.file).src);
    request.bodyMode = 'binary';
    if (source) request.binaryFile = {
      fileName: source.split(/[\\/]/).at(-1) ?? source,
      mimeType: 'application/octet-stream',
      dataBase64: ''
    };
  }
}

function postmanFormRows(value: unknown): FormDataRow[] {
  return array(value).map((entry) => {
    const row = object(entry);
    const file = row.type === 'file';
    const src = Array.isArray(row.src) ? string(row.src[0]) : string(row.src);
    return {
      id: uid(), key: string(row.key), value: file ? '' : string(row.value), enabled: !row.disabled,
      description: descriptionText(row.description), kind: file ? 'file' as const : 'text' as const,
      fileName: file ? src.split(/[\\/]/).at(-1) : undefined
    };
  }).filter((row) => row.key);
}

function variableRows(value: unknown): KeyValue[] {
  return array(value).map((entry) => {
    const row = object(entry);
    return { id: uid(), key: string(row.key), value: string(row.value), description: descriptionText(row.description), enabled: !row.disabled };
  }).filter((row) => row.key);
}

function postmanAuth(value: unknown, inheritWhenMissing: boolean): RequestAuth {
  const auth = object(value);
  const type = string(auth.type);
  if (!type) return { type: inheritWhenMissing ? 'inherit' : 'none' };
  const entries = array(auth[type]).map((entry) => object(entry));
  const get = (key: string) => string(entries.find((entry) => entry.key === key)?.value);
  if (type === 'bearer' || type === 'oauth2') return { type, token: get('token') || get('accessToken'), prefix: 'Bearer' } as RequestAuth;
  if (type === 'basic') return { type: 'basic', username: get('username'), password: get('password') };
  if (type === 'apikey') return { type: 'api-key', key: get('key'), value: get('value'), placement: get('in') === 'query' ? 'query' : 'header' };
  if (type === 'noauth') return { type: 'none' };
  return { type: inheritWhenMissing ? 'inherit' : 'none' };
}

function descriptionText(value: unknown): string {
  if (typeof value === 'string') return value;
  return string(object(value).content);
}
