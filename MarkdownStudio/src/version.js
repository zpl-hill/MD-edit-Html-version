/* version.js — 产品版本单一真源。
   about 页、帮助页脚、桌面壳（package.json / Cargo.toml / tauri.conf.json）
   必须与这里保持一致；发布前用 tools/check-version.ps1 或人工核对。
   版本序列：V1.9 打印设置 → V1.10 打印预览留白 → V1.11 最近文件快速切换。 */
export const APP_VERSION = '1.11.0';
export const APP_VERSION_LABEL = 'V1.11';
