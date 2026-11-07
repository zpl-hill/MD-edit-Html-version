/* viewer.js — 预览渲染、debounce、大文档降级、视区代码高亮、滚动同步。 */
import { createParser } from "./parser.js";

const DEBOUNCE_MS = 150;
const BIG_DOC_BYTES = 2000000;

export function createPreviewController(options) {
  const container = options.container;
  const parser = createParser();
  let timer = null;
  let idleHandle = null;
  let pauseSyncUntil = 0;
  let lastSource = '';

  function highlightVisible() {
    const blocks = container.querySelectorAll('pre > code[data-hl="0"]');
    let changed = false;
    Array.from(blocks).forEach(code => {
      const lang = code.getAttribute('data-lang') || '';
      const grammar = lang && globalThis.Prism ? globalThis.Prism.languages[lang] : null;
      if (!grammar) { code.setAttribute('data-hl', 'na'); return; }
      try {
        code.innerHTML = globalThis.Prism.highlight(code.textContent, grammar, lang);
        code.setAttribute('data-hl', '1');
        changed = true;
      } catch (e) { code.setAttribute('data-hl', 'na'); }
    });
    // 代码块 DOM 被替换后，预览查找的 mark 会失效，需要按当前关键词重建。
    if (changed && options.onHighlighted) options.onHighlighted();
  }

  function observeCodeBlocks() {
    if (!('IntersectionObserver' in window)) { highlightVisible(); return; }
    const observer = new IntersectionObserver(entries => {
      let dirty = false;
      entries.forEach(entry => { if (entry.isIntersecting) dirty = true; });
      if (dirty) highlightVisible();
    }, { root: container, rootMargin: '300px' });
    container.querySelectorAll('pre > code[data-hl="0"]').forEach(code => observer.observe(code));
  }

  function render(src) {
    lastSource = String(src || '');
    const scrollRatio = container.scrollTop / Math.max(1, container.scrollHeight - container.clientHeight);
    try {
      const result = parser.render(lastSource);
      container.innerHTML = result.html;
      container.scrollTop = scrollRatio * Math.max(1, container.scrollHeight - container.clientHeight);
      observeCodeBlocks();
      if (options.onHeadings) options.onHeadings(result.headings);
      if (options.onRendered) options.onRendered(result);
    } catch (e) {
      container.innerHTML = '<p class="mdsl-error">预览渲染失败：' + (e && e.message ? e.message : '未知错误') + '</p>';
      if (options.onError) options.onError(e);
    }
  }

  function scheduleRender(src) {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (idleHandle !== null && typeof cancelIdleCallback === 'function') { cancelIdleCallback(idleHandle); idleHandle = null; }
    const big = String(src || '').length > BIG_DOC_BYTES;
    if (big && typeof requestIdleCallback === 'function') {
      idleHandle = requestIdleCallback(() => { idleHandle = null; render(src); }, { timeout: 1200 });
      if (options.onStatus) options.onStatus('大文档：停止输入后渲染');
    } else {
      timer = setTimeout(() => { timer = null; render(src); }, DEBOUNCE_MS);
    }
  }

  function syncScroll(ratio) {
    if (Date.now() < pauseSyncUntil) return;
    container.scrollTop = ratio * Math.max(1, container.scrollHeight - container.clientHeight);
  }

  container.addEventListener('scroll', () => { pauseSyncUntil = Date.now() + 300; }, { passive: true });

  return {
    render, scheduleRender, syncScroll,
    getHtml: () => container.innerHTML,
    getSource: () => lastSource,
    highlightVisible
  };
}
