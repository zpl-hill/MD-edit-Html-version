/* imageData.js — 图片 I/O：粘贴/拖入图片内嵌为 data URI；导出时解码为 Word 可用字节。
   仅用 FileReader / Image / canvas，无网络请求、无外部依赖，file:// 下可用。 */
const DOCX_TYPES = new Set(['png', 'jpeg', 'jpg', 'gif', 'bmp']);
const MAX_EDGE = 1600;
const MAX_FILE = 20 * 1024 * 1024;

function isImageFile(file) {
  if (!file) return false;
  if (file.type && /^image\//i.test(file.type)) return true;
  return /\.(png|jpe?g|gif|bmp|webp|svg|avif|heic|heif|ico)$/i.test(file.name || '');
}

/* 拖入：优先 files；从网页拖图片时可能只有 items。 */
export function imageFilesFromDataTransfer(dt) {
  if (!dt) return [];
  const list = Array.from(dt.files || []);
  if (!list.length && dt.items) {
    Array.from(dt.items).forEach(item => {
      if (item.kind === 'file') { const f = item.getAsFile(); if (f) list.push(f); }
    });
  }
  return list.filter(isImageFile);
}

/* 粘贴截图：clipboardData.items 里的 image/* 项。 */
export function imageFilesFromClipboard(cd) {
  if (!cd) return [];
  const out = [];
  Array.from(cd.items || []).forEach(item => {
    if (item.kind === 'file' && /^image\//i.test(item.type || '')) {
      const f = item.getAsFile(); if (f) out.push(f);
    }
  });
  if (!out.length) Array.from(cd.files || []).forEach(f => { if (isImageFile(f)) out.push(f); });
  return out;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ img, width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
    img.onerror = () => reject(new Error('浏览器无法解码该图片'));
    img.src = src;
  });
}

/* canvas 栅格化：统一尺寸、把 WebP/SVG/AVIF 转成 Word 认识的 PNG，并压住 .md 体积。 */
function render(img, width, height, maxEdge, asJpeg, quality) {
  const scale = Math.min(1, maxEdge / Math.max(1, width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (asJpeg) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(img, 0, 0, w, h);
  return { uri: canvas.toDataURL(asJpeg ? 'image/jpeg' : 'image/png', quality), width: w, height: h };
}

function base64ToBytes(text) {
  const binary = atob(String(text).replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function normalizeType(subtype) {
  const t = String(subtype || 'png').toLowerCase();
  return (t === 'jpeg' || t === 'jpg') ? 'jpg' : t;
}

function altFromFile(file) {
  const base = String((file && file.name) || '图片').replace(/\.[^.]+$/, '');
  return base.replace(/[\][()\r\n]/g, ' ').trim().slice(0, 60) || '图片';
}

/* 图片文件 → 一段可直接插入编辑器的 Markdown。
   原生格式且体积/尺寸可控时保留原字节（GIF 动图、JPEG 体积都不会被破坏）；
   否则栅格化为 PNG/JPEG，兼顾 Word 兼容性与 .md 大小。 */
export async function fileToMarkdownImage(file) {
  if (!file || file.size > MAX_FILE) throw new Error('图片超过 20 MB，请先压缩');
  const sourceUri = await readAsDataUrl(file);
  const loaded = await loadImage(sourceUri);
  const width = loaded.width || 800;
  const height = loaded.height || 600;
  const subtype = (/^data:image\/([^;,]+)/i.exec(sourceUri) || [])[1] || '';
  const native = DOCX_TYPES.has(subtype.toLowerCase());
  let uri = sourceUri, outW = width, outH = height;
  if (!native || file.size > 2 * 1024 * 1024 || Math.max(width, height) > 2000) {
    const asJpeg = /^jpe?g$/i.test(subtype);
    let r = render(loaded.img, width, height, MAX_EDGE, asJpeg, 0.88);
    if (r.uri.length > 2.5 * 1024 * 1024) {
      const small = render(loaded.img, width, height, 1000, true, 0.8);
      if (small.uri.length < r.uri.length) r = small;
    }
    uri = r.uri; outW = r.width; outH = r.height;
  }
  const alt = altFromFile(file);
  return {
    markdown: '![' + alt + '](' + uri + ')',
    uri, alt, width: outW, height: outH,
    bytes: Math.round(uri.length * 0.75)
  };
}

/* 让图片自成一段：光标所在行有内容时补空行，避免图片挤进正文行内。 */
export function buildImageSnippet(entry, before, after) {
  const prefix = before && before.trim() ? '\n\n' : '\n';
  const suffix = after && after.trim() ? '\n\n' : '\n';
  return prefix + entry.markdown + suffix;
}

/* DOCX 图片解码：只接受内嵌 data: 与同源 blob:，绝不主动请求 http(s)/本地路径，
   避免离线环境挂起或把文档里的外链泄露出去。无法解码时返回 null 由调用方降级。 */
export async function decodeImageForDocx(src) {
  const value = String(src || '');
  if (!/^(data:image\/|blob:)/i.test(value)) return null;
  try {
    const direct = /^data:image\/([^;,]+);base64,([\s\S]+)$/i.exec(value);
    if (direct && DOCX_TYPES.has(direct[1].toLowerCase())) {
      const dims = await loadImage(value);
      const w = dims.width || 400, h = dims.height || 300;
      const ratio = Math.min(1, 560 / w);
      return {
        data: base64ToBytes(direct[2]),
        type: normalizeType(direct[1]),
        width: Math.max(1, Math.round(w * ratio)),
        height: Math.max(1, Math.round(h * ratio))
      };
    }
    /* WebP / AVIF / SVG / 百分号编码 data URI / blob: → 栅格化 PNG */
    const dims = await loadImage(value);
    const r = render(dims.img, dims.width || 800, dims.height || 600, MAX_EDGE, false);
    const ratio = Math.min(1, 560 / r.width);
    return {
      data: base64ToBytes(r.uri.slice(r.uri.indexOf(',') + 1)),
      type: 'png',
      width: Math.max(1, Math.round(r.width * ratio)),
      height: Math.max(1, Math.round(r.height * ratio))
    };
  } catch (e) { return null; }
}
