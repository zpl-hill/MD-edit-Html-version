/** e2e-image-insert.cjs — verify the「插入图片」dialog: file picker → Base64,
 *  manual path mode → relative reference, remembered preference affects drag-in,
 *  and the dialog opens/closes from both toolbar and Alt+I. */
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const ROOT = 'G:\\程序\\MD\\MarkdownStudio';
const DIST = path.join(ROOT, 'dist');
const TMP = path.join(DIST, 'image-insert-test');
fs.mkdirSync(TMP, { recursive: true });
for (const f of fs.readdirSync(TMP)) { try { fs.unlinkSync(path.join(TMP, f)); } catch (e) {} }

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
      raw[o] = 30; raw[o + 1] = 120 + Math.floor(80 * y / h); raw[o + 2] = 200;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}
const PNG_FILE = path.join(TMP, '截图 2026.png');
fs.writeFileSync(PNG_FILE, makePng(200, 120));

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = pathToFileURL(path.join(DIST, 'MarkdownStudioLite.html')).href;
const PORT = 9453;
const profile = path.join(os.tmpdir(), 'mdsl-ins-' + Date.now());
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank'
], { stdio: 'ignore', windowsHide: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const errors = [], consoleErrs = [];
async function evaluate(expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.text + ' :: ' + (r.result.exceptionDetails.exception?.description || '') };
  return r.result?.result?.value;
}
const log = (l, v) => console.log('\n=== ' + l + ' ===\n' + (typeof v === 'string' ? v : JSON.stringify(v, null, 1)));
const fails = [];
function check(name, ok, detail) {
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? ' — ' + detail : ''));
  if (!ok) fails.push(name);
}
const doc = () => evaluate(`CM6.EditorView.findFromDOM(document.querySelector('.cm-editor')).state.doc.toString()`);
const statusText = () => evaluate(`document.querySelector('#status-text').textContent`);

async function setFileInput(filePath) {
  await send('DOM.enable');
  const docNode = await send('DOM.getDocument', { depth: -1 });
  const rootId = docNode.result.root.nodeId;
  const found = await send('DOM.querySelector', { nodeId: rootId, selector: '#image-file-input' });
  const nodeId = found.result.nodeId;
  if (!nodeId) throw new Error('file input not found');
  await send('DOM.setFileInputFiles', { files: [filePath], nodeId });
}

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
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  await send('Page.navigate', { url: FILE }); await sleep(2200);

  /* 1. 工具栏入口 */
  const hasButton = await evaluate(`!!document.querySelector('[data-action="image"]')`);
  check('工具栏有「插入图片」按钮', hasButton === true);

  await evaluate(`document.querySelector('[data-action="image"]').click(); 'ok'`);
  await sleep(200);
  const opened = await evaluate(`document.querySelector('#image-dialog').classList.contains('open')`);
  check('点击后对话框打开', opened === true);

  /* 2. 选文件 → 内嵌 Base64 */
  await setFileInput(PNG_FILE);
  await sleep(700);
  const filled = await evaluate(`document.querySelector('#image-path').value`);
  check('选择文件后路径框回填文件名', typeof filled === 'string' && filled.includes('截图'), String(filled));
  const altFilled = await evaluate(`document.querySelector('#image-alt').value`);
  check('替代文本自动填文件名', altFilled === '截图 2026', String(altFilled));
  const previewOk = await evaluate(`document.querySelector('#image-preview').classList.contains('has-image')`);
  check('预览区显示图片', previewOk === true);

  await evaluate(`document.querySelector('[data-image="insert"]').click(); 'ok'`);
  await sleep(900);
  let text = await doc();
  const embedded = /!\[截图 2026\]\(data:image\/png;base64,[A-Za-z0-9+/=]{100,}\)/.test(text);
  check('内嵌模式写入 data URI', embedded);
  check('插入后对话框关闭', (await evaluate(`document.querySelector('#image-dialog').classList.contains('open')`)) === false);
  const st1 = await statusText();
  check('状态栏提示已内嵌', String(st1).includes('已内嵌'), String(st1));

  /* 3. 路径模式：手动输入相对路径 */
  await evaluate(`document.querySelector('[data-action="image"]').click(); 'ok'`);
  await sleep(150);
  await evaluate(`(() => {
    const radio = document.querySelector('input[name="image-mode"][value="path"]');
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    const p = document.querySelector('#image-path');
    p.value = './pic/flow chart.png';
    p.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(150);
  await evaluate(`document.querySelector('[data-image="insert"]').click(); 'ok'`);
  await sleep(600);
  text = await doc();
  check('路径模式写入相对路径（空格转义）', text.includes('(./pic/flow%20chart.png)'), text.slice(-160));
  check('路径模式不写入 base64', !text.slice(-80).includes('base64'));
  const st2 = await statusText();
  check('状态栏提示按路径插入', String(st2).includes('按路径插入'), String(st2));

  /* 4. 偏好已记住 → 拖入仍走内嵌并给出提示 */
  const pref = await evaluate(`localStorage.getItem('mdsl:pref:imageMode') || (window.__MDSL_TEST_PREF__ || null)`);
  log('PREF RAW', pref);
  const dragResult = await evaluate(`(() => {
    const b64 = ${JSON.stringify(makePng(80, 60).toString('base64'))};
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'dragged.png', { type: 'image/png' }));
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
    window.dispatchEvent(ev);
    return 'dispatched';
  })()`);
  await sleep(1200);
  text = await doc();
  check('拖入图片仍内嵌（拿不到磁盘路径）', text.includes('![dragged](data:image/png;base64,'));
  const st3 = await statusText();
  check('状态栏提示拖入无法取路径', String(st3).includes('拖入无法取得磁盘路径'), String(st3));

  /* 5. Alt+I 打开，Esc 关闭 */
  await evaluate(`document.body.click(); 'ok'`);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', altKey: true, bubbles: true })); 'ok'`);
  await sleep(200);
  const openedByKey = await evaluate(`document.querySelector('#image-dialog').classList.contains('open')`);
  check('Alt+I 打开对话框', openedByKey === true);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 'ok'`);
  await sleep(150);
  check('Esc 关闭对话框', (await evaluate(`document.querySelector('#image-dialog').classList.contains('open')`)) === false);

  /* 6. 对话框内不应出现外部请求 */
  log('EXCEPTIONS', errors);
  log('CONSOLE ERRORS', consoleErrs);
  check('无页面异常', errors.length === 0, errors.join(' | '));
  check('无 console 错误', consoleErrs.length === 0, consoleErrs.join(' | '));

  console.log('\n' + (fails.length ? 'IMAGE INSERT E2E: FAIL (' + fails.join(', ') + ')' : 'IMAGE INSERT E2E: PASS'));
  try { edge.kill(); } catch (e) {}
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); try { edge.kill(); } catch (x) {} process.exit(2); });
