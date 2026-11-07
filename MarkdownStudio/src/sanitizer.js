/* sanitizer.js — 原始 HTML 白名单清洗（ADR-008，自研以避开 DOMPurify 双许可）。 */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'sub', 'sup', 'code', 'pre',
  'ul', 'ol', 'li', 'blockquote', 'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'div', 'span', 'img', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
]);
const DROP_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'link', 'meta', 'svg', 'math', 'template']);
const ALLOWED_ATTRS = new Set(['class', 'id', 'href', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan', 'align', 'loading']);

export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeUrl(value) {
  const url = String(value || '').trim();
  if (/^\s*javascript:/i.test(url) || /^\s*data:text\/html/i.test(url) || /^\s*vbscript:/i.test(url)) return '';
  return url;
}

function cleanElement(el) {
  Array.from(el.attributes).forEach(attr => {
    const name = attr.name.toLowerCase();
    if (!ALLOWED_ATTRS.has(name) || name.startsWith('on')) { el.removeAttribute(attr.name); return; }
    if (name === 'href' || name === 'src') {
      const safe = safeUrl(attr.value);
      if (!safe) { el.removeAttribute(attr.name); return; }
      el.setAttribute(name, safe);
    }
  });
  if (el.tagName === 'A' && el.hasAttribute('href')) {
    el.setAttribute('rel', 'noopener noreferrer');
  }
}

export function sanitizeHtml(html) {
  if (!html || String(html).indexOf('<') === -1) return String(html || '');
  const doc = new DOMParser().parseFromString('<div id="mdsl-root">' + html + '</div>', 'text/html');
  const root = doc.getElementById('mdsl-root');
  if (!root) return '';

  const walk = node => {
    Array.from(node.children).forEach(child => {
      const tag = child.tagName.toLowerCase();
      if (DROP_TAGS.has(tag)) { child.remove(); return; }
      if (!ALLOWED_TAGS.has(tag)) {
        // 未知标签：保留文本内容，去掉标签本身
        const parent = child.parentNode;
        while (child.firstChild) parent.insertBefore(child.firstChild, child);
        child.remove();
        return;
      }
      cleanElement(child);
      walk(child);
    });
  };
  walk(root);
  return root.innerHTML;
}

export function stripTags(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  return doc.body.textContent || '';
}
