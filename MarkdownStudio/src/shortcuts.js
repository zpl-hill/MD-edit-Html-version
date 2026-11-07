/* shortcuts.js — 全局快捷键注册与冲突检测。 */
function normalize(combo) {
  return String(combo).toLowerCase().replace(/\s+/g, '')
    .replace(/control/g, 'ctrl').replace(/cmd/g, 'ctrl')
    .split('+').sort().join('+');
}

export function createShortcutRegistry(target) {
  const handlers = new Map();
  const host = target || window;

  function register(combo, handler, label) {
    const key = normalize(combo);
    if (handlers.has(key)) throw new Error('快捷键冲突: ' + combo);
    handlers.set(key, { combo, handler, label: label || combo });
    return key;
  }

  function eventKey(event) {
    const parts = [];
    if (event.ctrlKey || event.metaKey) parts.push('ctrl');
    if (event.altKey) parts.push('alt');
    if (event.shiftKey) parts.push('shift');
    let key = String(event.key || '').toLowerCase();
    if (key === ' ') key = 'space';
    parts.push(key);
    return parts.sort().join('+');
  }

  function attach() {
    host.addEventListener('keydown', event => {
      const entry = handlers.get(eventKey(event));
      if (!entry) return;
      event.preventDefault();
      event.stopPropagation();
      try { entry.handler(event); } catch (e) { console.error('[shortcut]', e); }
    }, true);
  }

  return { register, attach, list: () => Array.from(handlers.values()), normalize };
}
