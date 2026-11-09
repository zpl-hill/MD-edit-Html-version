/**
 * e2e-print.cjs — 打印设置与打印链路测试
 *
 * 覆盖：
 *   1. 设置对话框能打开，默认值正确（A4 纵向 / 常规边距 15-20mm）
 *   2. 纸张 + 方向 + 自定义边距生效：@page 规则、预览页尺寸、分页结果都跟着变
 *   3. 边距越大 → 每页装得越少（页数不少于窄边距）
 *   4. 「打印」真的调用 window.print（用桩函数计数，headless 下不会真弹对话框）
 *   5. 设置持久化：刷新后仍然生效
 */
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = 'G:\\程序\\MD\\MarkdownStudio';
const DIST = path.join(ROOT, 'dist');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = pathToFileURL(path.join(DIST, 'MarkdownStudioLite.html')).href;
const PORT = 9471;
const profile = path.join(os.tmpdir(), 'mdsl-print-' + Date.now());
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
async function evaluate(expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' :: ' + (r.result.exceptionDetails.exception?.description || ''));
  return r.result?.result?.value;
}
/** 打开打印设置：默认工具栏只有「打印预览」入口，设置按钮在预览模式的打印工具组里 */
async function openSetup() {
  const inPrint = await evaluate(`document.body.classList.contains('mdsl-print-mode')`);
  if (!inPrint) {
    await evaluate(`(document.querySelector('[data-action="print-mode"]').click(), true)`);
    await sleep(700);
  }
  await evaluate(`(document.querySelector('[data-action="print-setup"]').click(), true)`);
  await sleep(350);
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const SET_SELECT = (sel, value) => `(() => {
  const el = document.querySelector('${sel}');
  el.value = '${value}';
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value;
})()`;
const SET_NUM = (sel, value) => `(() => {
  const el = document.querySelector('${sel}');
  el.value = '${value}';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value;
})()`;
const PAGE_RULE = `(() => { const el = document.getElementById('mdsl-page-rule'); return el ? el.textContent : null; })()`;
const PAGE_STATE = `(() => {
  const root = document.getElementById('print-pages');
  const first = root.querySelector('.print-page');
  const cs = first ? getComputedStyle(first) : null;
  return {
    pages: root.querySelectorAll('.print-page').length,
    pageW: root.style.getPropertyValue('--page-w'),
    pageH: root.style.getPropertyValue('--page-h'),
    contentW: root.style.getPropertyValue('--content-w'),
    contentH: root.style.getPropertyValue('--content-h'),
    padding: cs ? [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft] : null,
    boxW: first ? Math.round(first.getBoundingClientRect().width / (Number(root.style.zoom) || 1)) : 0,
    printMode: document.body.classList.contains('mdsl-print-mode'),
    rule: (document.getElementById('mdsl-page-rule') || {}).textContent || null
  };
})()`;

const LONG = Array.from({ length: 70 }, (_, i) =>
  '第 ' + (i + 1) + ' 段：用于验证纸张与页边距对分页的影响，本段文字要足够长才能撑开页面高度，' +
  '重复一些内容以便稳定占满一行以上。').join('\n\n');

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

  // 清掉可能残留的打印偏好，保证从默认值开始
  await evaluate(`(() => {
    try {
      const key = 'mdstudio.prefs';
      const data = JSON.parse(localStorage.getItem(key) || '{}');
      delete data.printSettings;
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) { /* ignore */ }
    return true;
  })()`);

  // 打印桩：headless 下不能真弹对话框，只统计调用次数
  await evaluate(`(() => { window.__printCalls = 0; window.print = () => { window.__printCalls++; }; return true; })()`);

  // 换成一份长文档，便于观察分页差异
  await evaluate(`(() => {
    const el = document.querySelector('.cm-content');
    el.focus();
    return true;
  })()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 });
  await sleep(150);
  await send('Input.insertText', { text: LONG });
  await sleep(900);
  // CM6 只渲染视口内的行，用 DOM 文本量长度不可靠 → 以实时预览（完整渲染）为准
  const seeded = await evaluate(`(() => {
    const text = document.getElementById('preview').innerText;
    return { len: text.length, startsWithFirst: text.indexOf('第 1 段') >= 0 };
  })()`);
  check('长文档已就绪', seeded.len > 1000 && seeded.startsWithFirst, `${seeded.len} 字符`);

  // 1) 打开设置对话框
  await openSetup();
  const opened = await evaluate(`(() => {
    const d = document.getElementById('print-dialog');
    return {
      open: d.classList.contains('open'),
      paper: document.getElementById('print-paper').value,
      orientation: document.getElementById('print-orientation').value,
      preset: document.getElementById('print-margin-preset').value,
      mm: ['mt','mb','ml','mr'].map(k => document.getElementById('print-' + k).value),
      disabled: document.getElementById('print-mt').disabled,
      note: document.getElementById('print-layout-note').textContent
    };
  })()`);
  check('打印设置对话框可打开', opened.open === true);
  check('默认纸张 A4 / 纵向 / 常规边距', opened.paper === 'a4' && opened.orientation === 'portrait' && opened.preset === 'normal',
    `${opened.paper}/${opened.orientation}/${opened.preset}`);
  check('默认边距 15·15·20·20 且只读', opened.mm.join(',') === '15,15,20,20' && opened.disabled === true, opened.mm.join(','));
  check('版面提示显示可打印区', /可打印区\s*170\s*×\s*267\s*mm/.test(opened.note), opened.note);

  // 2) 切到宽边距 → 预览 → 记页数
  await evaluate(SET_SELECT('#print-margin-preset', 'wide'));
  await evaluate(`(document.querySelector('[data-print="preview"]').click(), true)`);
  await sleep(1500);
  const wide = await evaluate(PAGE_STATE);
  check('宽边距进入打印预览', wide.printMode === true && wide.pages > 0, `${wide.pages} 页`);
  check('宽边距 @page = 25mm 四边', /margin:\s*25mm 25mm 25mm 25mm/.test(wide.rule || ''), wide.rule);
  // 白纸 = 整张纸，页边距用 padding 表现（否则文字会贴着纸边，看起来没有边距）
  const mmOf = px => Math.round(parseFloat(px) * 25.4 / 96);
  check('宽边距预览白纸 = 整张 A4 (210×297mm)', wide.pageW === '210mm' && wide.pageH === '297mm', wide.pageW + ' / ' + wide.pageH);
  check('宽边距可打印区 160×247mm', wide.contentW === '160mm' && wide.contentH === '247mm', wide.contentW + ' / ' + wide.contentH);
  check('页边距以 25mm padding 呈现（上右下左）', (wide.padding || []).map(mmOf).join(',') === '25,25,25,25', (wide.padding || []).map(mmOf).join(','));
  check('白纸实际渲染宽度 ≈ 210mm', Math.abs(wide.boxW - 794) <= 3, wide.boxW + 'px');

  // 3) 切到 A3 横向 + 自定义 8mm
  await openSetup();
  await evaluate(SET_SELECT('#print-paper', 'a3'));
  await evaluate(SET_SELECT('#print-orientation', 'landscape'));
  await evaluate(SET_SELECT('#print-margin-preset', 'custom'));
  await evaluate(SET_NUM('#print-mt', '8'));
  await evaluate(SET_NUM('#print-mr', '8'));
  await evaluate(SET_NUM('#print-mb', '8'));
  await evaluate(SET_NUM('#print-ml', '8'));
  await evaluate(`(document.querySelector('[data-print="preview"]').click(), true)`);
  await sleep(1500);
  const a3 = await evaluate(PAGE_STATE);
  check('A3 横向 @page 规则正确', /size:\s*A3 landscape/.test(a3.rule || '') && /margin:\s*8mm 8mm 8mm 8mm/.test(a3.rule || ''), a3.rule);
  check('A3 横向白纸 = 420×297mm，可打印区 404×281mm',
    a3.pageW === '420mm' && a3.pageH === '297mm' && a3.contentW === '404mm' && a3.contentH === '281mm',
    `${a3.pageW} / ${a3.pageH} · ${a3.contentW} / ${a3.contentH}`);
  check('A3 横向页数少于 A4 纵向宽边距', a3.pages < wide.pages, `${a3.pages} < ${wide.pages}`);

  // 4) 点工具栏「打印」→ 必须真的调用 window.print
  await evaluate(`(document.querySelector('[data-action="print"]').click(), true)`);
  await sleep(600);
  const printed = await evaluate(`({ calls: window.__printCalls, state: ${PAGE_STATE} })`);
  check('「打印」调用系统打印一次', printed.calls === 1, `window.print 调用 ${printed.calls} 次`);
  check('打印前已重新分页', printed.state.pages > 0, `${printed.state.pages} 页`);

  // 5) 对话框内的「打印」按钮
  await openSetup();
  await evaluate(`(document.querySelector('[data-print="go"]').click(), true)`);
  await sleep(700);
  const printed2 = await evaluate(`({ calls: window.__printCalls, open: document.getElementById('print-dialog').classList.contains('open') })`);
  check('对话框「打印」同样出纸并关闭对话框', printed2.calls === 2 && printed2.open === false, `calls=${printed2.calls}`);

  // 6) 持久化：刷新后仍是 A3 横向 + 自定义 8mm
  await send('Page.navigate', { url: FILE });
  await sleep(2600);
  await openSetup();
  const restored = await evaluate(`(() => ({
    paper: document.getElementById('print-paper').value,
    orientation: document.getElementById('print-orientation').value,
    preset: document.getElementById('print-margin-preset').value,
    mt: document.getElementById('print-mt').value,
    disabled: document.getElementById('print-mt').disabled,
    rule: (document.getElementById('mdsl-page-rule') || {}).textContent
  }))()`);
  check('刷新后设置保持 A3 / 横向 / 自定义 8mm',
    restored.paper === 'a3' && restored.orientation === 'landscape' && restored.preset === 'custom' && restored.mt === '8',
    `${restored.paper}/${restored.orientation}/${restored.preset}/${restored.mt}`);
  check('刷新后 @page 仍是 A3 横向 8mm', /size:\s*A3 landscape/.test(restored.rule || ''), restored.rule);

  // 7) 退出预览：工具栏「退出预览」按钮 + Esc 两种方式都必须能回到编辑
  await openSetup();
  await evaluate(`(document.querySelector('[data-print="preview"]').click(), true)`);
  await sleep(1200);
  const inPreview = await evaluate(`(() => {
    const btn = document.querySelector('[data-action="exit-preview"]');
    const vis = btn ? getComputedStyle(btn).display !== 'none' && btn.getBoundingClientRect().width > 0 : false;
    return { mode: document.body.classList.contains('mdsl-print-mode'), btnVisible: vis };
  })()`);
  check('预览模式里「退出预览」按钮可见', inPreview.mode === true && inPreview.btnVisible === true,
    `mode=${inPreview.mode} btn=${inPreview.btnVisible}`);

  await evaluate(`(document.querySelector('[data-action="exit-preview"]').click(), true)`);
  await sleep(600);
  const afterExit = await evaluate(`(() => ({
    mode: document.body.classList.contains('mdsl-print-mode'),
    editorVisible: document.querySelector('.workspace').getBoundingClientRect().width > 0
  }))()`);
  check('点「退出预览」回到编辑且编辑器可见', afterExit.mode === false && afterExit.editorVisible === true,
    `mode=${afterExit.mode} editor=${afterExit.editorVisible}`);

  await evaluate(`(document.querySelector('[data-action="print-mode"]').click(), true)`);
  await sleep(1200);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(500);
  const afterEsc = await evaluate(`document.body.classList.contains('mdsl-print-mode')`);
  check('按 Esc 退出打印预览', afterEsc === false, `mode=${afterEsc}`);

  const failed = results.filter(r => !r.pass);
  console.log(`\n${failed.length === 0 ? 'ALL PASS' : 'FAILURES: ' + failed.length} (${results.length} checks)`);
  ws.close(); edge.kill();
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => {
  console.error('FATAL', e);
  try { edge.kill(); } catch (_) { /* noop */ }
  process.exit(1);
});
