/** e2e-quick-switch.cjs — 最近文件快速切换（V1.11）
 *  验证：阅读模式浮层入口 / 快捷键 / Esc、点击直接打开文档、切换前暂存并可切回、
 *  undo 历史隔离、版本号与无异常。浏览器版（file://）只验证「本机缓存」路径。
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
const PORT = 9533;
const profile = path.join(os.tmpdir(), 'mdsl-qs-' + Date.now());
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
  '--window-size=1400,900', 'about:blank'
], { stdio: 'ignore', windowsHide: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0;
const pending = new Map();
const exceptions = [];
const send = (method, params = {}) => new Promise(res => {
  const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' :: ' + (r.result.result?.value || ''));
  return r.result?.result?.value;
}
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' — ' + detail : ''));
}
const key = (k, code, vk, modifiers = 0) => [
  { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers },
  { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers }
];

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
    if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params.exceptionDetails.text);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: FILE });
  await sleep(2400);

  // 预置两份缓存正文 + 两条最近文件元数据（模拟曾经打开过并保存过的文件）
  await evaluate(`(async () => {
    const now = Date.now();
    localStorage.removeItem('mdstudio.emergency');
    localStorage.removeItem('mdsl.pref.printSettings');
    localStorage.setItem('mdstudio.recent', JSON.stringify([
      { id: 'file:a.md:6', name: 'a.md', size: 6, openedAt: now, source: 'file', path: null },
      { id: 'file:b.md:6', name: 'b.md', size: 6, openedAt: now - 60000, source: 'file', path: null }
    ]));
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('mdstudio', 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('documents', 'readwrite');
        tx.objectStore('documents').put({ id: 'file:a.md:6', name: 'a.md', content: '# AAA\\n\\nAAA body', updatedAt: now, version: 1 });
        tx.objectStore('documents').put({ id: 'file:b.md:6', name: 'b.md', content: '# BBB\\n\\nBBB body', updatedAt: now, version: 1 });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    return true;
  })()`, true);
  await send('Page.navigate', { url: FILE });
  await sleep(2400);

  const seeded = await evaluate(`(() => ({
    items: document.querySelectorAll('#recent-list .recent-item').length,
    version: document.querySelector('meta[name="version"]').getAttribute('content')
  }))()`);
  check('侧栏最近文件渲染 2 条', seeded.items === 2, String(seeded.items));
  check('meta 版本号 = 1.11.0', seeded.version === '1.11.0', seeded.version);

  // 1) 阅读模式：整宽铺满，但必须有可见的「最近文件」悬浮入口
  await evaluate(`(document.querySelector('[data-view="reader"]').click(), true)`);
  await sleep(600);
  const reader = await evaluate(`(() => {
    const fab = document.getElementById('recent-fab');
    const r = fab.getBoundingClientRect();
    return {
      mode: document.body.classList.contains('view-reader'),
      fabDisplay: getComputedStyle(fab).display,
      fabInView: r.width > 0 && r.right <= window.innerWidth + 1 && r.top >= 0,
      sidebarHidden: getComputedStyle(document.querySelector('.toc-pane')).display === 'none'
    };
  })()`);
  check('阅读模式保持整宽（侧栏隐藏）', reader.mode && reader.sidebarHidden, JSON.stringify(reader));
  check('阅读模式「☰ 最近文件」悬浮入口完整可见', reader.fabDisplay !== 'none' && reader.fabInView,
    `display=${reader.fabDisplay} inView=${reader.fabInView}`);

  await evaluate(`(document.getElementById('recent-fab').click(), true)`);
  await sleep(300);
  const panel = await evaluate(`(() => {
    const d = document.getElementById('recent-switcher');
    return {
      open: d.classList.contains('open'),
      rows: d.querySelectorAll('.recent-switch-list .recent-item').length,
      badge: (d.querySelector('.recent-badge') || {}).textContent || '',
      hint: document.getElementById('recent-hint').textContent
    };
  })()`);
  check('浮层列出全部最近文件', panel.open && panel.rows === 2, `open=${panel.open} rows=${panel.rows}`);
  check('浏览器版条目标记「本机缓存」且提示平台差异', /本机缓存/.test(panel.badge) && /桌面版/.test(panel.hint),
    `${panel.badge} / ${panel.hint.slice(0, 32)}…`);

  for (const ev of key('Escape', 'Escape', 27)) await send('Input.dispatchKeyEvent', ev);
  await sleep(250);
  check('Esc 只关闭浮层、不退出阅读模式',
    await evaluate(`!document.getElementById('recent-switcher').classList.contains('open') && document.body.classList.contains('view-reader')`));

  for (const ev of key('r', 'KeyR', 82, 1)) await send('Input.dispatchKeyEvent', ev); // Alt+R
  await sleep(250);
  check('Alt+R 打开快速切换浮层',
    await evaluate(`document.getElementById('recent-switcher').classList.contains('open')`));
  for (const ev of key('Escape', 'Escape', 27)) await send('Input.dispatchKeyEvent', ev);
  await sleep(200);
  for (const ev of key('r', 'KeyR', 82, 3)) await send('Input.dispatchKeyEvent', ev); // Ctrl+Alt+R
  await sleep(250);
  check('Ctrl+Alt+R 备用快捷键同样可用',
    await evaluate(`document.getElementById('recent-switcher').classList.contains('open')`));

  // 2) 点击条目直接切换文档（阅读模式下也应生效，且保持阅读模式）
  await evaluate(`(document.querySelector('#recent-switch-list .recent-item[data-id="file:b.md:6"]').click(), true)`);
  await sleep(900);
  const afterB = await evaluate(`(() => ({
    preview: document.getElementById('preview').innerText,
    title: document.title,
    current: document.querySelector('#recent-list .recent-item.is-current')?.dataset?.id || null,
    panelOpen: document.getElementById('recent-switcher').classList.contains('open'),
    mode: document.body.classList.contains('view-reader'),
    status: document.getElementById('status-text').textContent
  }))()`);
  check('点击 b.md 直接打开正文（预览含 BBB）', /BBB body/.test(afterB.preview), afterB.preview.slice(0, 40));
  check('标签页标题同步为 b.md', /b\.md/.test(afterB.title), afterB.title);
  check('切换后浮层关闭且保持阅读模式', !afterB.panelOpen && afterB.mode, `open=${afterB.panelOpen} reader=${afterB.mode}`);
  check('状态栏说明已暂存/可切回', /暂存|缓存恢复/.test(afterB.status), afterB.status);

  // 3) 快速切换：在 b.md 里编辑 → 切到 a.md → 切回 b.md，未保存内容不能丢
  await evaluate(`(document.querySelector('[data-view="split"]').click(), true)`);
  await sleep(500);
  await evaluate(`(document.querySelector('.cm-content').focus(), true)`);
  await send('Input.insertText', { text: ' EDITED-B' });
  await sleep(500);
  const edited = await evaluate(`document.querySelector('.cm-content').innerText.includes('EDITED-B')`);
  check('编辑器内已输入未保存修改', edited === true);

  await evaluate(`(document.querySelector('#recent-list .recent-item[data-id="file:a.md:6"]').click(), true)`);
  await sleep(900);
  check('切到 a.md 后正文为 AAA', /AAA body/.test(await evaluate(`document.getElementById('preview').innerText`)));
  await evaluate(`(document.querySelector('#recent-list .recent-item[data-id="file:b.md:6"]').click(), true)`);
  await sleep(900);
  const backB = await evaluate(`(() => ({
    editor: document.querySelector('.cm-content').innerText,
    preview: document.getElementById('preview').innerText
  }))()`);
  check('切回 b.md 时未保存修改被暂存并恢复', /EDITED-B/.test(backB.editor) && /EDITED-B/.test(backB.preview),
    backB.editor.slice(-40));

  // 4) undo 历史隔离：reset 后 Ctrl+Z 不应把上一份文档撤回来
  for (const ev of key('z', 'KeyZ', 90, 2)) await send('Input.dispatchKeyEvent', ev); // Ctrl+Z
  await sleep(400);
  const afterUndo = await evaluate(`document.querySelector('.cm-content').innerText`);
  check('Ctrl+Z 不会撤回到上一份文档', !/AAA/.test(afterUndo), afterUndo.slice(0, 40));

  // 5) 关于页版本号
  await evaluate(`(document.querySelector('[data-action="about"]').click(), true)`);
  await sleep(250);
  const about = await evaluate(`document.querySelector('#about-dialog .about-body').innerText`);
  check('关于页显示 V1.11 / 1.11.0', /V1\.11/.test(about) && /1\.11\.0/.test(about), about.slice(0, 90));

  // 6) 根因验证：用「打开」读入的文件必须立刻写入正文缓存
  await evaluate(`(() => {
    window.__mdslFileHook = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file') {
        const dt = new DataTransfer();
        dt.items.add(new File(['# OPENED\\n\\nOPEN-CACHE-PROBE\\n'], 'open-probe.md', { type: 'text/markdown' }));
        this.files = dt.files;
        this.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      return window.__mdslFileHook.apply(this, arguments);
    };
    return true;
  })()`);
  await evaluate(`(document.querySelector('[data-action="open"]').click(), true)`);
  await sleep(900);
  const opened = await evaluate(`(() => ({
    first: (JSON.parse(localStorage.getItem('mdstudio.recent') || '[]')[0] || {}),
    preview: document.getElementById('preview').innerText
  }))()`);
  check('「打开」把文件登记进最近文件', /open-probe\.md/.test(opened.first.name || ''), JSON.stringify(opened.first));
  check('「打开」后正文立即渲染', /OPEN-CACHE-PROBE/.test(opened.preview), opened.preview.slice(0, 50));

  const cached = await evaluate(`(async () => {
    const id = JSON.parse(localStorage.getItem('mdstudio.recent'))[0].id;
    return await new Promise(resolve => {
      const req = indexedDB.open('mdstudio', 1);
      req.onsuccess = () => {
        const q = req.result.transaction('documents', 'readonly').objectStore('documents').get(id);
        q.onsuccess = () => resolve(q.result ? q.result.content : null);
        q.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    });
  })()`, true);
  check('「打开」时正文已写入缓存（根因修复）', /OPEN-CACHE-PROBE/.test(cached || ''), (cached || '').slice(0, 40));

  await evaluate(`(document.querySelector('#recent-list .recent-item[data-id="file:a.md:6"]').click(), true)`);
  await sleep(800);
  await evaluate(`(document.querySelector('#recent-list .recent-item[data-id="${opened.first.id}"]').click(), true)`);
  await sleep(800);
  check('打开过的文件现在能直接切回来',
    /OPEN-CACHE-PROBE/.test(await evaluate(`document.getElementById('preview').innerText`)));

  const uncaught = await evaluate(`(window.__mdslErrors || []).length`);
  check('无未捕获脚本异常', exceptions.length === 0 && uncaught === 0,
    `cdp=${exceptions.length} page=${uncaught}`);

  const failed = results.filter(r => !r.ok);
  console.log(`\n${failed.length === 0 ? 'ALL PASS' : 'FAILURES: ' + failed.length} (${results.length} checks)`);
  ws.close(); edge.kill();
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => {
  console.error('FATAL', e);
  try { edge.kill(); } catch (_) { /* noop */ }
  process.exit(1);
});
