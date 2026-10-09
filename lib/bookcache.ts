/** 书本地缓存（IndexedDB）——下载过的书存本地，断网也能打开。
 *  按书 id 存原始字节；在 WKWebView（iOS Capacitor）与浏览器通用。 */

const DB_NAME = "inkshelf-books-cache";
const STORE = "files";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("no indexedDB"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getCachedBook(id: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const r = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
      r.onsuccess = () => resolve((r.result as ArrayBuffer) ?? null);
      r.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function putCachedBook(id: string, buf: ArrayBuffer): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(buf, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    /* 缓存失败不影响阅读 */
  }
}

/* 书的元数据（书名/作者/格式/路径/进度等）也缓存一份，离线时才有得读。
   行很小，用 localStorage 即可。 */
const META_PREFIX = "inkshelf-meta-";
export function putBookMeta(id: string, meta: unknown): void {
  try {
    localStorage.setItem(META_PREFIX + id, JSON.stringify(meta));
  } catch {
    /* 忽略 */
  }
}
export function getBookMeta<T>(id: string): T | null {
  try {
    const s = localStorage.getItem(META_PREFIX + id);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}
export function deleteBookMeta(id: string): void {
  try {
    localStorage.removeItem(META_PREFIX + id);
  } catch {
    /* 忽略 */
  }
}

export async function deleteCachedBook(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    /* 忽略 */
  }
}
