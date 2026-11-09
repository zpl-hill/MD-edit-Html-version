/** diag-selection.cjs — 诊断 CM6 选区高亮渲染（headless Edge + CDP 真实拖选） */
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = 'G:\\程序\\MD\\MarkdownStudio';
const DIST = path.join(ROOT, 'dist');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = pathToFileURL(path.join(DIST, 'MarkdownStudioLite.html')).href;
const PORT = 9451;
const profile = path.join(os.tmpdir(), 'mdsl-sel-' + Date.now());
const shot = path.join(DIST, 'diag-selection.png');
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files',
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
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.text + ' :: ' + (r.result.exceptionDetails.exception?.description || '') };
  return r.result?.result?.value;
}

const PROBE = `(() => {
  const layer = document.querySelector('.cm-selectionLayer');
  const bgs = [...document.querySelectorAll('.cm-selectionBackground')];
  const cs = el => { if (!el) return null; const s = getComputedStyle(el); return { bg: s.backgroundColor, zi: s.zIndex, pos: s.position, op: s.opacity, disp: s.display, rect: el.getBoundingClientRect().toJSON() }; };
  const active = [...document.querySelectorAll('.cm-activeLine')].map(cs);
  return {
    layer: cs(layer),
    layerHTML: layer ? layer.outerHTML.slice(0, 400) : null,
    selCount: bgs.length,
    sels: bgs.map(cs),
    activeLine: active,
    selectionString: String(window.getSelection()),
    cmVar: getComputedStyle(document.documentElement).getPropertyValue('--selection'),
    viewVar: getComputedStyle(document.querySelector('.cm-editor')).getPropertyValue('--selection')
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
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await send('Page.navigate', { url: FILE });
  await sleep(2500);

  // 写入固定内容，便于精确定位
  const ok = await evaluate(`(() => {
    const inp = document.querySelector('#editor textarea, .cm-content');
    return { hasContent: !!document.querySelector('.cm-content'), text: (document.querySelector('.cm-content')?.innerText || '').slice(0, 60) };
  })()`);
  console.log('READY', JSON.stringify(ok));

  // 用真实鼠标拖选：从某行第 2 字拖到第 12 字
  const box = await evaluate(`(() => {
    const lines = [...document.querySelectorAll('.cm-line')];
    const l = lines[2] || lines[0];
    const r = l.getBoundingClientRect();
    return { x: r.left, y: r.top + r.height / 2, h: r.height, text: l.textContent.slice(0, 40) };
  })()`);
  console.log('LINE', JSON.stringify(box));

  const y = box.y;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x + 6, y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(60);
  for (let i = 1; i <= 8; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + 6 + i * 9, y, button: 'left', buttons: 1 });
    await sleep(20);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x + 6 + 72, y, button: 'left', clickCount: 1, buttons: 0 });
  await sleep(400);

  console.log('PROBE', JSON.stringify(await evaluate(PROBE), null, 1));

  const shotRes = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(shot, Buffer.from(shotRes.result.data, 'base64'));
  console.log('SHOT', shot);

  ws.close();
  edge.kill();
  process.exit(0);
})().catch(e => { console.error('FATAL', e); try { edge.kill(); } catch (_) {} process.exit(1); });
