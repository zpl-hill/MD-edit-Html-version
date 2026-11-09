/* editor.js — CodeMirror 6 封装：视区渲染、多光标、搜索、折叠、语法高亮、主题联动。 */
export function createEditor(options) {
  const CM = globalThis.CM6;
  if (!CM) throw new Error('CodeMirror 6 未加载，请检查发布包完整性');

  const listeners = [];
  const scrollListeners = [];
  const themeCompartment = new CM.Compartment();
  let currentTheme = 'light';
  const themeSpec = {
    '&': { color: 'var(--editor-fg)', backgroundColor: 'var(--editor-bg)', height: '100%' },
    '.cm-content': { caretColor: 'var(--editor-fg)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-editor)', lineHeight: '1.65' },
    '.cm-gutters': { backgroundColor: 'var(--gutter-bg)', color: 'var(--gutter-fg)', border: 'none', fontSize: 'var(--fs-editor)' },
    '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--active-line)' },
    // 选区：.cm-selectionLayer 在 CM6 里是 z-index:-2（位于行背景之下），
    // 因此 .cm-activeLine 的底色必须半透明（见 app.css / dark.css 的 --active-line），
    // 否则不透明的行底色会把选中文字的高亮整块盖住。
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--selection) !important' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)' }
  };

  /* 扩展集中在一处，reset() 重建 EditorState 时可复用，保证主题/搜索/高亮等配置不丢失。 */
  function makeExtensions(themeMode) {
    return [
      CM.lineNumbers(),
      CM.highlightActiveLineGutter(),
      CM.highlightSpecialChars(),
      CM.history(),
      CM.foldGutter(),
      CM.drawSelection(),
      CM.dropCursor(),
      CM.EditorState.allowMultipleSelections.of(true),
      CM.indentOnInput(),
      CM.bracketMatching(),
      CM.rectangularSelection(),
      CM.crosshairCursor(),
      CM.highlightActiveLine(),
      CM.highlightSelectionMatches(),
      CM.keymap.of([
        ...CM.defaultKeymap, ...CM.historyKeymap,
        ...CM.foldKeymap, ...CM.searchKeymap,
        CM.indentWithTab
      ]),
      CM.markdown({ base: CM.markdownLanguage }),
      CM.syntaxHighlighting(CM.defaultHighlightStyle, { fallback: true }),
      CM.search({ top: true }),
      CM.EditorView.lineWrapping,
      themeCompartment.of(CM.EditorView.theme(themeSpec, { dark: themeMode === 'dark' })),
      CM.EditorView.updateListener.of(update => {
        if (update.docChanged) {
          const text = view.state.doc.toString();
          listeners.forEach(fn => { try { fn(text); } catch (e) { console.error(e); } });
        }
      })
    ];
  }

  const view = new CM.EditorView({
    state: CM.EditorState.create({
      doc: String(options.initial || ''),
      extensions: makeExtensions(currentTheme)
    }),
    parent: options.parent
  });

  view.scrollDOM.addEventListener('scroll', () => {
    const el = view.scrollDOM;
    const ratio = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
    scrollListeners.forEach(fn => fn(ratio));
  }, { passive: true });

  return {
    view,
    getText: () => view.state.doc.toString(),
    // O(1) 统计：CM6 的 Text 对象直接维护行数与长度，避免对超大文档做全量 split/正则。
    getStats: () => ({ lines: view.state.doc.lines, length: view.state.doc.length }),
    setText(text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: String(text == null ? '' : text) } });
    },
    /* 新建文档用：整体替换 EditorState。setText() 只发一次 change，会保留 undo 历史，
       Ctrl+Z 能把上一份文档「撤」回来；setState 会连带清空 history / 选区 / 搜索面板状态。 */
    reset(text) {
      view.setState(CM.EditorState.create({
        doc: String(text == null ? '' : text),
        extensions: makeExtensions(currentTheme)
      }));
      if (view.scrollDOM) view.scrollDOM.scrollTop = 0;
      view.focus();
    },
    insertText(text) { view.dispatch(view.state.replaceSelection(String(text))); view.focus(); },
    focus() { view.focus(); },
    onChange(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    onScroll(fn) { scrollListeners.push(fn); },
    getScrollRatio() {
      const el = view.scrollDOM;
      return el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
    },
    setTheme(mode) {
      currentTheme = mode === 'dark' ? 'dark' : 'light';
      view.dispatch({ effects: themeCompartment.reconfigure(CM.EditorView.theme(themeSpec, { dark: currentTheme === 'dark' })) });
    },
    refresh() { view.requestMeasure(); }
  };
}
