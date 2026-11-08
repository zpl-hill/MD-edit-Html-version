/** e2e-desktop-image.cjs — 桌面版路径引用图片验收：
 *  1) Markdown 里的相对路径能在预览中真正加载（asset 协议 / data URI 兜底）
 *  2) image_markdown_path 会算相对路径（同目录、子目录、跨目录）
 *  3) 对话框「引用路径」插入后，正文与预览都正确
 *  4) read_image_data_url 能返回合法 data URI */
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

const ROOT = 'G:\\程序\\MD\\MarkdownStudio';
const EXE = path.join(ROOT, 'dist', 'MarkdownStudioLite.exe');
const WORK = path.join(ROOT, 'dist', 'desktop-img-test');
const SUB = path.join(WORK, 'docs');
const PORT = 9335;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (l, v) => console.log('\n=== ' + l + ' ===\n' + (typeof v === 'string' ? v : JSON.stringify(v, null, 1)));

/* --- tiny PNG --- */
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
      raw[o] = 240; raw[o + 1] = 90; raw[o + 2] = 30;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}

const PIC = path.join(WORK, 'pic.png');
const DOC = path.join(SUB, 'doc.md');
const PIC_REL_FROM_DOC = '../pic.png';

if (!fs.existsSync(EXE)) { console.error('EXE not found: ' + EXE); process.exit(2); }
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(SUB, { recursive: true });
fs.writeFileSync(PIC, makePng(200, 120));
fs.writeFileSync(DOC, '# 路径图片测试\n\n![示意图](' + PIC_REL_FROM_DOC + ')\n\n末尾段落。\n', 'utf8');

