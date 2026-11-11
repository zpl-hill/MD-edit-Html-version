/** e2e-tabs-desktop.cjs — 桌面版（WebView2）常驻标签条
 *  验证 EXE 内标签条同样能「看到两个文件、点一下切过去」，以及阅读模式可见、
 *  关闭标签、版本号、无异常。浏览器版只测缓存恢复，桌面版这里沿用同一路径。
 */
const { spawn } = require('child_process');
const path = require('path');

const ROOT = 'G:\\程序\\MD\\MarkdownStudio';
const EXE = path.join(ROOT, 'dist', 'MarkdownStudioLite.exe');
const PORT = 9545;
const app = spawn(EXE, [], {
  stdio: 'ignore', windowsHide: true,
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + PORT }
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map();
const exceptions = [];
const send = (m, p = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
async function evaluate(expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' :: ' + (r.result.result?.value || ''));
  return r.result?.result?.value;
}
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
const TABS = `(() => {
  const bar = document.getElementById('tabbar');
  return {
    count: bar.querySelectorAll('.mdsl-tab').length,
    ids: [...bar.querySelectorAll('.mdsl-tab')].map(t => t.dataset.id),
    active: bar.querySelector('.mdsl-tab.active')?.dataset.id || null,
    display: getComputedStyle(bar).display,
    h: bar.getBoundingClientRect().height
  };
})()`;

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
    if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params.exceptionDetails.text);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  await send('Runtime.enable'); await send('Page.enable');
  for (let i = 0; i < 60; i++) {
    if (await evaluate(`!!document.querySelector('.cm-content')`)) break;
    await sleep(400);
  }

  // 预置两份缓存正文与最近文件；清掉旧标签数据
  await evaluate(`(async () => {
    const now = Date.now();
    localStorage.removeItem('mdstudio.tabs');
    localStorage.removeItem('mdstudio.emergency');
    localStorage.setItem('mdstudio.recent', JSON.stringify([
      { id: 'file:a.md:6', name: 'a.md', size: 6, openedAt: now, source: 'file', path: null },
      { id: 'file:b.md:6', name: 'b.md', size: 6, openedAt: now - 60000, source: 'file', path: null }
    ]));
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('mdstudio', 1);
      req.onsuccess = () => {
        const tx = req.result.transaction('documents', 'readwrite');
        tx.objectStore('documents').put({ id: 'file:a.md:6', name: 'a.md', content: '# AAA\\n\\nAAA body', updatedAt: now, version: 1 });
        tx.objectStore('documents').put({ id: 'file:b.md:6', name: 'b.md', content: '# BBB\\n\\nBBB body', updatedAt: now, version: 1 });
        tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    return true;
  })()`, true);
  // 回到三栏，避免上次会话停留在阅读模式
  await evaluate(`(document.querySelector('[data-view="split"]').click(), true)`);
  await sleep(500);

  const init = await evaluate(TABS);
  check('EXE 内标签条已渲染', init.display !== 'none' && init.count >= 1 && init.h > 20, JSON.stringify(init));

  // 用快速切换浮层打开两份文件（侧栏列表在启动时已渲染，浮层会重新读取最近文件）
  await evaluate(`(document.getElementById('recent-fab')?.click(), document.getElementById('recent-switcher').classList.add('open'), true)`);
  await sleep(300);
  await evaluate(`(document.querySelector('#recent-switch-list .recent-item[data-id="file:a.md:6"]').click(), true)`);
  await sleep(900);
  const afterA = await evaluate(TABS);
  check('打开 a.md 后标签条出现第二个标签', afterA.count >= 2 && afterA.ids.includes('file:a.md:6'), JSON.stringify(afterA.ids));

  await evaluate(`(document.getElementById('recent-fab').click(), true)`);
  await sleep(300);
  await evaluate(`(document.querySelector('#recent-switch-list .recent-item[data-id="file:b.md:6"]').click(), true)`);
  await sleep(900);
  const afterB = await evaluate(TABS);
  check('打开 b.md 后两份文件同时出现在标签条', afterB.count >= 3 && afterB.active === 'file:b.md:6', JSON.stringify(afterB.ids));

  // 核心：点 a.md 标签直接切过去
  await evaluate(`(document.querySelector('.mdsl-tab[data-id="file:a.md:6"]').click(), true)`);
  await sleep(900);
  const byTab = await evaluate(`(() => ({
    active: document.querySelector('.mdsl-tab.active')?.dataset.id || null,
    preview: document.getElementById('preview').innerText
  }))()`);
  check('点 a.md 标签直接切到 AAA 正文', byTab.active === 'file:a.md:6' && /AAA body/.test(byTab.preview),
    `${byTab.active} / ${byTab.preview.slice(0, 30)}`);

  await evaluate(`(document.querySelector('.mdsl-tab[data-id="file:b.md:6"]').click(), true)`);
  await sleep(900);
  check('点 b.md 标签切回 BBB 正文', /BBB body/.test(await evaluate(`document.getElementById('preview').innerText`)));

  // 阅读模式下标签条仍可见
  await evaluate(`(document.querySelector('[data-view="reader"]').click(), true)`);
  await sleep(500);
  const reader = await evaluate(TABS);
  check('EXE 阅读模式下标签条仍可见', reader.display !== 'none' && reader.h > 20, JSON.stringify(reader));

  // 关闭非当前标签
  await evaluate(`(document.querySelector('.mdsl-tab-close[data-close="draft"]').click(), true)`);
  await sleep(350);
  check('关闭非当前标签后数量减少',
    (await evaluate(`document.querySelectorAll('#tabbar .mdsl-tab').length`)) === (reader.count - 1));

  check('meta 版本号 = 1.13.0',
    (await evaluate(`document.querySelector('meta[name="version"]').getAttribute('content')`)) === '1.13.0');
  check('页面无未捕获异常', exceptions.length === 0, exceptions.slice(0, 2).join(' | '));

  const failed = results.filter(r => !r.pass);
  console.log(`\n${failed.length === 0 ? 'ALL PASS' : 'FAILURES: ' + failed.length} (${results.length} checks)`);
  ws.close();
  try { app.kill(); } catch (_) { /* noop */ }
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  console.error('FATAL', e);
  try { app.kill(); } catch (_) { /* noop */ }
  process.exit(1);
});
