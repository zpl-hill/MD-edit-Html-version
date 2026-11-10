/* storage.js — StorageAdapter：IndexedDB 主 + localStorage 辅 + 内存降级（SDD 第 8 章）。
   所有外部存储访问均有异常保护；偏好与最近文件元数据始终走 localStorage（带 try/catch）。 */
import { detectCapabilities, supportsCompression } from "./platform.js";

const PREF_KEY = 'mdstudio.prefs';
const RECENT_KEY = 'mdstudio.recent';
const EMERGENCY_KEY = 'mdstudio.emergency';
const LS_DATA_KEY = 'mdstudio.data';
const MAX_RECENT = 10;
const LS_LIMIT = 3500000;

let capability = { backend: 'memory', indexedDB: false, localStorage: false, persistent: false, reason: '' };
const memoryPrefs = Object.create(null);
const memoryRecent = [];

export function currentCapability() { return capability; }

export function getPref(key, fallback) {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : fallback;
  } catch (e) {
    return Object.prototype.hasOwnProperty.call(memoryPrefs, key) ? memoryPrefs[key] : fallback;
  }
}

export function setPref(key, value) {
  memoryPrefs[key] = value;
  try {
    const raw = localStorage.getItem(PREF_KEY);
    const data = raw ? JSON.parse(raw) : {};
    data[key] = value;
    localStorage.setItem(PREF_KEY, JSON.stringify(data));
  } catch (e) { /* 内存兜底已写入 */ }
}

export function listRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) { return memoryRecent.slice(); }
}

export function touchRecent(meta) {
  const previous = listRecent().find(item => item.id === meta.id);
  const list = listRecent().filter(item => item.id !== meta.id);
  /* path 只有桌面版（Tauri）拿得到；浏览器 file:// 沙箱禁止网页记住绝对路径。
     若本次调用没带 path，沿用旧条目的，避免另存为/暂存时把路径抹掉。 */
  const path = meta.path || (previous && previous.path) || null;
  list.unshift({
    id: meta.id, name: meta.name, size: meta.size || 0, openedAt: Date.now(),
    source: meta.source || 'file', path
  });
  const trimmed = list.slice(0, MAX_RECENT);
  memoryRecent.length = 0;
  trimmed.forEach(item => memoryRecent.push(item));
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(trimmed)); } catch (e) { /* ignore */ }
  return trimmed;
}

function reqPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

class IdbBackend {
  constructor() { this.db = null; }
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mdstudio', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('documents')) {
          const store = db.createObjectStore('documents', { keyPath: 'id' });
          store.createIndex('by_updated', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('snapshots')) {
          const store = db.createObjectStore('snapshots', { keyPath: ['docId', 'at'] });
          store.createIndex('by_doc', 'docId');
        }
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.db;
  }
  async getDoc(id) {
    const db = await this.open();
    const tx = db.transaction('documents', 'readonly');
    const result = await reqPromise(tx.objectStore('documents').get(id));
    return result || null;
  }
  async putDoc(doc) {
    const db = await this.open();
    const tx = db.transaction('documents', 'readwrite');
    tx.objectStore('documents').put(doc);
    await txDone(tx);
  }
  async deleteDoc(id) {
    const db = await this.open();
    const tx = db.transaction('documents', 'readwrite');
    tx.objectStore('documents').delete(id);
    await txDone(tx);
  }
  async putSnapshot(snap) {
    const db = await this.open();
    const tx = db.transaction('snapshots', 'readwrite');
    tx.objectStore('snapshots').put(snap);
    await txDone(tx);
    try {
      const readTx = db.transaction('snapshots', 'readonly');
      const index = readTx.objectStore('snapshots').index('by_doc');
      const all = await reqPromise(index.getAll(IDBKeyRange.only(snap.docId)));
      all.sort((a, b) => b.at - a.at);
      if (all.length > 3) {
        const delTx = db.transaction('snapshots', 'readwrite');
        const store = delTx.objectStore('snapshots');
        all.slice(3).forEach(item => store.delete([item.docId, item.at]));
        await txDone(delTx);
      }
    } catch (e) { /* 裁剪失败不影响主流程 */ }
  }
  async latestSnapshot(docId) {
    const db = await this.open();
    const tx = db.transaction('snapshots', 'readonly');
    const index = tx.objectStore('snapshots').index('by_doc');
    const all = await reqPromise(index.getAll(IDBKeyRange.only(docId)));
    all.sort((a, b) => b.at - a.at);
    return all[0] || null;
  }
  async clearSnapshots(docId) {
    const db = await this.open();
    const tx = db.transaction('snapshots', 'readwrite');
    const store = tx.objectStore('snapshots');
    const all = await reqPromise(store.index('by_doc').getAll(IDBKeyRange.only(docId)));
    all.forEach(item => store.delete([item.docId, item.at]));
    await txDone(tx);
  }
}

function emptyLsState() { return { docs: {}, snaps: [] }; }

