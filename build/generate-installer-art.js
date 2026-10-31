/*
 * Generador del arte del instalador NSIS de PointStream.
 *
 * Dibuja el arte con HTML/CSS usando la misma identidad que la app (ui/styles.css):
 * fondo #0B0E0F, acento verde #53FC18, tipografía Inter 800 y el wordmark
 * "point" + "Stream" en verde. Se renderiza en una ventana offscreen de Electron
 * y se guarda como BMP de 24 bits (el único formato que acepta NSIS).
 *
 *   build/installerSidebar.bmp  (164 x 314) -> panel lateral de bienvenida / fin
 *   build/installerHeader.bmp   (150 x 57)  -> cabecera (a la derecha) de páginas internas
 *
 * El fondo de la cabecera es exactamente #0B0E0F, el mismo MUI_BGCOLOR que define
 * build/installer.nsh, así la imagen se funde con la franja superior.
 *
 * Uso: electron build/generate-installer-art.js
 */
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('high-dpi-support', '1');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));

function iconDataUrl() {
  const src = fs.existsSync(path.join(ROOT, 'assets', 'icon_hd.png'))
    ? path.join(ROOT, 'assets', 'icon_hd.png')
    : path.join(ROOT, 'assets', 'icon.png');
  const img = nativeImage.createFromPath(src);
  if (img.isEmpty()) throw new Error('No se pudo cargar el icono: ' + src);
  return img.resize({ width: 256, height: 256, quality: 'best' }).toDataURL();
}

const BASE_CSS = `
  @font-face { font-family: 'InterLocal'; src: local('Inter'), local('Inter ExtraBold'); }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { margin: 0; background: #0b0e0f; overflow: hidden; }
  /* El lienzo tiene tamaño fijo en px: no depende del tamaño real de la ventana. */
  #art {
    position: absolute; left: 0; top: 0; overflow: hidden;
    font-family: 'Inter', 'InterLocal', 'Segoe UI', sans-serif;
    color: #fff;
    -webkit-font-smoothing: antialiased;
  }
  .accent { color: #53fc18; }
`;

function sidebarHtml(icon) {
  return `<!doctype html><html><head><meta charset="utf-8">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;800&display=block" rel="stylesheet">
  <style>${BASE_CSS}
    #art {
      width: 164px; height: 314px;
      background:
        radial-gradient(130px 130px at 50% 80px, rgba(83,252,24,0.22), transparent 70%),
        radial-gradient(160px 120px at 100% 100%, rgba(83,252,24,0.07), transparent 70%),
        linear-gradient(180deg, #12181b 0%, #0b0e0f 55%, #090c0d 100%);
      display: flex; flex-direction: column; align-items: center;
    }
    .icon {
      margin-top: 32px; width: 64px; height: 64px; border-radius: 16px;
      background: url(${icon}) center / cover;
      box-shadow: 0 0 0 1px rgba(83,252,24,0.45), 0 10px 30px rgba(83,252,24,0.28);
    }
    h1 { margin-top: 14px; font-size: 21px; font-weight: 800; letter-spacing: -0.03em; }
    .rule { margin: 9px 0 10px; width: 34px; height: 3px; border-radius: 3px; background: #53fc18; box-shadow: 0 0 10px rgba(83,252,24,0.6); }
    .tag { font-size: 10.5px; font-weight: 500; line-height: 1.5; color: #b6bcc0; text-align: center; padding: 0 16px; }
    .chips { margin-top: 14px; display: flex; flex-direction: column; gap: 5px; align-items: center; }
    .chip { font-size: 9.5px; font-weight: 600; color: #d8ddd9; padding: 2px 9px; border-radius: 999px;
            background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); }
    .chip b { color: #53fc18; font-weight: 800; }
    .foot { position: absolute; bottom: 12px; left: 0; right: 0; text-align: center;
            font-size: 9px; font-weight: 600; color: #6c757a; letter-spacing: 0.1em; }
  </style></head><body><div id="art">
    <div class="icon"></div>
    <h1>point<span class="accent">Stream</span></h1>
    <div class="rule"></div>
    <div class="tag">Streams de Kick y Twitch<br>+ predicciones de CS2</div>
    <div class="chips">
      <div class="chip"><b>●</b> Avisos en vivo</div>
      <div class="chip"><b>●</b> Stats HLTV · Valve</div>
      <div class="chip"><b>●</b> Telegram</div>
    </div>
    <div class="foot">VERSIÓN ${pkg.version}</div>
  </div></body></html>`;
}

