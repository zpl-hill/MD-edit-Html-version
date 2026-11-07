// CodeMirror 6 预打包入口 —— 仅开发机用 esbuild 生成 vendor/cm6.iife.js 后签入仓库。
// 命令见 tools/README.md。发布机不需要 Node / esbuild。
export { EditorState, EditorSelection, Compartment } from "@codemirror/state";
export {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor,
  highlightSpecialChars, placeholder
} from "@codemirror/view";
export {
  defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, selectAll
} from "@codemirror/commands";
export {
  search, searchKeymap, highlightSelectionMatches, openSearchPanel,
  closeSearchPanel, replaceAll, findNext, findPrevious
} from "@codemirror/search";
export {
  foldGutter, foldKeymap, bracketMatching, indentOnInput, syntaxHighlighting,
  HighlightStyle, defaultHighlightStyle, foldAll, unfoldAll
} from "@codemirror/language";
export { markdown, markdownLanguage } from "@codemirror/lang-markdown";
export { tags } from "@lezer/highlight";
