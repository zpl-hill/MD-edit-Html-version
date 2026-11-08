/* fileService.js — 打开 / 拖拽 / 保存 / 另存为 / 下载。
   浏览器：传统文件选择 + a[download]（已验证可靠）。
   桌面版（Tauri）：由 native 适配器直接读写原文件，不再触发浏览器下载。
   两条路径的对外接口一致，只是桌面版的 save / saveAs 返回 Promise。 */

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'untitled';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function createFileService(options) {
  const opts = options || {};
  const onOpen = opts.onOpen ? opts.onOpen : () => {};
  const onLimit = opts.onLimit ? opts.onLimit : () => true;
  const native = opts.native || null;

  let currentName = opts.initialName || 'untitled.md';
  let currentId = 'draft';

  function pickFile() {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.md,.markdown,.txt,text/markdown,text/plain';
      input.onchange = () => resolve(input.files && input.files[0] ? input.files[0] : null);
      input.click();
    });
  }

  async function readFile(file) {
    if (!file) return null;
    if (file.size > 20 * 1024 * 1024 && !onLimit(file.size)) return null;
    const text = await file.text();
    currentName = file.name || currentName;
    currentId = 'file:' + currentName + ':' + file.size;
    const result = { name: currentName, id: currentId, text, size: file.size };
    onOpen(result);
    return result;
  }

  async function open() {
    if (native) {
      const result = await native.open();
      if (!result) return null;
      currentName = result.name;
      currentId = 'file:' + currentName + ':' + result.size;
      const payload = {
        name: currentName,
        id: currentId,
        text: result.text,
        size: result.size,
        path: result.path
      };
      onOpen(payload);
      return payload;
    }
    return await readFile(await pickFile());
  }

  async function openDropped(file) {
    return await readFile(file);
  }

  async function save(text, name) {
    const filename = name || currentName;
    if (native) {
      const written = await native.save(String(text), filename);
      if (!written) return null;
      currentName = written;
      return written;
    }
    downloadBlob(new Blob([String(text)], { type: 'text/markdown;charset=utf-8' }), filename);
    currentName = filename;
    return filename;
  }

  async function saveAs(text, suggested) {
    const base = suggested || currentName;
    if (native) {
      const written = await native.saveAs(String(text), base);
      if (!written) return null;
      currentName = written;
      return written;
    }
    const name = window.prompt('另存为文件名', base);
    if (!name) return null;
    const finalName = name.endsWith('.md') || name.endsWith('.markdown') ? name : name + '.md';
    return await save(text, finalName);
  }

  function baseName(extension) {
    const dot = currentName.lastIndexOf('.');
    const stem = dot > 0 ? currentName.substring(0, dot) : currentName;
    return stem + (extension || '.md');
  }

  /* 新建空白文档：把文件名与文档 id 复位回初始草稿槽。
     这是单文档工具（无多标签页），固定回 'draft' 可让 30 秒自动保存与刷新恢复
     继续命中同一个槽位；旧草稿由 createNewDocument() 显式清除。
     桌面版还要清掉原生侧记住的路径，否则「保存」会写回上一份文件。 */
  function reset(name) {
    currentName = name || 'untitled.md';
    currentId = 'draft';
    if (native && native.resetPath) native.resetPath();
    return currentId;
  }

  return {
    open, openDropped, save, saveAs, baseName, reset, downloadBlob,
    getName: () => currentName,
    getId: () => currentId,
    setName: name => { currentName = name || currentName; },
    setId: id => { currentId = id || currentId; }
  };
}
