/** e2e-perf.cjs — large document performance (100k lines) under Edge file:// */
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const os = require('os');
const path = require('path');

const ROOT = 'G:\\程序\\MD\\MarkdownStudio';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = pathToFileURL(path.join(ROOT, 'dist', 'MarkdownStudioLite.html')).href;
const PORT = 9425;
const profile = path.join(os.tmpdir(), 'mdsl-perf-' + Date.now());
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--enable-precise-memory-info', '--js-flags=--max-old-space-size=1024',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank'
], { stdio: 'ignore', windowsHide: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map();
const send = (m, p = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
const errors = [];
async function ev(expression, awaitPromise = false, timeoutMs = 60000) {
  const call = send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  const r = await Promise.race([call, sleep(timeoutMs).then(() => ({ __timeout: true }))]);
  if (r.__timeout) return { __error: 'evaluate timeout ' + timeoutMs + 'ms' };
  if (r.result?.exceptionDetails) return { __error: (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 500) };
  return r.result?.result?.value;
}
const log = (l, v) => console.log('\n=== ' + l + ' ===\n' + (typeof v === 'string' ? v : JSON.stringify(v, null, 1)));

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
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').slice(0, 300));
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Performance.enable');
  await send('Page.navigate', { url: FILE }); await sleep(2500);

  log('BASELINE MEM', await ev(`JSON.stringify({heapMB: Math.round((performance.memory?.usedJSHeapSize||0)/1048576), status: document.querySelector('#status-doc').textContent})`));

  // Generate 100k lines in-page (no huge CDP payload).
  log('GENERATE 100k LINES', await ev(`(() => {
    const t = performance.now();
    const parts = new Array(100000);
    for (let i = 0; i < 100000; i++) {
      parts[i] = (i % 500 === 0 ? '## Section ' + i + '\\n' : '') +
        'Line ' + i + ': Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.';
    }
    globalThis.__BIG = parts.join('\\n');
    return JSON.stringify({ms: Math.round(performance.now()-t), chars: globalThis.__BIG.length, mb: +(new Blob([globalThis.__BIG]).size/1048576).toFixed(2), lines: globalThis.__BIG.split('\\n').length});
  })()`));

  // Dispatch into CM6 and time the synchronous editor + onChange path.
  log('DISPATCH (sync editor + onChange)', await ev(`(() => {
    const v = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    const t = performance.now();
    v.dispatch({changes:{from:0,to:v.state.doc.length,insert:globalThis.__BIG}});
    return JSON.stringify({ms: Math.round(performance.now()-t), docLength: v.state.doc.length, statusDoc: document.querySelector('#status-doc').textContent});
  })()`, false, 90000));

  // Wait for the debounced/idle preview render, poll for completion.
  log('PREVIEW RENDER WAIT', await ev(`(async () => {
    const p = document.querySelector('#preview');
    const t = performance.now();
    let last = -1, stable = 0;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 250));
      const n = p.childElementCount;
      if (n === last && n > 0) stable++; else stable = 0;
      last = n;
      if (stable >= 4) break;
    }
    return JSON.stringify({
      elapsedMs: Math.round(performance.now()-t),
      childElements: p.childElementCount,
      htmlMB: +(p.innerHTML.length/1048576).toFixed(2),
      status: document.querySelector('#status-text').textContent,
      statusDoc: document.querySelector('#status-doc').textContent,
      tocItems: document.querySelectorAll('#toc-tree .toc-item').length,
      heapMB: Math.round((performance.memory?.usedJSHeapSize||0)/1048576)
    });
  })()`, true, 90000));

  // A single-character edit responsiveness on the large document.
  log('SMALL EDIT ON BIG DOC', await ev(`(async () => {
    const v = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    const t = performance.now();
    v.dispatch({changes:{from:v.state.doc.length, to:v.state.doc.length, insert:'\\nEND'}});
    const syncMs = performance.now()-t;
    await new Promise(r=>setTimeout(r,600));
    return JSON.stringify({syncMs: +syncMs.toFixed(1), hasEnd: v.state.doc.toString().endsWith('END'), statusDoc: document.querySelector('#status-doc').textContent, heapMB: Math.round((performance.memory?.usedJSHeapSize||0)/1048576)});
  })()`, true, 90000));

  const metrics = await send('Performance.getMetrics');
  const m = (metrics.result?.metrics || []).reduce((a, x) => (a[x.name] = x.value, a), {});
  log('CDP METRICS', { JSHeapUsedSizeMB: Math.round((m.JSHeapUsedSize || 0) / 1048576), JSHeapTotalSizeMB: Math.round((m.JSHeapTotalSize || 0) / 1048576), Nodes: m.Nodes, Documents: m.Documents });
  log('EXCEPTIONS', errors.length ? errors.slice(0, 5) : 'none');
})().catch(e => console.error('ERROR:', e.message, e.stack)).finally(() => {
  try { ws && ws.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  setTimeout(() => process.exit(0), 300);
});
