// Genera icon-192.png / icon-512.png sin dependencias (escudo amarillo con "P" sobre verde).
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };

// Coordenadas en un lienzo 512x512.
const inShield = (x, y) => {
  if (y < 96 || y > 420) return false;
  const half = y < 150 ? 144 * ((y - 96) / 54) * 0.4 + 0 : 144; // hombros
  if (y < 150) return Math.abs(x - 256) <= 144 * ((y - 96) / 54);
  if (y <= 260) return Math.abs(x - 256) <= 144;
  const t = (y - 260) / 160; // punta redondeada
  return Math.abs(x - 256) <= 144 * Math.sqrt(Math.max(0, 1 - t * t)) && half > 0;
};
const inP = (x, y) => {
  if (x >= 216 && x <= 250 && y >= 190 && y <= 346) return true; // asta
  const dx = x - 266, dy = y - 240, r = Math.hypot(dx, dy);
  return x >= 250 && r <= 67 && r >= 33; // panza
} ;
const bar = (x, y) => (y >= 173 && y <= 207 && x >= 250 && x <= 266) || (y >= 273 && y <= 307 && x >= 250 && x <= 266);

function png(size) {
  const S = 2, raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let sh = 0, p = 0;
      for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) {
        const x = ((px + (a + .5) / S) / size) * 512, y = ((py + (b + .5) / S) / size) * 512;
        const s = inShield(x, y); if (s) { sh++; if (inP(x, y) || bar(x, y)) p++; }
      }
      const n = S * S, o = py * (size * 4 + 1) + 1 + px * 4;
      const bg = [11, 93, 75], yl = [255, 199, 44];
      const k = sh / n, q = p / n; // mezcla: verde -> amarillo -> verde (P)
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(bg[i] * (1 - k) + yl[i] * k * (1 - q) + bg[i] * k * q);
      raw[o + 3] = 255;
    }
  }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(size, 0); ih.writeUInt32BE(size, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [192, 512]) writeFileSync(new URL(`../public/icon-${s}.png`, import.meta.url), png(s));
