/* fileService.js — 打开 / 拖拽 / 保存 / 另存为 / 下载。V1 用传统文件选择 + a[download]（已验证可靠）。 */
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
  const onOpen = options && options.onOpen ? options.onOpen : () => {};
  const onLimit = options && options.onLimit ? options.onLimit : () => true;
  let currentName = 'untitled.md';
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

  async function open() { return await readFile(await pickFile()); }
  async function openDropped(file) { return await readFile(file); }

  function save(text, name) {
    const filename = name || currentName;
    downloadBlob(new Blob([String(text)], { type: 'text/markdown;charset=utf-8' }), filename);
    currentName = filename;
    return filename;
  }

  function saveAs(text, suggested) {
    const base = suggested || currentName;
    const name = window.prompt('另存为文件名', base);
    if (!name) return null;
    return save(text, name.endsWith('.md') || name.endsWith('.markdown') ? name : name + '.md');
  }

  function baseName(extension) {
    const dot = currentName.lastIndexOf('.');
    const stem = dot > 0 ? currentName.substring(0, dot) : currentName;
    return stem + (extension || '.md');
  }

  return {
    open, openDropped, save, saveAs, baseName, downloadBlob,
    getName: () => currentName,
    getId: () => currentId,
    setName: name => { currentName = name || currentName; },
    setId: id => { currentId = id || currentId; }
  };
}
