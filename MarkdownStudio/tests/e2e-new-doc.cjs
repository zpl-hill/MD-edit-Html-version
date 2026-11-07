/** e2e-new-doc.cjs — New document: button, confirm dialog, draft isolation, undo, reload, shortcuts */
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const os = require('os');
const path = require('path');
const fs = require('fs');

const ROOT = 'G:\\程序\\MD\\MarkdownStudio';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = pathToFileURL(path.join(ROOT, 'dist', 'MarkdownStudioLite.html')).href;
const DOWNLOADS = path.join(ROOT, 'dist', 'downloads');
const PORT = 9441;
const profile = path.join(os.tmpdir(), 'mdsl-new-' + Date.now());
fs.mkdirSync(DOWNLOADS, { recursive: true });
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank'
], { stdio: 'ignore', windowsHide: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map();
const send = (m, p = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
const errors = [], requests = [], consoleErrs = [];
async function ev(expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.result?.exceptionDetails) return { __error: (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 600) };
  return r.result?.result?.value;
}
const log = (l, v) => console.log('\n=== ' + l + ' ===\n' + (typeof v === 'string' ? v : JSON.stringify(v, null, 1)));

const OLD_TEXT = '\n\n# 旧文档（不应被恢复）\n\n这段内容在新建之后必须彻底消失。\n';
const NEW_TEXT = '# 新文档\n\n新建之后写的内容，刷新后应该能恢复。\n';

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
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').slice(0, 400));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrs.push(m.params.args.map(a => a.value || a.description).join(' ').slice(0, 250));
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: FILE }); await sleep(2600);

  // ---------- A. Initial state ----------
  log('A1. NEW BUTTON + DIALOG DOM', await ev(`(() => {
    const btn = document.querySelector('[data-action="new"]');
    const v = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    return JSON.stringify({
      newButton: !!btn,
      title: btn?.title,
      dialogExists: !!document.querySelector('#new-dialog'),
      actions: [...document.querySelectorAll('#new-dialog [data-new]')].map(b => b.dataset.new),
      pageTitle: document.title,
      sampleHeading: document.querySelector('#preview h1')?.textContent,
      initialLength: v.state.doc.length
    });
  })()`));

  log('A2. MAKE DIRTY + WRITE EMERGENCY DRAFT', await ev(`(() => {
    const v = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    v.dispatch({changes:{from: v.state.doc.length, insert: ${JSON.stringify(OLD_TEXT)}}});
    window.dispatchEvent(new Event('pagehide'));
    return JSON.stringify({
      length: v.state.doc.length,
      saveStatus: document.querySelector('#status-save').textContent,
      emergencyBefore: !!localStorage.getItem('mdstudio.emergency')
    });
  })()`));
  await sleep(350);

  // ---------- B. Confirm dialog ----------
  log('B1. NEW -> CONFIRM DIALOG', await ev(`(() => {
    document.querySelector('[data-action="new"]').click();
    const d = document.querySelector('#new-dialog');
    const p = d.querySelector('.new-primary');
    return JSON.stringify({
      open: d.classList.contains('open'),
      name: d.querySelector('.new-doc-name').textContent,
      hint: d.querySelector('.new-doc-hint').textContent.trim().slice(0, 90),
      focused: document.activeElement?.getAttribute('data-new'),
      primaryBg: getComputedStyle(p).backgroundColor,
      primaryColor: getComputedStyle(p).color,
      cardWidth: Math.round(d.querySelector('.new-card').getBoundingClientRect().width)
    });
  })()`));

  log('B2. CANCEL KEEPS CONTENT', await ev(`(() => {
    document.querySelector('#new-dialog [data-new="cancel"]').click();
    const v = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    return JSON.stringify({
      dialogOpen: document.querySelector('#new-dialog').classList.contains('open'),
      length: v.state.doc.length,
      oldTextStillThere: v.state.doc.toString().includes('必须彻底消失'),
      status: document.querySelector('#status-text').textContent
    });
  })()`));

  log('B3. DISCARD -> CLEAN NEW DOCUMENT', await ev(`(async () => {
    document.querySelector('[data-action="new"]').click();
    await new Promise(r => setTimeout(r, 30));
    document.querySelector('#new-dialog [data-new="discard"]').click();
    await new Promise(r => setTimeout(r, 120));
    const v = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    return JSON.stringify({
      dialogOpen: document.querySelector('#new-dialog').classList.contains('open'),
      docLength: v.state.doc.length,
      docText: v.state.doc.toString(),
      previewText: document.querySelector('#preview').textContent.trim().slice(0, 60),
      toc: document.querySelector('#toc-tree').textContent.trim(),
      pageTitle: document.title,
      statusText: document.querySelector('#status-text').textContent,
      statusDoc: document.querySelector('#status-doc').textContent,
      statusSave: document.querySelector('#status-save').textContent,
      bannerVisible: document.querySelector('#banner').classList.contains('visible'),
      emergencyAfter: !!localStorage.getItem('mdstudio.emergency'),
      startupBlank: JSON.parse(localStorage.getItem('mdstudio.prefs') || '{}').startupBlank,
      findBarHidden: document.querySelector('#find-bar').hidden,
      printPages: document.querySelector('#print-pages').children.length
    });
  })()`, true));

  log('B4. UNDO CANNOT BRING BACK OLD DOC', await ev(`(() => {
    const v = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    CM6.undo(v);
    return JSON.stringify({length: v.state.doc.length, text: v.state.doc.toString()});
  })()`));

  // ---------- C. Reload: old draft must not come back ----------
  await send('Page.reload'); await sleep(2600);
  log('C1. AFTER RELOAD (blank, no stale banner)', await ev(`(() => {
    const v = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    return JSON.stringify({
      docLength: v.state.doc.length,
      hasOldText: v.state.doc.toString().includes('必须彻底消失'),
      bannerVisible: document.querySelector('#banner').classList.contains('visible'),
      bannerText: document.querySelector('#banner').textContent,
      emergency: !!localStorage.getItem('mdstudio.emergency'),
      pageTitle: document.title
    });
  })()`));

  log('C2. NEW DOC AUTOSAVE CHAIN (pagehide draft -> reload -> restore)', await ev(`(() => {
    const v = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    v.dispatch({changes:{from: 0, to: v.state.doc.length, insert: ${JSON.stringify(NEW_TEXT)}}});
    window.dispatchEvent(new Event('pagehide'));
    return JSON.stringify({length: v.state.doc.length, emergency: !!localStorage.getItem('mdstudio.emergency')});
  })()`));
  await send('Page.reload'); await sleep(2600);
  log('C3. RESTORE BANNER AFTER RELOAD', await ev(`(() => {
    const b = document.querySelector('#banner');
    return JSON.stringify({visible: b.classList.contains('visible'), text: b.textContent.slice(0, 90), buttons: [...b.querySelectorAll('button')].map(x => x.textContent)});
  })()`));
  log('C4. CLICK RESTORE', await ev(`(() => {
    const btn = [...document.querySelectorAll('#banner button')].find(b => b.textContent === '恢复');
    if (btn) btn.click();
    const v = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    return JSON.stringify({restored: v.state.doc.toString().includes('刷新后应该能恢复'), length: v.state.doc.length, status: document.querySelector('#status-text').textContent});
  })()`));

  // ---------- D. "Save then new" branch ----------
  log('D1. SAVE-THEN-NEW', await ev(`(async () => {
    document.querySelector('[data-action="new"]').click();
    await new Promise(r => setTimeout(r, 30));
    const opened = document.querySelector('#new-dialog').classList.contains('open');
    document.querySelector('#new-dialog [data-new="save"]').click();
    await new Promise(r => setTimeout(r, 250));
    const v = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    return JSON.stringify({confirmShown: opened, dialogOpen: document.querySelector('#new-dialog').classList.contains('open'), docLength: v.state.doc.length, status: document.querySelector('#status-text').textContent, pageTitle: document.title});
  })()`, true));
  await sleep(700);
  log('D2. DOWNLOADED .md', fs.readdirSync(DOWNLOADS).filter(f => f.endsWith('.md')).map(f => f + ' (' + fs.statSync(path.join(DOWNLOADS, f)).size + ' B)'));

  // ---------- E. Reader mode auto-switch ----------
  log('E1. NEW FROM READER MODE', await ev(`(async () => {
    document.querySelector('[data-view="reader"]').click();
    const v = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    v.dispatch({changes:{from: 0, insert: '# 阅读模式下的未保存内容\\n'}});
    await new Promise(r => setTimeout(r, 60));
    document.querySelector('[data-action="new"]').click();
    await new Promise(r => setTimeout(r, 30));
    document.querySelector('#new-dialog [data-new="discard"]').click();
    await new Promise(r => setTimeout(r, 120));
    return JSON.stringify({
      view: ['split','editor','reader'].find(m => document.body.classList.contains('view-' + m)),
      docLength: CM6.EditorView.findFromDOM(document.querySelector('.cm-editor')).state.doc.length,
      editorVisible: getComputedStyle(document.querySelector('.editor-pane')).display !== 'none',
      status: document.querySelector('#status-text').textContent
    });
  })()`, true));

  // ---------- F. Shortcuts (Ctrl+N is reserved by the browser) ----------
  log('F1. ALT+N WHEN CLEAN -> DIRECT NEW', await ev(`(async () => {
    const v = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    v.dispatch({changes:{from: 0, insert: '# 临时内容\\n'}});
    const before = v.state.doc.length;
    document.querySelector('[data-action="new"]').click();
    await new Promise(r => setTimeout(r, 30));
    document.querySelector('#new-dialog [data-new="discard"]').click();
    await new Promise(r => setTimeout(r, 100));
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'n', altKey:true, bubbles:true}));
    await new Promise(r => setTimeout(r, 120));
    return JSON.stringify({before, after: CM6.EditorView.findFromDOM(document.querySelector('.cm-editor')).state.doc.length, dialogOpen: document.querySelector('#new-dialog').classList.contains('open'), status: document.querySelector('#status-text').textContent});
  })()`, true));

  log('F2. CTRL+ALT+N WHEN DIRTY -> CONFIRM + ESC', await ev(`(async () => {
    const v = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    v.dispatch({changes:{from: 0, insert: '# 又一段未保存内容\\n'}});
    await new Promise(r => setTimeout(r, 30));
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'n', ctrlKey:true, altKey:true, bubbles:true}));
    await new Promise(r => setTimeout(r, 50));
    const opened = document.querySelector('#new-dialog').classList.contains('open');
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    return JSON.stringify({opened, closedByEsc: !document.querySelector('#new-dialog').classList.contains('open'), contentKept: CM6.EditorView.findFromDOM(document.querySelector('.cm-editor')).state.doc.toString().includes('又一段未保存内容')});
  })()`, true));

  // ---------- G. Help mentions the new shortcut ----------
  log('G1. HELP TIPS', await ev(`(() => {
    document.querySelector('[data-action="help"]').click();
    const d = document.querySelector('#help-dialog');
    const tab = d.querySelector('[data-help-tab="tips"]');
    if (tab) tab.click();
    const text = d.querySelector('#help-body').textContent;
    const out = {open: d.classList.contains('open'), mentionsNew: text.includes('新建'), mentionsAltN: text.includes('Alt+N'), mentionsReserved: text.includes('浏览器保留')};
    d.querySelector('[data-close]').click();
    return JSON.stringify(out);
  })()`));

  log('EXCEPTIONS', errors.length ? errors : 'none');
  log('CONSOLE ERRORS', consoleErrs.length ? consoleErrs : 'none');
  log('NETWORK REQUESTS', requests);
  ws.close(); edge.kill();
})().catch(e => { console.error('FATAL', e); try { edge.kill(); } catch (x) {} process.exit(1); });
