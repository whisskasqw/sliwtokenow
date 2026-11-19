// Хранилище фотографий в IndexedDB — данные остаются в браузере пользователя.

const DB_NAME = 'photo-sorter';
const STORE = 'photos';
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const result = fn(store);
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

// Ошибки записи (например, переполнение квоты) показываем пользователю.
export let onError = () => {};
export function setErrorHandler(fn) { onError = fn; }
const report = e => { console.warn(e); onError(e); };

export const db = {
  async all() {
    try { return (await tx('readonly', s => s.getAll())) || []; }
    catch (e) { report(e); return []; }
  },
  put(photo) { return tx('readwrite', s => s.put(photo)).catch(report); },
  remove(id) { return tx('readwrite', s => s.delete(id)).catch(report); },
  clear() { return tx('readwrite', s => s.clear()).catch(report); },
};
