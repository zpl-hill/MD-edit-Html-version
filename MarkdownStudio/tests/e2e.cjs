/** e2e.cjs — Edge CDP under file:// : load the built single-file app, capture errors and probe the UI. */
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = pathToFileURL('G:\\程序\\MD\\MarkdownStudio\\dist\\MarkdownStudioLite.html').href;
const PORT = 9421;
const profile = path.join(os.tmpdir(), 'mdsl-e2e-' + Date.now());
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank'
], { stdio: 'ignore', windowsHide: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise(res => {
  const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});
const errors = [], consoleMsgs = [], requests = [];

const PROBE = `(() => {
  const out = {};
  out.title = document.title;
  out.globals = {marked: typeof marked, Prism: typeof Prism, docx: typeof docx, temml: typeof temml, CM6: typeof CM6};
  out.modules = ['__mdsl_platform','__mdsl_icons','__mdsl_storage','__mdsl_parser','__mdsl_viewer','__mdsl_toc','__mdsl_print','__mdsl_exportDocx']
    .map(k => k + '=' + (typeof globalThis[k]));
  out.dom = {
    toolbar: !!document.querySelector('#toolbar'),
    tocTree: !!document.querySelector('#toc-tree'),
    editorHost: !!document.querySelector('#editor-host'),
    cmEditor: !!document.querySelector('.cm-editor'),
    cmContent: !!document.querySelector('.cm-content'),
    preview: !!document.querySelector('#preview'),
    statusBackend: (document.querySelector('#status-backend')||{}).textContent,
    statusText: (document.querySelector('#status-text')||{}).textContent,
    statusDoc: (document.querySelector('#status-doc')||{}).textContent,
    notices: !!document.querySelector('.third-party-notices'),
    noticeSections: document.querySelectorAll('.third-party-notices section').length,
    buttons: document.querySelectorAll('[data-action]').length
  };
  out.i18n = typeof globalThis.__MDSL_I18N;
  out.noticesData = (globalThis.__MDSL_NOTICES||[]).length;
  out.previewHtml = (document.querySelector('#preview')||{}).innerHTML?.slice(0,300);
  out.tocHtml = (document.querySelector('#toc-tree')||{}).innerHTML?.slice(0,300);
  out.banner = (document.querySelector('#banner')||{}).textContent;
  out.scripts = document.querySelectorAll('script').length;
  out.externalRefs = document.querySelectorAll('script[src],link[href],img[src]').length;
  return JSON.stringify(out, null, 1);
})()`;

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
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text + ' :: ' + (m.params.exceptionDetails?.exception?.description || '').slice(0, 400));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleMsgs.push((m.params.args||[]).map(a => a.value || a.description).join(' ').slice(0, 300));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleMsgs.push('[log] ' + m.params.entry.text.slice(0, 300));
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
  const t0 = Date.now();
  await send('Page.navigate', { url: FILE });
  await sleep(3500);
  const loadMs = Date.now() - t0;
  const r = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
  console.log('=== LOAD TIME (incl. 3.5s settle) ===', loadMs, 'ms');
  console.log('=== PROBE ===');
  console.log(r.result?.result?.value || JSON.stringify(r.result?.exceptionDetails || 'no result'));
  console.log('=== PAGE EXCEPTIONS (' + errors.length + ') ===');
  errors.slice(0, 20).forEach(e => console.log(' -', e));
  console.log('=== CONSOLE ERRORS (' + consoleMsgs.length + ') ===');
  consoleMsgs.slice(0, 20).forEach(e => console.log(' -', e));
  console.log('=== NETWORK REQUESTS (' + requests.length + ') ===');
  requests.slice(0, 20).forEach(e => console.log(' -', e));
})().catch(e => console.error('ERROR:', e.message)).finally(() => {
  try { ws && ws.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  setTimeout(() => process.exit(0), 300);
});
