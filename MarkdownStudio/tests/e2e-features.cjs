/** e2e-features.cjs — functional test of the built single-file app under Edge file:// */
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
const PORT = 9422;
const profile = path.join(os.tmpdir(), 'mdsl-feat-' + Date.now());
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank'
], { stdio: 'ignore', windowsHide: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise(res => {
  const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});
const errors = [], consoleErrs = [], requests = [];
async function evaluate(expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.text + ' :: ' + (r.result.exceptionDetails.exception?.description || '') };
  return r.result?.result?.value;
}
function log(label, value) { console.log('\n=== ' + label + ' ===\n' + (typeof value === 'string' ? value : JSON.stringify(value, null, 1))); }

const MD = [
  '# 8D Report — 客户投诉分析',
  '',
  '## 1. 问题描述',
  '',
  '客户反馈 **批次 A-2026** 存在尺寸偏差，涉及 120 件产品。',
  '',
  '| 项目 | 数值 | 判定 |',
  '| --- | --- | --- |',
  '| 样本数 | 120 | OK |',
  '| 超差数 | 7 | NG |',
  '| GRR | 8.4% | OK |',
  '',
  '### 1.1 测量系统',
  '',
  '量具分辨率 0.001 mm，评价人 3 名，重复测量 3 次。',
  '',
  '```javascript',
  'const grr = Math.sqrt(ev ** 2 + av ** 2);',
  'console.log("GRR =", grr.toFixed(2));',
  '```',
  '',
  '行内公式 $E = mc^2$，独立公式：',
  '',
  '$$\\text{GRR} = \\sqrt{\\sigma_{EV}^2 + \\sigma_{AV}^2}$$',
  '',
  '> 结论：测量系统可接受，需追查过程变异来源。',
  '',
  '## 2. 根因分析',
  '',
  '- 刀具磨损未纳入点检',
  '- 换型后首件确认缺失',
  '',
  '## 3. 纠正措施',
  '',
  '1. 增加刀具寿命计数',
  '2. 换型首件双人确认',
  '',
  '![示意](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==)',
  '',
  ...Array.from({ length: 28 }, (_, i) => '段落 ' + (i + 1) + '：用于验证 A4 预分页在多页文档下的页眉与 "Page X of Y" 页码是否正确生成，本段落包含足够多的文字以便撑开页面高度。'),
  ''
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
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const f = pending.get(m.id); pending.delete(m.id); f(m); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text + ' :: ' + (m.params.exceptionDetails?.exception?.description || '').slice(0, 300));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrs.push((m.params.args || []).map(a => a.value || a.description).join(' ').slice(0, 300));
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });
  await send('Page.navigate', { url: FILE });
  await sleep(2500);

  // Stub window.print so the print() path can be exercised headlessly.
  await evaluate('window.print = function(){ globalThis.__printCalled = (globalThis.__printCalled||0)+1; }; globalThis.__printCalled = 0; "ok"');

  log('CM6 API', await evaluate(`JSON.stringify({hasFindFromDOM: typeof CM6.EditorView?.findFromDOM, keys: Object.keys(CM6).slice(0,12)})`));

  // --- edit document ---
  const editExpr = `(() => {
    const view = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    if (!view) return 'NO VIEW';
    const md = ${JSON.stringify(MD)};
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: md } });
    return 'dispatched, doc length=' + view.state.doc.length;
  })()`;
  log('EDIT', await evaluate(editExpr));
  await sleep(900);

  log('RENDER', await evaluate(`(() => {
    const p = document.querySelector('#preview');
    return JSON.stringify({
      h1: p.querySelectorAll('h1').length,
      h2: p.querySelectorAll('h2').length,
      h3: p.querySelectorAll('h3').length,
      tables: p.querySelectorAll('table').length,
      tableRows: p.querySelectorAll('tbody tr').length,
      codeBlocks: p.querySelectorAll('pre > code').length,
      tokens: p.querySelectorAll('pre code .token').length,
      math: p.querySelectorAll('math').length,
      blockquote: p.querySelectorAll('blockquote').length,
      images: p.querySelectorAll('img').length,
      anchors: p.querySelectorAll('.mdsl-anchor').length,
      tocItems: document.querySelectorAll('#toc-tree .toc-item').length,
      tocLevels: document.querySelectorAll('#toc-tree .toc-level-2').length,
      statusDoc: document.querySelector('#status-doc').textContent,
      statusSave: document.querySelector('#status-save').textContent,
      firstH1: p.querySelector('h1')?.textContent,
      mathSample: p.querySelector('math')?.outerHTML.slice(0,120)
    }, null, 1);
  })()`));

  // --- theme ---
  log('THEME', await evaluate(`(() => {
    const before = document.documentElement.getAttribute('data-theme');
    document.querySelector('[data-action="theme"]').click();
    const after = document.documentElement.getAttribute('data-theme');
    const status = document.querySelector('#status-text').textContent;
    return JSON.stringify({before, after, status});
  })()`));

  // --- search panel ---
  log('SEARCH', await evaluate(`(() => {
    document.querySelector('[data-action="find"]').click();
    const panel = document.querySelector('.cm-search');
    return JSON.stringify({panel: !!panel, html: panel ? panel.outerHTML.slice(0,200) : null});
  })()`));

  // --- about dialog ---
  log('ABOUT', await evaluate(`(() => {
    document.querySelector('[data-action="about"]').click();
    const d = document.querySelector('#about-dialog');
    return JSON.stringify({open: d.classList.contains('open'), noticesInDialog: d.querySelectorAll('.about-body details').length, text: d.querySelector('.about-body').textContent.slice(0,160)});
  })()`));
  await evaluate(`document.querySelector('#about-dialog [data-close]').click(); "ok"`);

  // --- print mode / pagination ---
  log('PRINT MODE', await evaluate(`(() => {
    document.querySelector('[data-action="print-mode"]').click();
    const pages = document.querySelectorAll('#print-pages .print-page');
    const footers = Array.from(document.querySelectorAll('.print-footer')).map(e=>e.textContent);
    return JSON.stringify({
      status: document.querySelector('#status-text').textContent,
      bodyClass: document.body.classList.contains('mdsl-print-mode'),
      pageCount: pages.length,
      firstHeader: document.querySelector('.print-header')?.textContent,
      firstFooter: footers[0], lastFooter: footers[footers.length-1],
      pageRule: document.querySelector('#mdsl-page-rule')?.textContent,
      tablesInPages: document.querySelectorAll('#print-pages table').length,
      mathInPages: document.querySelectorAll('#print-pages math').length,
      oversized: document.querySelectorAll('#print-pages .oversized').length
    }, null, 1);
  })()`));

  // --- orientation + zoom ---
  log('ORIENT/ZOOM', await evaluate(`(() => {
    document.querySelector('[data-action="orientation"]').click();
    document.querySelector('[data-action="zoom-in"]').click();
    return JSON.stringify({status: document.querySelector('#status-text').textContent, pageRule: document.querySelector('#mdsl-page-rule')?.textContent, zoom: document.querySelector('#print-pages').style.zoom, pages: document.querySelectorAll('.print-page').length});
  })()`));

  // --- print() path (stubbed) ---
  log('PRINT() PATH', await evaluate(`(() => {
    document.querySelector('[data-action="pdf"]').click();
    return JSON.stringify({status: document.querySelector('#status-text').textContent, printCalled: globalThis.__printCalled, pages: document.querySelectorAll('.print-page').length});
  })()`));
  await sleep(300);
  log('PRINT CALLED', await evaluate('String(globalThis.__printCalled)'));

  // --- DOCX export ---
  await evaluate(`document.querySelector('[data-action="print-mode"]').click(); "ok"`);
  await evaluate(`document.querySelector('[data-action="docx"]').click(); "ok"`);
  await sleep(2500);
  log('DOCX STATUS', await evaluate(`document.querySelector('#status-text').textContent`));

  // --- errors / network ---
  log('PAGE EXCEPTIONS', errors.length ? errors.slice(0, 15) : 'none');
  log('CONSOLE ERRORS', consoleErrs.length ? consoleErrs.slice(0, 15) : 'none');
  log('NETWORK REQUESTS', requests);

  const files = fs.readdirSync(DOWNLOADS).filter(f => !f.endsWith('.crdownload'));
  log('DOWNLOADED FILES', files.map(f => {
    const p = path.join(DOWNLOADS, f); const b = fs.readFileSync(p);
    return { name: f, size: b.length, zip: b.slice(0, 2).toString() === 'PK', hasDocumentXml: false };
  }));
})().catch(e => console.error('ERROR:', e.message, e.stack)).finally(() => {
  try { ws && ws.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  setTimeout(() => process.exit(0), 300);
});
