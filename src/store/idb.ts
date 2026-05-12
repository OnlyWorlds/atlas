/**
 * Minimal promise-wrapped IndexedDB primitives.
 *
 * Atlas only uses IDB for the handle vault — persisting `FileSystemDirectoryHandle`
 * references across reloads. World data lives in the folder; this module exists
 * solely so we don't drag a full IDB wrapper library into the bundle.
 */

export interface IdbStoreSpec {
  name: string;
  /** Single store keyPath. Object-store treated as key/value if omitted. */
  keyPath?: string;
}

/**
 * Open (or upgrade) a database. Stores listed but missing are created.
 */
export function openDb(dbName: string, version: number, stores: IdbStoreSpec[]): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const spec of stores) {
        if (!db.objectStoreNames.contains(spec.name)) {
          db.createObjectStore(spec.name, spec.keyPath ? { keyPath: spec.keyPath } : undefined);
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function idbGet<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export function idbPut(db: IDBDatabase, store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const objectStore = tx.objectStore(store);
    const req = key === undefined ? objectStore.put(value) : objectStore.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function idbDelete(db: IDBDatabase, store: string, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function idbList<T>(db: IDBDatabase, store: string): Promise<Array<{ key: IDBValidKey; value: T }>> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).openCursor();
    const out: Array<{ key: IDBValidKey; value: T }> = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        out.push({ key: cursor.key, value: cursor.value as T });
        cursor.continue();
      } else {
        resolve(out);
      }
    };
    req.onerror = () => reject(req.error);
  });
}
