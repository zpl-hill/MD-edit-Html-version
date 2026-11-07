/** e2e-extra.cjs — anchor fix, image viewer, TOC jump, shortcuts, theme persistence */
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const os = require('os');
const path = require('path');

const ROOT = 'G:\\程序\\MD\\MarkdownStudio';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = pathToFileURL(path.join(ROOT, 'dist', 'MarkdownStudioLite.html')).href;
const PORT = 9424;
const profile = path.join(os.tmpdir(), 'mdsl-extra-' + Date.now());
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank'
], { stdio: 'ignore', windowsHide: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map();
const send = (m, p = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
const errors = [];
async function ev(expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.result?.exceptionDetails) return { __error: (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text) };
  return r.result?.result?.value;
}
const log = (l, v) => console.log('\n=== ' + l + ' ===\n' + (typeof v === 'string' ? v : JSON.stringify(v, null, 1)));

const MD = [
  '# 标题一', '', '## 标题二 A', '', '正文段落。', '',
  '![示意](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==)',
  '', '## 标题二 B', '', '结尾。', ''
].join('\n');

(async () => {
  let url;
  for (let i = 0; i < 60; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = j.find(x => x.type === 'page'); if (p) { url = p.webSocketDebuggerUrl; break; } } catch (e) {}
    await sleep(200);
  }
  if (!url) throw new Error('CDP not ready');
  ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const f = pending.get(m.id); pending.delete(m.id); f(m); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: FILE }); await sleep(2500);

  log('ANCHOR FIX', await ev(`(() => {
    const v = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    v.dispatch({changes:{from:0,to:v.state.doc.length,insert:${JSON.stringify(MD)}}});
    return 'dispatched';
  })()`));
  await sleep(700);
  log('HEADING TEXT', await ev(`JSON.stringify({
    h1Text: document.querySelector('#preview h1').textContent,
    anchorText: document.querySelector('#preview h1 .mdsl-anchor').textContent,
    anchorPseudo: getComputedStyle(document.querySelector('#preview h1 .mdsl-anchor'),'::before').content,
    tocFirst: document.querySelector('#toc-tree .toc-link')?.textContent,
    headings: Array.from(document.querySelectorAll('#preview h1,#preview h2')).map(h=>h.textContent)
  })`));

  log('IMAGE VIEWER', await ev(`(() => {
    document.querySelector('#preview img[data-viewer]').click();
    const d = document.querySelector('.mdsl-lightbox');
    const before = d?.querySelector('.lightbox-scale')?.textContent;
    d.querySelector('[data-zoom="2"]').click();
    const after = d.querySelector('.lightbox-scale').textContent;
    d.querySelector('[data-fit]').click();
    const fit = d.querySelector('.lightbox-scale').textContent;
    d.querySelector('[data-close]').click();
    return JSON.stringify({opened: !!d, before, after, fit, closed: !d.classList.contains('open')});
  })()`));

  log('TOC JUMP', await ev(`(() => {
    const links = Array.from(document.querySelectorAll('#toc-tree .toc-link'));
    links[links.length-1].click();
    return JSON.stringify({status: document.querySelector('#status-text').textContent, linkCount: links.length, hash: location.hash, targetExists: !!document.getElementById(links[links.length-1].getAttribute('data-goto'))});
  })()`));

  log('SHORTCUT F6', await ev(`(() => {
    const modes = [];
    const snap = () => ['split','editor','reader'].find(m => document.body.classList.contains('view-' + m));
    modes.push(snap());
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'F6', bubbles:true}));
    modes.push(snap());
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'F6', bubbles:true}));
    modes.push(snap());
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'F6', bubbles:true}));
    modes.push(snap());
    return JSON.stringify({modes, status: document.querySelector('#status-text').textContent, statusView: document.querySelector('#status-view').textContent});
  })()`));

  log('SHORTCUT F8 + PREFS', await ev(`(() => {
    const before = document.documentElement.getAttribute('data-theme');
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'F8', bubbles:true}));
    return JSON.stringify({before, after: document.documentElement.getAttribute('data-theme'), status: document.querySelector('#status-text').textContent, prefKeys: Object.keys(localStorage).filter(k=>/pref|theme/i.test(k)), prefs: Object.keys(localStorage).map(k=>k+'='+String(localStorage.getItem(k)).slice(0,60))});
  })()`));

  log('HASH NAV', await ev(`(() => {
    const id = document.querySelector('#toc-tree .toc-link').getAttribute('data-goto');
    location.hash = '#' + encodeURIComponent(id);
    return JSON.stringify({hash: location.hash, status: document.querySelector('#status-text').textContent});
  })()`));

  log('EXCEPTIONS', errors.length ? errors : 'none');
})().catch(e => console.error('ERROR:', e.message, e.stack)).finally(() => {
  try { ws && ws.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  setTimeout(() => process.exit(0), 300);
});
