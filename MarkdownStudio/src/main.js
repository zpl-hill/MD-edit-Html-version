/* main.js — 应用装配与生命周期。构建时被包成 async IIFE 作为入口。 */
import { detectCapabilities } from "./platform.js";
import { icon } from "./icons.js";
import { hasNotices, buildNoticesMarkup } from "./notices.js";
import { getPref, setPref, listRecent, touchRecent, createStorageAdapter, putEmergencyDraft, putEmergencyDraftSync, readEmergencyDraft, clearEmergencyDraft } from "./storage.js";
import { createThemeController } from "./theme.js";
import { createShortcutRegistry } from "./shortcuts.js";
import { createParser } from "./parser.js";
import { createEditor } from "./editor.js";
import { createPreviewController } from "./viewer.js";
import { createTocTree } from "./toc.js";
import { createSearchController } from "./search.js";
import { createPreviewSearch } from "./previewSearch.js";
import { AUTHOR_NAME, AUTHOR_EMAIL } from "./author.js";
import { createImageViewer } from "./imageViewer.js";
import { createFileService } from "./fileService.js";
import { createPrintController } from "./print.js";
import { createDocxExporter } from "./exportDocx.js";
import { createHelpController } from "./help.js";
import { imageFilesFromDataTransfer, imageFilesFromClipboard, fileToMarkdownImage, buildImageSnippet } from "./imageData.js";

const $ = selector => document.querySelector(selector);

let uiScale = 1.15;

/* 界面字体缩放：默认值由 CSS 按屏幕宽度给出（大屏更大），用户可用 A− / A+ 覆盖并持久化。 */
function applyUiScale(value, persist) {
  const scale = Math.max(0.9, Math.min(1.7, Math.round(Number(value) * 100) / 100));
  if (!Number.isFinite(scale)) return uiScale;
  uiScale = scale;
  document.documentElement.style.setProperty('--ui-scale', String(scale));
  const label = $('#ui-scale-label');
  if (label) label.textContent = Math.round(scale * 100) + '%';
  if (persist) setPref('uiScale', scale);
  return scale;
}

function initUiScale() {
  const saved = getPref('uiScale', null);
  const fromCss = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'));
  applyUiScale(saved != null && Number.isFinite(Number(saved)) ? Number(saved) : (fromCss || 1.15), false);
}

initUiScale();
const SAMPLE = [
  '# Markdown Studio Lite',
  '',
  '欢迎使用！这是一个**完全离线**的 Markdown 编辑、预览与导出工具。',
  '',
  '## 快速开始',
  '',
  '1. 在左侧编辑 Markdown，右侧实时预览。',
  '2. 目录会自动生成，点击即可跳转。',
  '3. 使用 `Ctrl+S` 保存，`Ctrl+Shift+P` 打印 / 另存为 PDF。',
  '',
  '## 功能一览',
  '',
  '| 模块 | 状态 |',
  '| --- | --- |',
  '| 实时预览 | 支持 |',
  '| 目录导航 | 支持 |',
  '| 代码高亮 | 支持 |',
  '| 数学公式 | 支持 |',
  '| Word 导出 | 支持 |',
  '',
  '### 代码',
  '',
  '```javascript',
  'const answer = 42;',
  'console.log(`hello ${answer}`);',
  '```',
  '',
  '### 公式',
  '',
  '行内公式 $E = mc^2$，以及独立公式：',
  '',
  '$$\\text{GRR} = \\sqrt{\\sigma_{EV}^2 + \\sigma_{AV}^2}$$',
  '',
  '> 数据只保存在本机。刷新后可通过草稿横幅恢复。',
  '',
  '---',
  '',
  '*Markdown Studio Lite · 单文件离线运行*'
].join('\n');

let storage = null;
let currentDocId = 'draft';
let dirty = false;
let headings = [];
let autosaveTimer = null;
let viewMode = 'split';
let previewSearch = null;

function setStatus(message) {
  const el = $('#status-text');
  if (el) el.textContent = message;
}

