/** e2e-docx-image.cjs — verify image ingestion (paste/drop) + DOCX image export.
 *  Checks: inline PNG + SVG data URIs land in word/media/*, external/relative paths
 *  degrade with a status-bar warning, pasted/dropped image files become data URIs. */
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const ROOT = 'G:\\程序\\MD\\MarkdownStudio';
const DIST = path.join(ROOT, 'dist');
const DOWNLOADS = path.join(DIST, 'downloads');
fs.mkdirSync(DOWNLOADS, { recursive: true });
for (const f of fs.readdirSync(DOWNLOADS)) { try { fs.unlinkSync(path.join(DOWNLOADS, f)); } catch (e) {} }

/* --- tiny PNG encoder (no external deps) --- */
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
}
function makePng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = 210 + Math.floor(40 * x / w); raw[o + 1] = 40; raw[o + 2] = 40;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}
const PNG_B64 = makePng(160, 90).toString('base64');
const PNG = 'data:image/png;base64,' + PNG_B64;
const SVG = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#cc3333"/></svg>'
).toString('base64');

function zipInfo(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return [];
  const count = buf.readUInt16LE(eocd + 10), cd = buf.readUInt32LE(eocd + 16);
  const out = []; let p = cd;
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    out.push({ name, size: buf.readUInt32LE(p + 24), local: buf.readUInt32LE(p + 42) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
function readZipEntry(buf, entry) {
  const p = entry.local;
  const nameLen = buf.readUInt16LE(p + 26), extraLen = buf.readUInt16LE(p + 28);
  const method = buf.readUInt16LE(p + 8), size = buf.readUInt32LE(p + 18);
  const data = buf.slice(p + 30 + nameLen + extraLen, p + 30 + nameLen + extraLen + size);
  return method === 8 ? zlib.inflateRawSync(data) : data;
}

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = pathToFileURL(path.join(DIST, 'MarkdownStudioLite.html')).href;
const PORT = 9451;
const profile = path.join(os.tmpdir(), 'mdsl-img-' + Date.now());
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank'
], { stdio: 'ignore', windowsHide: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const errors = [], consoleErrs = [], requests = [], dlEvents = [];
async function evaluate(expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.text + ' :: ' + (r.result.exceptionDetails.exception?.description || '') };
  return r.result?.result?.value;
}
const log = (l, v) => console.log('\n=== ' + l + ' ===\n' + (typeof v === 'string' ? v : JSON.stringify(v, null, 1)));

const MD = [
  '# 图片导出验证',
  '',
  '![内嵌 PNG](' + PNG + ')',
  '',
  '![内嵌 SVG](' + SVG + ')',
  '',
  '![相对路径](./pic.png)',
  '',
  '![外链图片](https://example.invalid/nope.png)',
  '',
  '文末段落。',
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
    if (/download/i.test(m.method || '')) dlEvents.push(m.method + ' ' + JSON.stringify(m.params).slice(0, 240));
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS, eventsEnabled: true }).catch(() => {});
  await send('Page.navigate', { url: FILE }); await sleep(2200);

  /* --- 1. paste an image file --- */
  log('PASTE', await evaluate(`(() => {
    const b64 = ${JSON.stringify(PNG_B64)};
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'paste-shot.png', { type: 'image/png' }));
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: dt });
    document.dispatchEvent(ev);
    return 'dispatched';
  })()`));
  await sleep(900);
  log('PASTE RESULT', await evaluate(`(() => {
    const t = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor')).state.doc.toString();
    return JSON.stringify({ hasPaste: t.includes('![paste-shot](data:image/png;base64,'), len: t.length,
      status: document.querySelector('#status-text').textContent });
  })()`));

  /* --- 2. drop an image file --- */
  log('DROP', await evaluate(`(() => {
    const b64 = ${JSON.stringify(PNG_B64)};
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'drop-shot.png', { type: 'image/png' }));
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    window.dispatchEvent(ev);
    return 'dispatched';
  })()`));
  await sleep(900);
  log('DROP RESULT', await evaluate(`(() => {
    const t = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor')).state.doc.toString();
    return JSON.stringify({ hasPaste: t.includes('![paste-shot]('), hasDrop: t.includes('![drop-shot]('),
      imgCount: document.querySelectorAll('#preview img').length,
      status: document.querySelector('#status-text').textContent });
  })()`));

  /* --- 3. export a doc with PNG + SVG + relative path + external URL --- */
  await evaluate(`(() => { const view = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor')); view.dispatch({changes:{from:0,to:view.state.doc.length,insert:${JSON.stringify(MD)}}}); return 'ok'; })()`);
  await sleep(900);
  log('TOKENS', await evaluate(`(() => { const t = globalThis.marked.lexer(CM6.EditorView.findFromDOM(document.querySelector('.cm-editor')).state.doc.toString()); return JSON.stringify(t.filter(x=>x.type==='paragraph').map(p=>p.tokens.map(x=>x.type))); })()`));

  await evaluate(`document.querySelector('[data-action="docx"]').click(); 'ok'`);
  await sleep(6000);
  log('STATUS', await evaluate(`document.querySelector('#status-text').textContent`));
  log('DL EVENTS', dlEvents);
  log('DIR RAW', fs.readdirSync(DOWNLOADS));
  const files = fs.readdirSync(DOWNLOADS).filter(f => !f.endsWith('.crdownload'));
  log('DOWNLOADS', files.map(f => f + ' (' + fs.statSync(path.join(DOWNLOADS, f)).size + ' B)'));

  const docx = files.find(f => f.endsWith('.docx'));
  if (docx) {
    const buf = fs.readFileSync(path.join(DOWNLOADS, docx));
    const entries = zipInfo(buf);
    log('ZIP MEDIA', entries.filter(e => /word\/media\//.test(e.name)).map(e => e.name + ' (' + e.size + ' B)'));
    const docEntry = entries.find(e => e.name === 'word/document.xml');
    const xml = docEntry ? readZipEntry(buf, docEntry).toString('utf8') : '';
    log('DOCUMENT XML', {
      drawings: (xml.match(/<w:drawing>/g) || []).length,
      centered: (xml.match(/w:jc w:val="center"/g) || []).length,
      placeholders: (xml.match(/\[图片:/g) || []).length,
      heading: /w:val="Heading1"/.test(xml)
    });
  }
  log('EXCEPTIONS', errors.length ? errors : 'none');
  log('CONSOLE ERRORS', consoleErrs.length ? consoleErrs : 'none');
  log('NETWORK (non-file)', requests.filter(u => !u.startsWith('file:') && !u.startsWith('data:')));
  ws.close(); edge.kill();
  process.exit(0);
})().catch(e => { console.error('FATAL', e); edge.kill(); process.exit(1); });
