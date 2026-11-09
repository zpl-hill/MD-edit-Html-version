/* printSetup.js — 打印设置对话框：纸张、方向、页边距（预设 + 自定义四边）。
   只负责界面与表单，真正的分页 / 出纸由 print.js 完成；
   设置经 options.persist 交给调用方持久化（storage 层不在此处引入）。 */
import { PAPERS, MARGIN_PRESETS, normalizeSettings } from "./print.js";

const PAPER_ORDER = ['a4', 'a3', 'b5', 'letter'];
const PRESET_ORDER = ['normal', 'narrow', 'wide', 'custom'];

function option(value, label) {
  return '<option value="' + value + '">' + label + '</option>';
}

export function createPrintSetup(options) {
  const controller = options.controller;
  const dialog = document.getElementById('print-dialog');
  if (!dialog) throw new Error('打印设置对话框缺失：#print-dialog');

  const $ = id => dialog.querySelector('#' + id);
  const paperEl = $('print-paper');
  const orientationEl = $('print-orientation');
  const presetEl = $('print-margin-preset');
  const mm = {
    top: $('print-mt'), right: $('print-mr'), bottom: $('print-mb'), left: $('print-ml')
  };
  const noteEl = $('print-layout-note');

  paperEl.innerHTML = PAPER_ORDER
    .map(key => option(key, PAPERS[key].label + ' · ' + Math.round(PAPERS[key].w) + '×' + Math.round(PAPERS[key].h) + ' mm'))
    .join('');

  presetEl.innerHTML = [
    option('normal', '常规 · 上下 15 / 左右 20 mm'),
    option('narrow', '窄 · 四边 10 mm'),
    option('wide', '宽 · 四边 25 mm'),
    option('custom', '自定义…')
  ].join('');

  function readForm() {
    const preset = PRESET_ORDER.indexOf(presetEl.value) >= 0 ? presetEl.value : 'normal';
    return {
      paper: PAPERS[paperEl.value] ? paperEl.value : 'a4',
      orientation: orientationEl.value === 'landscape' ? 'landscape' : 'portrait',
      preset,
      margins: {
        top: mm.top.value === '' ? 0 : Number(mm.top.value),
        right: mm.right.value === '' ? 0 : Number(mm.right.value),
        bottom: mm.bottom.value === '' ? 0 : Number(mm.bottom.value),
        left: mm.left.value === '' ? 0 : Number(mm.left.value)
      }
    };
  }

  /* 让四边输入框跟随预设：非自定义时只读显示预设值，避免「选了窄边距但框里还是旧数字」的错觉。 */
  function syncMarginInputs(preset, margins) {
    const source = preset === 'custom' ? margins : (MARGIN_PRESETS[preset] || margins);
    ['top', 'right', 'bottom', 'left'].forEach(side => {
      mm[side].value = String(source[side] === undefined ? 0 : source[side]);
      mm[side].disabled = preset !== 'custom';
    });
  }

  function updateNote() {
    const next = normalizeSettings(readForm());
    const paper = PAPERS[next.paper];
    const landscape = next.orientation === 'landscape';
    const w = (landscape ? paper.h : paper.w) - next.margins.left - next.margins.right;
    const h = (landscape ? paper.w : paper.h) - next.margins.top - next.margins.bottom;
    const thin = Math.min(next.margins.top, next.margins.right, next.margins.bottom, next.margins.left) < 5;
    noteEl.textContent = '纸张 ' + (landscape ? paper.h : paper.w) + ' × ' + (landscape ? paper.w : paper.h)
      + ' mm · 可打印区 ' + Math.max(0, Math.round(w)) + ' × ' + Math.max(0, Math.round(h)) + ' mm'
      + (thin ? '（边距小于 5 mm，部分打印机会裁切内容）' : '');
    noteEl.classList.toggle('warn', thin);
  }

  function syncForm(settings) {
    const next = normalizeSettings(settings);
    paperEl.value = next.paper;
    orientationEl.value = next.orientation;
    presetEl.value = next.preset;
    syncMarginInputs(next.preset, next.margins);
    updateNote();
    return next;
  }

  function open() {
    if (dialog.classList.contains('open')) return; // 已打开时不要重置用户正在改的值
    syncForm(controller.getSettings());
    dialog.classList.add('open');
    setTimeout(() => paperEl.focus(), 30);
  }

  function close() {
    dialog.classList.remove('open');
  }

  function applyAndClose() {
    const settings = controller.setSettings(readForm());
    if (options.persist) options.persist(settings);
    close();
    return settings;
  }

  dialog.addEventListener('change', event => {
    if (event.target === presetEl) {
      // 切到「自定义」时保留当前四边数值作为起点，改起来更顺手
      const current = normalizeSettings(readForm());
      syncMarginInputs(presetEl.value, current.margins);
      if (presetEl.value === 'custom') mm.top.focus();
    } else if (mm.top === event.target || mm.right === event.target || mm.bottom === event.target || mm.left === event.target) {
      // 直接改数字即视为自定义，避免「预设 + 手改」的混合状态
      presetEl.value = 'custom';
      syncMarginInputs('custom', readForm().margins);
    }
    updateNote();
  });

  dialog.addEventListener('input', event => {
    if (event.target === mm.top || event.target === mm.right || event.target === mm.bottom || event.target === mm.left) updateNote();
  });

  dialog.addEventListener('click', event => {
    const action = event.target.closest('[data-print]');
    if (action) {
      const kind = action.getAttribute('data-print');
      if (kind === 'cancel') close();
      else if (kind === 'preview') {
        applyAndClose();
        controller.setMode('print');
      } else if (kind === 'go') {
        applyAndClose();
        controller.print();
      }
      return;
    }
    if (event.target === dialog || event.target.closest('[data-close]')) close();
  });

  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
    if (event.key === 'Enter' && event.target.tagName !== 'SELECT' && event.target.tagName !== 'BUTTON') {
      event.preventDefault();
      applyAndClose();
      controller.print();
    }
  });

  return { open, close, isOpen: () => dialog.classList.contains('open'), refresh: () => syncForm(controller.getSettings()) };
}
