/**
 * Handle vault — IDB persistence of FileSystemDirectoryHandle.
 *
 * Browsers retain handle objects across reloads but require a user gesture to
 * re-grant write permission per session. We persist by `handle_key` (a stable
 * id chosen at world creation) so registry entries can re-link to their folder
 * on next session.
 *
 * The vault is the ONLY use of IndexedDB in atlas. World data lives in the folder.
 */

import { HANDLE_VAULT_DB, HANDLE_VAULT_STORE } from '../core/constants';
import { openDb, idbGet, idbPut, idbDelete, idbList } from './idb';

const DB_VERSION = 1;

async function db(): Promise<IDBDatabase> {
  return openDb(HANDLE_VAULT_DB, DB_VERSION, [{ name: HANDLE_VAULT_STORE }]);
}

/**
 * Store a handle under the given key. Overwrites any existing handle for that key.
 */
export async function storeHandle(handleKey: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const conn = await db();
  try {
    await idbPut(conn, HANDLE_VAULT_STORE, handle, handleKey);
  } finally {
    conn.close();
  }
}

/**
 * Retrieve a handle by key. Returns undefined if no handle stored for that key.
 *
 * NOTE: the returned handle is a reference to the underlying folder, but write
 * permission must be RE-REQUESTED per session via `handle.requestPermission({ mode: 'readwrite' })`.
 * Callers handle the permission dance separately.
 */
export async function loadHandle(handleKey: string): Promise<FileSystemDirectoryHandle | undefined> {
  const conn = await db();
  try {
    return await idbGet<FileSystemDirectoryHandle>(conn, HANDLE_VAULT_STORE, handleKey);
  } finally {
    conn.close();
  }
}

/**
 * Remove a handle from the vault. Used when a world is deleted from the registry.
 */
export async function deleteHandle(handleKey: string): Promise<void> {
  const conn = await db();
  try {
    await idbDelete(conn, HANDLE_VAULT_STORE, handleKey);
  } finally {
    conn.close();
  }
}

/**
 * List all stored handle keys. Useful for diagnostics / "forgotten worlds" recovery.
 */
export async function listHandleKeys(): Promise<string[]> {
  const conn = await db();
  try {
    const entries = await idbList<FileSystemDirectoryHandle>(conn, HANDLE_VAULT_STORE);
    return entries.map(e => String(e.key));
  } finally {
    conn.close();
  }
}

/**
 * Verify and (re-)request read-write permission on a handle. Returns true if
 * the handle is now writable. Must be called inside a user-gesture handler in
 * production; tests can bypass via OPFS (auto-granted).
 */
export async function ensureWritable(handle: FileSystemDirectoryHandle): Promise<boolean> {
  // queryPermission and requestPermission are spec but typed loosely in lib.dom.
  type PermAware = FileSystemDirectoryHandle & {
    queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
  };
  const h = handle as PermAware;
  const opts = { mode: 'readwrite' as const };
  if (h.queryPermission) {
    const state = await h.queryPermission(opts);
    if (state === 'granted') return true;
  }
  if (h.requestPermission) {
    const state = await h.requestPermission(opts);
    return state === 'granted';
  }
  // OPFS handles: no permission API; auto-granted.
  return true;
}
