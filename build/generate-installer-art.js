/*
 * Generador del arte del instalador NSIS de pointStream.
 * Crea imágenes BMP (24 bits) sin dependencias externas:
 *   build/installerSidebar.bmp   (164 x 314) -> páginas de bienvenida/fin
 *   build/installerHeader.bmp    (150 x 57)  -> cabecera de páginas internas
 *
 * Uso: node build/generate-installer-art.js
 */
const fs = require('fs');
const path = require('path');

const GREEN = [83, 252, 24];
const INK = [6, 33, 10];

// Mezcla lineal entre dos colores
function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// ----- Escritura BMP 24 bits (BI_RGB) -----
function writeBMP(filePath, width, height, getPixel) {
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const imgSize = rowSize * height;
  const fileSize = 54 + imgSize;
  const buf = Buffer.alloc(fileSize);

  buf.write('BM', 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(54, 10);     // offset a los datos
  buf.writeUInt32LE(40, 14);     // tamaño cabecera DIB
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);      // planos
  buf.writeUInt16LE(24, 28);     // bits por pixel
  buf.writeUInt32LE(0, 30);      // sin compresión
  buf.writeUInt32LE(imgSize, 34);
  buf.writeInt32LE(2835, 38);    // resolución (72 dpi)
  buf.writeInt32LE(2835, 42);
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);

  // Las filas BMP se almacenan de abajo hacia arriba
  for (let y = 0; y < height; y++) {
    const fileRow = height - 1 - y;
    let p = 54 + fileRow * rowSize;
    for (let x = 0; x < width; x++) {
      const c = getPixel(x, y);
      buf[p++] = c[2]; // B
      buf[p++] = c[1]; // G
      buf[p++] = c[0]; // R
    }
  }

  fs.writeFileSync(filePath, buf);
}

// ----- Logo "P" en un espacio local 0..99 -----
function inRoundedRect(x, y, w, h, r) {
  const cx = Math.min(Math.max(x, r), w - 1 - r);
  const cy = Math.min(Math.max(y, r), h - 1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function isP(lx, ly) {
  // Asta vertical
  if (lx >= 36 && lx <= 46 && ly >= 27 && ly <= 74) return true;
  // Bucle superior (anillo recortado)
  const dx = lx - 48.4;
  const dy = ly - 40.6;
  const d = Math.hypot(dx, dy);
  if (d <= 16.4 && d >= 6.6 && ly <= 52) return true;
  return false;
}

// Devuelve color del logo o null si está fuera del cuadrado redondeado
function logoPixel(lx, ly) {
  if (!inRoundedRect(lx, ly, 100, 100, 24)) return null;
  if (isP(lx, ly)) return INK;
  return GREEN;
}

// ----- Fondo: degradado oscuro con leve brillo verde -----
function bgPixel(x, y, w, h, glowX, glowY, glowR) {
  const t = y / (h - 1);
  let base = mix([13, 16, 17], [9, 12, 13], t); // arriba un poco más claro
  // Brillo verde radial suave
  const d = Math.hypot(x - glowX, y - glowY);
  if (d < glowR) {
    const g = (1 - d / glowR) * 0.18;
    base = mix(base, GREEN, g);
  }
  return base;
}

// ----- Sidebar 164 x 314 -----
function drawSidebar() {
  const W = 164, H = 314;
  const logoSize = 88;
  const logoX0 = Math.round((W - logoSize) / 2);
  const logoY0 = 74;

  writeBMP(path.join(__dirname, 'installerSidebar.bmp'), W, H, (x, y) => {
    // Logo
    if (x >= logoX0 && x < logoX0 + logoSize && y >= logoY0 && y < logoY0 + logoSize) {
      const lx = ((x - logoX0) / logoSize) * 100;
      const ly = ((y - logoY0) / logoSize) * 100;
      const col = logoPixel(lx, ly);
      if (col) return col;
    }
    // Línea de acento debajo del logo
    if (y >= 182 && y <= 184 && x >= 52 && x <= 112) return GREEN;

    return bgPixel(x, y, W, H, W / 2, 118, 150);
  });
}

// ----- Header 150 x 57 -----
function drawHeader() {
  const W = 150, H = 57;
  const logoSize = 40;
  const logoX0 = 12;
  const logoY0 = Math.round((H - logoSize) / 2);

  writeBMP(path.join(__dirname, 'installerHeader.bmp'), W, H, (x, y) => {
    if (x >= logoX0 && x < logoX0 + logoSize && y >= logoY0 && y < logoY0 + logoSize) {
      const lx = ((x - logoX0) / logoSize) * 100;
      const ly = ((y - logoY0) / logoSize) * 100;
      const col = logoPixel(lx, ly);
      if (col) return col;
    }
    return bgPixel(x, y, W, H, 30, H / 2, 90);
  });
}

drawSidebar();
drawHeader();

console.log('Arte del instalador generado:');
console.log('  build/installerSidebar.bmp (164x314)');
console.log('  build/installerHeader.bmp  (150x57)');
