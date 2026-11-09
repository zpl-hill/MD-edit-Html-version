/**
 * e2e-selection.cjs — 编辑器选区高亮回归测试
 *
 * 背景：CM6 把 .cm-selectionLayer 放在 z-index:-2（行背景之下）。若 .cm-activeLine
 * 使用不透明底色，整行底色会把选区整块盖住 —— 表现就是「整行变色、选中的字不亮」，
 * 但复制/剪切正常（选区状态本身没错）。
 *
 * 本测试用真实双击选中一个词，然后：
 *   1. 校验 .cm-activeLine 底色必须是半透明（alpha < 1）；
 *   2. 校验 .cm-selectionBackground 宽度 ≈ 该词的文本宽度（精确到词，不是整行）；
 *   3. 截图逐像素采样：选区中心必须与该行非选区处的颜色明显不同。
 */
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const ROOT = 'G:\\程序\\MD\\MarkdownStudio';
const DIST = path.join(ROOT, 'dist');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = pathToFileURL(path.join(DIST, 'MarkdownStudioLite.html')).href;
const PORT = 9463;
const profile = path.join(os.tmpdir(), 'mdsl-sel-e2e-' + Date.now());
/** MDSL_TARGET=desktop 时改为驱动打包好的 EXE（WebView2 内核），其余逻辑一致 */
const DESKTOP = process.env.MDSL_TARGET === 'desktop';
const EXE = path.join(DIST, 'MarkdownStudioLite.exe');
const edge = DESKTOP
  ? spawn(EXE, [], {
      stdio: 'ignore', windowsHide: true,
      env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + PORT }
    })
  : spawn(EDGE, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
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
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' :: ' + (r.result.exceptionDetails.exception?.description || ''));
  return r.result?.result?.value;
}

/** 最小 PNG 解码（color type 6 / 8bit / 非隔行），仅供截图取色用 */
function decodePng(buf) {
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) throw new Error('unexpected PNG format');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.from(line);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      if (filter === 1) cur[i] = (cur[i] + a) & 255;
      else if (filter === 2) cur[i] = (cur[i] + b) & 255;
      else if (filter === 3) cur[i] = (cur[i] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    cur.copy(out, y * stride); prev = cur;
  }
  const at = (x, y) => {
    const o = y * stride + x * bpp;
    return { r: out[o], g: out[o + 1], b: out[o + 2] };
  };
  return { width, height, at };
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

