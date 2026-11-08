/* exportDocx.js — 组装 DOCX 并触发下载；图片支持内嵌 data URI、同源 blob URI，
   桌面版还会把路径引用的本地图片读进来，避免「编辑器里看得到、Word 里没有」。 */
import { convertTokens } from "./docxConverter.js";
import { downloadBlob } from "./fileService.js";
import { decodeImageForDocx, toLocalAbsolutePath } from "./imageData.js";

export function createDocxExporter(options) {
  const desktop = options.desktop || { enabled: false };

  async function resolveImage(src) {
    const direct = await decodeImageForDocx(src);
    if (direct) return direct;
    if (!desktop.enabled) return null;
    const abs = toLocalAbsolutePath(src, desktop.getPath());
    if (!abs) return null;
    try {
      const dataUrl = await desktop.readImageDataUrl(abs);
      return await decodeImageForDocx(dataUrl);
    } catch (e) {
      return null;
    }
  }

  async function generate(filename) {
    const tokens = options.getTokens();
    const document = await convertTokens(tokens, {
      title: options.getTitle() || 'Markdown Studio Lite',
      resolveImage
    });
    const blob = await globalThis.docx.Packer.toBlob(document);
    downloadBlob(blob, filename);
    return { ok: true, size: blob.size, stats: document.__mdslStats || null };
  }
  return { generate, resolveImage };
}
