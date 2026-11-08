/* make-icon.cjs — 纯 Node 生成 Tauri 所需图标（PNG 多尺寸 + ICO）。
   不依赖任何第三方库：手写 PNG chunk + zlib，ICO 内嵌 PNG。
   图形：紫色圆角方块 + 白色 M（Markdown 首字母），小尺寸下仍可辨识。 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'desktop', 'src-tauri', 'icons');

const PURPLE = [83, 74, 183];
const WHITE = [255, 255, 255];

/* ---------- PNG 编码 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // 每行前置 filter byte 0
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- 绘制（超采样抗锯齿）---------- */
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 === 0 ? 0 : (wx * vx + wy * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return Math.sqrt(dx * dx + dy * dy);
}

function render(size, ss) {
  const S = size * ss;
  const k = S / 256;
  const acc = new Float64Array(size * size * 4);

  // 归一化到 256 坐标系
  const bgX0 = 12 * k, bgY0 = 12 * k, bgX1 = 244 * k, bgY1 = 244 * k, bgR = 52 * k;
  const stroke = 15 * k;
  const mLeftA = [70 * k, 186 * k];
  const mRightA = [186 * k, 186 * k];
  const mTopY = 74 * k;
  const mPeak = [128 * k, 140 * k];

  for (let sy = 0; sy < S; sy++) {
    for (let sx = 0; sx < S; sx++) {
      let r = 0, g = 0, b = 0, a = 0;
      if (inRoundRect(sx + 0.5, sy + 0.5, bgX0, bgY0, bgX1, bgY1, bgR)) {
        r = PURPLE[0]; g = PURPLE[1]; b = PURPLE[2]; a = 255;
        const px = sx + 0.5, py = sy + 0.5;
        const onM =
          distToSegment(px, py, mLeftA[0], mTopY, mLeftA[0], mLeftA[1]) <= stroke ||
          distToSegment(px, py, mRightA[0], mTopY, mRightA[0], mRightA[1]) <= stroke ||
          distToSegment(px, py, mLeftA[0], mTopY, mPeak[0], mPeak[1]) <= stroke ||
          distToSegment(px, py, mRightA[0], mTopY, mPeak[0], mPeak[1]) <= stroke;
        if (onM) { r = WHITE[0]; g = WHITE[1]; b = WHITE[2]; }
      }
      const di = (Math.floor(sy / ss) * size + Math.floor(sx / ss)) * 4;
      acc[di] += r; acc[di + 1] += g; acc[di + 2] += b; acc[di + 3] += a;
    }
  }

  const out = Buffer.alloc(size * size * 4);
  const n = ss * ss;
  for (let i = 0; i < out.length; i++) out[i] = Math.round(acc[i] / n);
  return out;
}

/* ---------- ICO 封装 ---------- */
function buildIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  let offset = 6 + count * 16;
  const dir = [];
  for (const e of entries) {
    const b = Buffer.alloc(16);
    b[0] = e.size >= 256 ? 0 : e.size;
    b[1] = e.size >= 256 ? 0 : e.size;
    b[2] = 0;
    b[3] = 0;
    b.writeUInt16LE(1, 4);
    b.writeUInt16LE(32, 6);
    b.writeUInt32LE(e.png.length, 8);
    b.writeUInt32LE(offset, 12);
    dir.push(b);
    offset += e.png.length;
  }
  return Buffer.concat([header, ...dir, ...entries.map(e => e.png)]);
}

/* ---------- 主流程 ---------- */
fs.mkdirSync(OUT_DIR, { recursive: true });

const sizes = [16, 24, 32, 48, 64, 128, 256];
const entries = sizes.map(size => {
  const ss = size <= 48 ? 4 : 2;
  return { size, png: encodePng(size, render(size, ss)) };
});

for (const e of entries) {
  if (e.size === 32 || e.size === 128 || e.size === 256) {
    const name = e.size === 256 ? '128x128@2x.png' : e.size + 'x' + e.size + '.png';
    fs.writeFileSync(path.join(OUT_DIR, name), e.png);
  }
}
fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), buildIco(entries));

const icoPath = path.join(OUT_DIR, 'icon.ico');
console.log('icon.ico  ' + fs.statSync(icoPath).size + ' B  (' + sizes.join('/') + ')');
console.log('dir: ' + OUT_DIR);
