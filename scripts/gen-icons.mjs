// Generate the PWA / Apple-touch PNG icons from scratch — no image libraries.
// iOS "Add to Home Screen" uses the <link rel="apple-touch-icon"> PNG (it does
// not read the SVG favicon or manifest icons), so we need real PNGs. We draw a
// simple brand mark — a rounded dark tile with a lighter "M" — directly into an
// RGBA buffer and encode it with Node's built-in zlib. Deterministic output, so
// re-running does not churn the files. Run: `node scripts/gen-icons.mjs`.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const BG = [26, 26, 34]; // #1a1a22 — matches the app's dark panel
const FG = [122, 162, 247]; // #7aa2f7 — the brand accent

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  // compression/filter/interlace all 0
  // Prepend the per-row filter byte (0 = none) to each scanline.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Draw a rounded tile + a chunky "M". Pure math so it scales to any size.
function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const stroke = size * 0.1; // M stroke width
  const mTop = size * 0.3;
  const mBot = size * 0.72;
  const mLeft = size * 0.26;
  const mRight = size * 0.74;
  const mMidX = size * 0.5;

  const inRounded = (x, y) => {
    const rx = Math.min(x, size - 1 - x);
    const ry = Math.min(y, size - 1 - y);
    if (rx >= radius || ry >= radius) return true;
    const dx = radius - rx;
    const dy = radius - ry;
    return dx * dx + dy * dy <= radius * radius;
  };

  // Distance from point to segment, for the two diagonal strokes of the M.
  const distSeg = (px, py, ax, ay, bx, by) => {
    const vx = bx - ax;
    const vy = by - ay;
    const wx = px - ax;
    const wy = py - ay;
    const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
    const cx = ax + t * vx;
    const cy = ay + t * vy;
    return Math.hypot(px - cx, py - cy);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!inRounded(x, y)) {
        rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0; // transparent corner
        continue;
      }
      // Two left verticals + two diagonals form the M.
      const onM =
        distSeg(x, y, mLeft, mBot, mLeft, mTop) < stroke / 2 ||
        distSeg(x, y, mRight, mBot, mRight, mTop) < stroke / 2 ||
        distSeg(x, y, mLeft, mTop, mMidX, size * 0.55) < stroke / 2 ||
        distSeg(x, y, mRight, mTop, mMidX, size * 0.55) < stroke / 2;
      const c = onM ? FG : BG;
      rgba[i] = c[0];
      rgba[i + 1] = c[1];
      rgba[i + 2] = c[2];
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

for (const size of [180, 192, 512]) {
  const png = encodePng(size, drawIcon(size));
  writeFileSync(join(OUT_DIR, `icon-${size}.png`), png);
  console.log(`wrote icons/icon-${size}.png (${png.length} bytes)`);
}
