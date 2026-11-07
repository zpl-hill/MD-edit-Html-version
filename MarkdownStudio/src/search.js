/* search.js — 复用 CodeMirror 6 原生搜索/替换面板，不重复造轮子。 */
export function createSearchController(editor) {
  const CM = globalThis.CM6;

  function focusReplaceField() {
    const panel = editor.view.dom.querySelector('.cm-search');
    if (!panel) return false;
    // 旧版 CM6 的替换区是折叠的（checkbox 控制），新版则常驻展开。
    const toggle = panel.querySelector('input[type="checkbox"][name="replace"]');
    if (toggle) {
      if (!toggle.checked) toggle.click();
      return true;
    }
    const field = panel.querySelector('input[name="replace"]:not([type="checkbox"])');
    if (!field) return false;
    if (typeof field.focus === 'function') field.focus();
    return true;
  }

  return {
    find() { if (CM && CM.openSearchPanel) CM.openSearchPanel(editor.view); },
    replace() {
      if (!CM || !CM.openSearchPanel) return;
      CM.openSearchPanel(editor.view);
      // 面板可能晚一帧才插入 DOM；聚焦替换输入框，让用户按 Ctrl+H 后可直接输入。
      requestAnimationFrame(() => {
        if (!focusReplaceField()) setTimeout(focusReplaceField, 80);
      });
    },
    next() { if (CM && CM.findNext) CM.findNext(editor.view); },
    previous() { if (CM && CM.findPrevious) CM.findPrevious(editor.view); },
    close() { if (CM && CM.closeSearchPanel) CM.closeSearchPanel(editor.view); }
  };
}
