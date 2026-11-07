/* icons.js — 内联 SVG，零第三方图标依赖（规避 ISC / 字体许可）。 */
const PATHS = {
  open: '<path d="M3 5h6l2 2h10v2H3z"/><path d="M3 9h18l-2 10H5z"/>',
  save: '<path d="M4 3h13l3 3v15H4z"/><path d="M7 3v6h9V3M7 21v-8h10v8"/>',
  pdf: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/><path d="M9 13h6M9 17h6"/>',
  docx: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/><path d="M9 12l6 6M15 12l-6 6"/>',
  theme: '<path d="M12 3a9 9 0 100 18 9 9 0 000-18z"/><path d="M12 3v18"/>',
  print: '<path d="M6 9V3h12v6"/><path d="M6 18H4V9h16v9h-2"/><path d="M6 15h12v6H6z"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="M15 15l5 5"/>',
  toc: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  zoomIn: '<path d="M12 5v14M5 12h14"/>',
  zoomOut: '<path d="M5 12h14"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>'
};

export function icon(name, size) {
  const body = PATHS[name] || PATHS.info;
  const s = size || 18;
  return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true">' + body + '</svg>';
}

export const ICONS = PATHS;
