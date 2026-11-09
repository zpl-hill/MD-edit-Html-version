/* print.js — 打印 / PDF 引擎：纸张、方向、页边距设置 + JS 预分页 + 系统打印对话框。
   Chromium 不支持 CSS Paged Media 的 margin boxes（见 SDD ADR-010），
   所以页眉/页码由 paginator.js 预先切成独立页面，@page 只负责纸张与页边距。 */
import { paginate } from "./paginator.js";

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/* 纸张尺寸（mm）。@page 用 CSS 关键字而非裸尺寸：打印机会按名字匹配纸盒，
   写成 210mm 297mm 时部分驱动会识别不出而缩放。 */
export const PAPERS = {
  a4: { label: 'A4', css: 'A4', w: 210, h: 297 },
  a3: { label: 'A3', css: 'A3', w: 297, h: 420 },
  b5: { label: 'B5', css: 'B5', w: 176, h: 250 },
  letter: { label: 'Letter', css: 'letter', w: 215.9, h: 279.4 }
};

/* 页边距预设（mm）。custom 表示用用户手填的四边值。 */
export const MARGIN_PRESETS = {
  normal: { top: 15, right: 20, bottom: 15, left: 20 },
  narrow: { top: 10, right: 10, bottom: 10, left: 10 },
  wide: { top: 25, right: 25, bottom: 25, left: 25 },
  custom: null
};

const HEADER_MM = 10;
const FOOTER_MM = 9;

function clampMm(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(60, Math.round(n * 10) / 10));
}

export function normalizeMargins(input) {
  const src = input || {};
  return {
    top: clampMm(src.top !== undefined ? src.top : 15),
    right: clampMm(src.right !== undefined ? src.right : 20),
    bottom: clampMm(src.bottom !== undefined ? src.bottom : 15),
    left: clampMm(src.left !== undefined ? src.left : 20)
  };
}

export function normalizeSettings(input) {
  const src = input || {};
  const paper = PAPERS[src.paper] ? src.paper : 'a4';
  const orientation = src.orientation === 'landscape' ? 'landscape' : 'portrait';
  const preset = Object.prototype.hasOwnProperty.call(MARGIN_PRESETS, src.preset) ? src.preset : 'normal';
  const margins = preset === 'custom'
    ? normalizeMargins(src.margins)
    : Object.assign({}, MARGIN_PRESETS[preset] || MARGIN_PRESETS.normal);
  return { paper, orientation, preset, margins };
}

