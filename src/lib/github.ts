import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './bridge';
import type { Collection } from './types';

export type GitHubConfig = {
  owner: string;
  repo: string;
  branch: string;
};

export type CollectionPush = {
  id: string;
  name: string;
  data: Collection;
};

export type CollectionPullOutcome = {
  collectionId: string;
  file: string;
  outcome: 'updated' | 'unchanged' | 'error';
  data: Collection | null;
  message: string | null;
};

export type CollectionPushOutcome = {
  collectionId: string;
  outcome: 'pushed' | 'conflict' | 'error';
  remote: Collection | null;
  message: string | null;
};

function requireTauri(): void {
  if (!isTauri()) throw new Error('GitHub sync is only available in the desktop app.');
}

export async function setGitHubConfig(config: GitHubConfig, token: string): Promise<void> {
  requireTauri();
  await invoke('github_set_config', { config, token });
}

export async function getGitHubConfig(): Promise<GitHubConfig | null> {
  if (!isTauri()) return null;
  return invoke<GitHubConfig | null>('github_get_config');
}

export async function clearGitHubConfig(): Promise<void> {
  requireTauri();
  await invoke('github_clear_config');
}

export async function testGitHubConnection(): Promise<void> {
  requireTauri();
  await invoke('github_test_connection');
}

export async function pullCollections(): Promise<CollectionPullOutcome[]> {
  requireTauri();
  return invoke<CollectionPullOutcome[]>('github_pull');
}

export async function pushCollections(collections: CollectionPush[]): Promise<CollectionPushOutcome[]> {
  requireTauri();
  return invoke<CollectionPushOutcome[]>('github_push', { collections });
}
