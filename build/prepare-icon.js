/*
 * Prepara los iconos de la app a partir de assets/icon_hd.png (el icono elegido).
 * Usa nativeImage de Electron para redimensionar a 256x256 (sin dependencias
 * externas de imagen) y genera:
 *   assets/icon.png  (256x256, icono de la ventana)
 *   build/icon.png   (256x256)
 *   build/icon.ico   (256x256, PNG embebido, para el instalador)
 *
 * Uso: electron build/prepare-icon.js
 */
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

// ----- PNG -> ICO (embebe el PNG; ancho/alto 0 = 256 según el formato ICO) -----
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

app.whenReady().then(() => {
  const srcPath = path.join(__dirname, '..', 'assets', 'icon_hd.png');
  if (!fs.existsSync(srcPath)) {
    console.error('No se encontró assets/icon_hd.png');
    app.exit(1);
    return;
  }

  const img = nativeImage.createFromPath(srcPath);
  if (img.isEmpty()) {
    console.error('No se pudo leer icon_hd.png (¿formato no soportado?)');
    app.exit(1);
    return;
  }

  const resized = img.resize({ width: 256, height: 256, quality: 'best' });
  const png = resized.toPNG();

  const assetsDir = path.join(__dirname, '..', 'assets');
  const buildDir = __dirname;

  fs.writeFileSync(path.join(assetsDir, 'icon.png'), png);
  fs.writeFileSync(path.join(buildDir, 'icon.png'), png);
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), pngToIco(png));

  console.log('Iconos preparados desde icon_hd.png:');
  console.log('  assets/icon.png  (256x256, ' + Math.round(png.length / 1024) + ' KB)');
  console.log('  build/icon.png   (256x256)');
  console.log('  build/icon.ico   (256x256)');

  app.quit();
}).catch((err) => {
  console.error('Error preparando iconos:', err);
  app.exit(1);
});