export function createPrintController(options) {
  const pagesRoot = document.getElementById('print-pages');
  const sourceRoot = document.getElementById('print-source');
  let mode = 'read';
  let zoom = 1;
  let settings = normalizeSettings(options.settings);
  let pageRule = null;

  /* 版面几何：横纵向互换纸张的宽高，其它尺寸（可打印区）都由它推出来。 */
  function geometry() {
    const paper = PAPERS[settings.paper];
    const landscape = settings.orientation === 'landscape';
    return {
      paper,
      widthMm: landscape ? paper.h : paper.w,
      heightMm: landscape ? paper.w : paper.h,
      contentW: (landscape ? paper.h : paper.w) - settings.margins.left - settings.margins.right,
      contentH: (landscape ? paper.w : paper.h) - settings.margins.top - settings.margins.bottom
    };
  }

  /* @page 决定真实出纸的纸张与边距；--page-w/h 决定屏幕上预览页的尺寸。
     两者必须由同一份设置驱动，否则「预览看到的」和「打出来的」会不一样。 */
  function ensurePageRule() {
    if (!pageRule) {
      pageRule = document.createElement('style');
      pageRule.id = 'mdsl-page-rule';
      document.head.appendChild(pageRule);
    }
    const g = geometry();
    const m = settings.margins;
    pageRule.textContent = '@page { size: ' + g.paper.css + ' ' + settings.orientation + '; margin: '
      + m.top + 'mm ' + m.right + 'mm ' + m.bottom + 'mm ' + m.left + 'mm; }';
    /* 屏幕上预览的白色纸张 = 整张纸，页边距用 padding 表现（所见即所得）。
       若只画可打印区，文字会紧贴白纸边缘，看起来像没有边距。 */
    pagesRoot.style.setProperty('--page-w', g.widthMm + 'mm');
    pagesRoot.style.setProperty('--page-h', g.heightMm + 'mm');
    pagesRoot.style.setProperty('--content-w', g.contentW + 'mm');
    pagesRoot.style.setProperty('--content-h', g.contentH + 'mm');
    pagesRoot.style.setProperty('--margin-top', m.top + 'mm');
    pagesRoot.style.setProperty('--margin-right', m.right + 'mm');
    pagesRoot.style.setProperty('--margin-bottom', m.bottom + 'mm');
    pagesRoot.style.setProperty('--margin-left', m.left + 'mm');
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
    const g = geometry();
    const fragment = paginate(sourceRoot, {
      pageWidthMm: g.widthMm,
      pageHeightMm: g.heightMm,
      marginMm: settings.margins,
      headerMm: HEADER_MM,
      footerMm: FOOTER_MM,
      title: options.getTitle() || 'Untitled',
      date: today()
    });
    pagesRoot.replaceChildren(fragment);
    return pagesRoot.querySelectorAll('.print-page').length;
  }

  function describe(target) {
    const paper = PAPERS[target.paper] || PAPERS.a4;
    const landscape = target.orientation === 'landscape';
    const w = (landscape ? paper.h : paper.w) - target.margins.left - target.margins.right;
    const h = (landscape ? paper.w : paper.h) - target.margins.top - target.margins.bottom;
    return paper.label + ' ' + (landscape ? '横向' : '纵向')
      + ' · 可打印区 ' + Math.max(0, Math.round(w)) + '×' + Math.max(0, Math.round(h)) + ' mm';
  }

  function applyZoom() {
    pagesRoot.style.zoom = String(zoom);
  }

  /* 预览页是整张纸，A3 横向（420mm≈1587px）会宽过普通窗口。
     进入预览时按需缩小到能整页看见，但不放大（不改变用户对「100%」的理解）。 */
  function fitZoom() {
    const MM_PX = 96 / 25.4;
    const avail = window.innerWidth - 32;
    const pagePx = geometry().widthMm * MM_PX;
    if (!(avail > 0) || pagePx <= avail) return 1;
    return Math.max(0.5, Math.floor((avail / pagePx) * 20) / 20);
  }

  function setMode(next) {
    mode = next === 'print' ? 'print' : 'read';
    document.body.classList.toggle('mdsl-print-mode', mode === 'print');
    if (mode === 'print') {
      ensurePageRule();
      const count = buildPages();
      zoom = fitZoom();
      applyZoom();
      if (options.onStatus) options.onStatus('打印预览：' + count + ' 页 · ' + describe(settings));
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

  /* 设置变更：更新 @page / 预览尺寸；已在预览模式则立即重新分页。
     返回归一化后的设置，调用方拿它去持久化。 */
  function setSettings(patch) {
    const next = normalizeSettings(Object.assign({}, settings, patch || {}));
    const changed = JSON.stringify(next) !== JSON.stringify(settings);
    settings = next;
    ensurePageRule();
    if (mode === 'print') {
      const count = buildPages();
      // 换纸张/方向后可能装不下了：只在需要时缩小，用户手动放大的值不被抢走
      const fit = fitZoom();
      if (fit < zoom) { zoom = fit; applyZoom(); }
      if (options.onStatus) options.onStatus('打印预览：' + count + ' 页 · ' + describe(settings));
    }
    if (changed && options.onSettings) options.onSettings(settings);
    return settings;
  }

  function setOrientation(value) {
    return setSettings({ orientation: value === 'landscape' ? 'landscape' : 'portrait' }).orientation;
  }

  /* 真正的出纸动作：交给系统打印对话框（选打印机、份数、单双面、另存为 PDF）。
     我们用 @page 固定纸张与边距，因此对话框里「边距」保持「默认」、「缩放」保持 100% 即可。 */
  function print() {
    ensurePageRule();
    let count = 0;
    try {
      count = buildPages();
      if (options.onStatus) options.onStatus('已生成 ' + count + ' 页 · ' + describe(settings) + ' — 正在打开打印对话框');
    } catch (e) {
      console.warn('[print] 预分页失败，回退浏览器打印:', e);
      pagesRoot.replaceChildren();
      if (options.onStatus) options.onStatus('预分页不可用，已回退浏览器原生打印（请在对话框里勾选页眉页脚）');
    }
    document.body.classList.add('mdsl-printing');
    requestAnimationFrame(() => {
      try {
        window.print();
      } catch (e) {
        console.warn('[print] window.print 不可用:', e);
        if (options.onStatus) options.onStatus('当前环境不支持直接打印，请用「导出 PDF」或浏览器打印');
      }
      setTimeout(() => document.body.classList.remove('mdsl-printing'), 800);
    });
    return count;
  }

  ensurePageRule();

  return {
    setMode, setZoom, stepZoom, setOrientation, print, buildPages, setSettings,
    getMode: () => mode,
    getZoom: () => zoom,
    getOrientation: () => settings.orientation,
    getSettings: () => JSON.parse(JSON.stringify(settings)),
    getLayout: () => {
      const g = geometry();
      return {
        paper: settings.paper,
        paperLabel: g.paper.label,
        orientation: settings.orientation,
        margins: Object.assign({}, settings.margins),
        preset: settings.preset,
        widthMm: g.widthMm,
        heightMm: g.heightMm,
        contentW: g.contentW,
        contentH: g.contentH
      };
    },
    describe: () => describe(settings),
    zooms: ZOOMS
  };
}