let ws, seq = 0;
const pending = new Map();
const errors = [];
const send = (m, p = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
async function ev(expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails;
    return { __error: (d.exception && d.exception.description || d.text || '').slice(0, 500) };
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
}
const fails = [];
function check(name, ok, detail) {
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
  if (!ok) fails.push(name);
}

function killTree(pid) { try { execSync('taskkill /PID ' + pid + ' /T /F', { stdio: 'ignore' }); } catch (e) {} }

(async () => {
  const child = spawn(EXE, [DOC], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + PORT },
    stdio: 'ignore', windowsHide: false
  });

  let url = null;
  for (let i = 0; i < 90; i++) {
    try {
      const j = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = j.find(x => x.type === 'page');
      if (p) { url = p.webSocketDebuggerUrl; break; }
    } catch (e) {}
    await sleep(250);
  }
  if (!url) { console.error('CDP not ready'); killTree(child.pid); process.exit(2); }
  ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const f = pending.get(m.id); pending.delete(m.id); f(m); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.text || '') + ' :: ' + (m.params.exceptionDetails?.exception?.description || '').slice(0, 300));
  };
  await send('Runtime.enable');
  await sleep(1200);

  /* 1. 打开的是 doc.md，预览里的相对路径图片应该真的加载出来 */
  const loaded = await ev(`(() => {
    const img = document.querySelector('#preview img');
    if (!img) return { found: false };
    return {
      found: true,
      src: img.getAttribute('src'),
      marked: img.getAttribute('data-mdsl-local'),
      natural: img.naturalWidth + 'x' + img.naturalHeight,
      complete: img.complete
    };
  })()`);
  log('PREVIEW IMAGE', loaded);
  check('预览里找到图片', loaded && loaded.found === true);
  if (loaded && loaded.found) {
    check('识别为本地路径并改写', !!loaded.marked, loaded.marked);
    check('图片实际解码成功（非裂图）', loaded.natural !== '0x0', loaded.natural);
  }

  /* 2. 相对路径计算 */
  const same = await ev(`window.__TAURI__.core.invoke('image_markdown_path', { baseFile: ${JSON.stringify(path.join(WORK, 'main.md'))}, image: ${JSON.stringify(PIC)} })`, true);
  check('同目录 → 相对文件名', same === 'pic.png', same);

  const up = await ev(`window.__TAURI__.core.invoke('image_markdown_path', { baseFile: ${JSON.stringify(DOC)}, image: ${JSON.stringify(PIC)} })`, true);
  check('子目录 → ../ 相对路径', up === '../pic.png', up);

  const cross = await ev(`window.__TAURI__.core.invoke('image_markdown_path', { baseFile: null, image: ${JSON.stringify(PIC)} })`, true);
  check('文档未保存 → 绝对路径（正斜杠）', typeof cross === 'string' && cross.endsWith('/pic.png') && cross.startsWith('G:/'), cross);

  /* 3. read_image_data_url */
  const dataUrl = await ev(`window.__TAURI__.core.invoke('read_image_data_url', { path: ${JSON.stringify(PIC)} })`, true);
  check('读成 data URI', typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,'), typeof dataUrl === 'string' ? dataUrl.slice(0, 40) : dataUrl);

  /* 4. 对话框「引用路径」插入 */
  await ev(`document.querySelector('[data-action="image"]').click(); 'ok'`);
  await sleep(200);
  await ev(`(() => {
    const radio = document.querySelector('input[name="image-mode"][value="path"]');
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    const p = document.querySelector('#image-path');
    p.value = ${JSON.stringify(PIC)};
    p.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(300);
  const previewTag = await ev(`(() => { const i = document.querySelector('#image-preview img'); return i ? { src: i.getAttribute('src').slice(0, 60), natural: i.naturalWidth + 'x' + i.naturalHeight } : null; })()`);
  log('DIALOG PREVIEW', previewTag);
  check('对话框内预览出图片', !!previewTag && previewTag.natural !== '0x0', previewTag);

  await ev(`document.querySelector('[data-image="insert"]').click(); 'ok'`);
  await sleep(1200);
  const text = await ev(`CM6.EditorView.findFromDOM(document.querySelector('.cm-editor')).state.doc.toString()`);
  check('插入的是相对路径，不是 base64', text.includes('(../pic.png)') && !text.includes('base64'), text.slice(-60));

  const imgs = await ev(`Array.from(document.querySelectorAll('#preview img')).map(i => ({ n: i.naturalWidth, src: (i.getAttribute('src') || '').slice(0, 30) }))`);
  log('PREVIEW IMAGES AFTER INSERT', imgs);
  check('新插入的图片也能显示', Array.isArray(imgs) && imgs.length >= 2 && imgs[imgs.length - 1].n > 0, imgs);

  /* 5. 导出 DOCX：路径图片应在桌面版被读进来（而不是留下占位文字） */
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: WORK }).catch(() => {});
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: WORK, eventsEnabled: true }).catch(() => {});
  await ev(`document.querySelector('[data-action="docx"]').click(); 'ok'`);
  await sleep(4500);
  const st = await ev(`document.querySelector('#status-text').textContent`);
  log('DOCX STATUS', st);
  const docxFiles = fs.readdirSync(WORK).filter(f => f.endsWith('.docx'));
  check('DOCX 已下载', docxFiles.length > 0, docxFiles);
  if (docxFiles.length) {
    const buf = fs.readFileSync(path.join(WORK, docxFiles[0]));
    const names = [];
    let from = 0;
    while (true) {
      const i = buf.indexOf(Buffer.from('word/media/'), from);
      if (i < 0) break;
      names.push(buf.slice(i, i + 24).toString('latin1').replace(/[^\w./]/g, ''));
      from = i + 5;
    }
    log('DOCX MEDIA', names);
    check('路径图片写进了 word/media', names.length >= 1, names);
    check('状态栏没有「占位文字」告警', !String(st).includes('占位文字'), st);
  }

  /* 6. 异常 */
  log('EXCEPTIONS', errors);
  check('无页面异常', errors.length === 0, errors);

  console.log('\n' + (fails.length ? 'DESKTOP IMAGE E2E: FAIL (' + fails.join(', ') + ')' : 'DESKTOP IMAGE E2E: PASS'));
  killTree(child.pid);
  try { fs.rmSync(WORK, { recursive: true, force: true }); } catch (e) {}
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
