/* notices.js — 第三方许可证声明（构建期由 build-release.ps1 注入 __MDSL_NOTICES）。 */
export function getNotices() {
  const list = globalThis.__MDSL_NOTICES;
  return Array.isArray(list) ? list : [];
}

export function hasNotices() {
  return getNotices().some(item => item && item.name && item.text);
}

export function buildNoticesMarkup() {
  const items = getNotices();
  if (!items.length) return '<p>未找到内嵌的第三方许可证声明，请检查发布包完整性。</p>';
  return items.map(item =>
    '<section><h3>' + escapeText(item.name) + (item.version ? ' ' + escapeText(item.version) : '') +
    '</h3><p class="notice-license">' + escapeText(item.license || 'MIT') +
    '</p><pre>' + escapeText(item.text || '') + '</pre></section>'
  ).join('\n');
}

function escapeText(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
