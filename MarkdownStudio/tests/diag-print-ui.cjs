/** diag-print-ui.cjs — 打开打印设置对话框截图，检查排版 */
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = 'G:\\程序\\MD\\MarkdownStudio';
const DIST = path.join(ROOT, 'dist');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = pathToFileURL(path.join(DIST, 'MarkdownStudioLite.html')).href;
const PORT = 9481;
const profile = path.join(os.tmpdir(), 'mdsl-pui-' + Date.now());
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, '--window-size=1400,900', 'about:blank'
], { stdio: 'ignore', windowsHide: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise(res => {
  const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
  return r.result?.result?.value;
}

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
  await sleep(2500);
  await evaluate(`(document.querySelector('[data-action="print-mode"]').click(), true)`);
  await sleep(900);
  await evaluate(`(document.querySelector('[data-action="print-setup"]').click(), true)`);
  await sleep(400);
  const shot1 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(DIST, 'print-dialog-light.png'), Buffer.from(shot1.result.data, 'base64'));

  await evaluate(`(document.getElementById('print-margin-preset').value = 'custom', document.getElementById('print-margin-preset').dispatchEvent(new Event('change', {bubbles:true})), true)`);
  await sleep(250);
  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(DIST, 'print-dialog-custom.png'), Buffer.from(shot2.result.data, 'base64'));

  await evaluate(`(document.documentElement.setAttribute('data-theme','dark'), true)`);
  await sleep(350);
  const shot3 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(DIST, 'print-dialog-dark.png'), Buffer.from(shot3.result.data, 'base64'));

  await evaluate(`(document.documentElement.setAttribute('data-theme','light'), true)`);
  await sleep(350);
  const shot4 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(DIST, 'print-dialog-light.png'), Buffer.from(shot4.result.data, 'base64'));

  // 进入打印预览，检查工具栏（缩放 / 方向 / 页面设置 / 打印）
  await evaluate(`(document.querySelector('[data-print="preview"]').click(), true)`);
  await sleep(1600);
  const shot5 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(DIST, 'print-mode.png'), Buffer.from(shot5.result.data, 'base64'));

  console.log('OK');
  ws.close(); edge.kill();
  process.exit(0);
})().catch(e => { console.error('FATAL', e); try { edge.kill(); } catch (_) {} process.exit(1); });
