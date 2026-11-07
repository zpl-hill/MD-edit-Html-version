/* slug.js — 标题锚点生成（中文保留、去重、URL 编码）。 */
export function createSlugger() {
  const seen = Object.create(null);
  return function slug(text) {
    let base = String(text == null ? '' : text)
      .replace(/<[^>]*>/g, '')
      .replace(/[`*_~\[\]()#!.,:;?/'\\"+=<>$%^&|{}]/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '');
    if (!base) base = 'section';
    let id = base;
    let n = seen[id] || 0;
    if (n > 0) { id = base + '-' + (n + 1); }
    seen[base] = n + 1;
    seen[id] = (seen[id] || 0) + 1;
    return id;
  };
}

export function slugify(text) {
  return createSlugger()(text);
}

export function safeIdSelector(id) {
  if (typeof CSS !== 'undefined' && CSS.escape) return '#' + CSS.escape(id);
  return '#' + String(id).replace(/[^\w-]/g, c => '\\' + c);
}
