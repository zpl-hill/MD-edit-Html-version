/** e2e-math-layout.cjs — verify reader full-width layout + DOCX native OMML formulas */
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = 'G:\\程序\\MD\\MarkdownStudio';
const DIST = path.join(ROOT, 'dist');
const DOWNLOADS = path.join(DIST, 'downloads');
fs.mkdirSync(DOWNLOADS, { recursive: true });
for (const f of fs.readdirSync(DOWNLOADS)) { try { fs.unlinkSync(path.join(DOWNLOADS, f)); } catch (e) {} }
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = pathToFileURL(path.join(DIST, 'MarkdownStudioLite.html')).href;
const PORT = 9432;
const profile = path.join(os.tmpdir(), 'mdsl-math-' + Date.now());
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank'
], { stdio: 'ignore', windowsHide: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const errors = [], consoleErrs = [], requests = [];
async function evaluate(expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.text + ' :: ' + (r.result.exceptionDetails.exception?.description || '') };
  return r.result?.result?.value;
}
const log = (l, v) => console.log('\n=== ' + l + ' ===\n' + (typeof v === 'string' ? v : JSON.stringify(v, null, 1)));

const FORMULAS = [
  ['inline', 'E = mc^2', 'm:sSup'],
  ['fraction', 'C_p = \\frac{USL - LSL}{6\\sigma} \\geq 1.33', 'm:f'],
  ['sqrt', '\\text{GRR} = \\sqrt{\\sigma_{EV}^2 + \\sigma_{AV}^2}', 'm:rad'],
  ['sum', '\\bar{x} = \\frac{1}{n}\\sum_{i=1}^{n} x_i', 'm:nary'],
  ['integral', '\\int_0^1 f(x)\\,dx', 'm:nary'],
  ['root3', '\\sqrt[3]{x}', 'm:deg'],
  ['matrix', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', 'm:m'],
  ['hat', '\\hat{x}', 'm:acc'],
  ['overline', '\\overline{X}', 'm:acc'],
  ['leftright', '\\left( \\frac{a+b}{2} \\right)^2', 'm:d'],
  ['limit', '\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1', 'm:limLow'],
  ['subsup', 'x_{i,j}^2', 'm:sSubSup'],
  ['cjk', '\\text{合格率} = 95\\%', 'm:nor']
];

const MD = [
  '# 公式导出验证',
  '',
  '行内公式 $E = mc^2$ 与独立公式：',
  '',
  '$$\\text{GRR} = \\sqrt{\\sigma_{EV}^2 + \\sigma_{AV}^2}$$',
  '',
  '$$C_p = \\frac{USL - LSL}{6\\sigma} \\geq 1.33$$',
  '',
  '$$\\bar{x} = \\frac{1}{n}\\sum_{i=1}^{n} x_i$$',
  '',
  '$$\\int_0^1 f(x)\\,dx$$',
  '',
  '$$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$$',
  '',
  '$$\\hat{x} \\quad \\overline{X}$$',
  '',
  '$$\\left( \\frac{a+b}{2} \\right)^2$$',
  '',
  '$$\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$$',
  '',
  '普通金额对比：$5 与 $10 不应被当成公式。',
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
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const f = pending.get(m.id); pending.delete(m.id); f(m); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.text || '') + ' :: ' + (m.params.exceptionDetails?.exception?.description || '').slice(0, 300));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrs.push((m.params.args || []).map(a => a.value || a.description).join(' ').slice(0, 300));
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: FILE }); await sleep(2500);

  const rectExpr = `(() => {
    const pick = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const c = getComputedStyle(e);
      return {x: Math.round(r.x), w: Math.round(r.width), maxWidth: c.maxWidth, scrollW: e.scrollWidth, clientW: e.clientWidth}; };
    return JSON.stringify({viewport: innerWidth, bodyClass: document.body.className,
      gridCols: getComputedStyle(document.querySelector('.workspace')).gridTemplateColumns,
      previewPane: pick('.preview-pane'), markdownBody: pick('#preview')});
  })()`;

  log('SPLIT', await evaluate(rectExpr));
  await evaluate(`document.querySelector('[data-view="reader"]').click(); 'ok'`);
  await sleep(350);
  log('READER @1920', await evaluate(rectExpr));
  await send('Emulation.setDeviceMetricsOverride', { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false });
  await sleep(350);
  log('READER @2560', await evaluate(rectExpr));

  log('OMML UNIT', await evaluate(`(() => {
    const api = globalThis.__mdsl_omml || (typeof __mdsl_omml !== 'undefined' ? __mdsl_omml : null);
    if (!api) return 'module not reachable';
    const samples = ${JSON.stringify(FORMULAS)};
    return JSON.stringify(samples.map(([name, tex, marker]) => {
      const xml = api.texToOmml(tex);
      return {name, ok: !!xml, len: xml ? xml.length : 0, hasMarker: !!xml && xml.indexOf(marker) >= 0,
        fragment: xml ? xml.slice(0, 170) : null};
    }));
  })()`));

  log('MATH SEGMENTS', await evaluate(`(() => {
    const api = globalThis.__mdsl_omml || (typeof __mdsl_omml !== 'undefined' ? __mdsl_omml : null);
    return JSON.stringify(api.splitMathSegments('公式 $E = mc^2$ 与金额 $5 与 $10，以及 $$x^2$$'));
  })()`));

  log('SET DOC', await evaluate(`(() => {
    const view = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: ${JSON.stringify(MD)} } });
    return 'doc length=' + view.state.doc.length;
  })()`));
  await sleep(900);

  await evaluate(`document.querySelector('[data-action="docx"]').click(); 'ok'`);
  await sleep(2200);
  log('EXPORT STATUS', await evaluate(`document.querySelector('#status-text').textContent`));
  log('DOWNLOADED FILES', fs.readdirSync(DOWNLOADS).map(f => f + ' (' + fs.statSync(path.join(DOWNLOADS, f)).size + ' B)'));

  log('EXCEPTIONS', errors.length ? errors : 'none');
  log('CONSOLE ERRORS', consoleErrs.length ? consoleErrs : 'none');
  log('NETWORK', requests);
  ws.close(); edge.kill();
  process.exit(0);
})().catch(e => { console.error('FATAL', e); edge.kill(); process.exit(1); });