function setSaveStatus(message) {
  const el = $('#status-save');
  if (el) el.textContent = message;
}

function timeNow() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

/* 浏览器标签页显示当前文档名，新建 / 打开 / 另存为后都能一眼看出在编辑哪份文件。 */
function syncTitle(name) {
  document.title = 'Markdown Studio Lite — ' + (name || fileService.getName());
}

function banner(message, actions) {
  const root = $('#banner');
  if (!root) return;
  root.innerHTML = '';
  const text = document.createElement('span');
  text.textContent = message;
  root.appendChild(text);
  (actions || []).forEach(action => {
    const button = document.createElement('button');
    button.textContent = action.label;
    button.onclick = action.run;
    root.appendChild(button);
  });
  root.classList.add('visible');
}

function hideBanner() {
  const root = $('#banner');
  if (root) { root.classList.remove('visible'); root.innerHTML = ''; }
}

function updateCounts(text) {
  const el = $('#status-doc');
  if (!el) return;
  const source = text != null ? text : editorRef.getText();
  const stats = editorRef.getStats();
  let words;
  if (source.length > 1000000) {
    // 大文档：按前 64 KB 采样估算词数，避免每次按键全量扫描 10 MB 文本（约 150 万词）。
    const sample = source.slice(0, 65536);
    const density = (sample.match(/\S+/g) || []).length / Math.max(1, sample.length);
    words = '~' + Math.round(source.length * density);
  } else {
    words = String((source.trim().match(/\S+/g) || []).length);
  }
  el.textContent = stats.lines + ' 行 · ' + words + ' 词 · ' + formatSize(new Blob([source]).size);
}

let editorRef = null;

const storageReady = createStorageAdapter();
storage = await storageReady;
const capability = storage.capability();
$('#status-backend').textContent = '存储: ' + capability.backend +
  (capability.backend === 'indexeddb' ? '' : '（降级）');
if (capability.backend !== 'indexeddb') {
  setStatus('存储能力受限：' + (capability.reason || capability.backend) + '，请手动保存文件');
}

const fileService = createFileService({
  initialName: 'untitled.md',
  onOpen: result => {
    currentDocId = result.id;
    touchRecent({ id: result.id, name: result.name, size: result.size, source: 'file' });
    renderRecent();
    syncTitle(result.name);
    setStatus('已打开 ' + result.name);
  },
  onLimit: size => window.confirm('文件约 ' + formatSize(size) + '，超出设计容量 20 MB，可能卡顿。仍要继续吗？')
});

editorRef = createEditor({ parent: $('#editor-host'), initial: getPref('startupBlank', false) ? '' : SAMPLE });
const parser = createParser();

const viewer = createPreviewController({
  container: $('#preview'),
  onHeadings: list => {
    headings = list;
    tocRef.setHeadings(list);
  },
  onStatus: setStatus,
  // 预览 DOM 被整体替换 / 代码块延迟高亮后，重建「预览内查找」的高亮。
  onRendered: () => { if (previewSearch) previewSearch.refresh(); },
  onHighlighted: () => { if (previewSearch) previewSearch.refresh(); }
});

let tocRef = createTocTree($('#toc-tree'), {
  onNavigate: id => setStatus('跳转到 #' + id)
});

const search = createSearchController(editorRef);
previewSearch = createPreviewSearch({
  container: $('#preview'),
  bar: $('#find-bar'),
  input: $('#find-input'),
  count: $('#find-count'),
  onStatus: setStatus
});

/* 阅读模式下编辑器被隐藏：Ctrl+F 改走「预览内查找」；
   Ctrl+H 替换必须看到源码，先切回三栏视图再打开 CM6 替换面板。 */
function doFind() {
  if (viewMode === 'reader') { previewSearch.open(); return; }
  search.find();
}

function doReplace() {
  if (viewMode === 'reader') {
    applyView('split', true);
    setStatus('替换需要编辑器，已切回三栏视图');
  }
  setTimeout(() => search.replace(), 60);
}

