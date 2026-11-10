/* tabs.js — 常驻标签条：把「当前文档 + 已打开过的文档」可视化，点一下就切过去。
 *
 * 注意这仍是「单窗口快速切换」（方案 B），不是真多标签：同一时刻只有一份 CM6
 * 编辑器状态与一份预览。标签只记录 id / name / path，正文始终留在 IndexedDB
 * 缓存里；关闭标签只把条目从标签条移除，绝不删缓存，仍可从「最近文件」找回。
 *
 * 之所以要单独持久化一份「标签列表」而不是直接渲染最近文件：最近文件是历史记录
 * （最多 10 条、按时间滚动），标签条是用户主动保留的工作区快捷入口，两者语义不同。
 */
const KEY = 'mdstudio.tabs';
const MAX_TABS = 12;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (!data || !Array.isArray(data.list)) return { list: [], active: null };
    const list = data.list
      .filter(item => item && typeof item.id === 'string' && typeof item.name === 'string')
      .slice(0, MAX_TABS)
      .map(item => ({ id: item.id, name: item.name, path: item.path || null }));
    return { list, active: typeof data.active === 'string' ? data.active : null };
  } catch (e) {
    return { list: [], active: null };
  }
}

export function createTabs(options) {
  const root = document.getElementById('tabbar');
  const state = load();
  const onActivate = options.onActivate || function () {};
  const onClose = options.onClose || function () {};

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 存储降级时不阻塞 UI */ }
  }

  function list() { return state.list.map(item => Object.assign({}, item)); }
  function active() { return state.active; }

  function add(item) {
    if (!item || !item.id) return;
    const found = state.list.find(entry => entry.id === item.id);
    if (found) {
      found.name = item.name || found.name;
      if (item.path !== undefined) found.path = item.path || null;
    } else {
      state.list.push({ id: item.id, name: item.name || 'untitled.md', path: item.path || null });
      while (state.list.length > MAX_TABS) state.list.shift();
    }
    save();
  }

  function setActive(id) {
    if (!id) return;
    state.active = id;
    // active 必须始终指向一个可见标签，否则标签条会出现「没有任何高亮」的怪状态
    if (!state.list.some(entry => entry.id === id)) {
      state.list.unshift({ id, name: 'untitled.md', path: null });
    }
    save();
  }

  function remove(id) {
    state.list = state.list.filter(entry => entry.id !== id);
    save();
  }

  function render() {
    if (!root) return;
    root.replaceChildren();
    state.list.forEach(item => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'mdsl-tab' + (item.id === state.active ? ' active' : '');
      tab.dataset.id = item.id;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', item.id === state.active ? 'true' : 'false');
      tab.title = item.name + (item.path ? '\n原文件：' + item.path : '\n本机缓存');

      const label = document.createElement('span');
      label.className = 'mdsl-tab-name';
      label.textContent = item.name;
      const close = document.createElement('span');
      close.className = 'mdsl-tab-close';
      close.dataset.close = item.id;
      close.setAttribute('aria-label', '从标签条移除 ' + item.name);
      close.textContent = '×';
      tab.append(label, close);
      root.appendChild(tab);
    });
    const hint = document.createElement('span');
    hint.className = 'tabbar-hint';
    hint.textContent = '点击切换 · 切换前自动暂存 · × 只移出标签条（缓存保留）';
    root.appendChild(hint);
  }

  if (root) {
    root.addEventListener('click', event => {
      const close = event.target.closest('[data-close]');
      if (close) { event.stopPropagation(); onClose(close.getAttribute('data-close')); return; }
      const tab = event.target.closest('.mdsl-tab[data-id]');
      if (tab) onActivate(tab.getAttribute('data-id'));
    });
  }

  return { list, active, add, setActive, remove, render };
}
