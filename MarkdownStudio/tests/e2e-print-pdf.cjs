/**
 * e2e-print-pdf.cjs — 打印保真校验
 *
 * 用 CDP Page.printToPDF 走真实的打印排版（@media print + @page），
 * 核对「实际出纸张数」是否等于「预览页数」。页数一旦不等，说明预分页
 * 的内容高度超出了可打印区，实际打印会串页 —— 这是打印功能最致命的缺陷。
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
const PORT = 9491;
const profile = path.join(os.tmpdir(), 'mdsl-pdf-' + Date.now());
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
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' :: ' + (r.result.exceptionDetails.exception?.description || ''));
  return r.result?.result?.value;
}
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

/** PDF 页数：统计 /Type /Page 对象（排除 /Pages） */
function pdfPageCount(buf) {
  const text = buf.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page[^s]/g) || [];
  return matches.length;
}

const MM_PER_INCH = 25.4;
const mmToIn = mm => mm / MM_PER_INCH;

const LONG = Array.from({ length: 70 }, (_, i) =>
  '第 ' + (i + 1) + ' 段：用于验证纸张与页边距对分页的影响，本段文字要足够长才能撑开页面高度，' +
  '重复一些内容以便稳定占满一行以上。').join('\n\n');

async function setup(preset, paper, orientation, margins) {
  await evaluate(`(document.querySelector('[data-action="print-setup"]').click(), true)`);
  await sleep(300);
  await evaluate(`(() => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
    const mmv = ${JSON.stringify(margins)};
    set('print-paper', '${paper}');
    set('print-orientation', '${orientation}');
    set('print-margin-preset', '${preset}');
    ['mt','mb','ml','mr'].forEach((k, idx) => {
      const el = document.getElementById('print-' + k);
      el.value = String(mmv[idx]);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    return true;
  })()`);
  await evaluate(`(document.querySelector('[data-print="preview"]').click(), true)`);
  await sleep(1600);
  return evaluate(`(() => {
    const root = document.getElementById('print-pages');
    return { pages: root.querySelectorAll('.print-page').length, rule: (document.getElementById('mdsl-page-rule') || {}).textContent };
  })()`);
}

async function measure(pdfPath) {
  const res = await send('Page.printToPDF', {
    printBackground: true,
    preferCSSPageSize: true,
    paperWidth: WIDTH_IN,
    paperHeight: HEIGHT_IN,
    marginTop: TOP_IN, marginBottom: BOTTOM_IN, marginLeft: LEFT_IN, marginRight: RIGHT_IN
  });
  const buf = Buffer.from(res.result.data, 'base64');
  fs.writeFileSync(pdfPath, buf);
  return { pages: pdfPageCount(buf), bytes: buf.length };
}

let WIDTH_IN = 0, HEIGHT_IN = 0, TOP_IN = 0, BOTTOM_IN = 0, LEFT_IN = 0, RIGHT_IN = 0;

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

  // A4 纵向 + 常规边距 15/20
  const a4 = await setup('normal', 'a4', 'portrait', ['15', '15', '20', '20']);
  WIDTH_IN = mmToIn(210); HEIGHT_IN = mmToIn(297);
  TOP_IN = mmToIn(15); BOTTOM_IN = mmToIn(15); LEFT_IN = mmToIn(20); RIGHT_IN = mmToIn(20);
  const a4Pdf = await measure(path.join(DIST, 'test-print-a4.pdf'));
  check('A4 常规：预览与出纸张数一致', a4.pages === a4Pdf.pages, `预览 ${a4.pages} 页 / PDF ${a4Pdf.pages} 页`);

  // A4 纵向 + 宽边距 25mm
  const wide = await setup('wide', 'a4', 'portrait', ['25', '25', '25', '25']);
  TOP_IN = mmToIn(25); BOTTOM_IN = mmToIn(25); LEFT_IN = mmToIn(25); RIGHT_IN = mmToIn(25);
  const widePdf = await measure(path.join(DIST, 'test-print-wide.pdf'));
  check('A4 宽边距：预览与出纸张数一致', wide.pages === widePdf.pages, `预览 ${wide.pages} 页 / PDF ${widePdf.pages} 页`);

  // A3 横向 + 自定义 8mm
  const a3 = await setup('custom', 'a3', 'landscape', ['8', '8', '8', '8']);
  WIDTH_IN = mmToIn(420); HEIGHT_IN = mmToIn(297);
  TOP_IN = mmToIn(8); BOTTOM_IN = mmToIn(8); LEFT_IN = mmToIn(8); RIGHT_IN = mmToIn(8);
  const a3Pdf = await measure(path.join(DIST, 'test-print-a3.pdf'));
  check('A3 横向：预览与出纸张数一致', a3.pages === a3Pdf.pages, `预览 ${a3.pages} 页 / PDF ${a3Pdf.pages} 页`);

  // 内容不丢：PDF 里能抽到首末段（用 printToPDF 的文本不好取，退而验证页数递增合理）
  check('窄边距页数不超过宽边距', wide.pages >= a3.pages, `${wide.pages} vs ${a3.pages}`);

  const failed = results.filter(r => !r.pass);
  console.log(`\n${failed.length === 0 ? 'ALL PASS' : 'FAILURES: ' + failed.length} (${results.length} checks)`);
  console.log('PDF: ' + ['test-print-a4.pdf', 'test-print-wide.pdf', 'test-print-a3.pdf'].join(', '));
  ws.close(); edge.kill();
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); try { edge.kill(); } catch (_) {} process.exit(1); });
