import type { Collection } from './types';
import {
  clearGitHubConfig,
  getGitHubConfig,
  pullCollections,
  pushCollections,
  setGitHubConfig,
  testGitHubConnection,
  type CollectionPush,
  type GitHubConfig
} from './github';

const SNAPSHOT_KEY = 'postcall.sync.snapshots';

type SnapshotMap = Record<string, string>;

function loadSnapshots(): SnapshotMap {
  try {
    return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? '{}') as SnapshotMap;
  } catch {
    return {};
  }
}

function saveSnapshots(snapshots: SnapshotMap): void {
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots));
}

async function hashCollection(collection: Collection): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(collection));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export type SyncConflict = {
  collectionId: string;
  local: Collection;
  remote: Collection;
};

export type SyncError = {
  collectionId: string;
  message: string;
};

export type SyncSummary = {
  /** New from remote, or fast-forwarded because the local copy hadn't changed — upsert these into the workspace. */
  merged: Collection[];
  /** Collection ids successfully pushed to GitHub. */
  pushed: string[];
  /** Local edits that raced a remote change on the same collection — ask the user to pick a side. */
  conflicts: SyncConflict[];
  /** Collections that didn't sync at all — a serialization, network, or GitHub API failure for that one item. */
  errors: SyncError[];
};

export async function isLinked(): Promise<boolean> {
  return (await getGitHubConfig()) !== null;
}

export async function getLinkedRepository(): Promise<GitHubConfig | null> {
  return getGitHubConfig();
}

export async function link(config: GitHubConfig, token: string): Promise<void> {
  await setGitHubConfig(config, token);
  try {
    await testGitHubConnection();
  } catch (error) {
    await clearGitHubConfig().catch(() => {});
    throw error;
  }
}

export async function unlink(): Promise<void> {
  await clearGitHubConfig();
  saveSnapshots({});
}

/**
 * Pulls remote changes, then pushes local collections that changed since their last
 * successful sync. A collection that changed on both sides comes back as a conflict
 * instead of being overwritten either direction.
 *
 * Deletions aren't synced yet: removing a collection locally or on GitHub doesn't
 * remove its counterpart on the other side.
 */
export async function sync(collections: Collection[]): Promise<SyncSummary> {
  const snapshots = loadSnapshots();
  const byId = new Map(collections.map((collection) => [collection.id, collection]));

  const localHashes = new Map<string, string>();
  await Promise.all(
    collections.map(async (collection) => {
      localHashes.set(collection.id, await hashCollection(collection));
    })
  );
  const isDirty = (id: string) => localHashes.get(id) !== snapshots[id];

  const merged: Collection[] = [];
  const conflicts: SyncConflict[] = [];
  const errors: SyncError[] = [];
  const claimedByPull = new Set<string>();

  const pulled = await pullCollections();
  for (const outcome of pulled) {
    if (outcome.outcome === 'error') {
      errors.push({ collectionId: outcome.collectionId, message: outcome.message ?? 'Pull failed for this collection.' });
      continue;
    }
    if (outcome.outcome !== 'updated' || !outcome.data) continue;
    claimedByPull.add(outcome.collectionId);
    const local = byId.get(outcome.collectionId);
    if (!local || !isDirty(outcome.collectionId)) {
      merged.push(outcome.data);
      snapshots[outcome.collectionId] = await hashCollection(outcome.data);
    } else {
      conflicts.push({ collectionId: outcome.collectionId, local, remote: outcome.data });
    }
  }

  const toPush: CollectionPush[] = collections
    .filter((collection) => !claimedByPull.has(collection.id) && isDirty(collection.id))
    .map((collection) => ({ id: collection.id, name: collection.name, data: collection }));

  const pushed: string[] = [];
  if (toPush.length) {
    const results = await pushCollections(toPush);
    for (const result of results) {
      if (result.outcome === 'pushed') {
        pushed.push(result.collectionId);
        snapshots[result.collectionId] = localHashes.get(result.collectionId)!;
      } else if (result.outcome === 'conflict' && result.remote) {
        const local = byId.get(result.collectionId);
        if (local) conflicts.push({ collectionId: result.collectionId, local, remote: result.remote });
      } else if (result.outcome === 'error') {
        errors.push({ collectionId: result.collectionId, message: result.message ?? 'Push failed for this collection.' });
      }
    }
  }

  saveSnapshots(snapshots);
  return { merged, pushed, conflicts, errors };
}

/**
 * Call once the user resolves a conflict.
 * - Picked remote: apply `conflict.remote` into the workspace, then call this with it.
 * - Picked local: keep the local collection as-is, then call `sync()` again — the
 *   conflicting push already recorded GitHub's current sha, so the retry lands cleanly.
 */
export async function resolveConflict(collection: Collection): Promise<void> {
  const snapshots = loadSnapshots();
  snapshots[collection.id] = await hashCollection(collection);
  saveSnapshots(snapshots);
}
