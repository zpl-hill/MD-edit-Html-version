/* paginator.js — JS 预分页引擎（ADR-010：Chromium 不支持 CSS margin boxes）。
   按顶层块测量打包；超高表格/代码块自动按行切分；生成每页独立页眉页脚。 */
import { mmToPx } from "./platform.js";

function measureHeight(el, container) {
  container.appendChild(el);
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const height = rect.height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
  container.removeChild(el);
  return height;
}

function makeTableShell(source) {
  const table = document.createElement('table');
  table.className = source.className || '';
  const thead = source.querySelector('thead');
  if (thead) table.appendChild(thead.cloneNode(true));
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  return { table, tbody };
}

function splitTable(source, availH, container) {
  const rows = Array.from(source.querySelectorAll('tbody > tr'));
  if (rows.length < 2) return [source];
  const parts = [];
  let shell = makeTableShell(source);
  rows.forEach(row => {
    shell.tbody.appendChild(row.cloneNode(true));
    if (measureHeight(shell.table, container) > availH && shell.tbody.children.length > 1) {
      const last = shell.tbody.lastElementChild;
      shell.tbody.removeChild(last);
      parts.push(shell.table);
      shell = makeTableShell(source);
      shell.tbody.appendChild(last);
    }
  });
  if (shell.tbody.children.length) parts.push(shell.table);
  return parts.length ? parts : [source];
}

function splitPre(source, availH, container) {
  const lines = (source.textContent || '').split('\n');
  if (lines.length < 2) return [source];
  const parts = [];
  let current = document.createElement('pre');
  current.className = source.className || '';
  const code = source.querySelector('code');
  let acc = [];
  lines.forEach(line => {
    acc.push(line);
    const probe = document.createElement('pre');
    probe.className = current.className;
    probe.textContent = acc.join('\n');
    if (measureHeight(probe, container) > availH && acc.length > 1) {
      const extra = acc.pop();
      current.textContent = acc.join('\n');
      parts.push(current);
      current = document.createElement('pre');
      current.className = source.className || '';
      acc = [extra];
    }
  });
  current.textContent = acc.join('\n');
  if (code) current.setAttribute('data-lang', code.getAttribute('data-lang') || '');
  parts.push(current);
  return parts.length ? parts : [source];
}

export function paginate(sourceRoot, options) {
  const margin = options.marginMm || { top: 15, right: 20, bottom: 15, left: 20 };
  const contentW = mmToPx(options.pageWidthMm - margin.left - margin.right);
  const headerH = mmToPx(options.headerMm || 10);
  const footerH = mmToPx(options.footerMm || 9);
  const availH = mmToPx(options.pageHeightMm - margin.top - margin.bottom) - headerH - footerH;

  const container = document.createElement('div');
  container.className = 'mdsl-measure';
  container.style.width = contentW + 'px';
  document.body.appendChild(container);

  let groups = [];
  let current = [];
  let used = 0;
  const oversized = new Set();

  try {
    const blocks = Array.from(sourceRoot.children).map(el => el.cloneNode(true));
    blocks.forEach(block => {
      let pieces = [block];
      let height = measureHeight(block, container);
      if (height > availH) {
        if (block.tagName === 'TABLE') pieces = splitTable(block, availH, container);
        else if (block.tagName === 'PRE') pieces = splitPre(block, availH, container);
      }
      pieces.forEach(piece => {
        const h = measureHeight(piece, container);
        if (h > availH) {
          if (current.length) { groups.push(current); current = []; used = 0; }
          groups.push([piece]);
          oversized.add(groups.length - 1);
          return;
        }
        if (current.length && used + h > availH) { groups.push(current); current = []; used = 0; }
        current.push(piece);
        used += h;
      });
    });
    if (current.length) groups.push(current);
  } finally {
    container.remove();
  }

  if (!groups.length) groups = [[]];
  const fragment = document.createDocumentFragment();
  const total = groups.length;

  groups.forEach((items, index) => {
    const page = document.createElement('section');
    page.className = 'print-page' + (oversized.has(index) ? ' oversized' : '');
    const header = document.createElement('div');
    header.className = 'print-header';
    const title = document.createElement('span');
    title.className = 'ph-title';
    title.textContent = options.title || '';
    const date = document.createElement('span');
    date.className = 'ph-date';
    date.textContent = options.date || '';
    header.append(title, date);

    const body = document.createElement('div');
    body.className = 'print-body';
    items.forEach(item => body.appendChild(item));

    const footer = document.createElement('div');
    footer.className = 'print-footer';
    footer.textContent = 'Page ' + (index + 1) + ' of ' + total;

    page.append(header, body, footer);
    fragment.appendChild(page);
  });

  return fragment;
}
