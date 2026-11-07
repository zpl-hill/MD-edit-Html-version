/* exportDocx.js — 组装 DOCX 并触发下载；图片支持内嵌 data URI 与同源 blob URI。 */
import { convertTokens } from "./docxConverter.js";
import { downloadBlob } from "./fileService.js";
import { decodeImageForDocx } from "./imageData.js";

export function createDocxExporter(options) {
  async function generate(filename) {
    const tokens = options.getTokens();
    const document = await convertTokens(tokens, {
      title: options.getTitle() || 'Markdown Studio Lite',
      resolveImage: decodeImageForDocx
    });
    const blob = await globalThis.docx.Packer.toBlob(document);
    downloadBlob(blob, filename);
    return { ok: true, size: blob.size, stats: document.__mdslStats || null };
  }
  return { generate, resolveImage: decodeImageForDocx };
}
