import { invoke } from '@tauri-apps/api/core';
import type { RequestInput, ResponseData, WorkspaceState, WorkspaceStore } from './types';

export const isTauri = () => '__TAURI_INTERNALS__' in window;

export async function executeRequest(input: RequestInput): Promise<ResponseData> {
  if (isTauri()) {
    return invoke<ResponseData>('execute_http', { input });
  }

  const started = performance.now();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    let requestBody: BodyInit | undefined = input.body;
    if (input.multipart?.length) {
      const form = new FormData();
      for (const field of input.multipart) {
        if (field.kind === 'file' && field.dataBase64) {
          form.append(field.name, base64ToBlob(field.dataBase64, field.mimeType), field.fileName ?? 'upload.bin');
        } else form.append(field.name, field.value);
      }
      requestBody = form;
    } else if (input.binary?.dataBase64) {
      requestBody = base64ToBlob(input.binary.dataBase64, input.binary.mimeType);
    }
    const response = await fetch(input.url, {
      method: input.method,
      headers: Object.fromEntries(input.headers),
      body: ['GET', 'HEAD'].includes(input.method.toUpperCase()) ? undefined : requestBody,
      redirect: input.followRedirects ? 'follow' : 'manual',
      signal: controller.signal
    });
    const ttfbMs = Math.round(performance.now() - started);
    const body = await response.text();
    const resource = performance.getEntriesByName(response.url, 'resource').at(-1) as PerformanceResourceTiming | undefined;
    return {
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()].map(([key, value], index) => ({
        id: `response-header-${index}`,
        key,
        value,
        enabled: true
      })),
      body,
      contentType: response.headers.get('content-type') ?? '',
      elapsedMs: Math.round(performance.now() - started),
      sizeBytes: new TextEncoder().encode(body).byteLength,
      url: response.url,
      timings: {
        ttfbMs,
        dnsMs: resource ? Math.max(0, Math.round(resource.domainLookupEnd - resource.domainLookupStart)) : undefined,
        connectMs: resource ? Math.max(0, Math.round(resource.connectEnd - resource.connectStart)) : undefined,
        tlsMs: resource?.secureConnectionStart ? Math.max(0, Math.round(resource.connectEnd - resource.secureConnectionStart)) : undefined
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

function base64ToBlob(data: string, mimeType = 'application/octet-stream') {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

export async function loadWorkspace(): Promise<WorkspaceStore | WorkspaceState | null> {
  if (!isTauri()) return null;
  return invoke<WorkspaceStore | WorkspaceState | null>('load_workspace');
}

export async function saveWorkspace(workspace: WorkspaceStore): Promise<void> {
  localStorage.setItem('postcall.workspace', JSON.stringify(workspace));
  if (isTauri()) await invoke('save_workspace', { workspace });
}

export async function getStoragePath(): Promise<string> {
  if (!isTauri()) return 'Browser localStorage · postcall.workspace';
  return invoke<string>('get_storage_path');
}

export async function openStorageLocation(): Promise<void> {
  if (!isTauri()) throw new Error('The storage folder is only available in the desktop app.');
  await invoke('open_storage_location');
}

export type ProcessMetrics = { memoryBytes: number; cpuPercent: number; storageBytes: number };

export async function getProcessMetrics(): Promise<ProcessMetrics | null> {
  if (!isTauri()) return null;
  return invoke<ProcessMetrics>('get_process_metrics');
}

export function loadBrowserWorkspace(): WorkspaceStore | WorkspaceState | null {
  const saved = localStorage.getItem('postcall.workspace');
  if (!saved) return null;
  try {
    return JSON.parse(saved) as WorkspaceStore | WorkspaceState;
  } catch {
    return null;
  }
}
