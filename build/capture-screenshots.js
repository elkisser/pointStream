/*
 * Captura screenshots reales de la interfaz de pointStream para el README.
 * Carga la UI en una ventana de Electron y guarda PNGs en assets/screenshots/.
 *
 * Uso: electron build/capture-screenshots.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'assets', 'screenshots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const win = new BrowserWindow({
    width: 1280,
    height: 832,
    show: true,
    backgroundColor: '#0b0e0f',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await win.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  await wait(1800); // esperar fuentes + animaciones iniciales

  async function shot(name) {
    const img = await win.webContents.capturePage();
    const file = path.join(OUT, name);
    fs.writeFileSync(file, img.toPNG());
    console.log('  guardado:', path.relative(path.join(__dirname, '..'), file));
  }

  // 1. Monitor — tema Kick (estado por defecto)
  await shot('monitor-kick.png');

  // 2. Monitor — tema Twitch (cambia colores)
  await win.webContents.executeJavaScript(
    `document.querySelector('.platform-btn[data-platform="twitch"]').click(); true;`
  );
  await wait(700);
  await shot('monitor-twitch.png');

  // 3. Panel de Predicciones CS2
  await win.webContents.executeJavaScript(
    `document.querySelector('.platform-btn[data-platform="kick"]').click();
     document.querySelector('.tab-btn[data-tab="predictions"]').click(); true;`
  );
  await wait(700);
  await shot('predicciones.png');

  console.log('Screenshots listas en assets/screenshots/');
  win.destroy();
  app.quit();
}).catch((err) => {
  console.error('Error capturando screenshots:', err);
  app.exit(1);
});
