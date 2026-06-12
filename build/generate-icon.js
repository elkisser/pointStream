/*
 * Generador del icono de la aplicación.
 * Crea un icono con el logo "K" estilo Kick (cuadrado verde con K oscura).
 * Genera: assets/icon.png (256x256) y build/icon.ico (256x256, PNG embebido).
 *
 * Uso: node build/generate-icon.js
 * No requiere dependencias externas (usa zlib nativo de Node).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 256;
const H = 256;

// ----- Colores -----
const GREEN = [83, 252, 24, 255];   // verde Kick
const DARK = [11, 14, 15, 255];     // fondo oscuro de la K
const TRANSPARENT = [0, 0, 0, 0];

// ----- Utilidades geométricas -----
function inRoundedRect(x, y, r) {
  const cx = Math.min(Math.max(x, r), W - 1 - r);
  const cy = Math.min(Math.max(y, r), H - 1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// Forma de la letra K
function isK(x, y) {
  // Barra vertical
  if (x >= 86 && x <= 112 && y >= 74 && y <= 182) return true;
  // Diagonal superior
  if (distToSegment(x, y, 110, 128, 168, 74) <= 14) return true;
  // Diagonal inferior
  if (distToSegment(x, y, 110, 128, 178, 182) <= 14) return true;
  return false;
}

// ----- Construir buffer RGBA -----
function buildPixels() {
  const raw = Buffer.alloc(H * (1 + W * 4)); // 1 byte de filtro por fila
  let p = 0;
  for (let y = 0; y < H; y++) {
    raw[p++] = 0; // filtro None
    for (let x = 0; x < W; x++) {
      let color;
      if (!inRoundedRect(x, y, 52)) {
        color = TRANSPARENT;
      } else if (isK(x, y)) {
        color = DARK;
      } else {
        color = GREEN;
      }
      raw[p++] = color[0];
      raw[p++] = color[1];
      raw[p++] = color[2];
      raw[p++] = color[3];
    }
  }
  return raw;
}

// ----- CRC32 (para chunks PNG) -----
const crcTable = (() => {
  const t = [];
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

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function buildPng() {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; // compresión
  ihdr[11] = 0; // filtro
  ihdr[12] = 0; // entrelazado
  const idat = zlib.deflateSync(buildPixels(), { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngToIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reservado
  header.writeUInt16LE(1, 2); // tipo icono
  header.writeUInt16LE(1, 4); // cantidad de imágenes
  const entry = Buffer.alloc(16);
  entry[0] = 0; // ancho 256 -> 0
  entry[1] = 0; // alto 256 -> 0
  entry[2] = 0; // paleta
  entry[3] = 0; // reservado
  entry.writeUInt16LE(1, 4);  // planos
  entry.writeUInt16LE(32, 6); // bits por pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(6 + 16, 12);
  return Buffer.concat([header, entry, png]);
}

// ----- Escribir archivos -----
const png = buildPng();
const ico = pngToIco(png);

const assetsDir = path.join(__dirname, '..', 'assets');
const buildDir = __dirname;
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

fs.writeFileSync(path.join(assetsDir, 'icon.png'), png);
fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);
fs.writeFileSync(path.join(buildDir, 'icon.png'), png);

console.log('Icono generado:');
console.log('  assets/icon.png  (' + png.length + ' bytes)');
console.log('  build/icon.ico   (' + ico.length + ' bytes)');
console.log('  build/icon.png   (' + png.length + ' bytes)');
