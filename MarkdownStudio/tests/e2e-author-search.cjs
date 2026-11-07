/** e2e-author-search.cjs — author info everywhere + reader-mode preview find */
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const os = require('os');
const path = require('path');
const fs = require('fs');

const ROOT = 'G:\\程序\\MD\\MarkdownStudio';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = pathToFileURL(path.join(ROOT, 'dist', 'MarkdownStudioLite.html')).href;
const DOWNLOADS = path.join(ROOT, 'dist', 'downloads');
const PORT = 9431;
const profile = path.join(os.tmpdir(), 'mdsl-author-' + Date.now());
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

const MD = [
  '# 阅读模式查找测试',
  '',
  '行内公式 $E = mc^2$，独立公式：',
  '',
  '$$\\text{GRR} = \\sqrt{\\sigma_{EV}^2 + \\sigma_{AV}^2}$$',
  ''
].concat(Array.from({ length: 60 }, (_, i) =>
  `第 ${i + 1} 段：GRR 测量系统分析，包含关键词 GRR 与 grr 混合大小写，用于验证预览内查找的高亮与跳转。`)
).join('\n');

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

  // ---------- A. Author info ----------
  log('A1. META + ABOUT DIALOG', await ev(`(() => {
    const meta = document.querySelector('meta[name="author"]').content;
    document.querySelector('[data-action="about"]').click();
    const d = document.querySelector('#about-dialog');
    const body = d.querySelector('.about-body');
    const out = {
      meta, open: d.classList.contains('open'),
      name: body.querySelector('.about-author-name')?.textContent,
      email: body.querySelector('.about-author-contact a')?.textContent,
      mailto: body.querySelector('.about-author-contact a')?.getAttribute('href'),
      copyButton: !!body.querySelector('[data-copy-email]'),
      notices: body.querySelectorAll('details section').length,
      mentionsDocAuthor: body.textContent.includes('Word 文档属性'),
      head: body.textContent.trim().slice(0, 110)
    };
    d.querySelector('[data-close]').click();
    return JSON.stringify(out);
  })()`));

  log('A2. COPY EMAIL BUTTON', await ev(`(async () => {
    document.querySelector('[data-action="about"]').click();
    const btn = document.querySelector('[data-copy-email]');
    btn.click();
    await new Promise(r => setTimeout(r, 200));
    const label = btn.textContent;
    const selected = window.getSelection().toString();
    document.querySelector('#about-dialog [data-close]').click();
    return JSON.stringify({label, selected, dialogClosed: !document.querySelector('#about-dialog').classList.contains('open')});
  })()`, true));

  log('A3. HELP FOOT CREDIT', await ev(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'F1', bubbles:true}));
    const foot = document.querySelector('.help-foot').textContent;
    const open = document.querySelector('#help-dialog').classList.contains('open');
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    return JSON.stringify({open, hasName: foot.includes('Zhao Pengliang (Fred)'), hasMail: foot.includes('zplwsygr@163.com'), foot: foot.trim().replace(/\\s+/g,' ').slice(0,150)});
  })()`));

  // ---------- B. Reader-mode find ----------
  log('B0. SET DOC + SWITCH TO READER', await ev(`(() => {
    const v = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    v.dispatch({changes: {from: 0, to: v.state.doc.length, insert: ${JSON.stringify(MD)}}});
    document.querySelector('[data-view="reader"]').click();
    return JSON.stringify({len: v.state.doc.length, view: document.body.className});
  })()`));
  await sleep(1100);
  log('B1. PREVIEW READY', await ev(`JSON.stringify({
    paragraphs: document.querySelectorAll('#preview p').length,
    mathElements: document.querySelectorAll('#preview math').length,
    previewScrollHeight: document.querySelector('#preview').scrollHeight,
    previewClientHeight: document.querySelector('#preview').clientHeight,
    findBarHidden: document.querySelector('#find-bar').hidden
  })`));

  log('C1. CTRL+F IN READER', await ev(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'f', ctrlKey:true, bubbles:true}));
    const bar = document.querySelector('#find-bar');
    return JSON.stringify({
      hidden: bar.hidden,
      focused: document.activeElement === document.querySelector('#find-input'),
      status: document.querySelector('#status-text').textContent,
      cmSearchPanel: !!document.querySelector('.cm-search')
    });
  })()`));

  log('C2. TOOLBAR FIND BUTTON IN READER', await ev(`(() => {
    document.querySelector('[data-find="close"]').click();
    document.querySelector('[data-action="find"]').click();
    return JSON.stringify({
      hidden: document.querySelector('#find-bar').hidden,
      focused: document.activeElement === document.querySelector('#find-input'),
      cmSearchPanel: !!document.querySelector('.cm-search')
    });
  })()`));

  log('D1. QUERY "grr" (case-insensitive)', await ev(`(() => {
    const input = document.querySelector('#find-input');
    input.value = 'grr';
    input.dispatchEvent(new Event('input', {bubbles:true}));
    return JSON.stringify({
      count: document.querySelector('#find-count').textContent,
      marks: document.querySelectorAll('#preview mark.mdsl-find-hit').length,
      current: document.querySelectorAll('#preview mark.mdsl-find-hit.current').length,
      marksInsideMath: document.querySelectorAll('#preview math mark').length,
      mathElements: document.querySelectorAll('#preview math').length,
      firstMark: document.querySelector('#preview mark.mdsl-find-hit')?.textContent,
      findBarRect: (() => { const r = document.querySelector('#find-bar').getBoundingClientRect(); return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width)}; })()
    });
  })()`));

  log('E1. NEXT x150 / PREV / ENTER / SHIFT+ENTER', await ev(`(() => {
    const preview = document.querySelector('#preview');
    const next = document.querySelector('[data-find="next"]');
    const before = preview.scrollTop;
    for (let i = 0; i < 150; i++) next.click();
    const mid = {scrollTop: Math.round(preview.scrollTop), count: document.querySelector('#find-count').textContent};
    document.querySelector('[data-find="prev"]').click();
    const afterPrev = document.querySelector('#find-count').textContent;
    const input = document.querySelector('#find-input');
    input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
    const afterEnter = document.querySelector('#find-count').textContent;
    input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', shiftKey:true, bubbles:true}));
    const afterShiftEnter = document.querySelector('#find-count').textContent;
    return JSON.stringify({before, mid, afterPrev, afterEnter, afterShiftEnter, maxScroll: preview.scrollHeight - preview.clientHeight});
  })()`));

  log('F1. CASE SENSITIVE TOGGLE', await ev(`(() => {
    const btn = document.querySelector('[data-find="case"]');
    btn.click();
    const on = {marks: document.querySelectorAll('#preview mark.mdsl-find-hit').length, count: document.querySelector('#find-count').textContent, pressed: btn.getAttribute('aria-pressed'), status: document.querySelector('#status-text').textContent};
    btn.click();
    const off = {marks: document.querySelectorAll('#preview mark.mdsl-find-hit').length, count: document.querySelector('#find-count').textContent, pressed: btn.getAttribute('aria-pressed')};
    return JSON.stringify({on, off});
  })()`));

  log('G1. RERENDER REFRESH', await ev(`(() => {
    const v = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    const before = document.querySelectorAll('#preview mark.mdsl-find-hit').length;
    v.dispatch({changes: {from: 0, insert: '前缀 GRR 一段。\\n'}});
    return JSON.stringify({before});
  })()`));
  await sleep(1000);
  log('G2. AFTER RERENDER', await ev(`JSON.stringify({
    marks: document.querySelectorAll('#preview mark.mdsl-find-hit').length,
    count: document.querySelector('#find-count').textContent,
    current: document.querySelectorAll('#preview mark.mdsl-find-hit.current').length,
    barOpen: !document.querySelector('#find-bar').hidden,
    firstText: document.querySelector('#preview').textContent.trim().slice(0, 30)
  })`));

  log('H1. ESC CLOSE', await ev(`(() => {
    const input = document.querySelector('#find-input');
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    return JSON.stringify({hidden: document.querySelector('#find-bar').hidden, marks: document.querySelectorAll('#preview mark').length, count: document.querySelector('#find-count').textContent, status: document.querySelector('#status-text').textContent});
  })()`));

  log('H2. PRINT HIGHLIGHT SUPPRESSED', await ev(`(() => {
    const pages = document.querySelector('.print-pages');
    const m = document.createElement('mark');
    m.className = 'mdsl-find-hit'; m.textContent = 'x';
    pages.appendChild(m);
    const bg = getComputedStyle(m).backgroundColor;
    const outline = getComputedStyle(m).outlineStyle;
    m.remove();
    return JSON.stringify({bg, outline});
  })()`));

  log('I1. SPLIT MODE STILL USES CM6 SEARCH', await ev(`(() => {
    document.querySelector('[data-view="split"]').click();
    document.querySelector('[data-action="find"]').click();
    return JSON.stringify({
      view: ['split','editor','reader'].find(m => document.body.classList.contains('view-' + m)),
      cmSearch: !!document.querySelector('.cm-search'),
      findBarHidden: document.querySelector('#find-bar').hidden,
      previewMarks: document.querySelectorAll('#preview mark').length
    });
  })()`));

  log('J1. CTRL+H FROM READER SWITCHES BACK', await ev(`(() => {
    document.querySelector('[data-view="reader"]').click();
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'h', ctrlKey:true, bubbles:true}));
    return JSON.stringify({view: ['split','editor','reader'].find(m => document.body.classList.contains('view-' + m)), status: document.querySelector('#status-text').textContent});
  })()`));
  await sleep(400);
  log('J2. REPLACE PANEL', await ev(`JSON.stringify({
    view: ['split','editor','reader'].find(m => document.body.classList.contains('view-' + m)),
    cmSearch: !!document.querySelector('.cm-search'),
    replaceChecked: document.querySelector('.cm-search [name="replace"]')?.checked,
    findBarHidden: document.querySelector('#find-bar').hidden,
    replaceFieldFocused: document.activeElement === document.querySelector('.cm-search input[name="replace"]:not([type="checkbox"])'),
    activeElementName: document.activeElement?.getAttribute('name'),
    cmInputs: Array.from(document.querySelectorAll('.cm-search input')).map(i => ({name: i.name, type: i.type, checked: i.checked}))
  })`));

  // ---------- K. DOCX author metadata ----------
  await ev(`document.querySelector('[data-action="docx"]').click(); 'ok'`);
  await sleep(2400);
  log('K1. DOCX EXPORT', await ev(`document.querySelector('#status-text').textContent`));
  log('K2. DOWNLOADED FILES', fs.readdirSync(DOWNLOADS).map(f => f + ' (' + fs.statSync(path.join(DOWNLOADS, f)).size + ' B)'));

  log('EXCEPTIONS', errors.length ? errors : 'none');
  log('CONSOLE ERRORS', consoleErrs.length ? consoleErrs : 'none');
  log('NETWORK REQUESTS', requests);
  ws.close(); edge.kill();
})().catch(e => { console.error('FATAL', e); try { edge.kill(); } catch (x) {} process.exit(1); });
