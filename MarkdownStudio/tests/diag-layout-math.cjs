/** diag.cjs — diagnose reader layout + probe docx Math / Temml MathML APIs */
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const os = require('os');
const path = require('path');

const ROOT = 'G:\\程序\\MD\\MarkdownStudio';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = pathToFileURL(path.join(ROOT, 'dist', 'MarkdownStudioLite.html')).href;
const PORT = 9431;
const profile = path.join(os.tmpdir(), 'mdsl-diag-' + Date.now());
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
  if (r.result?.exceptionDetails) return { __error: (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 700) };
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
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description || '').slice(0, 300));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: FILE }); await sleep(2600);

  const rects = `(() => {
    const pick = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const c = getComputedStyle(e);
      return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        display: c.display, maxWidth: c.maxWidth, overflowY: c.overflowY, scrollW: e.scrollWidth, clientW: e.clientWidth}; };
    return JSON.stringify({
      viewport: [innerWidth, innerHeight],
      bodyClass: document.body.className,
      gridCols: getComputedStyle(document.querySelector('.workspace')).gridTemplateColumns,
      workspace: pick('.workspace'), tocPane: pick('.toc-pane'), editorPane: pick('.editor-pane'),
      previewPane: pick('.preview-pane'), paneTitle: pick('.preview-pane .pane-title'), markdownBody: pick('#preview')
    });
  })()`;

  log('SPLIT RECTS', await ev(rects));
  await ev(`document.querySelector('[data-view="reader"]').click(); 'ok'`);
  await sleep(400);
  log('READER RECTS', await ev(rects));

  log('DOCX MATH EXPORTS', await ev(`(() => {
    const d = globalThis.docx;
    return JSON.stringify(Object.keys(d).filter(k => /^Math|OMML|XmlComponent|Imported/i.test(k)));
  })()`));

  log('MATH CONSTRUCTORS', await ev(`(() => {
    const d = globalThis.docx;
    const names = ['Math','MathRun','MathFraction','MathSuperScript','MathSubScript','MathSubSuperScript','MathRadical','MathSum','MathIntegral','MathRoundBrackets','MathCurlyBrackets','MathSquareBrackets','MathAngledBrackets','MathFunction','MathLimit','MathLimitLower','MathLimitUpper','MathMatrix','MathText','MathDegree','MathNumerator','MathDenominator','MathBase','MathArg','ImportedXmlComponent','BaseXmlComponent'];
    return JSON.stringify(names.map(n => { const f = d[n]; if (typeof f !== 'function') return [n, 'missing'];
      let src = ''; try { src = String(f).slice(0, 260); } catch(e) { src = 'ERR'; }
      return [n, src]; }));
  })()`));

  log('TEMML MATHML SAMPLES', await ev(`(() => {
    const t = globalThis.temml;
    if (!t || !t.renderToString) return 'no temml';
    const tests = ['E = mc^2', '\\\\text{GRR} = \\\\sqrt{\\\\sigma_{EV}^2 + \\\\sigma_{AV}^2}', '\\\\frac{a}{b}', '\\\\sum_{i=1}^{n} x_i', '\\\\begin{pmatrix} a & b \\\\\\\\ c & d \\\\end{pmatrix}'];
    return JSON.stringify(tests.map(s => { try { return {tex: s, ml: t.renderToString(s, {displayMode:false}).slice(0, 900)}; } catch(e) { return {tex:s, err:String(e)}; } }));
  })()`));

  log('EXCEPTIONS', errors.length ? errors : 'none');
  ws.close(); edge.kill();
  process.exit(0);
})().catch(e => { console.error('FATAL', e); edge.kill(); process.exit(1); });
