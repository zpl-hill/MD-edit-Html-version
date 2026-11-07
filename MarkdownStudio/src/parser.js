/* parser.js — Marked v15 解析 + DOM 后处理（清洗 / 锚点 / 公式 / 图片 / 代码标记）。
   刻意不使用 renderer 覆写：v15 的 renderer 为对象参数，DOM 后处理更稳且跨版本。 */
import { sanitizeHtml, escapeHtml } from "./sanitizer.js";
import { createSlugger } from "./slug.js";

const MATH_RE = /\$\$([\s\S]+?)\$\$|\$((?:\\.|[^$\\\n])+?)\$/g;

function renderMath(tex, display) {
  const fn = globalThis.temml && globalThis.temml.renderToString;
  if (typeof fn !== 'function') return '<span class="mdsl-math-fallback">' + escapeHtml(tex) + '</span>';
  try {
    return fn.call(globalThis.temml, tex, { displayMode: !!display });
  } catch (e) {
    return '<span class="mdsl-math-fallback" title="公式解析失败">' + escapeHtml(tex) + '</span>';
  }
}

function isInsideCode(node) {
  let parent = node.parentNode;
  while (parent) {
    const tag = parent.nodeName ? parent.nodeName.toLowerCase() : '';
    if (tag === 'code' || tag === 'pre') return true;
    parent = parent.parentNode;
  }
  return false;
}

function replaceMathInTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
  const targets = [];
  while (walker.nextNode()) targets.push(walker.currentNode);

  targets.forEach(node => {
    const text = node.nodeValue || '';
    if (text.indexOf('$') === -1 || isInsideCode(node)) return;
    MATH_RE.lastIndex = 0;
    if (!MATH_RE.test(text)) return;
    MATH_RE.lastIndex = 0;

    const fragment = document.createDocumentFragment();
    let last = 0;
    let match;
    while ((match = MATH_RE.exec(text)) !== null) {
      if (match.index > last) fragment.appendChild(document.createTextNode(text.slice(last, match.index)));
      const display = match[1] !== undefined;
      const tex = (display ? match[1] : match[2]).trim();
      const wrapper = document.createElement(display ? 'div' : 'span');
      wrapper.className = display ? 'mdsl-math-block' : 'mdsl-math-inline';
      wrapper.innerHTML = renderMath(tex, display);
      fragment.appendChild(wrapper);
      last = match.index + match[0].length;
    }
    if (last < text.length) fragment.appendChild(document.createTextNode(text.slice(last)));
    if (node.parentNode) node.parentNode.replaceChild(fragment, node);
  });
}

function postProcess(root, slug) {
  const headings = [];
  Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6')).forEach(heading => {
    const text = (heading.textContent || '').trim();
    const id = slug(text);
    heading.setAttribute('id', id);
    const anchor = document.createElement('a');
    anchor.className = 'mdsl-anchor';
    anchor.setAttribute('href', '#' + id);
    anchor.setAttribute('aria-label', '链接到 ' + text);
    // 不写 textContent：'#' 由 CSS ::before 生成，避免污染标题文本（复制/选择/打印）。
    heading.insertBefore(anchor, heading.firstChild);
    headings.push({ id, level: Number(heading.tagName.substring(1)), text });
  });

  Array.from(root.querySelectorAll('a[href]')).forEach(link => {
    const href = link.getAttribute('href') || '';
    if (/^(https?:|mailto:)/i.test(href)) {
      link.setAttribute('rel', 'noopener noreferrer');
      link.setAttribute('target', '_blank');
    }
  });

  Array.from(root.querySelectorAll('img')).forEach(img => {
    img.setAttribute('loading', 'lazy');
    img.setAttribute('data-viewer', '1');
    img.classList.add('mdsl-image');
  });

  Array.from(root.querySelectorAll('pre > code')).forEach(code => {
    const match = /language-([\w+-]+)/.exec(code.className || '');
    code.setAttribute('data-lang', match ? match[1] : '');
    code.setAttribute('data-hl', '0');
  });

  return headings;
}

export function createParser() {
  return {
    render(src) {
      const raw = globalThis.marked.parse(String(src || ''), { gfm: true, breaks: false });
      const safe = sanitizeHtml(raw);
      const template = document.createElement('template');
      template.innerHTML = safe;
      const root = template.content;
      replaceMathInTextNodes(root);
      const slug = createSlugger();
      const headings = postProcess(root, slug);
      return { html: template.innerHTML, headings };
    },
    lex(src) {
      try { return globalThis.marked.lexer(String(src || ''), { gfm: true }); }
      catch (e) { return []; }
    }
  };
}
