/** e2e-persistence.cjs — autosave / crash recovery / recent files under Edge file:// */
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = 'G:\\程序\\MD\\MarkdownStudio';
const DIST = path.join(ROOT, 'dist');
const DOWNLOADS = path.join(DIST, 'downloads');
fs.mkdirSync(DOWNLOADS, { recursive: true });
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = pathToFileURL(path.join(DIST, 'MarkdownStudioLite.html')).href;
const PORT = 9423;
const profile = path.join(os.tmpdir(), 'mdsl-persist-' + Date.now());
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank'
], { stdio: 'ignore', windowsHide: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise(res => {
  const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});
const errors = [];
async function evaluate(expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.text + ' :: ' + (r.result.exceptionDetails.exception?.description || '') };
  return r.result?.result?.value;
}
function log(label, value) { console.log('\n=== ' + label + ' ===\n' + (typeof value === 'string' ? value : JSON.stringify(value, null, 1))); }

const MARK = 'RECOVERY-MARK-9527';
const MD = '# 草稿恢复测试\n\n这是用于验证异常关闭恢复的唯一标记：' + MARK + '\n\n## 第二节\n\n内容包含表格与公式 $x^2$。\n';

(async () => {
  let url;
  for (let i = 0; i < 60; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = j.find(x => x.type === 'page'); if (p) { url = p.webSocketDebuggerUrl; break; } } catch (e) {}
    await sleep(200);
  }
  if (!url) throw new Error('CDP not ready');
  ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const f = pending.get(m.id); pending.delete(m.id); f(m); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text + ' :: ' + (m.params.exceptionDetails?.exception?.description || '').slice(0, 300));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });
  await send('Page.navigate', { url: FILE });
  await sleep(2500);

  log('INITIAL', await evaluate(`JSON.stringify({
    backend: document.querySelector('#status-backend').textContent,
    banner: document.querySelector('#banner').textContent,
    lsKeys: Object.keys(localStorage),
    hasMark: CM6.EditorView.findFromDOM(document.querySelector('.cm-editor')).state.doc.toString().includes(${JSON.stringify(MARK)})
  })`));

  // --- edit ---
  log('EDIT', await evaluate(`(() => {
    const v = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    v.dispatch({changes:{from:0,to:v.state.doc.length,insert:${JSON.stringify(MD)}}});
    return 'len=' + v.state.doc.length;
  })()`));
  await sleep(500);

  // --- 30s interval autosave: wait it out for real ---
  console.log('\n[waiting 31s for the 30s autosave interval ...]');
  await sleep(31000);
  log('AUTOSAVE STATUS', await evaluate(`JSON.stringify({
    save: document.querySelector('#status-save').textContent,
    status: document.querySelector('#status-text').textContent,
    lsKeys: Object.keys(localStorage)
  })`));

  log('INDEXEDDB SNAPSHOTS', await evaluate(`(async () => {
    const dbs = (indexedDB.databases ? await indexedDB.databases() : []).map(d=>d.name);
    const out = {databases: dbs};
    const dbName = dbs.find(n=>/mdsl|markdown/i.test(n)) || dbs[0];
    if (dbName) {
      const db = await new Promise((res,rej)=>{const r=indexedDB.open(dbName); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);});
      out.stores = Array.from(db.objectStoreNames);
      for (const s of db.objectStoreNames) {
        const count = await new Promise(res=>{const tx=db.transaction(s,'readonly'); const q=tx.objectStore(s).count(); q.onsuccess=()=>res(q.result); q.onerror=()=>res('err');});
        out[s+'Count'] = count;
      }
      db.close();
    }
    return JSON.stringify(out);
  })()`, true));

  // --- pagehide emergency draft, then reload ---
  log('PAGEHIDE', await evaluate(`(() => {
    window.dispatchEvent(new Event('pagehide'));
    return JSON.stringify({lsKeys: Object.keys(localStorage), draftPreview: Object.keys(localStorage).filter(k=>/draft|emergency/i.test(k)).map(k=>localStorage.getItem(k).slice(0,120))});
  })()`));

  await send('Page.reload', { ignoreCache: true });
  await sleep(2800);
  log('AFTER RELOAD', await evaluate(`JSON.stringify({
    bannerVisible: document.querySelector('#banner').classList.contains('visible'),
    bannerText: document.querySelector('#banner').textContent,
    buttons: Array.from(document.querySelectorAll('#banner button')).map(b=>b.textContent),
    editorHasMark: CM6.EditorView.findFromDOM(document.querySelector('.cm-editor')).state.doc.toString().includes(${JSON.stringify(MARK)}),
    previewHasMark: document.querySelector('#preview').textContent.includes(${JSON.stringify(MARK)}),
    backend: document.querySelector('#status-backend').textContent
  })`));

  log('CLICK RESTORE', await evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('#banner button')).find(b=>b.textContent.includes('恢复'));
    if (!btn) return 'NO RESTORE BUTTON';
    btn.click();
    return JSON.stringify({
      editorHasMark: CM6.EditorView.findFromDOM(document.querySelector('.cm-editor')).state.doc.toString().includes(${JSON.stringify(MARK)}),
      previewHasMark: document.querySelector('#preview').textContent.includes(${JSON.stringify(MARK)}),
      status: document.querySelector('#status-text').textContent,
      bannerVisible: document.querySelector('#banner').classList.contains('visible')
    });
  })()`));
  await sleep(500);
  log('PREVIEW AFTER RESTORE', await evaluate(`document.querySelector('#preview').textContent.slice(0, 160)`));

  // --- save .md + recent list + IndexedDB doc ---
  log('SAVE', await evaluate(`(() => {
    document.querySelector('[data-action="save"]').click();
    return JSON.stringify({status: document.querySelector('#status-text').textContent, save: document.querySelector('#status-save').textContent});
  })()`));
  await sleep(1200);
  log('RECENT LIST', await evaluate(`document.querySelector('#recent-list').textContent`));
  log('RECENT CLICK', await evaluate(`(async () => {
    const b = document.querySelector('#recent-list [data-id]');
    if (!b) return 'NO RECENT ITEM';
    b.click();
    await new Promise(r=>setTimeout(r,400));
    return JSON.stringify({status: document.querySelector('#status-text').textContent, hasMark: CM6.EditorView.findFromDOM(document.querySelector('.cm-editor')).state.doc.toString().includes(${JSON.stringify(MARK)})});
  })()`, true));

  log('EXCEPTIONS', errors.length ? errors : 'none');
  const files = fs.readdirSync(DOWNLOADS).filter(f => !f.endsWith('.crdownload'));
  log('DOWNLOADS', files.map(f => ({ name: f, size: fs.statSync(path.join(DOWNLOADS, f)).size })));
})().catch(e => console.error('ERROR:', e.message, e.stack)).finally(() => {
  try { ws && ws.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  setTimeout(() => process.exit(0), 300);
});