const imageViewer = createImageViewer();

const printController = createPrintController({
  getHtml: () => viewer.getHtml(),
  getTitle: () => {
    const first = headings[0];
    return first ? first.text : fileService.getName();
  },
  onStatus: setStatus
});

const docxExporter = createDocxExporter({
  getTokens: () => parser.lex(editorRef.getText()),
  getTitle: () => (headings[0] ? headings[0].text : fileService.getName())
});

const theme = createThemeController(value => editorRef.setTheme(value));

const help = createHelpController({
  dialog: $('#help-dialog'),
  onInsert: text => {
    // 阅读模式下编辑器是隐藏的，先切回可编辑视图再插入示例
    if (viewMode === 'reader') applyView('split', true);
    editorRef.insertText(text);
    editorRef.focus();
    setStatus('已插入语法示例，把占位文字改成自己的内容即可');
  }
});

editorRef.onChange(text => {
  dirty = true;
  viewer.scheduleRender(text);
  updateCounts(text);
  setSaveStatus('有未保存更改');
});
editorRef.onScroll(ratio => viewer.syncScroll(ratio));

$('#preview').addEventListener('click', event => {
  const image = event.target.closest('img[data-viewer]');
  if (image) imageViewer.open(image.getAttribute('src'), image.getAttribute('alt'));
  const anchor = event.target.closest('a[href^="#"]');
  if (anchor) {
    event.preventDefault();
    const id = decodeURIComponent(anchor.getAttribute('href').slice(1));
    tocRef.goto(id);
  }
});

async function saveSnapshot(trigger) {
  if (!dirty) return;
  const text = editorRef.getText();
  try {
    await storage.putSnapshot({
      docId: currentDocId, at: Date.now(), content: text,
      name: fileService.getName(), trigger
    });
    await putEmergencyDraft(text, fileService.getName());
    dirty = false;
    setSaveStatus('自动保存 ' + timeNow());
  } catch (e) {
    setSaveStatus('自动保存失败');
    console.warn('[autosave]', e);
  }
}

async function saveFile() {
  const text = editorRef.getText();
  const name = fileService.save(text);
  syncTitle(name);
  try {
    await storage.putDoc({ id: currentDocId, name, content: text, updatedAt: Date.now(), version: 1 });
    await storage.clearSnapshots(currentDocId);
    clearEmergencyDraft();
    touchRecent({ id: currentDocId, name, size: text.length, source: 'file' });
    renderRecent();
  } catch (e) { console.warn('[save]', e); }
  dirty = false;
  setSaveStatus('已保存 ' + timeNow());
  setStatus('已下载 ' + name + '；正文已存入本机存储');
}

function saveAs() {
  const name = fileService.saveAs(editorRef.getText());
  if (name) { syncTitle(name); setStatus('已另存为 ' + name); setSaveStatus('已保存 ' + timeNow()); }
}

async function openFile() {
  const result = await fileService.open();
  if (!result) return;
  editorRef.setText(result.text);
  viewer.render(result.text);
  updateCounts();
  dirty = false;
  setSaveStatus('已打开 ' + timeNow());
}

/* ---------- 新建文档 ----------
   绝对不能只是「清空编辑器」：IndexedDB 快照、全局紧急草稿、恢复横幅都还指向旧内容，
   任何一处没处理，刷新后旧文档都会被恢复回来；Ctrl+Z 也不该把上一份文档撤回来
   （由 editor.reset() 重建 EditorState 保证）。
   文档 id 复位回固定的 'draft' 槽位（单文档工具无多标签页），这样 30 秒自动保存
   与启动时的 restoreDraft() 仍命中同一处；旧文档留在本机存储与「最近文件」里。 */
