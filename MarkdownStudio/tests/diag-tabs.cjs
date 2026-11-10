/** diag-tabs.cjs — 标签条视觉诊断截图（浅色三栏 / 阅读模式 / 深色） */
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = 'G:\\程序\\MD\\MarkdownStudio';
const DIST = path.join(ROOT, 'dist');
const FILE = pathToFileURL(path.join(DIST, 'MarkdownStudioLite.html')).href;
const PORT = 9543;
const profile = path.join(os.tmpdir(), 'mdsl-tabs-shot-' + Date.now());
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
  '--window-size=1400,900', 'about:blank'
], { stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map();
const send = (m, p = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
const evaluate = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

(async () => {
  let t;
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); t = l.find(x => x.type === 'page'); if (t) break; } catch (_) {}
    await sleep(250);
  }
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: FILE });
  await sleep(2200);

  await evaluate(`(async () => {
    const now = Date.now();
    localStorage.setItem('mdstudio.recent', JSON.stringify([
      { id: 'file:8D-Report.md:6', name: '8D-Report.md', size: 6, openedAt: now, source: 'file', path: null },
      { id: 'file:MSA-Study.md:6', name: 'MSA-Study.md', size: 6, openedAt: now - 60000, source: 'file', path: null }
    ]));
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('mdstudio', 1);
      req.onsuccess = () => {
        const tx = req.result.transaction('documents', 'readwrite');
        tx.objectStore('documents').put({ id: 'file:8D-Report.md:6', name: '8D-Report.md', content: '# 8D Report\\n\\n质量问题分析与改善报告。', updatedAt: now, version: 1 });
        tx.objectStore('documents').put({ id: 'file:MSA-Study.md:6', name: 'MSA-Study.md', content: '# MSA Study\\n\\n测量系统分析。', updatedAt: now, version: 1 });
        tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    return true;
  })()`, true);
  await send('Page.navigate', { url: FILE });
  await sleep(2300);
  await evaluate(`(document.querySelector('#recent-list .recent-item[data-id="file:8D-Report.md:6"]').click(), true)`);
  await sleep(700);
  await evaluate(`(document.querySelector('#recent-list .recent-item[data-id="file:MSA-Study.md:6"]').click(), true)`);
  await sleep(800);

  for (const [name, setup] of [
    ['tabs-light.png', `(document.documentElement.setAttribute('data-theme','light'), true)`],
    ['tabs-dark.png', `(document.documentElement.setAttribute('data-theme','dark'), true)`],
    ['tabs-reader.png', `(document.documentElement.setAttribute('data-theme','light'), document.querySelector('[data-view="reader"]').click(), true)`]
  ]) {
    await evaluate(setup);
    await sleep(450);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(DIST, name), Buffer.from(shot.result.data, 'base64'));
  }
  console.log('screenshots written');
  ws.close(); edge.kill(); process.exit(0);
})().catch(e => { console.error(e); try { edge.kill(); } catch (_) {} process.exit(1); });
