/** e2e-desktop.cjs — 桌面版验收：命令行打开 / 编辑保存回原文件 / 单实例转发 / 文件关联。
 *  通过 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 打开远程调试端口，用 CDP 直接读页面状态。 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = 'G:\\程序\\MD\\MarkdownStudio';
const EXE = path.join(ROOT, 'dist', 'MarkdownStudioLite.exe');
const WORK = path.join(ROOT, 'dist', 'desktop-test');
const PORT = 9333;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (l, v) => console.log('\n=== ' + l + ' ===\n' + (typeof v === 'string' ? v : JSON.stringify(v, null, 1)));

let ws, seq = 0;
const pending = new Map();
const errors = [];
const send = (m, p = {}) => new Promise(res => {
  const id = ++seq;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method: m, params: p }));
});
async function ev(expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails;
    return { __error: (d.exception && d.exception.description || d.text || '').slice(0, 500) };
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
}

const A = path.join(WORK, 'alpha.md');
const B = path.join(WORK, 'beta.md');
const A_TEXT = '# Alpha 文档\n\n这段文字来自磁盘上的 alpha.md。\n';
const B_TEXT = '# Beta 文档\n\n第二个文件，用于验证单实例转发。\n';

if (!fs.existsSync(EXE)) {
  console.error('EXE not found: ' + EXE);
  process.exit(2);
}
fs.mkdirSync(WORK, { recursive: true });
fs.writeFileSync(A, A_TEXT, 'utf8');
fs.writeFileSync(B, B_TEXT, 'utf8');

function launch(file) {
  return spawn(EXE, [file], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + PORT },
    stdio: 'ignore',
    windowsHide: false
  });
}

function killTree(pid) {
  try { execSync('taskkill /PID ' + pid + ' /T /F', { stdio: 'ignore' }); } catch (e) { /* ignore */ }
}

(async () => {
  let child = launch(A);
  let ok = true;
  const fail = m => { ok = false; console.log('\n[FAIL] ' + m); };

  // ---------- 1. 等 CDP ----------
  let url = null;
  for (let i = 0; i < 80; i++) {
    try {
      const j = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = j.find(x => x.type === 'page');
      if (p) { url = p.webSocketDebuggerUrl; break; }
    } catch (e) { /* not ready */ }
    await sleep(250);
  }
  if (!url) { fail('CDP 未就绪，窗口可能没起来'); killTree(child.pid); process.exit(1); }

  ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const f = pending.get(m.id); pending.delete(m.id); f(m); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 300));
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(2200);

  // ---------- 2. 启动即加载命令行文件 ----------
  const boot = await ev(`(() => {
    const view = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    const text = view ? view.state.doc.toString() : '';
    return JSON.stringify({
      tauri: !!window.__TAURI__,
      desktop: !!window.__MDSL_DESKTOP__,
      hasEditor: !!view,
      textHead: text.slice(0, 60),
      loaded: text.indexOf('alpha.md') >= 0,
      title: document.title
    });
  })()`);
  log('1. 启动加载命令行文件', boot);
  const b = typeof boot === 'string' ? JSON.parse(boot) : {};
  if (!b.tauri) fail('window.__TAURI__ 未注入');
  if (!b.desktop) fail('桌面桥接未注册');
  if (!b.loaded) fail('命令行传入的 md 没有被打开');

  // ---------- 3. 编辑 + Ctrl+S 写回原文件 ----------
  const edit = await ev(`(() => {
    const view = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    view.dispatch({ changes: { from: view.state.doc.length, insert: '\\n\\n<!-- desktop save probe -->\\n' } });
    return view.state.doc.toString().length;
  })()`);
  await sleep(300);
  await ev(`document.querySelector('[data-action="save"]').click(); 'clicked'`);
  await sleep(1800);
  const afterSave = fs.readFileSync(A, 'utf8');
  log('2. 编辑 + 保存写回原文件', {
    lengthAfterEdit: edit,
    fileHasProbe: afterSave.indexOf('desktop save probe') >= 0,
    fileBytes: Buffer.byteLength(afterSave, 'utf8'),
    status: await ev(`document.querySelector('#status-text').textContent`)
  });
  if (afterSave.indexOf('desktop save probe') < 0) fail('保存没有写回原文件');

  // ---------- 4. 单实例：再开一个进程传 beta.md ----------
  const beforePids = execSync('tasklist /FI "IMAGENAME eq MarkdownStudioLite.exe" /NH', { encoding: 'utf8' })
    .split('\n').filter(l => l.indexOf('MarkdownStudioLite') >= 0).length;
  const child2 = launch(B);
  await sleep(3200);
  const afterPids = execSync('tasklist /FI "IMAGENAME eq MarkdownStudioLite.exe" /NH', { encoding: 'utf8' })
    .split('\n').filter(l => l.indexOf('MarkdownStudioLite') >= 0).length;
  const switched = await ev(`(() => {
    const view = CM6.EditorView.findFromDOM(document.querySelector('.cm-editor'));
    return view ? view.state.doc.toString().indexOf('Beta ') >= 0 : false;
  })()`);
  log('3. 单实例转发', { pidsBefore: beforePids, pidsAfter: afterPids, switchedToBeta: switched });
  if (afterPids > beforePids) fail('第二个实例没有被合并（出现多个进程）');
  if (!switched) fail('第二个实例的文件没有转发到已有窗口');
  try { child2.kill(); } catch (e) { /* ignore */ }

  // ---------- 5. 文件关联注册 ----------
  // 不用 reg.exe 验证：部分企业环境把它列进程序黑名单（本次实测就被拦了）。
  // default_app_status 本身就是读 HKCU 得到的，等价于直接查注册表。
  const reg = await ev(`window.__TAURI__.core.invoke('set_default_app').then(r => r).catch(e => 'ERR ' + e)`, true);
  await sleep(600);
  const status = await ev(`window.__TAURI__.core.invoke('default_app_status').then(r => JSON.stringify(r)).catch(e => 'ERR ' + e)`, true);
  let parsed = {};
  try { parsed = JSON.parse(status); } catch (e) { parsed = {}; }
  log('4. 文件关联', { setResult: reg, status: parsed });
  if (!parsed.registered) fail('.md 关联没有写入 HKCU');
  if (!String(reg).endsWith('MarkdownStudioLite.exe')) fail('注册时拿到的 exe 路径异常');

  // ---------- 6. 运行期异常 ----------
  log('5. 页面异常', errors.length ? errors : '(none)');

  killTree(child.pid);
  await sleep(500);

  console.log('\n===================================');
  console.log(ok ? 'DESKTOP E2E: PASS' : 'DESKTOP E2E: FAIL');
  console.log('===================================');
  process.exit(ok ? 0 : 1);
})().catch(e => {
  console.error('\n[FATAL] ' + e.message);
  process.exit(1);
});
