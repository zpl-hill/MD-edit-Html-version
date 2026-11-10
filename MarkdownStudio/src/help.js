/* help.js — Markdown / 公式语法速查。分类标签 + 示例表 + 一键插入到编辑器光标处。
   内容为静态数据，便于后续扩展或本地化；不引入任何第三方依赖。 */

const HELP = [
  {
    id: 'markdown',
    label: 'Markdown 语法',
    note: 'Markdown 用纯文本写排版：空一行表示新段落，行尾两个空格可强制换行。左侧编辑、右侧实时预览，改完立刻能看到效果。',
    groups: [
      {
        title: '标题与段落',
        rows: [
          { syntax: '# 一级标题', desc: '一级标题（H1）；# 的个数 1~6 对应 H1~H6，会自动进左侧目录', insert: '# 一级标题\n\n' },
          { syntax: '## 二级标题', desc: '二级标题（H2），目录里会缩进一级', insert: '## 二级标题\n\n' },
          { syntax: '段落之间空一行', desc: '两个段落之间必须留一个空行，否则会被当成同一段', insert: '第一段文字。\n\n第二段文字。\n' },
          { syntax: '---', desc: '水平分割线', insert: '\n---\n\n' }
        ]
      },
      {
        title: '强调与代码',
        rows: [
          { syntax: '**粗体**  *斜体*', desc: '粗体 / 斜体；也可写 __粗体__、_斜体_', insert: '**粗体** *斜体*\n' },
          { syntax: '~~删除线~~', desc: '删除线（GFM 扩展）', insert: '~~删除线~~\n' },
          { syntax: '`行内代码`', desc: '行内代码，用反引号包住', insert: '`行内代码`\n' },
          { syntax: '```javascript\nconst x = 1;\n```', desc: '围栏代码块；首行写语言名可获得语法高亮（支持 js/python/sql/bash/c/cpp/java/go/rust/ts/json/yaml/powershell 等）', insert: '```javascript\nconst x = 1;\nconsole.log(x);\n```\n\n' }
        ]
      },
      {
        title: '列表与引用',
        rows: [
          { syntax: '- 项目一\n- 项目二', desc: '无序列表；缩进 2~4 空格可嵌套子列表', insert: '- 项目一\n- 项目二\n- 项目三\n\n' },
          { syntax: '1. 第一步\n2. 第二步', desc: '有序列表，数字会自动重新编号', insert: '1. 第一步\n2. 第二步\n3. 第三步\n\n' },
          { syntax: '- [ ] 待办\n- [x] 已完成', desc: '任务清单（GFM 扩展）', insert: '- [ ] 待办事项\n- [x] 已完成事项\n\n' },
          { syntax: '> 引用文字', desc: '块引用，常用来写结论或注意事项', insert: '> 结论：测量系统可接受，需追查过程变异来源。\n\n' }
        ]
      },
      {
        title: '表格',
        rows: [
          { syntax: '| 项目 | 数值 |\n| --- | --- |\n| 样本 | 120 |', desc: '标准表格；第二行的 --- 必须有，表头会自动加粗', insert: '| 项目 | 数值 | 判定 |\n| --- | --- | --- |\n| 样本数 | 120 | OK |\n| 超差数 | 7 | NG |\n\n' },
          { syntax: '| :--- | ---: | :---: |', desc: '冒号控制对齐：左对齐 / 右对齐 / 居中', insert: '| 左对齐 | 右对齐 | 居中 |\n| :--- | ---: | :---: |\n| A | 100 | OK |\n\n' }
        ]
      },
      {
        title: '链接、图片与锚点',
        rows: [
          { syntax: '[显示文字](https://example.com)', desc: '超链接；本工具会加上 noreferrer，并在新标签打开', insert: '[显示文字](https://example.com)\n' },
          { syntax: '工具栏「插入图片」 / Alt+I', desc: '选本地文件、粘贴路径或网址，再决定「内嵌 Base64」还是「引用路径」；勾选「记住」后，拖入图片也按这个方式处理', insert: null },
          { syntax: '直接粘贴截图 / 拖入图片', desc: '最省事的做法：Ctrl+V 粘贴截图，或把 png/jpg/webp/svg 拖进窗口，会自动内嵌成 data URI 并插入光标处；大图自动压缩', insert: null },
          { syntax: '![说明](data:image/png;base64,...)', desc: '内嵌写法。图片数据随 .md 一起保存，离线预览、打印和 DOCX 导出都能带上，但正文会很长', insert: '![示意](data:image/png;base64,)\n' },
          { syntax: '![说明](./pic/a.png)', desc: '路径写法。文档很小、编辑器清爽；图片文件要和 .md 一起保存和搬移。桌面版导出 DOCX 不会带上路径图片', insert: '![示意](./pic/a.png)\n' },
          { syntax: '[跳到第二节](#第二节)', desc: '跳到本文档内的标题锚点；中文标题直接用原文，重复标题会自动加序号', insert: '[跳转到](#标题)\n' },
          { syntax: '<!-- 注释 -->', desc: 'HTML 注释：只出现在源码里，预览与打印都不显示', insert: '<!-- 这里写备注，不会显示在预览中 -->\n' }
        ]
      }
    ]
  },
  {
    id: 'math',
    label: '数学公式 (LaTeX)',
    note: '公式用 $...$（行内）或 $$...$$（独立成行）包住，写法是 LaTeX 子集。本工具用 Temml 生成浏览器原生 MathML，不需要字体文件、完全离线。若公式解析失败会显示红色原文，可对照下表检查命令。',
    groups: [
      {
        title: '定界符（必看）',
        rows: [
          { syntax: '$E = mc^2$', desc: '行内公式，嵌在句子中间', insert: '行内公式 $E = mc^2$，继续写正文。\n' },
          { syntax: '$$\\text{GRR} = 8.4\\%$$', desc: '独立公式，居中独占一行；$$ 建议单独占行', insert: '$$\\text{GRR} = \\sqrt{\\sigma_{EV}^2 + \\sigma_{AV}^2}$$\n\n' },
          { syntax: '\\%  \\_  \\#', desc: '公式里写百分号、下划线、井号需要反斜杠转义', insert: '$$\\text{合格率} = 95\\%$$\n\n' }
        ]
      },
      {
        title: '上下标、分式与根号',
        rows: [
          { syntax: 'x^2   x_i   x_{i,j}', desc: '上标 / 下标；多于一个字符要用花括号 {} 分组', insert: '$$x_{i,j}^2$$\n\n' },
          { syntax: '\\frac{a}{b}', desc: '分式；分子分母各用花括号', insert: '$$\\frac{\\sigma_{EV}^2}{\\sigma_{TV}^2}$$\n\n' },
          { syntax: '\\sqrt{x}   \\sqrt[3]{x}', desc: '平方根 / n 次根', insert: '$$\\sqrt{\\sigma_{EV}^2 + \\sigma_{AV}^2}$$\n\n' },
          { syntax: '\\overline{AB}   \\hat{x}   \\vec{v}', desc: '上划线 / 帽子 / 向量', insert: '$$\\overline{X} = \\frac{1}{n}\\sum_{i=1}^{n} x_i$$\n\n' }
        ]
      },
      {
        title: '希腊字母与常用符号',
        rows: [
          { syntax: '\\alpha \\beta \\sigma \\mu \\Delta \\Omega', desc: '小写与大写希腊字母；大写直接首字母大写即可', insert: '$$\\mu = 0,\\ \\sigma = 1,\\ \\Delta = 0.05$$\n\n' },
          { syntax: '\\times \\pm \\leq \\geq \\neq \\approx', desc: '乘号、正负号、不等号、约等于', insert: '$$C_p = \\frac{USL - LSL}{6\\sigma} \\geq 1.33$$\n\n' },
          { syntax: '\\infty \\rightarrow \\Rightarrow \\in \\subset', desc: '无穷、箭头、属于、包含于', insert: '$$n \\rightarrow \\infty,\\ x \\in \\mathbb{R}$$\n\n' }
        ]
      },
      {
        title: '求和、积分与极限',
        rows: [
          { syntax: '\\sum_{i=1}^{n} x_i', desc: '求和；下标 _ 上标 ^ 可与大型运算符配合', insert: '$$\\bar{x} = \\frac{1}{n}\\sum_{i=1}^{n} x_i$$\n\n' },
          { syntax: '\\int_0^1 f(x)\\,dx', desc: '积分；\\, 是细空格，让 dx 更美观', insert: '$$\\int_0^1 f(x)\\,dx$$\n\n' },
          { syntax: '\\lim_{x \\to 0} f(x)', desc: '极限', insert: '$$\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$$\n\n' },
          { syntax: '\\prod_{i=1}^{n}', desc: '连乘', insert: '$$\\prod_{i=1}^{n} p_i$$\n\n' }
        ]
      },
      {
        title: '文本、括号与矩阵',
        rows: [
          { syntax: '\\text{GRR}', desc: '在公式里插入普通文字（含中文）；公式默认把字母当变量显示为斜体', insert: '$$\\text{GRR} = 8.4\\% \\quad (\\text{可接受})$$\n\n' },
          { syntax: '\\left( \\frac{a}{b} \\right)', desc: '自动伸缩的括号，比直接写 ( ) 更贴合高度', insert: '$$\\left( \\frac{a+b}{2} \\right)^2$$\n\n' },
          { syntax: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', desc: '矩阵；& 分列、\\\\ 换行。注：源码里每条 LaTeX 换行都要写两个反斜杠', insert: '$$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$$\n\n' },
          { syntax: '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}', desc: '多行对齐公式，用 & 指定对齐位置', insert: '$$\\begin{aligned} \\text{EV} &= \\sigma_{EV}^2 \\\\ \\text{AV} &= \\sigma_{AV}^2 \\end{aligned}$$\n\n' }
        ]
      }
    ]
  },
  {
    id: 'tips',
    label: '使用技巧',
    note: '这个工具是单 HTML 文件、双击即用、完全离线。正文只存在本机浏览器里，不会上传。',
    groups: [
      {
        title: '快捷键',
        rows: [
          { syntax: '新建 (Alt+N)', desc: '工具栏「新建」或 Alt+N / Ctrl+Alt+N 创建空白 .md 文档；有未保存更改时会先询问是否保存。Ctrl+N 是浏览器保留快捷键，网页无法拦截', insert: null },
          { syntax: 'Ctrl+O / Ctrl+S', desc: '打开 .md 文件 / 保存并下载 .md 文件', insert: null },
          { syntax: 'Ctrl+F / Ctrl+H', desc: '编辑器内搜索 / 替换；阅读模式下 Ctrl+F 改为在预览内容里查找，Ctrl+H 会自动切回可编辑视图', insert: null },
          { syntax: '阅读模式查找', desc: 'Ctrl+F 打开查找条：输入即高亮、Enter / Shift+Enter 跳上下一个、Aa 区分大小写、Esc 关闭', insert: null },
          { syntax: 'Ctrl+P / Ctrl+Shift+P / Ctrl+Shift+W', desc: '打印设置（纸张/方向/边距）/ 直接用当前设置打印并另存为 PDF / 导出 Word DOCX', insert: null },
          { syntax: 'Alt+R / Ctrl+Alt+R', desc: '打开「最近文件 · 快速切换」浮层；Esc 关闭。阅读模式下也有右上角悬浮入口', insert: null },
          { syntax: 'F6', desc: '循环切换视图：三栏 → 仅编辑 → 仅阅读', insert: null },
          { syntax: 'F8 / F1 / Esc', desc: '切换主题 / 打开本帮助 / 关闭弹窗', insert: null }
        ]
      },
      {
        title: '数据与保存',
        rows: [
          { syntax: '新建文档', desc: '新建会复位回固定草稿槽并清除旧草稿，旧内容不会在刷新时恢复回来；已保存过的文件仍可从「最近文件」切回。浏览器标签页标题会显示当前文件名', insert: null },
          { syntax: '30 秒自动保存', desc: '正文快照写入 IndexedDB；关闭或切走时还会写一份压缩草稿', insert: null },
          { syntax: '刷新后恢复', desc: '若发现未保存草稿，顶部会出现横幅，点「恢复」即可还原；点「丢弃」则清空', insert: null },
          { syntax: '最近文件', desc: '左栏下方列出最近 10 个文件；打开、保存、另存为时都会缓存正文，点击即可切换过去', insert: null },
          { syntax: '快速切换', desc: '单窗口切换文档：切换前自动把当前文档暂存到本机（快照 + 紧急草稿），随时可从列表切回；暂存不等于写回原文件，状态栏会明确区分', insert: null },
          { syntax: '浏览器 / 桌面版差异', desc: '浏览器在 file:// 下不能记住磁盘绝对路径，只能从本机缓存恢复；桌面版 EXE 会记录文件绝对路径，标「原文件」的条目点击后直接重新读取磁盘最新内容，保存也写回该文件', insert: null },
          { syntax: 'A− / A+', desc: '工具栏右侧可调整整个界面字体大小，设置会记住', insert: null }
        ]
      },
      {
        title: '打印与导出',
        rows: [
          { syntax: '打印设置', desc: '在打印预览模式的工具栏里点「页面设置」（或直接按 Ctrl+P）：选纸张（A4 / A3 / B5 / Letter）、方向与页边距（常规 / 窄 / 宽 / 自定义四边 mm），点「打印」即调系统打印机', insert: null },
          { syntax: '打印预览', desc: '白纸即整张纸，页边距以留白显示（所见即所得）；按当前纸张与边距预分页，自动加标题+日期页眉与 Page X of Y 页码；预览工具栏有退出、缩放、方向、页面设置与打印', insert: null },
          { syntax: '退出预览', desc: '预览工具栏最左侧的「← 退出预览」，或直接按 Esc，即可回到编辑；Ctrl+P 开的设置对话框按 Esc 只关对话框', insert: null },
          { syntax: '导出 PDF', desc: '用当前设置直接打开系统打印对话框，选「另存为 PDF」即可导出；文字可选中、保真度最高', insert: null },
          { syntax: '导出 DOCX', desc: '标题映射为 Word Heading 1~3，表格、代码、内嵌图片（自动居中）、页眉页码都会保留；只支持内嵌图片，外链/相对路径会降级为占位文字并在状态栏提示', insert: null },
          { syntax: 'Word 里的公式', desc: '$...$ / $$...$$ 会转成 Word 原生公式（OMML），在 Word 中可双击编辑；极复杂公式若转换失败会保留红色源码', insert: null },
          { syntax: '阅读模式', desc: '只想读文档时点「阅读」：隐藏目录与编辑器，预览铺满窗口宽度、字号行距更舒适；右上角有「☰ 最近文件」悬浮入口，可切到别的文档', insert: null }
        ]
      }
    ]
  }
];

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function createHelpController(options) {
  const dialog = options.dialog;
  const tabsRoot = dialog.querySelector('#help-tabs');
  const bodyRoot = dialog.querySelector('#help-body');
  const inserts = [];
  let activeId = HELP[0].id;

  function render() {
    inserts.length = 0;
    tabsRoot.innerHTML = HELP.map(section =>
      '<button class="help-tab' + (section.id === activeId ? ' active' : '') +
      '" data-help-tab="' + esc(section.id) + '">' + esc(section.label) + '</button>'
    ).join('');

    bodyRoot.innerHTML = HELP.map(section =>
      '<div class="help-panel' + (section.id === activeId ? ' active' : '') +
      '" data-help-panel="' + esc(section.id) + '">' +
      (section.note ? '<p class="help-note">' + esc(section.note) + '</p>' : '') +
      section.groups.map(group =>
        '<section class="help-group"><h3>' + esc(group.title) + '</h3>' +
        '<table class="help-table"><thead><tr><th>写法</th><th>说明</th><th></th></tr></thead><tbody>' +
        group.rows.map(row => {
          let button = '';
          if (row.insert != null) {
            const index = inserts.push(row.insert) - 1;
            button = '<button class="help-insert" data-help-insert="' + index + '">插入</button>';
          }
          return '<tr><td><code>' + esc(row.syntax) + '</code></td><td>' + esc(row.desc) +
            '</td><td>' + button + '</td></tr>';
        }).join('') +
        '</tbody></table></section>'
      ).join('') + '</div>'
    ).join('');
  }

  function setTab(id) {
    if (!HELP.some(section => section.id === id)) return;
    activeId = id;
    Array.from(tabsRoot.querySelectorAll('[data-help-tab]')).forEach(button =>
      button.classList.toggle('active', button.getAttribute('data-help-tab') === id));
    Array.from(bodyRoot.querySelectorAll('[data-help-panel]')).forEach(panel =>
      panel.classList.toggle('active', panel.getAttribute('data-help-panel') === id));
    bodyRoot.scrollTop = 0;
  }

  function open() { render(); dialog.classList.add('open'); }
  function close() { dialog.classList.remove('open'); }
  function toggle() { if (dialog.classList.contains('open')) close(); else open(); }

  dialog.addEventListener('click', event => {
    const tab = event.target.closest('[data-help-tab]');
    if (tab) { setTab(tab.getAttribute('data-help-tab')); return; }
    const button = event.target.closest('[data-help-insert]');
    if (button) {
      const index = Number(button.getAttribute('data-help-insert'));
      const text = inserts[index];
      close();
      if (text != null && options.onInsert) options.onInsert(text);
      return;
    }
    if (event.target === dialog || event.target.closest('[data-close]')) close();
  });

  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && dialog.classList.contains('open')) close();
  });

  return { open, close, toggle, setTab, isOpen: () => dialog.classList.contains('open') };
}
