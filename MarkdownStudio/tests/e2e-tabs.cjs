/** e2e-tabs.cjs — 常驻文件标签条（V1.12）
 *
 * 诉求：打开两份文件后要能「看到标签、点一下就切过去」。
 * 本测试覆盖：标签渲染与当前高亮、点击切换（核心）、切换前暂存不丢内容、
 * Alt+1..9 快捷键、关闭标签（非当前 / 当前 / 最后一个）、阅读模式可见、
 * 打印预览隐藏、刷新后保持、布局不被标签条挤掉、版本号、无异常。
 */
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const os = require('os');
const path = require('path');

const ROOT = 'G:\\程序\\MD\\MarkdownStudio';
const DIST = path.join(ROOT, 'dist');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = pathToFileURL(path.join(DIST, 'MarkdownStudioLite.html')).href;
const PORT = 9541;
const profile = path.join(os.tmpdir(), 'mdsl-tabs-' + Date.now());
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
  '--window-size=1400,900', 'about:blank'
], { stdio: 'ignore', windowsHide: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0;
const pending = new Map();
const exceptions = [];
const consoleErrors = [];
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

const TAB_STATE = `(() => {
  const bar = document.getElementById('tabbar');
  const tabs = [...bar.querySelectorAll('.mdsl-tab')];
  return {
    count: tabs.length,
    ids: tabs.map(t => t.dataset.id),
    activeId: (bar.querySelector('.mdsl-tab.active') || {}).dataset?.id || null,
    activeCount: bar.querySelectorAll('.mdsl-tab.active').length,
    display: getComputedStyle(bar).display,
    rect: (() => { const r = bar.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height }; })()
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
    if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map(a => a.value || a.description || '').join(' '));
    }
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: FILE });
  await sleep(2200);

  // 预置两份「曾打开过」的文档 + 一份空白标签条，然后刷新让应用重新装配
  await evaluate(`(async () => {
    const now = Date.now();
    localStorage.removeItem('mdstudio.tabs');
    localStorage.removeItem('mdstudio.emergency');
    localStorage.removeItem('mdstudio.recent');
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
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    return true;
  })()`, true);
  await send('Page.navigate', { url: FILE });
  await sleep(2400);

  // 1) 标签条存在、初始状态、布局高度正确
  const init = await evaluate(TAB_STATE);
  check('标签条已渲染且默认有 1 个标签', init.count === 1, JSON.stringify(init.ids));
  check('恰有 1 个当前标签高亮', init.activeCount === 1 && init.activeId === 'draft', String(init.activeId));
  check('标签条在工具栏下方（独立于工具栏）', init.rect.top > 40 && init.rect.h > 20, JSON.stringify(init.rect));
  const layout = await evaluate(`(() => {
    const w = document.querySelector('.workspace').getBoundingClientRect();
    const f = document.querySelector('.statusbar').getBoundingClientRect();
    return { bottom: w.bottom, footerH: f.height, winH: window.innerHeight };
  })()`);
  check('workspace 高度已扣除标签条，底部未被裁',
    Math.abs(layout.bottom + layout.footerH - layout.winH) <= 2,
    `bottom=${layout.bottom.toFixed(1)} + footer=${layout.footerH.toFixed(1)} vs ${layout.winH}`);
  check('meta 版本号 = 1.12.0',
    (await evaluate(`document.querySelector('meta[name="version"]').getAttribute('content')`)) === '1.12.0');

  // 2) 打开两份文件后，两份都要出现在标签条上
  await evaluate(`(document.querySelector('#recent-list .recent-item[data-id="file:a.md:6"]').click(), true)`);
  await sleep(800);
  const afterA = await evaluate(TAB_STATE);
  check('打开 a.md 后标签条新增 a.md', afterA.count === 2 && afterA.ids.includes('file:a.md:6'), JSON.stringify(afterA.ids));
  check('当前高亮切到 a.md', afterA.activeId === 'file:a.md:6', String(afterA.activeId));

  await evaluate(`(document.querySelector('#recent-list .recent-item[data-id="file:b.md:6"]').click(), true)`);
  await sleep(800);
  const afterB = await evaluate(TAB_STATE);
  check('打开 b.md 后共 3 个标签（含初始文档）', afterB.count === 3, JSON.stringify(afterB.ids));
  check('当前高亮切到 b.md 且预览为 BBB',
    afterB.activeId === 'file:b.md:6' && /BBB body/.test(await evaluate(`document.getElementById('preview').innerText`)),
    String(afterB.activeId));

  // 3) 核心诉求：直接点标签切换不同文件
  await evaluate(`(document.querySelector('.mdsl-tab[data-id="file:a.md:6"]').click(), true)`);
  await sleep(850);
  const byTab = await evaluate(`(() => ({
    active: document.querySelector('.mdsl-tab.active')?.dataset.id || null,
    preview: document.getElementById('preview').innerText,
    title: document.title
  }))()`);
  check('点 a.md 标签直接切换到 AAA 正文', /AAA body/.test(byTab.preview) && byTab.active === 'file:a.md:6',
    `${byTab.active} / ${byTab.preview.slice(0, 30)}`);
  check('切换后标题同步为 a.md', /a\.md/.test(byTab.title), byTab.title);

  // 4) Alt+1..9 快捷键切第 N 个标签
  for (const ev of key('1', 'Digit1', 49, 1)) await send('Input.dispatchKeyEvent', ev);  // Alt+1
  await sleep(650);
  check('Alt+1 切到第 1 个标签（初始文档）',
    (await evaluate(`document.querySelector('.mdsl-tab.active')?.dataset.id`)) === 'draft');
  for (const ev of key('3', 'Digit3', 51, 1)) await send('Input.dispatchKeyEvent', ev);  // Alt+3
  await sleep(650);
  check('Alt+3 切到第 3 个标签（b.md）且正文为 BBB',
    (await evaluate(`document.querySelector('.mdsl-tab.active')?.dataset.id`)) === 'file:b.md:6'
    && /BBB body/.test(await evaluate(`document.getElementById('preview').innerText`)));

  // 5) 切换前自动暂存：编辑 a.md → 切到 b.md → 点 a.md 标签切回，改动不能丢
  await evaluate(`(document.querySelector('.mdsl-tab[data-id="file:a.md:6"]').click(), true)`);
  await sleep(800);
  await evaluate(`(document.querySelector('.cm-content').focus(), true)`);
  await send('Input.insertText', { text: ' TAB-EDIT' });
  await sleep(400);
  check('已在 a.md 输入未保存修改',
    await evaluate(`document.querySelector('.cm-content').innerText.includes('TAB-EDIT')`));
  await evaluate(`(document.querySelector('.mdsl-tab[data-id="file:b.md:6"]').click(), true)`);
  await sleep(800);
  await evaluate(`(document.querySelector('.mdsl-tab[data-id="file:a.md:6"]').click(), true)`);
  await sleep(800);
  const back = await evaluate(`(() => ({
    editor: document.querySelector('.cm-content').innerText,
    preview: document.getElementById('preview').innerText
  }))()`);
  check('经标签切换后未保存内容被暂存并恢复', /TAB-EDIT/.test(back.editor) && /TAB-EDIT/.test(back.preview),
    back.editor.slice(-30));

  // 6) 关闭非当前标签：只移出标签条，缓存与最近文件仍在
  await evaluate(`(document.querySelector('.mdsl-tab-close[data-close="file:b.md:6"]').click(), true)`);
  await sleep(350);
  const closedOther = await evaluate(`(() => ({
    count: document.querySelectorAll('#tabbar .mdsl-tab').length,
    hasB: !!document.querySelector('.mdsl-tab[data-id="file:b.md:6"]'),
    recentHasB: !!document.querySelector('#recent-list .recent-item[data-id="file:b.md:6"]')
  }))()`);
  check('关闭非当前标签后标签数减少', closedOther.count === 2 && !closedOther.hasB, JSON.stringify(closedOther));
  check('关闭标签不删缓存/最近记录', closedOther.recentHasB === true);

  // 7) 关闭当前标签：自动切到相邻标签，被关文档仍在最近文件里
  await evaluate(`(document.querySelector('.mdsl-tab-close[data-close="file:a.md:6"]').click(), true)`);
  await sleep(850);
  const closedCurrent = await evaluate(`(() => ({
    count: document.querySelectorAll('#tabbar .mdsl-tab').length,
    active: document.querySelector('.mdsl-tab.active')?.dataset.id || null,
    recentHasA: !!document.querySelector('#recent-list .recent-item[data-id="file:a.md:6"]'),
    status: document.getElementById('status-text').textContent
  }))()`);
  check('关闭当前标签后自动切到相邻标签', closedCurrent.count === 1 && closedCurrent.active === 'draft', JSON.stringify(closedCurrent));
  check('被关闭的 a.md 仍可从最近文件找回', closedCurrent.recentHasA === true);

  // 8) 最后一个标签不允许关闭（避免编辑器内容与标签状态脱节）
  await evaluate(`(document.querySelector('.mdsl-tab-close[data-close="draft"]').click(), true)`);
  await sleep(300);
  check('最后一个标签关闭被拒绝并提示',
    (await evaluate(`document.querySelectorAll('#tabbar .mdsl-tab').length`)) === 1
    && /至少保留一个标签/.test(await evaluate(`document.getElementById('status-text').textContent`)));

  // 9) 三种视图都可见；打印预览隐藏
  await evaluate(`(document.querySelector('[data-view="reader"]').click(), true)`);
  await sleep(500);
  const reader = await evaluate(TAB_STATE);
  check('阅读模式下标签条仍可见', reader.display !== 'none' && reader.rect.h > 20 && reader.rect.top >= 0,
    `${reader.display} / ${JSON.stringify(reader.rect)}`);
  await evaluate(`(document.querySelector('[data-action="print-mode"]').click(), true)`);
  await sleep(900);
  check('打印预览模式隐藏标签条',
    (await evaluate(`getComputedStyle(document.getElementById('tabbar')).display`)) === 'none');
  for (const ev of key('Escape', 'Escape', 27)) await send('Input.dispatchKeyEvent', ev);
  await sleep(400);
  await evaluate(`(document.querySelector('[data-view="split"]').click(), true)`);
  await sleep(400);

  // 10) 刷新后标签列表持久化，且 active 与真实当前文档一致
  const beforeReload = await evaluate(`JSON.parse(localStorage.getItem('mdstudio.tabs') || '{}')`);
  await send('Page.navigate', { url: FILE });
  await sleep(2400);
  const afterReload = await evaluate(TAB_STATE);
  check('刷新后标签条仍存在且 active 与当前文档一致',
    afterReload.count >= 1 && afterReload.activeId === 'draft', JSON.stringify(afterReload.ids));
  check('标签条持久化数据未被清空', beforeReload && Array.isArray(beforeReload.list));

  // 11) 深色主题下当前标签仍可辨识
  await evaluate(`(document.documentElement.setAttribute('data-theme','dark'), true)`);
  await sleep(350);
  const dark = await evaluate(`(() => {
    const t = document.querySelector('.mdsl-tab.active');
    const cs = getComputedStyle(t);
    return { bg: cs.backgroundColor, fg: cs.color, barBg: getComputedStyle(document.getElementById('tabbar')).backgroundColor };
  })()`);
  check('深色主题下当前标签有独立底色与前景色',
    dark.bg !== dark.barBg && dark.fg && dark.fg !== 'rgb(0, 0, 0)', JSON.stringify(dark));

  // 12) 关于页版本
  await evaluate(`(document.querySelector('[data-action="about"]').click(), true)`);
  await sleep(250);
  const about = await evaluate(`document.querySelector('#about-dialog .about-body').innerText`);
  check('关于页显示 V1.12 / 1.12.0', /V1\.12/.test(about) && /1\.12\.0/.test(about), about.slice(0, 80));

  // 13) 无异常
  check('页面无未捕获异常', exceptions.length === 0, exceptions.slice(0, 2).join(' | '));
  check('控制台无 error', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  ws.close(); edge.kill();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('TEST ERROR', e); try { edge.kill(); } catch (_) {} process.exit(1); });
