/* exportDocx.js — 组装 DOCX 并触发下载；图片仅支持内嵌 data URI（SDD 6.3）。 */
import { convertTokens } from "./docxConverter.js";
import { downloadBlob } from "./fileService.js";

async function resolveImage(src) {
  const match = /^data:image\/(png|jpeg|jpg|gif|bmp);base64,([\s\S]+)$/i.exec(String(src || ''));
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const dims = await new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 400, h: img.naturalHeight || 300 });
      img.onerror = () => resolve({ w: 400, h: 300 });
      img.src = String(src);
    });
    const ratio = Math.min(1, 560 / dims.w);
    let type = match[1].toLowerCase();
    if (type === 'jpeg') type = 'jpg';
    return {
      data: bytes,
      width: Math.max(1, Math.round(dims.w * ratio)),
      height: Math.max(1, Math.round(dims.h * ratio)),
      type
    };
  } catch (e) { return null; }
}

export function createDocxExporter(options) {
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
