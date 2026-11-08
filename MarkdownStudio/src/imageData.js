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

/* ---------------- 路径引用模式 ---------------- */

function escapeAltText(value) {
  return String(value || '').replace(/[\][()\r\n]/g, ' ').trim();
}

function altFromPath(p) {
  const base = String(p || '').split(/[\\/]/).pop() || '图片';
  return escapeAltText(base.replace(/\.[^.]+$/, '')).slice(0, 60) || '图片';
}

/* 链接目标里的空格 / 括号必须转义，否则 Markdown 会提前截断。
   中文保持原样（比整串 encodeURI 更可读，各编辑器也都支持）。 */
export function encodeLinkTarget(value) {
  return String(value || '').replace(/[ ()<>#?]/g, ch =>
    '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}

export function decodeLinkTarget(value) {
  const text = String(value || '');
  try { return decodeURIComponent(text); } catch (e) { return text; }
}

/* 判断是否真的带协议（http:// / data: / file: ...）。
   注意不能只看 "xxx:" —— Windows 盘符 "C:/pic.png" 会被误判成协议。 */
export function isRemoteUrl(value) {
  const text = String(value || '').trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
    || /^data:/i.test(text)
    || /^file:/i.test(text)
    || text.startsWith('//');
}

/* 只写路径，不复制图片字节。文档更小，但图片文件要和 .md 一起存放/移动。 */
export function pathToMarkdownImage(pathValue, alt) {
  const path = String(pathValue || '').trim();
  if (!path) throw new Error('路径为空');
  const label = escapeAltText(alt) || altFromPath(path);
  return {
    markdown: '![' + label + '](' + (isRemoteUrl(path) ? path : encodeLinkTarget(path)) + ')',
    alt: label,
    path,
    mode: 'path',
    bytes: 0,
    width: 0,
    height: 0
  };
}

/* 图片文件 → 一段可直接插入编辑器的 Markdown。
   原生格式且体积/尺寸可控时保留原字节（GIF 动图、JPEG 体积都不会被破坏）；
   否则栅格化为 PNG/JPEG，兼顾 Word 兼容性与 .md 大小。 */
export async function fileToMarkdownImage(file) {
  if (!file || file.size > MAX_FILE) throw new Error('图片超过 20 MB，请先压缩');
  const sourceUri = await readAsDataUrl(file);
  return await dataUriToMarkdownImage(sourceUri, altFromFile(file), file.size);
}

/* 桌面版从磁盘读回的图片走同一条压缩/栅格化链路，保证与浏览器版行为一致。 */
export async function dataUriToMarkdownImage(sourceUri, altHint, byteHint) {
  const loaded = await loadImage(sourceUri);
  const width = loaded.width || 800;
  const height = loaded.height || 600;
  const subtype = (/^data:image\/([^;,]+)/i.exec(sourceUri) || [])[1] || '';
  const native = DOCX_TYPES.has(subtype.toLowerCase());
  const bytes = Number(byteHint) || Math.round(sourceUri.length * 0.75);
  let uri = sourceUri, outW = width, outH = height;
  if (!native || bytes > 2 * 1024 * 1024 || Math.max(width, height) > 2000) {
    const asJpeg = /^jpe?g$/i.test(subtype);
    let r = render(loaded.img, width, height, MAX_EDGE, asJpeg, 0.88);
    if (r.uri.length > 2.5 * 1024 * 1024) {
      const small = render(loaded.img, width, height, 1000, true, 0.8);
      if (small.uri.length < r.uri.length) r = small;
    }
    uri = r.uri; outW = r.width; outH = r.height;
  }
  const alt = escapeAltText(altHint) || '图片';
  return {
    markdown: '![' + alt + '](' + uri + ')',
    uri, alt, mode: 'embed', width: outW, height: outH,
    bytes: Math.round(uri.length * 0.75)
  };
}

/* 让图片自成一段：光标所在行有内容时补空行，避免图片挤进正文行内。 */
export function buildImageSnippet(entry, before, after) {
  const prefix = before && before.trim() ? '\n\n' : '\n';
  const suffix = after && after.trim() ? '\n\n' : '\n';
  return prefix + entry.markdown + suffix;
}

/* ---------------- 本地路径解析（预览用） ---------------- */

const REMOTE_SRC = /^(?:data:|blob:|https?:|\/\/)/i;

/* 把 Markdown 里的图片地址还原成磁盘绝对路径；不是本地路径时返回 null。
   桌面版靠它把 ![](pic.png) 换成可加载的内部 URL，浏览器版直接返回 null 不干预。 */
export function toLocalAbsolutePath(src, baseFile) {
  const raw = decodeLinkTarget(String(src || '').trim());
  if (!raw || REMOTE_SRC.test(raw)) return null;

  let path = raw.replace(/\\/g, '/');
  if (/^file:\/\//i.test(path)) {
    path = path.replace(/^file:\/\//i, '');
    if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);   // file:///C:/x → C:/x
  }
  const absolute = /^[A-Za-z]:\//.test(path);
  if (!absolute && path.startsWith('/')) return null;      // 站点根相对，不猜
  if (!absolute) {
    if (!baseFile) return null;
    const dir = String(baseFile).replace(/\\/g, '/').replace(/\/[^/]*$/, '');
    if (!dir) return null;
    path = dir + '/' + path;
  }
  return normalizeSegments(path);
}

function normalizeSegments(input) {
  const parts = String(input).split('/');
  const out = [];
  parts.forEach(part => {
    if (part === '..') {
      if (out.length && !(out.length === 1 && /^[A-Za-z]:$/.test(out[0]))) out.pop();
      return;
    }
    if (part === '.' || (part === '' && out.length)) return;
    out.push(part);
  });
  return out.join('/');
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
