/** shoot.cjs — drive the single-file app via Edge CDP and capture real screenshots. */
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const path = require('path');
// Node 22+ provides global WebSocket; no extra dep needed.

const ROOT = 'G:\\程序\\MD\\MarkdownStudio';
const DIST = path.join(ROOT, 'dist');
const OUT = 'G:\\程序\\MD\\MD-bilibili\\screenshots';
fs.mkdirSync(OUT, { recursive: true });
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = pathToFileURL(path.join(DIST, 'MarkdownStudioLite.html')).href;
const PORT = 9433;
const profile = path.join(os.tmpdir(), 'mdsl-shoot-' + Date.now());
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--force-device-scale-factor=1.25',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank'
], { stdio: 'ignore', windowsHide: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise(res => {
  const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.text };
  return r.result?.result?.value;
};

// --- nice gradient SVG banner as data URI (shows the image-insert feature) ---
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200" viewBox="0 0 640 200">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#06b6d4"/></linearGradient></defs>
<rect width="640" height="200" rx="16" fill="url(#g)"/>
<text x="32" y="80" font-family="Segoe UI, sans-serif" font-size="34" font-weight="700" fill="#fff">Markdown Studio Lite</text>
<text x="32" y="120" font-family="Segoe UI, sans-serif" font-size="18" fill="#e0e7ff">完全本地 · 单文件 · 双击即用</text>
<text x="32" y="160" font-family="Segoe UI, sans-serif" font-size="15" fill="#cffafe">编辑 · 预览 · 导出 一站式</text>
</svg>`;
const IMG = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');

const MD = [
'# 🚀 Markdown Studio Lite 使用手册',
'',
'> 一个 **完全本地、零依赖、双击即用** 的 Markdown 编辑器',
'',
'## 一、为什么选它',
'',
'- ✅ 单文件 HTML，**断网也能用**，数据绝不出本机',
'- ✅ 三栏布局：大纲 · 编辑 · 预览 同屏可见',
'- ✅ 支持图片、数学公式、代码高亮、表格',
'',
'## 二、核心功能速览',
'',
'| 功能 | 说明 | 状态 |',
'| --- | --- | --- |',
'| 本地存储 | IndexedDB 自动保存 | ✅ |',
'| 三栏视图 | 编辑 / 阅读 / 分屏 | ✅ |',
'| 图片插入 | 粘贴即内嵌 Base64 | ✅ |',
'| 语法提示 | F1 速查 + 一键插入 | ✅ |',
'',
'### 2.1 行内与独立公式',
'',
'质能方程 $E = mc^2$，样本方差：',
'',
'$$\\sigma^2 = \\frac{1}{n}\\sum_{i=1}^{n}(x_i-\\bar{x})^2$$',
'',
'### 2.2 代码高亮',
'',
'```python',
'def greet(name: str) -> str:',
'    return f"你好，{name}！"',
'',
'print(greet("Markdown"))',
'```',
'',
'![封面图](' + IMG + ')',
'',
'> 💡 提示：按 **F6** 可在「分屏 / 编辑 / 阅读」三种视图间一键切换。',
'',
'## 三、今日待办',
'',
'1. 写一份周报',
'2. 整理读书笔记',
'3. 导出 PDF 交付客户',
'',
'## 四、使用心得',
'',
...Array.from({ length: 26 }, (_, i) =>
  `段落 ${i + 1}：Markdown Studio Lite 主打「离线优先」。所有数据存于本机 IndexedDB，断网照样编辑；刷新页面会自动恢复上次内容，不必担心丢失。导出 PDF 走浏览器原生打印，公式与表格保真呈现，非常适合写技术报告与质量文档。`
),
'',
'---',
'',
'**作者**：Zhao Pengliang (Fred)  ·  纯前端 · 离线优先',
''
].join('\n');

async function setViewport(w, h) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1.25, mobile: false });
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const buf = Buffer.from(r.result.data, 'base64');
  const p = path.join(OUT, name + '.png');
  fs.writeFileSync(p, buf);
  console.log('saved', name + '.png', buf.length, 'bytes');
}

(async () => {
  let url;
  for (let i = 0; i < 80; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const pg = j.find(x => x.type === 'page'); if (pg) { url = pg.webSocketDebuggerUrl; break; } } catch (e) {}
    await sleep(200);
  }
  if (!url) throw new Error('CDP not ready');
  ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const f = pending.get(m.id); pending.delete(m.id); f(m); } };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: FILE });
  await sleep(2800);

  // inject content
  await evaluate(`(() => {
    const view = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    if (!view) return 'NO VIEW';
    const md = ${JSON.stringify(MD)};
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: md } });
    return 'len=' + view.state.doc.length;
  })()`);
  await sleep(1200);

  // 1) HERO — split (three-pane) view
  await evaluate(`document.querySelector('[data-view="split"]')?.click(); "ok"`);
  await sleep(700);
  await setViewport(1500, 960);
  await sleep(400);
  await shot('01-hero-split');

  // 2) READER mode
  await evaluate(`document.querySelector('[data-view="reader"]')?.click(); "ok"`);
  await sleep(700);
  await setViewport(1180, 960);
  await sleep(400);
  await shot('02-reader-mode');

  // 3) HELP / syntax cheat sheet (F1)
  await evaluate(`document.querySelector('[data-view="split"]')?.click(); "ok"`);
  await sleep(400);
  await setViewport(1500, 960);
  await sleep(300);
  await evaluate(`document.querySelector('[data-action="help"]')?.click(); "ok"`);
  await sleep(700);
  await shot('03-help-syntax');
  await evaluate(`document.querySelector('#help-dialog [data-close]')?.click(); "ok"`);
  await sleep(300);

  // 4) INSERT IMAGE dialog
  await evaluate(`document.querySelector('[data-action="image"]')?.click(); "ok"`);
  await sleep(700);
  await shot('04-insert-image');
  await evaluate(`document.querySelector('#image-dialog [data-close]')?.click(); "ok"`);
  await sleep(300);

  // 5) DARK theme (close any open dialog first, then verify toggle)
  await evaluate(`document.querySelectorAll('[data-close]').forEach(b => { try { b.click(); } catch(e){} }); "ok"`);
  await sleep(700);
  for (let i = 0; i < 3; i++) {
    const t = await evaluate(`document.documentElement.getAttribute('data-theme')`);
    if (t === 'dark') break;
    await evaluate(`document.querySelector('[data-action="theme"]')?.click(); "ok"`);
    await sleep(500);
  }
  await setViewport(1500, 960);
  await sleep(400);
  const dbg = await evaluate(`(function(){return JSON.stringify({theme:document.documentElement.getAttribute('data-theme'),bodyBg:getComputedStyle(document.body).backgroundColor,editorBg:getComputedStyle(document.querySelector('.cm-editor')).backgroundColor,previewBg:getComputedStyle(document.querySelector('#preview')).backgroundColor});})()`);
  console.log('DARK DBG:', dbg);
  await shot('05-dark-theme');

  // 6) PRINT / A4 pagination
  await evaluate(`document.querySelector('[data-action="print-mode"]')?.click(); "ok"`);
  await sleep(1800);
  await setViewport(1100, 1760);
  await sleep(500);
  await shot('06-print-pages');

  console.log('ALL DONE');
})().catch(e => console.error('ERROR:', e.message, e.stack)).finally(() => {
  try { ws && ws.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  setTimeout(() => process.exit(0), 400);
});