async function createNewDocument() {
  const oldId = currentDocId;
  currentDocId = fileService.reset('untitled.md');
  // 旧文档（以及此前未命名草稿）的快照都要清，否则刷新后会被恢复出来。
  try { await storage.clearSnapshots(oldId); } catch (e) { /* 存储不可用时忽略 */ }
  if (oldId !== currentDocId) {
    try { await storage.clearSnapshots(currentDocId); } catch (e) { /* ignore */ }
  }
  clearEmergencyDraft();
  hideBanner();
  setPref('startupBlank', true);   // 以后启动默认空白，不再把示例文档当成新建的文档

  editorRef.reset('');
  viewer.render('');
  updateCounts('');
  $('#preview').scrollTop = 0;

  // 与旧内容相关的浮层 / 打印页一并收掉
  search.close();
  if (previewSearch) previewSearch.close();
  imageViewer.close();
  if (printController.getMode() === 'print') printController.setMode('read');
  $('#print-pages').replaceChildren();
  $('#print-source').replaceChildren();

  // 阅读模式下编辑器被隐藏，新建之后必须回到能立刻写字的视图
  if (viewMode === 'reader') applyView('split', true);

  syncTitle();
  editorRef.focus();
  dirty = false;                       // 放在最后，压住 reset 可能触发的同步回调
  setSaveStatus('新文档');
  setStatus('已新建空白文档 ' + fileService.getName() + ' · 开始输入，Ctrl+S 可保存为 .md 文件');
}

function askBeforeNew() {
  const dialog = $('#new-dialog');
  if (!dialog) return;
  dialog.querySelector('.new-doc-name').textContent = fileService.getName();
  dialog.classList.add('open');
  const primary = dialog.querySelector('[data-new="save"]');
  if (primary) primary.focus();
}

function requestNew() {
  if (dirty) { askBeforeNew(); return; }
  createNewDocument();
}

async function exportDocx() {
  setStatus('正在生成 DOCX…');
  try {
    const filename = fileService.baseName('.docx');
    const result = await docxExporter.generate(filename);
    let message = '已导出 ' + filename + '（' + formatSize(result.size) + '）';
    const stats = result.stats;
    if (stats && stats.mathCount) message += ' · ' + stats.mathCount + ' 个公式已转为 Word 原生公式';
    if (stats && stats.mathFailures) message += ' · 注意：' + stats.mathFailures + ' 个公式转换失败，已保留源码';
    if (stats && stats.imageCount) message += ' · ' + stats.imageCount + ' 张图片已嵌入 Word';
    if (stats && stats.imageFailures) message += ' · 注意：' + stats.imageFailures + ' 张图片是外链/相对路径，离线无法读取，已用占位文字代替';
    setStatus(message);
  } catch (e) {
    setStatus('DOCX 导出失败：' + (e && e.message ? e.message : '未知错误'));
    console.error('[docx]', e);
  }
}

function renderRecent() {
  const root = $('#recent-list');
  if (!root) return;
  const list = listRecent();
  root.replaceChildren();
  if (!list.length) {
    const empty = document.createElement('p');
    empty.className = 'recent-empty';
    empty.textContent = '暂无最近文件';
    root.appendChild(empty);
    return;
  }
  list.forEach(item => {
    const button = document.createElement('button');
    button.className = 'recent-item';
    button.dataset.id = item.id;
    button.title = item.name;
    const name = document.createElement('span');
    name.className = 'recent-name';
    name.textContent = item.name;
    const meta = document.createElement('span');
    meta.className = 'recent-meta';
    const when = item.openedAt ? new Date(item.openedAt).toLocaleString() : '';
    const size = item.size != null ? formatSize(item.size) : '';
    meta.textContent = [when, size].filter(Boolean).join(' · ') || '本机缓存';
    button.append(name, meta);
    root.appendChild(button);
  });
}

$('#recent-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-id]');
  if (!button) return;
  const id = button.getAttribute('data-id');
  const doc = await storage.getDoc(id);
  if (!doc) { setStatus('该文件正文未缓存，请用「打开」重新选择文件'); return; }
  editorRef.setText(doc.content);
  viewer.render(doc.content);
  fileService.setName(doc.name);
  fileService.setId(id);
  syncTitle(doc.name);
  currentDocId = id;
  updateCounts();
  dirty = false;
  setStatus('已从本机缓存恢复 ' + doc.name);
});

