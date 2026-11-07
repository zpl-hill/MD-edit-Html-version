/** vendor-smoke.cjs — 用 Edge CDP 在 file:// 下验证各 vendor 全局对象与 API 签名 */
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = pathToFileURL('G:\\程序\\MD\\MarkdownStudio\\tests\\vendor-smoke.html').href;
const PORT = 9411;
const profile = path.join(os.tmpdir(), 'mdsl-smoke-' + Date.now());
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank'
], { stdio: 'ignore', windowsHide: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise(res => {
  const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});

const EXPR = `(()=>{
  const out = {};
  out.globals = {marked:typeof marked, Prism:typeof Prism, docx:typeof docx, temml:typeof temml, CM6:typeof CM6};
  try {
    out.markedParse = marked.parse('# Hi\\n\\n|a|b|\\n|-|-|\\n|1|2|').slice(0,160);
    out.markedTokens = marked.lexer('# Hi\\n\\n- a\\n- b').map(t=>({type:t.type,depth:t.depth,text:t.text}));
    out.rendererKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(new marked.Renderer())).slice(0,25);
  } catch(e){ out.markedErr = e.message; }
  try { out.temmlKeys = Object.keys(temml).slice(0,20);
        out.temmlOut = typeof temml.renderToString==='function' ? temml.renderToString('x^2 + \\\\frac{1}{2}').slice(0,220) : 'NO renderToString'; }
  catch(e){ out.temmlErr = e.message; }
  try { out.docxKeys = ['Document','Paragraph','TextRun','Packer','HeadingLevel','Table','TableRow','TableCell','ImageRun','ExternalHyperlink','PageNumber','Footer','Header','AlignmentType','BorderStyle','ShadingType','PageOrientation','NumberFormat'].filter(k=>k in docx); }
  catch(e){ out.docxErr = e.message; }
  try { out.cm6Keys = Object.keys(CM6).slice(0,45); }
  catch(e){ out.cm6Err = e.message; }
  try { out.prismLangs = Object.keys(Prism.languages).length;
        out.prismSample = Prism.highlight('const x = 1;', Prism.languages.javascript, 'javascript').slice(0,120); }
  catch(e){ out.prismErr = e.message; }
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
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const f = pending.get(m.id); pending.delete(m.id); f(m); } };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: FILE }); await sleep(2500);
  const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EXCEPTION:', JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  console.log(r.result?.result?.value || 'no result');
})().catch(e => console.error('ERROR:', e.message)).finally(() => {
  try { ws && ws.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  setTimeout(() => process.exit(0), 300);
});
