/** e2e-print-desktop.cjs — 桌面版（WebView2）打印设置与预览链路
 *  说明：不实际调用 window.print()——Chromium 的 print() 是同步阻塞调用，
 *  自动化里会把渲染进程挂住；这里只验证能力存在 + 设置/预览/分页链路正确。
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const ROOT = 'G:\\程序\\MD\\MarkdownStudio';
const EXE = path.join(ROOT, 'dist', 'MarkdownStudioLite.exe');
const PORT = 9501;
const app = spawn(EXE, [], {
  stdio: 'ignore', windowsHide: true,
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + PORT }
});

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

(async () => {
  let target;
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find(t => t.type === 'page');
      if (target) break;
    } catch (e) { /* retry */ }
    await sleep(300);
  }
  if (!target) throw new Error('无法连接 WebView2 调试端口');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  await send('Runtime.enable'); await send('Page.enable');

  for (let i = 0; i < 60; i++) {
    if (await evaluate(`!!document.querySelector('.cm-content')`)) break;
    await sleep(400);
  }
  // 恢复的视图可能是「阅读」，编辑区不可见时按 F6 切回三栏
  for (let i = 0; i < 4; i++) {
    const visible = await evaluate(`(() => { const el = document.querySelector('.cm-content'); return !!el && el.getBoundingClientRect().height > 10; })()`);
    if (visible) break;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F6', code: 'F6', windowsVirtualKeyCode: 117, nativeVirtualKeyCode: 117 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F6', code: 'F6', windowsVirtualKeyCode: 117, nativeVirtualKeyCode: 117 });
    await sleep(600);
  }

  check('WebView2 暴露 window.print', await evaluate(`typeof window.print === 'function'`));

  const hasDialog = await evaluate(`!!document.getElementById('print-dialog') && !!document.querySelector('[data-action="print-mode"]')`);
  check('打印设置入口与对话框存在', hasDialog);

  await evaluate(`(document.querySelector('[data-action="print-mode"]').click(), true)`);
  await sleep(900);
  await evaluate(`(document.querySelector('[data-action="print-setup"]').click(), true)`);
  await sleep(500);
  const opened = await evaluate(`(() => ({
    open: document.getElementById('print-dialog').classList.contains('open'),
    paperOptions: document.getElementById('print-paper').options.length,
    presetOptions: document.getElementById('print-margin-preset').options.length,
    note: document.getElementById('print-layout-note').textContent.trim()
  }))()`);
  check('桌面版对话框可打开', opened.open === true);
  check('纸张 4 种 / 边距 4 种', opened.paperOptions === 4 && opened.presetOptions === 4,
    `${opened.paperOptions} / ${opened.presetOptions}`);
  check('版面提示非空', opened.note.length > 8, opened.note);

  // 选 A4 窄边距 → 预览
  await evaluate(`(() => {
    const p = document.getElementById('print-margin-preset');
    p.value = 'narrow';
    p.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('[data-print="preview"]').click();
    return true;
  })()`);
  await sleep(1800);
  const preview = await evaluate(`(() => {
    const root = document.getElementById('print-pages');
    return {
      printMode: document.body.classList.contains('mdsl-print-mode'),
      pages: root.querySelectorAll('.print-page').length,
      pageW: root.style.getPropertyValue('--page-w'),
      rule: (document.getElementById('mdsl-page-rule') || {}).textContent || '',
      printToolsVisible: getComputedStyle(document.querySelector('.print-tools')).display
    };
  })()`);
  check('桌面版进入打印预览并分页', preview.printMode === true && preview.pages > 0, `${preview.pages} 页`);
  check('窄边距 @page = 10mm 四边', /margin:\s*10mm 10mm 10mm 10mm/.test(preview.rule), preview.rule);
  check('预览页宽 190mm', preview.pageW === '190mm', preview.pageW);
  check('预览模式下出现打印工具组（含打印按钮）', preview.printToolsVisible !== 'none', preview.printToolsVisible);

  const toolbarHasPrint = await evaluate(`!!document.querySelector('.print-tools [data-action="print"]')`);
  check('预览工具栏含「打印」按钮', toolbarHasPrint);

  const exceptions = await evaluate(`window.__mdslErrors ? window.__mdslErrors.length : 0`);
  check('无脚本异常', exceptions === 0, String(exceptions));

  const failed = results.filter(r => !r.pass);
  console.log(`\n${failed.length === 0 ? 'ALL PASS' : 'FAILURES: ' + failed.length} (${results.length} checks)`);
  ws.close();
  try { app.kill(); } catch (_) { /* noop */ }
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => {
  console.error('FATAL', e);
  try { app.kill(); } catch (_) { /* noop */ }
  process.exit(1);
});