async function restoreDraft() {
  let snapshot = await storage.latestSnapshot(currentDocId);
  let emergency = false;
  if (!snapshot) {
    const draft = await readEmergencyDraft();
    if (draft && draft.content) {
      snapshot = { content: draft.content, at: draft.at, name: draft.name, truncated: draft.truncated };
      emergency = true;
    }
  }
  if (!snapshot || snapshot.content === editorRef.getText()) return;
  const label = new Date(snapshot.at).toLocaleString();
  banner('发现 ' + label + ' 的未保存草稿' + (snapshot.truncated ? '（不完整）' : '') + '，是否恢复？', [
    {
      label: '恢复', run: () => {
        editorRef.setText(snapshot.content);
        viewer.render(snapshot.content);
        if (snapshot.name) { fileService.setName(snapshot.name); syncTitle(snapshot.name); }
        updateCounts();
        dirty = true;
        hideBanner();
        setStatus('草稿已恢复');
      }
    },
    {
      label: '丢弃', run: async () => {
        await storage.clearSnapshots(currentDocId);
        clearEmergencyDraft();
        hideBanner();
        setStatus('草稿已丢弃');
      }
    }
  ]);
}

const VIEW_LABELS = { split: '三栏', editor: '仅编辑', reader: '仅阅读' };

function applyView(mode, persist) {
  viewMode = ['split', 'editor', 'reader'].indexOf(mode) >= 0 ? mode : 'split';
  document.body.classList.remove('view-split', 'view-editor', 'view-reader');
  document.body.classList.add('view-' + viewMode);
  Array.from(document.querySelectorAll('.view-btn')).forEach(button =>
    button.classList.toggle('active', button.getAttribute('data-view') === viewMode));
  const label = $('#status-view');
  if (label) label.textContent = '视图: ' + VIEW_LABELS[viewMode];
  if (persist) setPref('viewMode', viewMode);
  // 两种查找面板互相排斥：进入阅读模式关掉 CM6 面板，离开阅读模式关掉预览查找条。
  if (viewMode === 'reader') search.close();
  else if (previewSearch) previewSearch.close();
  // 编辑器从隐藏状态恢复后需要 CM6 重新测量视区
  setTimeout(() => { if (editorRef) editorRef.refresh(); }, 50);
  return viewMode;
}

function cycleView() {
  const order = ['split', 'editor', 'reader'];
  const next = order[(order.indexOf(viewMode) + 1) % order.length];
  applyView(next, true);
  setStatus('视图: ' + VIEW_LABELS[next] + '（F6 循环切换）');
  return next;
}

function showAbout() {
  const dialog = $('#about-dialog');
  dialog.querySelector('.about-body').innerHTML =
    '<div class="about-author">' +
      '<div class="about-author-label">作者 / Author</div>' +
      '<div class="about-author-name">' + AUTHOR_NAME + '</div>' +
      '<div class="about-author-contact">' +
        '<a href="mailto:' + AUTHOR_EMAIL + '">' + AUTHOR_EMAIL + '</a>' +
        '<button class="tbtn about-copy" type="button" data-copy-email="1">复制邮箱</button>' +
      '</div>' +
    '</div>' +
    '<p><strong>Markdown Studio Lite V1.0</strong></p>' +
    '<p>单 HTML 文件 · 纯前端 · 完全离线 · 无需安装</p>' +
    '<p>运行时不依赖 Node / Python / 服务器 / 网络。</p>' +
    '<p>存储后端：' + capability.backend + ' · 导出的 Word 文档属性中也会写入作者信息。</p>' +
    '<details open><summary>第三方软件许可证（' + (hasNotices() ? '已内嵌' : '缺失') + '）</summary>' +
    buildNoticesMarkup() + '</details>';
  dialog.classList.add('open');
}

