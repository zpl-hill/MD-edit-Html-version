/** e2e-ui.cjs — UI scale / recent-files layout / view modes / syntax help, tested at 1920x1080 */
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const os = require('os');
const path = require('path');

const ROOT = 'G:\\程序\\MD\\MarkdownStudio';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = pathToFileURL(path.join(ROOT, 'dist', 'MarkdownStudioLite.html')).href;
const PORT = 9426;
const profile = path.join(os.tmpdir(), 'mdsl-ui-' + Date.now());
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank'
], { stdio: 'ignore', windowsHide: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map();
const send = (m, p = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
const errors = [], requests = [];
async function ev(expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
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
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: FILE }); await sleep(2600);

  // ---------- 1. UI scale ----------
  log('1. INITIAL SCALE (1920x1080)', await ev(`JSON.stringify({
    viewport: [innerWidth, innerHeight],
    scale: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim(),
    label: document.querySelector('#ui-scale-label').textContent,
    toolbarBtnFontSize: getComputedStyle(document.querySelector('.tbtn')).fontSize,
    bodyFontSize: getComputedStyle(document.body).fontSize,
    editorFontSize: getComputedStyle(document.querySelector('.cm-content')).fontSize,
    previewFontSize: getComputedStyle(document.querySelector('#preview')).fontSize,
    statusFontSize: getComputedStyle(document.querySelector('.statusbar')).fontSize,
    toolbarHeight: getComputedStyle(document.querySelector('.toolbar')).height,
    sidebarWidth: getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w').trim()
  })`));

  log('1b. A+ / A-', await ev(`(() => {
    document.querySelector('[data-action="ui-larger"]').click();
    document.querySelector('[data-action="ui-larger"]').click();
    const afterPlus = {scale: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim(), label: document.querySelector('#ui-scale-label').textContent, btn: getComputedStyle(document.querySelector('.tbtn')).fontSize};
    document.querySelector('[data-action="ui-smaller"]').click();
    const afterMinus = {scale: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim(), label: document.querySelector('#ui-scale-label').textContent};
    return JSON.stringify({afterPlus, afterMinus, prefs: localStorage.getItem('mdstudio.prefs')});
  })()`));

  // ---------- 2. recent files area ----------
  log('2. RECENT FILES LAYOUT', await ev(`JSON.stringify({
    tocHeight: Math.round(document.querySelector('#toc-tree').getBoundingClientRect().height),
    recentHeight: Math.round(document.querySelector('#recent-list').getBoundingClientRect().height),
    ratio: +(document.querySelector('#recent-list').getBoundingClientRect().height / document.querySelector('#toc-tree').getBoundingClientRect().height).toFixed(2),
    sidebarWidth: Math.round(document.querySelector('.toc-pane').getBoundingClientRect().width),
    emptyText: document.querySelector('#recent-list').textContent.trim(),
    recentTitle: document.querySelector('.recent-title').textContent
  })`));

  // Populate recent files via a saved doc, then verify two-line rendering.
  log('2b. RECENT AFTER SAVE', await ev(`(async () => {
    document.querySelector('[data-action="save"]').click();
    await new Promise(r=>setTimeout(r,500));
    const items = document.querySelectorAll('.recent-item');
    return JSON.stringify({count: items.length, name: items[0]?.querySelector('.recent-name')?.textContent, meta: items[0]?.querySelector('.recent-meta')?.textContent, height: Math.round(document.querySelector('#recent-list').getBoundingClientRect().height)});
  })()`, true));

  // ---------- 3. view modes ----------
  log('3. VIEW MODES', await ev(`(() => {
    const out = {};
    const snap = () => {
      const vis = s => { const e = document.querySelector(s); return e ? getComputedStyle(e).display !== 'none' : null; };
      return {
        cls: ['split','editor','reader'].find(m => document.body.classList.contains('view-' + m)),
        toc: vis('.toc-pane'), editor: vis('.editor-pane'), preview: vis('.preview-pane'),
        status: document.querySelector('#status-view').textContent,
        activeBtn: document.querySelector('.view-btn.active')?.getAttribute('data-view')
      };
    };
    out.initial = snap();
    document.querySelector('[data-view="editor"]').click(); out.editor = snap();
    document.querySelector('[data-view="reader"]').click(); out.reader = snap();
    document.querySelector('[data-view="split"]').click(); out.backToSplit = snap();
    return JSON.stringify(out, null, 1);
  })()`));

  log('3b. F6 CYCLE + PERSIST', await ev(`(() => {
    const modes = [];
    for (let i=0;i<4;i++) {
      window.dispatchEvent(new KeyboardEvent('keydown', {key:'F6', bubbles:true}));
      modes.push(['split','editor','reader'].find(m => document.body.classList.contains('view-' + m)));
    }
    return JSON.stringify({modes, prefs: localStorage.getItem('mdstudio.prefs')});
  })()`));

  await send('Page.reload', { ignoreCache: true }); await sleep(2600);
  log('3c. AFTER RELOAD', await ev(`JSON.stringify({
    view: ['split','editor','reader'].find(m => document.body.classList.contains('view-' + m)),
    scale: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim(),
    label: document.querySelector('#ui-scale-label').textContent,
    activeBtn: document.querySelector('.view-btn.active')?.getAttribute('data-view'),
    cmEditor: !!document.querySelector('.cm-editor')
  })`));

  // ---------- 4. help dialog ----------
  log('4. HELP DIALOG', await ev(`(() => {
    document.querySelector('[data-action="help"]').click();
    const d = document.querySelector('#help-dialog');
    return JSON.stringify({
      open: d.classList.contains('open'),
      tabs: Array.from(d.querySelectorAll('.help-tab')).map(b=>b.textContent),
      activeTab: d.querySelector('.help-tab.active')?.textContent,
      panels: d.querySelectorAll('.help-panel').length,
      groups: d.querySelectorAll('.help-panel.active .help-group').length,
      rows: d.querySelectorAll('.help-panel.active .help-table tbody tr').length,
      insertButtons: d.querySelectorAll('.help-insert').length,
      note: d.querySelector('.help-panel.active .help-note')?.textContent.slice(0,80)
    }, null, 1);
  })()`));

  log('4b. HELP TABS', await ev(`(() => {
    const d = document.querySelector('#help-dialog');
    const out = {};
    ['math','tips','markdown'].forEach(id => {
      d.querySelector('[data-help-tab="'+id+'"]').click();
      out[id] = {active: d.querySelector('.help-tab.active')?.getAttribute('data-help-tab'), groups: d.querySelectorAll('.help-panel.active .help-group').length, rows: d.querySelectorAll('.help-panel.active .help-table tbody tr').length, inserts: d.querySelectorAll('.help-panel.active .help-insert').length, sample: d.querySelector('.help-panel.active .help-table code')?.textContent};
    });
    return JSON.stringify(out, null, 1);
  })()`));

  log('4c. INSERT SAMPLE (from reader view)', await ev(`(async () => {
    document.querySelector('[data-view="reader"]').click();
    const d = document.querySelector('#help-dialog');
    d.querySelector('[data-help-tab="math"]').click();
    const before = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor')).state.doc.length;
    d.querySelector('.help-panel.active .help-insert').click();
    await new Promise(r=>setTimeout(r,450));
    const v = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    return JSON.stringify({
      dialogClosed: !d.classList.contains('open'),
      view: ['split','editor','reader'].find(m => document.body.classList.contains('view-' + m)),
      before, after: v.state.doc.length,
      insertedIntoDoc: v.state.doc.toString().includes('行内公式 $E = mc^2$'),
      insertedIntoPreview: document.querySelector('#preview').textContent.includes('行内公式'),
      status: document.querySelector('#status-text').textContent
    });
  })()`, true));

  log('4d. F1 / ESC', await ev(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'F1', bubbles:true}));
    const opened = document.querySelector('#help-dialog').classList.contains('open');
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    const closed = !document.querySelector('#help-dialog').classList.contains('open');
    return JSON.stringify({opened, closed});
  })()`));

  log('5. READER / TOOLBAR LAYOUT', await ev(`(() => {
    document.querySelector('[data-view="reader"]').click();
    const p = document.querySelector('#preview');
    const r = p.getBoundingClientRect();
    const t = document.querySelector('.toolbar-actions');
    const out = {
      bodyClass: document.body.className,
      readerMaxWidth: getComputedStyle(p).maxWidth,
      readerPadding: getComputedStyle(p).paddingLeft,
      readerFontSize: getComputedStyle(p).fontSize,
      readerWidth: Math.round(r.width),
      readerLeft: Math.round(r.left),
      paneWidth: Math.round(document.querySelector('.preview-pane').getBoundingClientRect().width),
      workspaceWidth: Math.round(document.querySelector('.workspace').getBoundingClientRect().width),
      gridColumns: getComputedStyle(document.querySelector('.workspace')).gridTemplateColumns,
      viewport: innerWidth,
      toolbarOverflow: t.scrollWidth - t.clientWidth,
      toolbarButtons: t.querySelectorAll('button').length
    };
    document.querySelector('[data-view="split"]').click();
    return JSON.stringify(out, null, 1);
  })()`));

  // ---------- 6. narrow screen: toolbar must remain fully reachable ----------
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  log('6. NARROW SCREEN (900x700)', await ev(`(() => {
    const t = document.querySelector('.toolbar-actions');
    const tr = t.getBoundingClientRect();
    t.scrollLeft = 0;
    const vs = document.querySelector('.view-switch').getBoundingClientRect();
    const viewVisibleAtStart = vs.left >= tr.left - 2 && vs.right <= tr.right + 2;
    t.scrollLeft = t.scrollWidth;
    const ui = document.querySelector('.ui-scale-group').getBoundingClientRect();
    const uiReachableAtEnd = ui.left >= tr.left - 2 && ui.right <= tr.right + 2;
    return JSON.stringify({
      viewport: [innerWidth, innerHeight],
      overflow: t.scrollWidth - t.clientWidth,
      viewVisibleAtStart,
      uiReachableAtEnd,
      scale: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim(),
      sidebarWidth: Math.round(document.querySelector('.toc-pane').getBoundingClientRect().width)
    });
  })()`));

  log('EXCEPTIONS', errors.length ? errors : 'none');
  log('NETWORK REQUESTS', requests);
})().catch(e => console.error('ERROR:', e.message, e.stack)).finally(() => {
  try { ws && ws.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  setTimeout(() => process.exit(0), 300);
});