class LocalStorageBackend {
  read() {
    try {
      const raw = localStorage.getItem(LS_DATA_KEY);
      const data = raw ? JSON.parse(raw) : emptyLsState();
      return { docs: data.docs || {}, snaps: data.snaps || [] };
    } catch (e) { return emptyLsState(); }
  }
  write(state) {
    try {
      const text = JSON.stringify(state);
      if (text.length > LS_LIMIT) return false;
      localStorage.setItem(LS_DATA_KEY, text);
      return true;
    } catch (e) { return false; }
  }
  async getDoc(id) { return this.read().docs[id] || null; }
  async putDoc(doc) {
    const state = this.read(); state.docs[doc.id] = doc; return this.write(state);
  }
  async deleteDoc(id) {
    const state = this.read(); delete state.docs[id]; return this.write(state);
  }
  async putSnapshot(snap) {
    const state = this.read();
    state.snaps = state.snaps.filter(item => !(item.docId === snap.docId && item.at === snap.at));
    state.snaps.push(snap);
    state.snaps = state.snaps.filter(item => item.docId === snap.docId)
      .sort((a, b) => b.at - a.at).slice(0, 3)
      .concat(state.snaps.filter(item => item.docId !== snap.docId));
    return this.write(state);
  }
  async latestSnapshot(docId) {
    return this.read().snaps.filter(item => item.docId === docId).sort((a, b) => b.at - a.at)[0] || null;
  }
  async clearSnapshots(docId) {
    const state = this.read();
    state.snaps = state.snaps.filter(item => item.docId !== docId);
    return this.write(state);
  }
}

class MemoryBackend {
  constructor() { this.docs = Object.create(null); this.snaps = []; }
  async getDoc(id) { return this.docs[id] || null; }
  async putDoc(doc) { this.docs[doc.id] = doc; return true; }
  async deleteDoc(id) { delete this.docs[id]; return true; }
  async putSnapshot(snap) {
    this.snaps.push(snap);
    this.snaps = this.snaps.filter(item => item.docId === snap.docId).sort((a, b) => b.at - a.at).slice(0, 3)
      .concat(this.snaps.filter(item => item.docId !== snap.docId));
    return true;
  }
  async latestSnapshot(docId) {
    return this.snaps.filter(item => item.docId === docId).sort((a, b) => b.at - a.at)[0] || null;
  }
  async clearSnapshots(docId) {
    this.snaps = this.snaps.filter(item => item.docId !== docId); return true;
  }
}

export async function createStorageAdapter() {
  capability = await detectCapabilities();
  let backend;
  if (capability.backend === 'indexeddb') backend = new IdbBackend();
  else if (capability.backend === 'localstorage') backend = new LocalStorageBackend();
  else backend = new MemoryBackend();

  const wrap = (name, fallback) => async (...args) => {
    try { return await backend[name](...args); }
    catch (e) {
      console.warn('[storage] ' + name + ' 失败，降级到内存后端:', e && e.message);
      if (!(backend instanceof MemoryBackend)) backend = new MemoryBackend();
      try { return await backend[name](...args); } catch (e2) { return fallback; }
    }
  };

  return {
    capability: () => capability,
    getDoc: wrap('getDoc', null),
    putDoc: wrap('putDoc', false),
    deleteDoc: wrap('deleteDoc', false),
    putSnapshot: wrap('putSnapshot', false),
    latestSnapshot: wrap('latestSnapshot', null),
    clearSnapshots: wrap('clearSnapshots', false)
  };
}

async function gzipBase64(text) {
  if (!supportsCompression()) return null;
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    const buffer = await new Response(stream).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  } catch (e) { return null; }
}

async function gunzipBase64(encoded) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

export async function putEmergencyDraft(content, name) {
  const payload = { at: Date.now(), name: name || '', compressed: false, truncated: false, content: '' };
  const compressed = await gzipBase64(content);
  if (compressed && compressed.length <= 1400000) {
    payload.content = compressed; payload.compressed = true;
  } else {
    payload.content = String(content).slice(0, 900000);
    payload.truncated = String(content).length > 900000;
  }
  try { localStorage.setItem(EMERGENCY_KEY, JSON.stringify(payload)); return true; }
  catch (e) { return false; }
}

export function putEmergencyDraftSync(content, name) {
  try {
    const text = String(content).slice(0, 900000);
    localStorage.setItem(EMERGENCY_KEY, JSON.stringify({
      at: Date.now(), name: name || '', compressed: false,
      truncated: String(content).length > 900000, content: text
    }));
    return true;
  } catch (e) { return false; }
}

export async function readEmergencyDraft() {
  try {
    const raw = localStorage.getItem(EMERGENCY_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (payload.compressed) payload.content = await gunzipBase64(payload.content);
    return payload;
  } catch (e) { return null; }
}

export function clearEmergencyDraft() {
  try { localStorage.removeItem(EMERGENCY_KEY); } catch (e) { /* ignore */ }
}
