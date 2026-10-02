const DB_NAME = "wgulinux-overlay";
const STORE_NAME = "files";

function storageName(path) {
  return path.replace(/^\/+/, "").replaceAll("/", "__");
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class OverlayStorage {
  constructor() { this.backend = "IndexedDB"; this.root = null; this.db = null; }

  async init() {
    if (navigator.storage?.getDirectory) {
      try { this.root = await navigator.storage.getDirectory(); this.backend = "OPFS"; return this; } catch { /* fallback below */ }
    }
    this.db = await openDatabase();
    return this;
  }

  async write(path, value) {
    if (this.root) {
      const handle = await this.root.getFileHandle(storageName(path), { create: true });
      const writable = await handle.createWritable();
      await writable.write(value);
      await writable.close();
      return;
    }
    await this.transaction("readwrite", store => store.put(value, path));
  }

  async read(path) {
    if (this.root) {
      try { return await (await this.root.getFileHandle(storageName(path))).getFile().then(file => file.text()); } catch { return null; }
    }
    return this.transaction("readonly", store => store.get(path));
  }

  async reset() {
    if (this.root) {
      for await (const [name] of this.root.entries()) await this.root.removeEntry(name);
      return;
    }
    await this.transaction("readwrite", store => store.clear());
  }

  transaction(mode, action) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      if (!request) { transaction.oncomplete = () => resolve(); return; }
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }
}
