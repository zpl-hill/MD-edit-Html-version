/* print.js — 打印模式、缩放、A4 预分页与 PDF 导出（保真优先）。 */
import { paginate } from "./paginator.js";

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function createPrintController(options) {
  const pagesRoot = document.getElementById('print-pages');
  const sourceRoot = document.getElementById('print-source');
  let mode = 'read';
  let zoom = 1;
  let orientation = 'portrait';
  let pageRule = null;

  function ensurePageRule() {
    if (!pageRule) {
      pageRule = document.createElement('style');
      pageRule.id = 'mdsl-page-rule';
      document.head.appendChild(pageRule);
    }
    pageRule.textContent = '@page { size: A4 ' + orientation + '; margin: 15mm 20mm 15mm 20mm; }';
    const portrait = orientation === 'portrait';
    pagesRoot.style.setProperty('--page-w', (portrait ? 170 : 257) + 'mm');
    pagesRoot.style.setProperty('--page-h', (portrait ? 267 : 180) + 'mm');
  }

  function today() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function buildPages() {
    const html = options.getHtml();
    sourceRoot.innerHTML = html;
    Array.from(sourceRoot.querySelectorAll('.mdsl-anchor')).forEach(a => a.remove());
    const portrait = orientation === 'portrait';
    const fragment = paginate(sourceRoot, {
      pageWidthMm: portrait ? 210 : 297,
      pageHeightMm: portrait ? 297 : 210,
      marginMm: { top: 15, right: 20, bottom: 15, left: 20 },
      headerMm: 10,
      footerMm: 9,
      title: options.getTitle() || 'Untitled',
      date: today()
    });
    pagesRoot.replaceChildren(fragment);
    return pagesRoot.querySelectorAll('.print-page').length;
  }

  function applyZoom() {
    pagesRoot.style.zoom = String(zoom);
  }

  function setMode(next) {
    mode = next === 'print' ? 'print' : 'read';
    document.body.classList.toggle('mdsl-print-mode', mode === 'print');
    if (mode === 'print') {
      ensurePageRule();
      const count = buildPages();
      applyZoom();
      if (options.onStatus) options.onStatus('打印模式：' + count + ' 页 · A4 ' + (orientation === 'portrait' ? '纵向' : '横向'));
    } else if (options.onStatus) {
      options.onStatus('阅读模式');
    }
    return mode;
  }

  function setZoom(value) {
    zoom = Math.max(0.25, Math.min(4, Number(value) || 1));
    applyZoom();
    if (options.onStatus) options.onStatus('缩放 ' + Math.round(zoom * 100) + '%');
    return zoom;
  }

  function stepZoom(delta) {
    const index = ZOOMS.findIndex(value => value >= zoom - 0.001);
    const next = Math.max(0, Math.min(ZOOMS.length - 1, (index < 0 ? 2 : index) + delta));
    return setZoom(ZOOMS[next]);
  }

  function setOrientation(value) {
    orientation = value === 'landscape' ? 'landscape' : 'portrait';
    ensurePageRule();
    if (mode === 'print') setMode('print');
    return orientation;
  }

  function print() {
    ensurePageRule();
    let count = 0;
    try {
      count = buildPages();
      if (options.onStatus) options.onStatus('已生成 ' + count + ' 页，请在打印对话框中选择「另存为 PDF」');
    } catch (e) {
      console.warn('[print] 预分页失败，回退浏览器打印:', e);
      pagesRoot.replaceChildren();
      if (options.onStatus) options.onStatus('预分页不可用，已回退浏览器原生打印（请勾选页眉和页脚）');
    }
    document.body.classList.add('mdsl-printing');
    requestAnimationFrame(() => {
      window.print();
      setTimeout(() => document.body.classList.remove('mdsl-printing'), 800);
    });
    return count;
  }

  ensurePageRule();

  return {
    setMode, setZoom, stepZoom, setOrientation, print, buildPages,
    getMode: () => mode, getZoom: () => zoom, getOrientation: () => orientation,
    zooms: ZOOMS
  };
}
