/** e2e-quick-switch-desktop.cjs — 桌面版（WebView2）「原文件」重新打开能力
 *  浏览器版受 file:// 沙箱限制只能恢复本机缓存；桌面版会记录绝对路径，
 *  点击「原文件」条目时按路径重新读取磁盘上的最新内容（不是缓存里的旧副本）。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = 'G:\\程序\\MD\\MarkdownStudio';
const EXE = path.join(ROOT, 'dist', 'MarkdownStudioLite.exe');
const PORT = 9537;
const DISK_FILE = path.join(os.tmpdir(), 'mdsl-disk-probe-' + Date.now() + '.md');
const DISK_TEXT = '# DISK\n\nDISK-FRESH-CONTENT\n';
const CACHE_TEXT = '# CACHE\n\nCACHE-STALE-CONTENT\n';
const ENTRY_ID = 'file:disk-probe:1';
fs.writeFileSync(DISK_FILE, DISK_TEXT, 'utf8');

const app = spawn(EXE, [], {
  stdio: 'ignore', windowsHide: true,
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + PORT }
});

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

  // 预置：最近文件条目带绝对路径；IndexedDB 里故意放一份过期缓存
  const seedExpr = `(async () => {
    const entry = ${JSON.stringify({
      id: ENTRY_ID, name: path.basename(DISK_FILE), size: 1,
      openedAt: Date.now(), source: 'file', path: DISK_FILE
    })};
    localStorage.setItem('mdstudio.recent', JSON.stringify([entry]));
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('mdstudio', 1);
      req.onsuccess = () => {
        const tx = req.result.transaction('documents', 'readwrite');
        tx.objectStore('documents').put({
          id: ${JSON.stringify(ENTRY_ID)}, name: entry.name,
          content: ${JSON.stringify(CACHE_TEXT)}, updatedAt: Date.now(), version: 1
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    return true;
  })()`;
  await evaluate(seedExpr, true);

  // 阅读模式下的悬浮入口同样要在 EXE 里可用
  await evaluate(`(document.querySelector('[data-view="reader"]').click(), true)`);
  await sleep(600);
  const fab = await evaluate(`(() => {
    const el = document.getElementById('recent-fab');
    const r = el.getBoundingClientRect();
    return { display: getComputedStyle(el).display, inView: r.width > 0 && r.right <= window.innerWidth + 1 };
  })()`);
  check('桌面版阅读模式有「最近文件」悬浮入口', fab.display !== 'none' && fab.inView, JSON.stringify(fab));

  await evaluate(`(document.getElementById('recent-fab').click(), true)`);
  await sleep(350);
  const panel = await evaluate(`(() => {
    const d = document.getElementById('recent-switcher');
    return {
      open: d.classList.contains('open'),
      rows: d.querySelectorAll('.recent-switch-list .recent-item').length,
      badge: (d.querySelector('.recent-badge') || {}).textContent || '',
      hint: document.getElementById('recent-hint').textContent
    };
  })()`);
  check('浮层条目带「原文件」标记', panel.open && panel.rows === 1 && /原文件/.test(panel.badge), JSON.stringify(panel));
  check('桌面版提示会重新读取磁盘内容', /重新读取磁盘/.test(panel.hint), panel.hint.slice(0, 40));

  // 关键：点击后应读磁盘最新内容，而不是缓存里的旧副本
  await evaluate(`(document.querySelector('#recent-switch-list .recent-item').click(), true)`);
  await sleep(1200);
  const loaded = await evaluate(`(() => ({
    preview: document.getElementById('preview').innerText,
    status: document.getElementById('status-text').textContent,
    save: document.getElementById('status-save').textContent
  }))()`);
  check('点击「原文件」读到磁盘最新内容', /DISK-FRESH-CONTENT/.test(loaded.preview), loaded.preview.slice(0, 60));
  check('未误用过期缓存', !/CACHE-STALE-CONTENT/.test(loaded.preview));
  check('状态栏说明「已重新打开原文件」', /重新打开原文件/.test(loaded.status) || /已打开原文件/.test(loaded.save),
    loaded.status + ' / ' + loaded.save);

  const failed = results.filter(r => !r.pass);
  console.log(`\n${failed.length === 0 ? 'ALL PASS' : 'FAILURES: ' + failed.length} (${results.length} checks)`);
  ws.close();
  try { app.kill(); } catch (_) { /* noop */ }
  try { fs.unlinkSync(DISK_FILE); } catch (_) { /* noop */ }
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => {
  console.error('FATAL', e);
  try { app.kill(); } catch (_) { /* noop */ }
  process.exit(1);
});
