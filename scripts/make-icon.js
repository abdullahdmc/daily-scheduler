'use strict';

// Draws build/icon.png (512x512): a sticky note with a ticked line and two plain lines.
// Run with: npm run icon

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const N = 512;
const px = Buffer.alloc(N * N * 4);
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// 4x4 supersampling per pixel for smooth edges.
function shape(inside, color) {
  const [r, g, b] = hex(color);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let hits = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) hits++;
      if (!hits) continue;
      const a = hits / 16;
      const i = (y * N + x) * 4;
      const da = px[i + 3] / 255;
      const oa = a + da * (1 - a);
      px[i] = Math.round((r * a + px[i] * da * (1 - a)) / oa);
      px[i + 1] = Math.round((g * a + px[i + 1] * da * (1 - a)) / oa);
      px[i + 2] = Math.round((b * a + px[i + 2] * da * (1 - a)) / oa);
      px[i + 3] = Math.round(oa * 255);
    }
  }
}

const roundRect = (x0, y0, x1, y1, r) => (x, y) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + r, Math.min(x1 - r, x));
  const cy = Math.max(y0 + r, Math.min(y1 - r, y));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const segment = (ax, ay, bx, by, w) => (x, y) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= (w / 2) ** 2;
};

shape(roundRect(40, 40, 472, 472, 56), '#EF9F27');
shape(roundRect(52, 52, 460, 460, 46), '#FAEEDA');
shape((x, y) => roundRect(52, 52, 460, 460, 46)(x, y) && y < 150, '#FAC775');
// progress bar
shape(roundRect(96, 112, 416, 128, 8), '#FAEEDA');
shape(roundRect(96, 112, 300, 128, 8), '#1D9E75');
// ticked box + line
shape(roundRect(96, 196, 156, 256, 12), '#633806');
shape(segment(110, 226, 122, 240, 12), '#FAEEDA');
shape(segment(122, 240, 144, 210, 12), '#FAEEDA');
shape(roundRect(182, 214, 416, 238, 12), '#B88A4D');
// open boxes + lines
for (const y of [296, 386]) {
  shape(roundRect(96, y, 156, y + 60, 12), '#633806');
  shape(roundRect(106, y + 10, 146, y + 50, 6), '#FAEEDA');
  shape(roundRect(182, y + 18, 416, y + 42, 12), '#854F0B');
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`Wrote ${out}`);
