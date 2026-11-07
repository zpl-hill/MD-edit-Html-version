/* previewSearch.js — 阅读模式下的「预览内查找」。
   背景：CodeMirror 搜索面板随编辑器一起被 display:none 隐藏，
   而全局 Ctrl+F 又被快捷键注册表 preventDefault，浏览器原生页内查找也进不来。
   因此阅读模式需要一个独立的、基于渲染后 DOM 的查找条。
   只包裹普通文本节点，跳过 MathML / SVG / 脚本，避免破坏公式与高亮结构。 */
export function createPreviewSearch(options) {
  const container = options.container;
  const bar = options.bar;
  const input = options.input;
  const countEl = options.count;
  const onStatus = options.onStatus || function () {};
  const SKIP = new Set(['MATH', 'SVG', 'SCRIPT', 'STYLE', 'MARK', 'TEXTAREA',
    'INPUT', 'SELECT', 'OPTION', 'NOSCRIPT', 'IFRAME', 'BUTTON']);
  const MAX_HITS = 2000;

  let hits = [];
  let current = -1;
  let caseSensitive = false;

  function isOpen() { return !bar.hidden; }

  function updateCount() {
    if (!countEl) return;
    countEl.textContent = hits.length ? (Math.max(0, current) + 1) + '/' + hits.length : '0/0';
    const noResult = isOpen() && input.value && !hits.length;
    countEl.classList.toggle('no-result', !!noResult);
  }

  function textNodes() {
    const list = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        let el = node.parentElement;
        while (el && el !== container) {
          // HTML 文档里 <math>/<svg> 的 tagName 是小写，且子元素属于 MathML / SVG 命名空间；
          // 往其中插入 HTML <mark> 会破坏公式与矢量图的渲染，必须整支跳过。
          const tag = (el.tagName || '').toUpperCase();
          const ns = el.namespaceURI || '';
          if (SKIP.has(tag) || ns === 'http://www.w3.org/1998/Math/MathML' ||
            ns === 'http://www.w3.org/2000/svg') return NodeFilter.FILTER_REJECT;
          el = el.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) list.push(walker.currentNode);
    return list;
  }

  function clearHighlights() {
    const parents = new Set();
    for (const mark of hits) {
      const parent = mark.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
      if (container.contains(parent)) parents.add(parent);
    }
    hits = [];
    current = -1;
    parents.forEach(parent => { try { parent.normalize(); } catch (e) { /* ignore */ } });
  }

  function applyHighlights(query, focusFirst) {
    const previousIndex = current;
    clearHighlights();
    const q = String(query || '');
    if (q) {
      const needle = caseSensitive ? q : q.toLowerCase();
      for (const node of textNodes()) {
        if (hits.length >= MAX_HITS) break;
        const raw = node.nodeValue;
        const hay = caseSensitive ? raw : raw.toLowerCase();
        let pos = 0;
        let at;
        let frag = null;
        const local = [];
        while ((at = hay.indexOf(needle, pos)) !== -1 && hits.length + local.length < MAX_HITS) {
          if (!frag) frag = document.createDocumentFragment();
          if (at > pos) frag.appendChild(document.createTextNode(raw.slice(pos, at)));
          const mark = document.createElement('mark');
          mark.className = 'mdsl-find-hit';
          mark.textContent = raw.slice(at, at + q.length);
          frag.appendChild(mark);
          local.push(mark);
          pos = at + q.length;
        }
        if (!frag) continue;
        frag.appendChild(document.createTextNode(raw.slice(pos)));
        if (node.parentNode) node.parentNode.replaceChild(frag, node);
        local.forEach(mark => hits.push(mark));
      }
    }
    if (focusFirst && hits.length) goto(1);
    else if (hits.length) {
      current = Math.min(Math.max(previousIndex, 0), hits.length - 1);
      hits[current].classList.add('current');
    }
    updateCount();
  }

  function goto(delta) {
    if (!hits.length) { updateCount(); return; }
    for (const mark of hits) mark.classList.remove('current');
    current = (current + delta + hits.length) % hits.length;
    const el = hits[current];
    el.classList.add('current');
    try {
      const rect = el.getBoundingClientRect();
      const host = container.getBoundingClientRect();
      const target = container.scrollTop + (rect.top - host.top) -
        container.clientHeight / 2 + rect.height / 2;
      container.scrollTop = Math.max(0, target);
    } catch (e) { /* layout not ready */ }
    updateCount();
  }

  function open(preset) {
    bar.hidden = false;
    if (typeof preset === 'string') input.value = preset;
    applyHighlights(input.value, true);
    input.focus();
    input.select();
    onStatus('阅读模式：在预览中查找 · Enter 下一个 / Shift+Enter 上一个 / Esc 关闭');
  }

  function close() {
    clearHighlights();
    updateCount();
    bar.hidden = true;
    if (document.activeElement === input) input.blur();
  }

  /* 预览重渲染 / 代码块延迟高亮后，旧 mark 已脱离文档，需要按当前关键词重新应用。 */
  function refresh() {
    if (!isOpen()) return;
    applyHighlights(input.value, false);
  }

  bar.addEventListener('click', event => {
    const button = event.target.closest('[data-find]');
    if (!button) return;
    const action = button.getAttribute('data-find');
    if (action === 'next') goto(1);
    else if (action === 'prev') goto(-1);
    else if (action === 'case') {
      caseSensitive = !caseSensitive;
      button.classList.toggle('active', caseSensitive);
      button.setAttribute('aria-pressed', String(caseSensitive));
      applyHighlights(input.value, true);
      onStatus(caseSensitive ? '预览查找：区分大小写' : '预览查找：忽略大小写');
    } else if (action === 'close') {
      close();
      onStatus('已关闭预览查找');
    }
  });

  input.addEventListener('input', () => applyHighlights(input.value, true));
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      goto(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      onStatus('已关闭预览查找');
    }
  });

  return {
    open, close, refresh, isOpen, next: () => goto(1), previous: () => goto(-1),
    stats: () => ({ open: isOpen(), query: input.value, hits: hits.length, current, caseSensitive })
  };
}
