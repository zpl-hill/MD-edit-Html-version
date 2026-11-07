/**
 * prepare-vendor.cjs — 仅开发机运行：补齐 vendor 资源与许可证。
 * 用法: node tools/prepare-vendor.cjs <node_modules 绝对路径>
 * 发布机不需要此脚本（build-release.ps1 为纯 PowerShell 零安装）。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const NM = process.argv[2];
const VENDOR = path.join(ROOT, 'vendor');
const LICENSES = path.join(ROOT, 'licenses');

if (!NM) {
  console.error('用法: node tools/prepare-vendor.cjs <node_modules 绝对路径>');
  process.exit(1);
}

const PRISM_VERSION = '1.29.0';
const LANGS = [
  'json', 'python', 'bash', 'sql', 'java', 'c', 'cpp', 'csharp',
  'go', 'rust', 'typescript', 'markdown', 'yaml', 'powershell'
];
const CM_PACKAGES = [
  '@codemirror/state', '@codemirror/view', '@codemirror/commands',
  '@codemirror/search', '@codemirror/language',
  '@codemirror/lang-markdown', '@lezer/highlight'
];

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return await res.text();
}

function copyLicense(from, to) {
  const src = path.join(NM, from);
  if (!fs.existsSync(src)) throw new Error('缺少许可证: ' + src);
  fs.copyFileSync(src, path.join(LICENSES, to));
}

(async () => {
  fs.mkdirSync(VENDOR, { recursive: true });
  fs.mkdirSync(LICENSES, { recursive: true });

  // 1. Prism 语言组件（按依赖顺序拼接，cpp 在 c 之后、typescript 在 javascript 之后）
  let bundle = '';
  for (const lang of LANGS) {
    const url = `https://cdn.jsdelivr.net/npm/prismjs@${PRISM_VERSION}/components/prism-${lang}.min.js`;
    bundle += (await download(url)) + '\n';
    console.log('  + prism-' + lang);
  }
  fs.writeFileSync(path.join(VENDOR, 'prism-langs.js'), bundle, 'utf8');

  // 2. 各组件 LICENSE 原文
  copyLicense('marked/LICENSE.md', 'MARKED-LICENSE.md');
  copyLicense('prismjs/LICENSE', 'PRISM-LICENSE.txt');
  copyLicense('docx/LICENSE', 'DOCX-LICENSE.txt');
  copyLicense('temml/LICENSE', 'TEMML-LICENSE.txt');

  // 3. CodeMirror 6 系列许可证合并（含包名与版本）
  let cmText = '';
  for (const pkg of CM_PACKAGES) {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(NM, pkg, 'package.json'), 'utf8'));
    cmText += `\n========== ${pkg} @ ${pkgJson.version} ==========\n\n`;
    cmText += fs.readFileSync(path.join(NM, pkg, 'LICENSE'), 'utf8') + '\n';
  }
  fs.writeFileSync(path.join(LICENSES, 'CODEMIRROR-LICENSES.txt'), cmText, 'utf8');

  console.log('vendor 资源与许可证已就绪。');
})().catch(err => {
  console.error('prepare-vendor 失败:', err.message);
  process.exit(1);
});