const shortcuts = createShortcutRegistry(window);
/* Ctrl+N 是 Chrome/Edge 保留快捷键（开新窗口），网页无法拦截，故用 Alt+N / Ctrl+Alt+N。 */
shortcuts.register('Alt+N', requestNew);
shortcuts.register('Ctrl+Alt+N', requestNew);
shortcuts.register('Ctrl+O', openFile);
shortcuts.register('Ctrl+S', saveFile);
shortcuts.register('Ctrl+Shift+S', saveAs);
shortcuts.register('Ctrl+F', doFind);
shortcuts.register('Ctrl+H', doReplace);
shortcuts.register('Ctrl+Shift+P', () => printController.print());
shortcuts.register('Ctrl+Shift+W', exportDocx);
shortcuts.register('F6', cycleView);
shortcuts.register('F8', () => { setStatus('主题: ' + theme.cycle()); });
shortcuts.register('F1', () => help.toggle());
shortcuts.register('Ctrl+/', () => help.toggle());
shortcuts.attach();

$('#toolbar').addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.getAttribute('data-action');
  if (action === 'new') requestNew();
  else if (action === 'open') openFile();
  else if (action === 'save') saveFile();
  else if (action === 'save-as') saveAs();
  else if (action === 'pdf') printController.print();
  else if (action === 'docx') exportDocx();
  else if (action === 'theme') setStatus('主题: ' + theme.cycle());
  else if (action === 'print-mode') printController.setMode(printController.getMode() === 'print' ? 'read' : 'print');
  else if (action === 'zoom-in') printController.stepZoom(1);
  else if (action === 'zoom-out') printController.stepZoom(-1);
  else if (action === 'fit') printController.setZoom(1);
  else if (action === 'orientation') setStatus('方向: ' + printController.setOrientation(
    printController.getOrientation() === 'portrait' ? 'landscape' : 'portrait'));
  else if (action === 'about') showAbout();
  else if (action === 'find') doFind();
  else if (action === 'help') help.toggle();
  else if (action === 'ui-smaller') { applyUiScale(uiScale - 0.1, true); setStatus('界面字体: ' + Math.round(uiScale * 100) + '%'); }
  else if (action === 'ui-larger') { applyUiScale(uiScale + 0.1, true); setStatus('界面字体: ' + Math.round(uiScale * 100) + '%'); }
});

$('.view-switch').addEventListener('click', event => {
  const button = event.target.closest('[data-view]');
  if (!button) return;
  applyView(button.getAttribute('data-view'), true);
  setStatus('视图: ' + VIEW_LABELS[viewMode]);
});

