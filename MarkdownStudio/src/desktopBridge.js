/* desktopBridge.js — 桌面版（Tauri 2）原生能力桥接。
   浏览器里运行时 enabled = false，调用方保持原有 File API 行为，丝毫不改；
   只有检测到 window.__TAURI__ 时才把打开 / 保存 / 文件关联交给原生层。 */

export function createDesktopBridge() {
  const tauri = globalThis.__TAURI__;
  const invoke =
    tauri && tauri.core && typeof tauri.core.invoke === 'function' ? tauri.core.invoke : null;

  if (!invoke) return { enabled: false };

  let currentPath = null;
  let currentEncoding = 'utf-8';

  function baseName(p) {
    if (!p) return 'untitled.md';
    const parts = String(p).split(/[\\/]/);
    return parts[parts.length - 1] || 'untitled.md';
  }

  async function loadPath(path) {
    const res = await invoke('read_text_file', { path });
    currentPath = path;
    currentEncoding = (res && res.encoding) || 'utf-8';
    return {
      name: baseName(path),
      text: res.text,
      size: res.size,
      path,
      encoding: currentEncoding
    };
  }

  async function open() {
    const path = await invoke('pick_markdown');
    if (!path) return null;
    return await loadPath(path);
  }

  /* 有当前路径就直接写回原文件；没有（新建的草稿）才走另存为。 */
  async function save(text, name) {
    if (!currentPath) return await saveAs(text, name);
    await invoke('write_text_file', {
      path: currentPath,
      text: String(text),
      encoding: currentEncoding
    });
    return baseName(currentPath);
  }

  async function saveAs(text, suggested) {
    const target = await invoke('pick_save_path', { defaultName: suggested || 'untitled.md' });
    if (!target) return null;
    await invoke('write_text_file', {
      path: target,
      text: String(text),
      encoding: currentEncoding
    });
    currentPath = target;
    return baseName(target);
  }

  /* 宿主（命令行参数 / 第二个实例）送进来的文件，取一次即清空。 */
  async function takePending() {
    const path = await invoke('take_pending_file');
    if (!path) return null;
    return await loadPath(path);
  }

  function resetPath() {
    currentPath = null;
    currentEncoding = 'utf-8';
  }

  async function setDefaultApp() {
    return await invoke('set_default_app');
  }

  async function defaultStatus() {
    try {
      return await invoke('default_app_status');
    } catch (e) {
      return { is_default: false, registered: false, user_choice: null, exe: '' };
    }
  }

  async function openDefaultSettings() {
    return await invoke('open_default_apps_settings');
  }

  /* 弹系统「打开方式」对话框；path 为空时 Rust 侧会生成一个示例 .md 供选择。 */
  async function openWithDialog(path) {
    return await invoke('open_with_dialog', { path: path || null });
  }

  async function revealInExplorer(path) {
    return await invoke('reveal_in_explorer', { path: path || currentPath });
  }

  /* ---- 图片：选文件 / 读字节 / 算相对路径 / 转内部 URL ---- */

  async function pickImage() {
    return await invoke('pick_image');
  }

  async function readImageDataUrl(path) {
    return await invoke('read_image_data_url', { path });
  }

  /* 返回写进 Markdown 的路径：同盘且文档已保存时给相对路径，否则给绝对路径。 */
  async function imagePathFor(baseFile, imagePath) {
    return await invoke('image_markdown_path', { baseFile: baseFile || null, image: imagePath });
  }

  /* WebView2 的页面源是 http://tauri.localhost，file:// 图片会被拦，
     必须换成 asset 协议地址才能显示。 */
  function assetUrl(path) {
    if (!path) return '';
    const core = tauri && tauri.core;
    if (core && typeof core.convertFileSrc === 'function') {
      try { return core.convertFileSrc(path); } catch (e) { return ''; }
    }
    return '';
  }

  return {
    enabled: true,
    open,
    save,
    saveAs,
    loadPath,
    takePending,
    resetPath,
    setDefaultApp,
    defaultStatus,
    openDefaultSettings,
    openWithDialog,
    revealInExplorer,
    pickImage,
    readImageDataUrl,
    imagePathFor,
    assetUrl,
    baseName,
    getPath: () => currentPath,
    getEncoding: () => currentEncoding
  };
}