/** 在指定主题下跑一遍选区断言 */
async function runTheme(scheme) {
  // 直接切 data-theme（比媒体查询可靠：桌面版 WebView2 不一定跟随 emulation）
  await evaluate(`document.documentElement.setAttribute('data-theme', '${scheme}')`);
  await sleep(600);

  const QUERY = `(() => {
    const line = [...document.querySelectorAll('.cm-line')]
      .find(l => l.textContent.includes('完全离线') && l.getBoundingClientRect().height > 0);
    if (!line) return null;
    line.scrollIntoView({ block: 'center' });
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const i = n.nodeValue.indexOf('完全离线');
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(n, i); r.setEnd(n, i + 4);
        const rect = r.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, w: rect.width, word: '完全离线' };
      }
    }
    return null;
  })()`;

  const PROBE = `(() => {
    const bg = document.querySelector('.cm-selectionBackground');
    const line = document.querySelector('.cm-activeLine');
    const cs = el => el ? getComputedStyle(el) : null;
    const rect = bg ? bg.getBoundingClientRect() : null;
    return {
      selected: String(window.getSelection()),
      lineBg: line ? cs(line).backgroundColor : null,
      selBg: bg ? cs(bg).backgroundColor : null,
      rect: rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null
    };
  })()`;

  // 真实双击选中该词；主题切换可能触发重排，位置漂了就重算一次
  let target = null, probe = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    target = await evaluate(QUERY);
    if (!target) throw new Error('未找到目标词');
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 2, buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 2, buttons: 0 });
    await sleep(500);
    probe = await evaluate(PROBE);
    if (probe.selected === target.word && probe.rect) break;
  }

  // 1) 选中内容正确
  check(`[${scheme}] 双击选中内容为「${target.word}」`, probe.selected === target.word, `actual="${probe.selected}"`);

  // 2) 当前行底色必须半透明（否则会盖住选区图层）
  const alpha = probe.lineBg && probe.lineBg.startsWith('rgba') ? parseFloat(probe.lineBg.split(',')[3]) : 1;
  check(`[${scheme}] .cm-activeLine 底色半透明 (alpha=${alpha})`, alpha < 1, probe.lineBg);

  // 3) 选区矩形宽度应≈该词宽度（精确到词，而不是整行）
  const dw = probe.rect ? Math.abs(probe.rect.w - target.w) : 999;
  check(`[${scheme}] 选区宽度贴合词宽 ${probe.rect ? probe.rect.w.toFixed(1) : '-'}px vs 词宽 ${target.w.toFixed(1)}px`,
    probe.rect && dw < 4, `Δ=${dw.toFixed(2)}px`);

  // 4) 像素级证明：选区矩形内「有选区」与「收起选区（同一行仍为当前行）」必须明显不同。
  //    同坐标做差可排除字形像素干扰——字形颜色不变，变化的只可能是选区底色。
  const clip = { x: 0, y: 0, width: 1400, height: 900, scale: 1 };
  const shotA = decodePng(Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip })).result.data, 'base64'));

  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await sleep(450);
  const shotB = decodePng(Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip })).result.data, 'base64'));

  const x0 = Math.max(0, Math.round(probe.rect.x) + 1);
  const y0 = Math.max(0, Math.round(probe.rect.y) + 1);
  const x1 = Math.min(shotA.width - 1, Math.round(probe.rect.x + probe.rect.w) - 1);
  const y1 = Math.min(shotA.height - 1, Math.round(probe.rect.y + probe.rect.h) - 1);
  let changed = 0, total = 0, sumDelta = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const a = shotA.at(x, y), b = shotB.at(x, y);
      const d = Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
      total++; sumDelta += d;
      if (d > 8) changed++;
    }
  }
  const ratio = total ? changed / total : 0;
  check(`[${scheme}] 选区内 ${(ratio * 100).toFixed(1)}% 像素因选区变色（平均 ΔRGB=${(sumDelta / Math.max(1, total)).toFixed(1)}）`,
    ratio > 0.2, `${changed}/${total} px`);

  // 5) 对照：选区之外（同一行右侧）像素不应因收起选区而改变
  const ox = Math.round(probe.rect.x + probe.rect.w + 80);
  const oy = Math.round(probe.rect.y + probe.rect.h / 2);
  const oa = shotA.at(Math.min(ox, shotA.width - 1), Math.min(oy, shotA.height - 1));
  const ob = shotB.at(Math.min(ox, shotB.width - 1), Math.min(oy, shotB.height - 1));
  const outDelta = Math.abs(oa.r - ob.r) + Math.abs(oa.g - ob.g) + Math.abs(oa.b - ob.b);
  check(`[${scheme}] 选区外像素不受影响 (ΔRGB=${outDelta})`, outDelta <= 8, `${oa.r},${oa.g},${oa.b} → ${ob.r},${ob.g},${ob.b}`);

  return { probe, ratio };
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
  if (DESKTOP) {
    // EXE 启动即加载内嵌页面，等待编辑器就绪即可
    for (let i = 0; i < 60; i++) {
      const ready = await evaluate(`!!document.querySelector('.cm-content')`);
      if (ready) break;
      await sleep(400);
    }
    await sleep(1200);
  } else {
    await send('Page.navigate', { url: FILE });
    await sleep(2500);
  }

  // 桌面版会恢复上次的视图模式（可能是「阅读」），先确保编辑区可见
  for (let i = 0; i < 4; i++) {
    const visible = await evaluate(`(() => { const el = document.querySelector('.cm-content'); return !!el && el.getBoundingClientRect().height > 10; })()`);
    if (visible) break;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F6', code: 'F6', windowsVirtualKeyCode: 117, nativeVirtualKeyCode: 117 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F6', code: 'F6', windowsVirtualKeyCode: 117, nativeVirtualKeyCode: 117 });
    await sleep(600);
  }

  // 桌面版可能以空白文档启动：必要时手动输入一段含目标词的样本
  const needSeed = await evaluate(`!((document.querySelector('.cm-content') || {}).innerText || '').includes('完全离线')`);
  if (needSeed) {
    const pt = await evaluate(`(() => { const r = document.querySelector('.cm-content').getBoundingClientRect(); return { x: r.left + 40, y: r.top + 20 }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1, buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1, buttons: 0 });
    await sleep(200);
    await send('Input.insertText', { text: '这是一段用于验证选区高亮的样例文字，包含完全离线这几个字。' });
    await sleep(600);
    console.log('SEEDED 样本文本（原文档为空或缺少目标词）');
  }

  const light = await runTheme('light');
  const dark = await runTheme('dark');

  console.log('\n--- light ---', JSON.stringify(light));
  console.log('--- dark  ---', JSON.stringify(dark));
  const failed = results.filter(r => !r.pass);
  console.log(`\n${failed.length === 0 ? 'ALL PASS' : 'FAILURES: ' + failed.length} (${results.length} checks)`);
  ws.close(); edge.kill();
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(async e => {
  console.error('FATAL', e);
  try { edge.kill(); } catch (_) { /* noop */ }
  process.exit(1);
});
