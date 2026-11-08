/* imageInsert.js — 「插入图片」对话框：本地文件 / 路径 / 网址，内嵌 Base64 或引用路径。
   浏览器版拿不到本地文件的真实路径（安全限制），因此路径模式只接受手动输入；
   桌面版走原生对话框，可直接拿到磁盘路径并写入相对路径。 */

import { fileToMarkdownImage, dataUriToMarkdownImage, pathToMarkdownImage, toLocalAbsolutePath, isRemoteUrl } from "./imageData.js";

const MODE_KEY = 'imageMode';

export function createImageInserter(options) {
  const { dialog, desktop, getPref, setPref, insert, setStatus } = options;
  if (!dialog) return { open() {}, close() {}, getPreferredMode: () => 'embed', pickFromFiles: async () => {} };

  const q = selector => dialog.querySelector(selector);
  const pathInput = q('#image-path');
  const altInput = q('#image-alt');
  const preview = q('#image-preview');
  const rememberBox = q('#image-remember');
  const hint = q('#image-hint');
  const fileInput = document.querySelector('#image-file-input');

  let pendingFile = null;      // 浏览器：File 对象
  let pendingPath = null;      // 桌面：原生对话框选中的绝对路径
  let busy = false;

  /* 记住的方式同时决定拖入图片的默认行为。 */
  function getPreferredMode() {
    const value = getPref(MODE_KEY, 'embed');
    return value === 'path' ? 'path' : 'embed';
  }

  function currentMode() {
    const checked = dialog.querySelector('input[name="image-mode"]:checked');
    return checked && checked.value === 'path' ? 'path' : 'embed';
  }

  function setMode(mode) {
    dialog.querySelectorAll('input[name="image-mode"]').forEach(radio => {
      radio.checked = radio.value === (mode === 'path' ? 'path' : 'embed');
    });
    updateHints();
  }

  function updateHints() {
    const path = pathInput.value.trim();
    const local = path && !isRemoteUrl(path);
    if (!desktop.enabled) {
      hint.textContent = currentMode() === 'path'
        ? '浏览器版拿不到文件真实路径：上面这串文字会原样写进文档，请自行确认是相对路径或网址。'
        : '选中的图片会在本机读进内存并内嵌，不会上传到任何地方。';
      return;
    }
    if (!local) { hint.textContent = '选择一个本地图片，或直接粘贴图片路径 / 网址。'; return; }
    if (!desktop.getPath()) {
      hint.textContent = '当前文档还没保存，会写入绝对路径；保存到磁盘后相对路径更便于整体搬移。';
      return;
    }
    hint.textContent = '会写入相对于当前文档的路径，整个文件夹搬走后仍然可用。';
  }

  function resetPreview(message) {
    preview.textContent = '';
    preview.classList.remove('has-image');
    if (message) {
      const p = document.createElement('span');
      p.className = 'image-preview-note';
      p.textContent = message;
      preview.appendChild(p);
    }
  }

  function showPreview(src) {
    if (!src) { resetPreview(''); return; }
    resetPreview('');
    const img = document.createElement('img');
    img.alt = '';
    img.onerror = () => resetPreview('无法读取该图片（路径可能不对，或文件已被移动）');
    img.onload = () => preview.classList.add('has-image');
    img.src = src;
    preview.appendChild(img);
  }

  function previewSource() {
    if (pendingFile) return URL.createObjectURL(pendingFile);
    const path = pathInput.value.trim();
    if (!path) return '';
    if (!desktop.enabled) return /^(?:https?:|data:)/i.test(path) ? path : '';
    const abs = toLocalAbsolutePath(path, desktop.getPath());
    if (abs) return desktop.assetUrl(abs);
    return isRemoteUrl(path) ? path : '';
  }

  function refresh() {
    updateHints();
    const src = previewSource();
    if (src) showPreview(src);
    else resetPreview(pathInput.value.trim() ? '选择文件后可预览' : '还没有选择图片');
  }

  function open(preset) {
    pendingFile = null;
    pendingPath = null;
    pathInput.value = (preset && preset.path) || '';
    altInput.value = (preset && preset.alt) || '';
    setMode((preset && preset.mode) || getPreferredMode());
    rememberBox.checked = true;
    if (preset && preset.file) {
      pendingFile = preset.file;
      if (!altInput.value) altInput.value = String(preset.file.name || '').replace(/\.[^.]+$/, '');
    }
    dialog.classList.add('open');
    refresh();
    setTimeout(() => pathInput.focus(), 30);
  }

  function close() {
    dialog.classList.remove('open');
    resetPreview('');
    pendingFile = null;
    pendingPath = null;
  }

  async function pick() {
    if (desktop.enabled && desktop.pickImage) {
      let path = null;
      try { path = await desktop.pickImage(); } catch (e) { setStatus('选择图片失败：' + (e.message || e)); return; }
      if (!path) return;
      pendingPath = path;
      pendingFile = null;
      pathInput.value = path;
      if (!altInput.value.trim()) {
        const base = String(path).split(/[\\/]/).pop() || '';
        altInput.value = base.replace(/\.[^.]+$/, '');
      }
      refresh();
      return;
    }
    if (fileInput) {
      fileInput.value = '';
      fileInput.click();
    }
  }

  function onFilePicked(file) {
    if (!file) return;
    pendingFile = file;
    pendingPath = null;
    pathInput.value = file.name;
    if (!altInput.value.trim()) altInput.value = String(file.name || '').replace(/\.[^.]+$/, '');
    refresh();
  }

  async function buildEntry() {
    const mode = currentMode();
    const rawPath = pathInput.value.trim();
    if (!rawPath && !pendingFile) throw new Error('请先选择图片，或填写图片路径 / 网址');

    if (mode === 'path') {
      /* 带协议的（https:// / data: / file:）原样写入；其余按本地路径处理。 */
      let target = rawPath;
      if (!isRemoteUrl(rawPath) && desktop.enabled) target = await desktop.imagePathFor(desktop.getPath(), rawPath);
      return pathToMarkdownImage(target, altInput.value);
    }

    if (pendingFile) return await fileToMarkdownImage(pendingFile);

    if (/^data:image\//i.test(rawPath)) return await dataUriToMarkdownImage(rawPath, altInput.value || '图片');

    if (/^https?:/i.test(rawPath)) {
      throw new Error('外链图片请选「引用路径」，内嵌需要先把图片下载到本地');
    }

    if (!desktop.enabled) {
      throw new Error('浏览器版读不到文件内容，请用「选择文件」按钮，或改用「引用路径」');
    }
    const dataUrl = await desktop.readImageDataUrl(rawPath);
    const base = String(rawPath).split(/[\\/]/).pop() || '图片';
    return await dataUriToMarkdownImage(dataUrl, altInput.value || base.replace(/\.[^.]+$/, ''));
  }

  async function doInsert() {
    if (busy) return;
    busy = true;
    const button = q('[data-image="insert"]');
    if (button) button.disabled = true;
    try {
      const entry = await buildEntry();
      if (rememberBox.checked) setPref(MODE_KEY, entry.mode || currentMode());
      close();
      insert(entry);
    } catch (e) {
      setStatus('插入图片失败：' + (e && e.message ? e.message : e));
    } finally {
      busy = false;
      if (button) button.disabled = false;
    }
  }

  dialog.addEventListener('click', event => {
    const action = event.target.closest('[data-image]');
    if (action) {
      const name = action.getAttribute('data-image');
      if (name === 'pick') pick();
      else if (name === 'insert') doInsert();
      else if (name === 'cancel') close();
      return;
    }
    if (event.target === dialog || event.target.closest('[data-close]')) close();
  });

  dialog.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && event.target.tagName !== 'TEXTAREA') {
      const tag = event.target.tagName;
      if (tag === 'INPUT' && event.target.type === 'text') { event.preventDefault(); doInsert(); }
    }
  });

  pathInput.addEventListener('input', () => { pendingFile = null; pendingPath = null; refresh(); });
  pathInput.addEventListener('blur', refresh);
  dialog.querySelectorAll('input[name="image-mode"]').forEach(radio => {
    radio.addEventListener('change', updateHints);
  });
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) onFilePicked(file);
    });
  }

  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && dialog.classList.contains('open')) close();
  });

  /* 拖入 / 粘贴时直接按偏好走，不弹窗打断；想换方式再从对话框里选。 */
  return {
    open,
    close,
    pick,
    onFilePicked,
    getPreferredMode,
    isOpen: () => dialog.classList.contains('open')
  };
}
