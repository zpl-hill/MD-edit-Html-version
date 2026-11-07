/* platform.js — L4 基础设施：能力探测。所有访问均有异常保护，禁止白屏。 */
export async function detectCapabilities() {
  const result = { backend: 'memory', indexedDB: false, localStorage: false, persistent: false, reason: '' };

  try {
    localStorage.setItem('__mdsl_probe__', '1');
    localStorage.removeItem('__mdsl_probe__');
    result.localStorage = true;
  } catch (e) {
    result.reason += 'localStorage: ' + (e && e.name ? e.name : 'unavailable') + '; ';
  }

  try {
    result.indexedDB = await new Promise(resolve => {
      let done = false;
      const finish = value => { if (!done) { done = true; resolve(value); } };
      try {
        const request = indexedDB.open('__mdsl_probe_db__', 1);
        request.onsuccess = () => {
          try { request.result.close(); } catch (e) { /* ignore */ }
          try { indexedDB.deleteDatabase('__mdsl_probe_db__'); } catch (e) { /* ignore */ }
          finish(true);
        };
        request.onerror = () => finish(false);
        request.onblocked = () => finish(false);
        setTimeout(() => finish(false), 1500);
      } catch (e) { finish(false); }
    });
  } catch (e) {
    result.indexedDB = false;
    result.reason += 'indexedDB: ' + (e && e.name ? e.name : 'unavailable') + '; ';
  }

  if (result.indexedDB) result.backend = 'indexeddb';
  else if (result.localStorage) result.backend = 'localstorage';
  else result.backend = 'memory';

  result.persistent = result.backend !== 'memory';
  return result;
}

export function supportsCompression() {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

export function mmToPx(mm) {
  return mm * 96 / 25.4;
}
