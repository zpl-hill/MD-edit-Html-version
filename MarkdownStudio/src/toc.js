/* toc.js — 标题树、展开收起、跳转、hash 同步。 */
import { safeIdSelector } from "./slug.js";

function buildTree(headings) {
  const roots = [];
  const stack = [];
  headings.forEach(item => {
    const node = { id: item.id, level: item.level, text: item.text, children: [] };
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  });
  return roots;
}

export function createTocTree(root, options) {
  const onNavigate = options && options.onNavigate ? options.onNavigate : () => {};
  let collapsed = new Set();
  let currentId = '';
  let lastHeadings = [];

  function renderNodes(nodes, level) {
    if (!nodes.length) return '';
    let html = '<ul class="toc-list toc-level-' + level + '">';
    nodes.forEach(node => {
      const hasChildren = node.children.length > 0;
      const isCollapsed = collapsed.has(node.id);
      html += '<li class="toc-item' + (node.id === currentId ? ' active' : '') + '">';
      html += '<div class="toc-row">';
      html += hasChildren
        ? '<button class="toc-toggle" data-toggle="' + node.id + '" aria-label="展开或收起">' + (isCollapsed ? '▸' : '▾') + '</button>'
        : '<span class="toc-toggle placeholder"></span>';
      html += '<button class="toc-link" data-goto="' + node.id + '" title="' + node.text.replace(/"/g, '&quot;') + '">' + node.text + '</button>';
      html += '</div>';
      if (hasChildren && !isCollapsed) html += renderNodes(node.children, level + 1);
      html += '</li>';
    });
    return html + '</ul>';
  }

  function setHeadings(headings) {
    lastHeadings = headings || [];
    if (!lastHeadings.length) {
      root.innerHTML = '<p class="toc-empty">暂无标题</p>';
      return;
    }
    root.innerHTML = renderNodes(buildTree(lastHeadings), 1);
  }

  root.addEventListener('click', event => {
    const toggle = event.target.closest('[data-toggle]');
    if (toggle) {
      const id = toggle.getAttribute('data-toggle');
      if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
      setHeadings(lastHeadings);
      return;
    }
    const link = event.target.closest('[data-goto]');
    if (link) goto(link.getAttribute('data-goto'));
  });

  function goto(id) {
    currentId = id;
    const target = document.querySelector(safeIdSelector(id));
    if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try { history.replaceState(null, '', '#' + encodeURIComponent(id)); } catch (e) { /* ignore */ }
    onNavigate(id);
    Array.from(root.querySelectorAll('.toc-item')).forEach(item => item.classList.remove('active'));
    const active = root.querySelector('[data-goto="' + id + '"]');
    if (active && active.closest('.toc-item')) active.closest('.toc-item').classList.add('active');
  }

  function setActive(id) {
    currentId = id;
    Array.from(root.querySelectorAll('.toc-item')).forEach(item => item.classList.remove('active'));
    const active = root.querySelector('[data-goto="' + id + '"]');
    if (active && active.closest('.toc-item')) active.closest('.toc-item').classList.add('active');
  }

  return { setHeadings, goto, setActive, collapsed };
}
