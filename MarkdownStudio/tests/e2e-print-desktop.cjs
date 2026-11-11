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
      contentW: root.style.getPropertyValue('--content-w'),
      rule: (document.getElementById('mdsl-page-rule') || {}).textContent || '',
      printToolsVisible: getComputedStyle(document.querySelector('.print-tools')).display
    };
  })()`);
  check('桌面版进入打印预览并分页', preview.printMode === true && preview.pages > 0, `${preview.pages} 页`);
  check('窄边距 @page = 10mm 四边', /margin:\s*10mm 10mm 10mm 10mm/.test(preview.rule), preview.rule);
  check('预览白纸 = 整张 A4 (210mm)，可打印区 190mm', preview.pageW === '210mm' && preview.contentW === '190mm',
    preview.pageW + ' / ' + preview.contentW);
  check('预览模式下出现打印工具组（含打印按钮）', preview.printToolsVisible !== 'none', preview.printToolsVisible);

  const toolbarHasPrint = await evaluate(`!!document.querySelector('.print-tools [data-action="print"]')`);
  check('预览工具栏含「打印」按钮', toolbarHasPrint);

  // 退出预览：按钮必须真的可见且能回到编辑（WebView2 下也验证一次）
  const exitState = await evaluate(`(() => {
    const btn = document.querySelector('[data-action="exit-preview"]');
    if (!btn) return { found: false };
    const r = btn.getBoundingClientRect();
    const inView = r.width > 0 && r.right <= window.innerWidth + 1 && r.left >= 0;
    btn.click();
    return { found: true, inView, text: btn.textContent.trim() };
  })()`);
  await sleep(700);
  const exited = await evaluate(`(() => ({
    mode: document.body.classList.contains('mdsl-print-mode'),
    editorVisible: document.querySelector('.workspace').getBoundingClientRect().width > 0
  }))()`);
  check('「退出预览」按钮完整可见且可点击', exitState.found === true && exitState.inView === true,
    `${exitState.text || ''} inView=${exitState.inView}`);
  check('桌面版点「退出预览」回到编辑', exited.mode === false && exited.editorVisible === true,
    `mode=${exited.mode} editor=${exited.editorVisible}`);

  // V1.13：桌面版同样验证打印输出不含应用 UI（白名单规则在 WebView2 下生效）
  await send('Emulation.setEmulatedMedia', { media: 'print', features: [] });
  await sleep(300);
  const clean = await evaluate(`(() => {
    const d = sel => { const el = document.querySelector(sel); return el ? getComputedStyle(el).display : '(missing)'; };
    return {
      tabbar: d('.tabbar'), fab: d('.recent-fab'), notices: d('.third-party-notices'),
      pages: d('.print-pages'), text: document.body.innerText
    };
  })()`);
  check('桌面版打印输出隐藏标签条/悬浮入口/许可证声明',
    clean.tabbar === 'none' && clean.fab === 'none' && clean.notices === 'none',
    `${clean.tabbar}/${clean.fab}/${clean.notices}`);
  check('桌面版打印输出保留打印页且文本层无 UI',
    clean.pages !== 'none' && !clean.text.includes('Third-party software licenses') &&
    !clean.text.includes('☰ 最近文件'), clean.pages);
  await send('Emulation.setEmulatedMedia', { media: '', features: [] });

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
