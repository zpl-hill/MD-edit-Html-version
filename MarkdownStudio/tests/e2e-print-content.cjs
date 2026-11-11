/**
 * e2e-print-content.cjs — 打印输出「内容纯净性」回归（V1.13）
 *
 * 背景：V1.12 标签条、V1.11 阅读模式悬浮入口、构建期内嵌的第三方许可证
 * 声明都在 <body> 顶层，而 @media print 原本用黑名单逐个隐藏 UI，漏一个
 * 就会混进 PDF。V1.13 改为白名单（body 下只保留 .print-pages）。
 *
 * 验证手段：CDP 把页面切到 print 媒体后，
 *   1) 逐项断言 UI 元素的 computed display === 'none'；
 *   2) 用 document.body.innerText（会自动跳过 display:none 的元素）
 *      断言打印文本层不含标签名 / 悬浮按钮 / 许可证标题，且仍含文档正文与页码；
 *   3) 回到 screen 媒体，断言这些 UI 元素恢复可见，屏幕行为不受影响；
 *   4) 覆盖两条触发路径：直接打印（不进入 mdsl-print-mode）与打印预览模式。
 */
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const path = require('path');
const os = require('os');

const ROOT = 'G:\\程序\\MD\\MarkdownStudio';
const DIST = path.join(ROOT, 'dist');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = pathToFileURL(path.join(DIST, 'MarkdownStudioLite.html')).href;
const PORT = 9479;
const profile = path.join(os.tmpdir(), 'mdsl-print-content-' + Date.now());
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
  '--window-size=1400,900', 'about:blank'
], { stdio: 'ignore', windowsHide: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise(res => {
  const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' :: ' + (r.result.exceptionDetails.exception?.description || ''));
  return r.result?.result?.value;
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

/* 打印媒体下的可见性快照 + 文本层快照 */
const SNAPSHOT = `(() => {
  const disp = sel => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).display : '(missing)';
  };
  const pages = document.getElementById('print-pages');
  return {
    displays: {
      pages: disp('.print-pages'),
      tabbar: disp('.tabbar'),
      fab: disp('.recent-fab'),
      notices: disp('.third-party-notices'),
      toolbar: disp('.toolbar'),
      workspace: disp('.workspace'),
      statusbar: disp('.statusbar'),
      switcher: disp('#recent-switcher'),
      printDialog: disp('#print-dialog')
    },
    pageCount: pages.querySelectorAll('.print-page').length,
    text: document.body.innerText,
    tabName: (document.querySelector('.mdsl-tab-name') || {}).textContent || '',
    printMode: document.body.classList.contains('mdsl-print-mode')
  };
})()`;

(async () => {
  let target;
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find(t => t.type === 'page');
      if (target) break;
    } catch (e) { /* retry */ }
    await sleep(250);
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: FILE });
  await sleep(2600);

  // 打印桩：headless 下不能真弹系统对话框，只计数
  await evaluate(`(() => { window.__printCalls = 0; window.print = () => { window.__printCalls++; }; return true; })()`);

  // 换成一份可识别的短文档
  await evaluate(`(() => { document.querySelector('.cm-content').focus(); return true; })()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 });
  await sleep(150);
  await send('Input.insertText', { text: '# AAA\n\nAAA body\n\n用于核对打印输出只包含文档内容。' });
  await sleep(900);

  const seeded = await evaluate(`(() => ({
    preview: document.getElementById('preview').innerText,
    tabName: (document.querySelector('.mdsl-tab-name') || {}).textContent || '',
    hasNotices: !!document.querySelector('.third-party-notices')
  }))()`);
  check('文档已就绪且标签条/许可证节点存在',
    seeded.preview.includes('AAA body') && !!seeded.tabName && seeded.hasNotices,
    `tab="${seeded.tabName}"`);

  // 切到阅读模式，让 .recent-fab 在屏幕上处于可见状态（复现用户截图）
  await evaluate(`(document.querySelector('[data-view="reader"]').click(), true)`);
  await sleep(350);

  // ---- 路径 1：直接打印（Ctrl+Shift+P / 导出 PDF），不进入 mdsl-print-mode ----
  await evaluate(`(document.querySelector('[data-action="pdf"]').click(), true)`);
  await sleep(600);
  check('直接打印路径确实未进入预览模式',
    (await evaluate(`document.body.classList.contains('mdsl-print-mode')`)) === false);
  check('打印动作已触发（window.print 桩计数）',
    (await evaluate(`window.__printCalls`)) >= 1);

  await send('Emulation.setEmulatedMedia', { media: 'print', features: [] });
  await sleep(300);
  const p1 = await evaluate(SNAPSHOT);

  const hidden = ['tabbar', 'fab', 'notices', 'toolbar', 'workspace', 'statusbar', 'switcher', 'printDialog'];
  hidden.forEach(key => check(`[直接打印] ${key} 在打印输出中隐藏`, p1.displays[key] === 'none', p1.displays[key]));
  check('[直接打印] .print-pages 仍可见', p1.displays.pages !== 'none', p1.displays.pages);
  check('[直接打印] 预分页结果存在', p1.pageCount >= 1, `${p1.pageCount} 页`);
  check('[直接打印] 文本层保留文档正文与页码',
    p1.text.includes('AAA body') && /Page \d+ of \d+/.test(p1.text),
    JSON.stringify(p1.text.slice(0, 90)));
  check('[直接打印] 文本层不含标签名', !p1.text.includes(seeded.tabName), `tab="${seeded.tabName}"`);
  check('[直接打印] 文本层不含「最近文件」悬浮按钮',
    !p1.text.includes('☰ 最近文件') && !p1.text.includes('最近文件 · 快速切换'));
  check('[直接打印] 文本层不含第三方许可证声明',
    !p1.text.includes('Third-party software licenses'));
  check('[直接打印] 文本层不含应用品牌栏',
    !p1.text.includes('Markdown Studio') && !p1.text.includes('单文件 · 离线 · 零安装'));

  // ---- 回到屏幕媒体：UI 必须原样恢复 ----
  await send('Emulation.setEmulatedMedia', { media: '', features: [] });
  await sleep(300);
  const screen = await evaluate(`(() => {
    const d = sel => { const el = document.querySelector(sel); return el ? getComputedStyle(el).display : '(missing)'; };
    return { tabbar: d('.tabbar'), fab: d('.recent-fab'), notices: d('.third-party-notices'), pages: d('.print-pages') };
  })()`);
  check('[屏幕] 标签条恢复可见', screen.tabbar !== 'none', screen.tabbar);
  check('[屏幕] 阅读模式悬浮入口恢复可见', screen.fab !== 'none', screen.fab);
  check('[屏幕] 许可证声明仍在 DOM 中可见', screen.notices !== 'none', screen.notices);
  check('[屏幕] 非预览模式下打印页不占用编辑区', screen.pages === 'none', screen.pages);

  // ---- 路径 2：进入打印预览模式后再打印 ----
  await evaluate(`(document.querySelector('[data-action="print-mode"]').click(), true)`);
  await sleep(700);
  check('[预览] 已进入 mdsl-print-mode',
    (await evaluate(`document.body.classList.contains('mdsl-print-mode')`)) === true);

  await send('Emulation.setEmulatedMedia', { media: 'print', features: [] });
  await sleep(300);
  const p2 = await evaluate(SNAPSHOT);
  ['tabbar', 'fab', 'notices', 'toolbar', 'workspace'].forEach(key =>
    check(`[预览打印] ${key} 在打印输出中隐藏`, p2.displays[key] === 'none', p2.displays[key]));
  check('[预览打印] .print-pages 仍可见且已分页',
    p2.displays.pages !== 'none' && p2.pageCount >= 1, `${p2.pageCount} 页`);
  check('[预览打印] 文本层不含 UI 元素',
    !p2.text.includes('Third-party software licenses') &&
    !p2.text.includes(seeded.tabName) && !p2.text.includes('☰ 最近文件'));
  check('[预览打印] 文本层保留文档正文', p2.text.includes('AAA body'));

  await send('Emulation.setEmulatedMedia', { media: '', features: [] });

  // ---- 真实 PDF：CDP printToPDF 出文件，解压内容流统计可见文本 ----
  // Skia 把文本写成十六进制字形 ID（实测 "AAA" → <002400240024> Tj），
  // 所以明文搜索 ASCII 无效。改用对照实验：先出正常 PDF，再临时让白名单
  // 失效（模拟修复前），比较两份 PDF 内容流里的文本字形数量。
  // printToPDF 自身按打印媒体渲染，不依赖上面的 setEmulatedMedia。
  const zlib = require('zlib');
  function pdfText(base64) {
    const buf = Buffer.from(base64, 'base64');
    const latin = buf.toString('latin1');
    let all = '';
    const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let m;
    while ((m = streamRe.exec(latin)) !== null) {
      const raw = Buffer.from(m[1], 'latin1');
      try { all += zlib.inflateSync(raw).toString('latin1'); }
      catch (e) { all += m[1]; }
    }
    let glyphs = 0;
    const textRe = /<([0-9A-Fa-f\s]+)>\s*Tj/g;
    let t;
    while ((t = textRe.exec(all)) !== null) glyphs += t[1].replace(/\s/g, '').length / 4;
    return { size: buf.length, chars: all.length, glyphs, raw: all };
  }

  const normalRes = await send('Page.printToPDF', { preferCSSPageSize: true, printBackground: false });
  const normal = pdfText(normalRes.result.data);

  // 对照：只放行标签条与许可证声明（后插入的同特异性 !important 规则会盖过白名单）
  await evaluate(`(() => {
    const s = document.createElement('style');
    s.id = 'mdsl-diag-ui';
    s.textContent = '@media print { body > .tabbar, body > .third-party-notices { display: block !important; } }';
    document.head.appendChild(s);
    return true;
  })()`);
  const controlRes = await send('Page.printToPDF', { preferCSSPageSize: true, printBackground: false });
  const control = pdfText(controlRes.result.data);
  await evaluate(`(document.getElementById('mdsl-diag-ui').remove(), true)`);

  check('真实 PDF 已生成且内容流可解析',
    normal.size > 1000 && normal.chars > 100, `${normal.size} B / ${normal.chars} chars`);
  check('正常 PDF 文本量仅为文档正文量级',
    normal.glyphs > 0 && normal.glyphs < 200, `${normal.glyphs} glyphs`);
  check('对照实验可捕捉 UI 混入（放行 UI 后文本量显著增加）',
    control.glyphs > normal.glyphs + 20,
    `正常 ${normal.glyphs} → 对照 ${control.glyphs} glyphs`);
  check('正常 PDF 内容流无 UI 明文标记（ASCII 明文兜底）',
    !normal.raw.includes(seeded.tabName) && !normal.raw.includes('Third-party software licenses'),
    `tab="${seeded.tabName}"`);

  const errors = await evaluate(`(window.__mdslErrors || []).length`);
  check('页面运行期 0 异常', errors === 0, `${errors} 条`);

  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} PASS${failed.length ? ' — ' + failed.length + ' FAIL' : ''}`);
  ws.close(); edge.kill();
  process.exit(failed.length ? 1 : 0);
})().catch(err => {
  console.error('TEST ERROR', err);
  try { ws.close(); } catch (e) {}
  edge.kill();
  process.exit(1);
});
