/* imageViewer.js — 图片查看器：100/150/200%/Fit + 滚轮缩放 + 拖拽平移。 */
import { icon } from "./icons.js";

const LEVELS = [1, 1.5, 2];

export function createImageViewer() {
  let dialog = null;
  let image = null;
  let scale = 1;
  let fit = true;
  let dragging = false;
  let startX = 0, startY = 0, offsetX = 0, offsetY = 0;

  function apply() {
    if (!image) return;
    image.style.transform = 'translate(' + offsetX + 'px,' + offsetY + 'px) scale(' + (fit ? 1 : scale) + ')';
    image.classList.toggle('is-fit', fit);
  }

  function setLevel(value) {
    fit = false;
    scale = Math.max(0.25, Math.min(4, value));
    offsetX = 0; offsetY = 0;
    apply();
  }

  function build() {
    dialog = document.createElement('div');
    dialog.className = 'mdsl-lightbox';
    dialog.innerHTML =
      '<div class="lightbox-bar">' +
        '<span class="lightbox-title">图片查看器</span>' +
        '<button data-zoom="1">100%</button>' +
        '<button data-zoom="1.5">150%</button>' +
        '<button data-zoom="2">200%</button>' +
        '<button data-fit="1">Fit Window</button>' +
        '<span class="lightbox-scale"></span>' +
        '<button data-close="1" aria-label="关闭">' + icon('close', 16) + '</button>' +
      '</div>' +
      '<div class="lightbox-stage"><img alt=""></div>';
    document.body.appendChild(dialog);

    dialog.querySelector('.lightbox-bar').addEventListener('click', event => {
      const zoom = event.target.closest('[data-zoom]');
      if (zoom) { setLevel(Number(zoom.getAttribute('data-zoom'))); updateLabel(); return; }
      if (event.target.closest('[data-fit]')) { fit = true; scale = 1; offsetX = 0; offsetY = 0; apply(); updateLabel(); return; }
      if (event.target.closest('[data-close]')) close();
    });

    const stage = dialog.querySelector('.lightbox-stage');
    stage.addEventListener('wheel', event => {
      event.preventDefault();
      fit = false;
      scale = Math.max(0.25, Math.min(4, scale + (event.deltaY < 0 ? 0.1 : -0.1)));
      apply(); updateLabel();
    }, { passive: false });

    stage.addEventListener('mousedown', event => {
      if (event.button !== 0) return;
      dragging = true; startX = event.clientX - offsetX; startY = event.clientY - offsetY;
      stage.classList.add('dragging');
    });
    window.addEventListener('mousemove', event => {
      if (!dragging) return;
      offsetX = event.clientX - startX; offsetY = event.clientY - startY; apply();
    });
    window.addEventListener('mouseup', () => { dragging = false; if (stage) stage.classList.remove('dragging'); });
    dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
    image = dialog.querySelector('img');
  }

  function updateLabel() {
    const label = dialog.querySelector('.lightbox-scale');
    if (label) label.textContent = fit ? '适应窗口' : Math.round(scale * 100) + '%';
  }

  function open(src, alt) {
    if (!dialog) build();
    image.setAttribute('src', src || '');
    image.setAttribute('alt', alt || '');
    fit = true; scale = 1; offsetX = 0; offsetY = 0;
    apply(); updateLabel();
    dialog.classList.add('open');
  }

  function close() { if (dialog) dialog.classList.remove('open'); }

  window.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });

  return { open, close, setLevel, levels: LEVELS };
}