function headerHtml(icon) {
  return `<!doctype html><html><head><meta charset="utf-8">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@800&display=block" rel="stylesheet">
  <style>${BASE_CSS}
    #art { width: 150px; height: 57px; display: flex; align-items: center; justify-content: flex-end;
           gap: 8px; padding-right: 10px; box-sizing: border-box;
           background: radial-gradient(70px 50px at 122px 28px, rgba(83,252,24,0.14), transparent 70%), #0b0e0f; }
    h1 { font-size: 14px; font-weight: 800; letter-spacing: -0.03em; }
    .icon { width: 36px; height: 36px; border-radius: 9px; background: url(${icon}) center / cover;
            box-shadow: 0 0 0 1px rgba(83,252,24,0.4); }
  </style></head><body><div id="art">
    <h1>point<span class="accent">Stream</span></h1>
    <div class="icon"></div>
  </div></body></html>`;
}

async function render(html, width, height) {
  // Windows impone un tamaño mínimo de ventana, así que la ventana es más grande
  // que el arte y se recorta exactamente el rectángulo de #art.
  const win = new BrowserWindow({
    width: Math.max(width, 400) + 20, height: Math.max(height, 400) + 20, useContentSize: true, show: false, frame: false,
    backgroundColor: '#0b0e0f',
    webPreferences: { offscreen: true, javascript: true }
  });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    // Esperar la fuente Inter (si no hay red, cae a Segoe UI) y un frame pintado.
    await win.webContents.executeJavaScript(
      'Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 4000))]).then(() => new Promise(r => setTimeout(r, 300)))'
    );
    const img = await win.webContents.capturePage({ x: 0, y: 0, width, height });
    const size = img.getSize();
    if (size.width !== width || size.height !== height) {
      throw new Error(`Captura de ${size.width}x${size.height}, se esperaba ${width}x${height} (revisar escala de pantalla)`);
    }
    return img.toBitmap(); // BGRA
  } finally {
    win.destroy();
  }
}

// BMP 24 bits BI_RGB (filas de abajo hacia arriba), a partir de un bitmap BGRA.
function writeBMP(filePath, width, height, bgra) {
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const imgSize = rowSize * height;
  const buf = Buffer.alloc(54 + imgSize);
  buf.write('BM', 0);
  buf.writeUInt32LE(54 + imgSize, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(imgSize, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    let p = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Componer sobre #0B0E0F por si algún pixel quedó con alfa.
      const a = bgra[i + 3] / 255;
      buf[p++] = Math.round(bgra[i] * a + 15 * (1 - a));
      buf[p++] = Math.round(bgra[i + 1] * a + 14 * (1 - a));
      buf[p++] = Math.round(bgra[i + 2] * a + 11 * (1 - a));
    }
  }
  fs.writeFileSync(filePath, buf);
}

app.whenReady().then(async () => {
  try {
    const icon = iconDataUrl();
    writeBMP(path.join(__dirname, 'installerSidebar.bmp'), 164, 314, await render(sidebarHtml(icon), 164, 314));
    writeBMP(path.join(__dirname, 'installerHeader.bmp'), 150, 57, await render(headerHtml(icon), 150, 57));
    console.log('[ART] Arte del instalador generado:');
    console.log('  build/installerSidebar.bmp (164x314)');
    console.log('  build/installerHeader.bmp  (150x57)');
    app.quit();
  } catch (err) {
    console.error('[ART] Error generando arte NSIS:', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => { /* no salir hasta terminar */ });
