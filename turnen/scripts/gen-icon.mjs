// Erzeugt ein einfaches, aber gültiges PNG-App-Icon (flächiges Emerald mit
// abgerundeten Ecken und einem simplen weißen "Turnring"-Symbol) ohne
// externe Bild-Tools - reiner PNG-Byte-Encoder über Node's zlib.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function makeIcon(size) {
  const bg = [5, 150, 105]; // emerald-600
  const fg = [255, 255, 255];
  const radius = size * 0.18;
  const rows = [];
  const cx = size / 2;
  const cy = size / 2;
  const ringR = size * 0.22;
  const ringThickness = size * 0.055;

  function insideRoundedSquare(x, y) {
    const rx = Math.min(x, size - 1 - x);
    const ry = Math.min(y, size - 1 - y);
    if (rx >= radius || ry >= radius) return true;
    const dx = radius - rx;
    const dy = radius - ry;
    return dx * dx + dy * dy <= radius * radius;
  }

  function ringDist(x, y, offsetX) {
    const dx = x - (cx + offsetX);
    const dy = y - cy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let [r, g, b] = insideRoundedSquare(x, y) ? bg : [255, 255, 255];
      let alphaOnRing = false;
      if (insideRoundedSquare(x, y)) {
        for (const offset of [-ringR * 0.65, ringR * 0.65]) {
          const d = ringDist(x, y, offset);
          if (Math.abs(d - ringR) <= ringThickness) alphaOnRing = true;
        }
        if (alphaOnRing) [r, g, b] = fg;
      }
      const idx = 1 + x * 3;
      row[idx] = r;
      row[idx + 1] = g;
      row[idx + 2] = b;
    }
    rows.push(row);
  }

  const raw = Buffer.concat(rows);
  const idat = deflateSync(raw);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor (RGB)
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

writeFileSync("public/icon-192.png", makeIcon(192));
writeFileSync("public/icon-512.png", makeIcon(512));
console.log("Icons erzeugt: public/icon-192.png, public/icon-512.png");