$('#about-dialog').addEventListener('click', async event => {
  const copyButton = event.target.closest('[data-copy-email]');
  if (copyButton) {
    let copied = false;
    try { await navigator.clipboard.writeText(AUTHOR_EMAIL); copied = true; } catch (e) { /* 降级 */ }
    if (!copied) {
      const temp = document.createElement('textarea');
      temp.value = AUTHOR_EMAIL;
      temp.setAttribute('readonly', '');
      temp.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(temp);
      temp.select();
      try { copied = document.execCommand('copy'); } catch (e) { /* ignore */ }
      temp.remove();
    }
    if (!copied) {
      // 无剪贴板权限时（企业策略 / 非用户手势）退而求其次：选中邮箱文字，按 Ctrl+C 即可。
      const link = $('#about-dialog').querySelector('.about-author-contact a');
      if (link) {
        const range = document.createRange();
        range.selectNodeContents(link);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    copyButton.textContent = copied ? '已复制' : '已选中，按 Ctrl+C';
    setTimeout(() => { copyButton.textContent = '复制邮箱'; }, 2200);
    return;
  }
  if (event.target === $('#about-dialog') || event.target.closest('[data-close]')) {
    $('#about-dialog').classList.remove('open');
  }
});

/* 新建确认框：有未保存更改时给三条路——保存后新建 / 直接新建 / 取消。 */
$('#new-dialog').addEventListener('click', async event => {
  const dialog = $('#new-dialog');
  const choice = event.target.closest('[data-new]');
  if (choice) {
    const action = choice.getAttribute('data-new');
    dialog.classList.remove('open');
    if (action === 'cancel') { setStatus('已取消新建，当前文档保持不变'); return; }
    if (action === 'save') await saveFile();
    await createNewDocument();
    return;
  }
  if (event.target === dialog || event.target.closest('[data-close]')) dialog.classList.remove('open');
});
window.addEventListener('keydown', event => {
  const dialog = $('#new-dialog');
  if (event.key === 'Escape' && dialog && dialog.classList.contains('open')) dialog.classList.remove('open');
});

/* 图片内嵌：粘贴截图 / 拖入图片文件 → data URI 写进 .md。
   图片随文档一起保存，离线预览、打印和 DOCX 导出都能带上，无需同目录图片文件。 */
async function insertImageFiles(files) {
  if (viewMode === 'reader') applyView('split', true);
  let ok = 0, failed = 0, bytes = 0;
  for (const file of files) {
    try {
      const entry = await fileToMarkdownImage(file);
      const state = editorRef.view.state;
      const head = state.selection.main.head;
      const line = state.doc.lineAt(head);
      const before = line.text.slice(0, head - line.from);
      const after = line.text.slice(head - line.from);
      editorRef.insertText(buildImageSnippet(entry, before, after));
      ok++;
      bytes += entry.bytes;
    } catch (e) {
      failed++;
      console.warn('[image]', e);
    }
  }
  setStatus('已内嵌 ' + ok + ' 张图片（约 ' + formatSize(bytes) + '，随 .md 一起保存，导出 DOCX 会保留）'
    + (failed ? ' · ' + failed + ' 张无法解码' : ''));
}

/* 捕获阶段拦截：有图片时不再让 CodeMirror 把剪贴板内容当纯文本粘贴。 */
document.addEventListener('paste', async event => {
  const files = imageFilesFromClipboard(event.clipboardData);
  if (!files.length) return;
  event.preventDefault();
  event.stopPropagation();
  await insertImageFiles(files);
}, true);

window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', async event => {
  event.preventDefault();
  const images = imageFilesFromDataTransfer(event.dataTransfer);
  if (images.length) { await insertImageFiles(images); return; }
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (!file) return;
  const result = await fileService.openDropped(file);
  if (result) {
    editorRef.setText(result.text);
    viewer.render(result.text);
    updateCounts();
    dirty = false;
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveSnapshot('hidden');
});
window.addEventListener('pagehide', () => {
  if (dirty) putEmergencyDraftSync(editorRef.getText(), fileService.getName());
});

/* 作者信息统一由 author.js 提供：关于页 / 帮助页脚 / DOCX 属性 / HTML meta。 */
const helpCredit = $('#help-credit');
if (helpCredit) {
  helpCredit.appendChild(document.createTextNode('作者：' + AUTHOR_NAME + ' · '));
  const mailLink = document.createElement('a');
  mailLink.href = 'mailto:' + AUTHOR_EMAIL;
  mailLink.textContent = AUTHOR_EMAIL;
  helpCredit.appendChild(mailLink);
}

viewer.render(editorRef.getText());
syncTitle();
updateCounts();
renderRecent();
applyView(getPref('viewMode', 'split'), false);
setSaveStatus('就绪');
setStatus('就绪 · 双击即可离线使用');
if (globalThis.__MDSL_I18N && globalThis.__MDSL_I18N.subtitle) {
  $('#app-subtitle').textContent = globalThis.__MDSL_I18N.subtitle;
  setStatus(globalThis.__MDSL_I18N.ready);
}

await restoreDraft();

if (location.hash && location.hash.length > 1) {
  try { tocRef.goto(decodeURIComponent(location.hash.slice(1))); } catch (e) { /* ignore */ }
}

autosaveTimer = setInterval(() => saveSnapshot('interval'), 30000);
window.addEventListener('pagehide', () => { if (autosaveTimer) clearInterval(autosaveTimer); });
