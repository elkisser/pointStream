const { app, BrowserWindow, ipcMain, Notification, shell, Menu } = require('electron');
const path = require('path');
const axios = require('axios');

let mainWindow;
let monitorInterval = null;
let isMonitoring = false;
let currentStreamers = new Map(); // streamer -> isLive state
let openedStreamers = new Set(); // streamers cuya pestaña ya fue abierta automáticamente

function createWindow() {
  // Quitar la barra de menú nativa (File / Edit / View...)
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0e0f',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    frame: false,
    titleBarStyle: 'hidden'
  });

  mainWindow.loadFile('ui/index.html');

  // Avisar al renderer cuando cambia el estado maximizado/restaurado
  // para alternar el ícono del botón maximizar/restaurar.
  mainWindow.on('maximize', () => {
    if (mainWindow) mainWindow.webContents.send('window-state', { maximized: true });
  });
  mainWindow.on('unmaximize', () => {
    if (mainWindow) mainWindow.webContents.send('window-state', { maximized: false });
  });
  
  // Abrir DevTools en modo desarrollo
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (monitorInterval) {
      clearInterval(monitorInterval);
    }
    if (predMonitorInterval) {
      clearInterval(predMonitorInterval);
    }
  });
}

app.whenReady().then(() => {
  // Cloudflare (HLTV) rechaza el navegador y entra en bucle de verificación
  // cuando el User-Agent no coincide con la versión real de Chromium. Forzamos
  // un UA limpio de Chrome con la MISMA versión de Chromium que trae Electron,
  // sin el token "Electron", para que coincida con los client-hints (Sec-CH-UA).
  const chromeVersion = process.versions.chrome || '120.0.0.0';
  app.userAgentFallback =
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ============================================================
// API de Streams (Kick / Twitch)
// ============================================================

// Limpia un nombre de usuario para usarlo de forma segura en URLs/consultas.
function sanitizeLogin(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
}

// Despacha la verificación según la plataforma elegida.
async function checkStreamStatus(streamerName, platform = 'kick') {
  if (platform === 'twitch') {
    return checkTwitchStatus(streamerName);
  }
  return checkKickStatus(streamerName);
}

async function checkKickStatus(streamerName) {
  try {
    const response = await axios.get(
      `https://kick.com/api/v2/channels/${streamerName}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        },
        timeout: 10000
      }
    );

    if (response.status === 200) {
      const data = response.data;
      const livestream = data.livestream;

      const profilePic = data.user?.profile_pic || data.user?.profilepic || '';

      if (livestream && livestream.is_live) {
        const thumb = livestream.thumbnail || {};
        const thumbnailUrl = thumb.url || thumb.src || thumb.responsive || '';
        return {
          isLive: true,
          title: livestream.session_title || 'Sin título',
          viewers: livestream.viewer_count || 0,
          thumbnail: thumbnailUrl,
          profilePic,
          category: livestream.categories?.[0]?.name || 'Sin categoría',
          startedAt: livestream.created_at || ''
        };
      }

      return { isLive: false, profilePic };
    }

    return { isLive: false };
  } catch (error) {
    console.error(`Error checking Kick ${streamerName}:`, error.message);
    return { isLive: false, error: error.message };
  }
}

// Twitch no expone una API pública sencilla, pero su web usa un endpoint
// GraphQL con un Client-ID público bien conocido. Lo usamos para saber si
// el canal está en vivo sin necesitar credenciales OAuth.
const TWITCH_GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

async function checkTwitchStatus(streamerName) {
  const login = sanitizeLogin(streamerName);
  if (!login) return { isLive: false };

  try {
    const query = {
      query: `query {
        user(login: "${login}") {
          displayName
          profileImageURL(width: 70)
          stream {
            title
            viewersCount
            createdAt
            game { displayName }
            previewImageURL(width: 640, height: 360)
          }
        }
      }`
    };

    const response = await axios.post('https://gql.twitch.tv/gql', query, {
      headers: {
        'Client-ID': TWITCH_GQL_CLIENT_ID,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    const user = response.data?.data?.user;
    if (!user) return { isLive: false };

    const profilePic = user.profileImageURL || '';
    const stream = user.stream;

    if (stream) {
      return {
        isLive: true,
        title: stream.title || 'Sin título',
        viewers: stream.viewersCount || 0,
        thumbnail: stream.previewImageURL || '',
        profilePic,
        category: stream.game?.displayName || 'Sin categoría',
        startedAt: stream.createdAt || ''
      };
    }

    return { isLive: false, profilePic };
  } catch (error) {
    console.error(`Error checking Twitch ${streamerName}:`, error.message);
    return { isLive: false, error: error.message };
  }
}

function openInBrave(streamerName, platform = 'kick') {
  const url = platform === 'twitch'
    ? `https://www.twitch.tv/${streamerName}`
    : `https://kick.com/${streamerName}`;
  const fs = require('fs');
  const { exec } = require('child_process');

  // Rutas conocidas de Brave por plataforma
  const bravePaths = process.platform === 'win32'
    ? [
        'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
        'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser']
      : ['brave-browser', 'brave'];

  // Buscar el primer Brave existente y abrir una sola vez
  if (process.platform === 'win32') {
    const found = bravePaths.find(p => {
      try { return fs.existsSync(p); } catch (e) { return false; }
    });
    if (found) {
      exec(`"${found}" "${url}"`);
      return url;
    }
  } else if (process.platform === 'darwin') {
    exec(`open -a "Brave Browser" "${url}"`, (error) => {
      if (error) shell.openExternal(url);
    });
    return url;
  } else {
    exec(`${bravePaths[0]} "${url}"`, (error) => {
      if (error) shell.openExternal(url);
    });
    return url;
  }

  // Fallback: navegador predeterminado
  shell.openExternal(url);
  return url;
}

function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({
      title,
      body,
      icon: path.join(__dirname, '../assets/icon.png')
    }).show();
  }
}

// ============================================================
// IPC Handlers
// ============================================================

ipcMain.handle('check-stream', async (event, streamerName, platform) => {
  return await checkStreamStatus(streamerName, platform);
});

ipcMain.handle('open-stream', async (event, streamerName, platform) => {
  return openInBrave(streamerName, platform);
});

ipcMain.handle('start-monitoring', async (event, config) => {
  if (isMonitoring) {
    return { success: false, message: 'Ya está monitoreando' };
  }

  isMonitoring = true;
  const { streamers, interval, autoOpen, notifications, platform = 'kick' } = config;

  // Inicializar estados
  openedStreamers.clear();
  streamers.forEach(name => {
    currentStreamers.set(name, false);
  });

  // Función de monitoreo
  const monitor = async () => {
    for (const streamerName of streamers) {
      const status = await checkStreamStatus(streamerName, platform);
      const wasLive = currentStreamers.get(streamerName);

      // Enviar actualización a la UI
      mainWindow.webContents.send('stream-update', {
        streamer: streamerName,
        ...status
      });

      if (status.isLive && !wasLive) {
        // Stream acaba de empezar
        console.log(`🔴 ${streamerName} está EN VIVO! (${platform})`);

        // Notificación
        if (notifications) {
          showNotification(
            `🔴 ${streamerName} está en vivo!`,
            status.title
          );
        }

        // Abrir automáticamente solo si no se abrió antes para esta sesión en vivo
        if (autoOpen && !openedStreamers.has(streamerName)) {
          openInBrave(streamerName, platform);
          openedStreamers.add(streamerName);
        }

        currentStreamers.set(streamerName, true);
      } else if (!status.isLive && wasLive) {
        // Stream terminó: liberar para permitir reapertura la próxima vez
        console.log(`⭕ ${streamerName} ya no está en vivo`);
        currentStreamers.set(streamerName, false);
        openedStreamers.delete(streamerName);
      }
    }
  };

  // Ejecutar inmediatamente
  monitor();

  // Configurar intervalo
  monitorInterval = setInterval(monitor, interval * 1000);

  return { success: true, message: 'Monitoreo iniciado' };
});

ipcMain.handle('stop-monitoring', async () => {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  isMonitoring = false;
  currentStreamers.clear();
  openedStreamers.clear();
  return { success: true, message: 'Monitoreo detenido' };
});

ipcMain.handle('get-monitoring-status', async () => {
  return { isMonitoring };
});

// ============================================================
// Controles de ventana (barra de título personalizada)
// ============================================================

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// ============================================================
// Predicciones CS2 - HLTV Analysis + Forg1 Scraper
// ============================================================

const { analyzeMatchup } = require('./hltv');
const { scrapeForg1Predictions, openForg1Login } = require('./forg1-scraper');
const { openHLTVConnect } = require('./hltv');

ipcMain.handle('analyze-match', async (event, team1, team2) => {
  try {
    const analysis = await analyzeMatchup(team1, team2);
    return { success: true, data: analysis };
  } catch (error) {
    console.error('Error analizando match:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('scrape-forg1-predictions', async () => {
  try {
    const data = await scrapeForg1Predictions();
    return { success: true, data };
  } catch (error) {
    console.error('Error scrapeando forg1:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('forg1-login', async () => {
  try {
    openForg1Login();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('hltv-connect', async () => {
  try {
    openHLTVConnect();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============================================================
// Monitoreo de predicciones: avisa cuando se abre una nueva
// ============================================================

let predMonitorInterval = null;
let isPredMonitoring = false;
let knownPredictions = new Set();

function predictionSignature(pred) {
  const teams = (pred.teams || [])
    .map(t => (t.name || '').toLowerCase().trim())
    .sort()
    .join(' vs ');
  return `${(pred.question || '').toLowerCase().trim()}::${teams}`;
}

// Pasada de monitoreo: scrapea, detecta predicciones nuevas y notifica.
async function runPredictionScan() {
  let data;
  try {
    data = await scrapeForg1Predictions();
  } catch (err) {
    if (mainWindow) mainWindow.webContents.send('predictions-update', { ok: false, error: err.message });
    return;
  }

  if (!data.loggedIn) {
    if (mainWindow) mainWindow.webContents.send('predictions-update', { ok: false, loggedIn: false });
    return;
  }

  const preds = data.predictions || [];
  const currentSigs = new Set(preds.map(predictionSignature));

  // Nuevas = están ahora pero no estaban en el ciclo anterior
  const fresh = preds.filter(p => !knownPredictions.has(predictionSignature(p)));

  for (const p of fresh) {
    const teamsTxt = (p.teams || []).map(t => t.name).join(' vs ');
    showNotification('🎯 Nueva predicción CS2', teamsTxt ? `${p.question || 'Predicción'} — ${teamsTxt}` : (p.question || 'Predicción abierta en Forg1'));
  }

  knownPredictions = currentSigs;

  if (mainWindow) {
    mainWindow.webContents.send('predictions-update', {
      ok: true,
      loggedIn: true,
      predictions: preds,
      hasNew: fresh.length > 0,
      newCount: fresh.length
    });
  }
}

ipcMain.handle('start-predictions-monitoring', async (event, config = {}) => {
  if (isPredMonitoring) return { success: false, message: 'Ya está monitoreando predicciones' };

  const interval = Math.max(30, parseInt(config.interval) || 60);

  // Primera pasada: registrar las predicciones que ya existen SIN notificarlas.
  try {
    const data = await scrapeForg1Predictions();
    if (!data.loggedIn) {
      return { success: false, error: 'not-logged-in' };
    }
    knownPredictions = new Set((data.predictions || []).map(predictionSignature));
    if (mainWindow) {
      mainWindow.webContents.send('predictions-update', {
        ok: true, loggedIn: true, predictions: data.predictions || [], hasNew: false, newCount: 0
      });
    }
  } catch (e) {
    console.error('Error en primera pasada de predicciones:', e.message);
  }

  isPredMonitoring = true;
  predMonitorInterval = setInterval(runPredictionScan, interval * 1000);
  return { success: true, message: 'Monitoreo de predicciones iniciado', interval };
});

ipcMain.handle('stop-predictions-monitoring', async () => {
  if (predMonitorInterval) {
    clearInterval(predMonitorInterval);
    predMonitorInterval = null;
  }
  isPredMonitoring = false;
  knownPredictions = new Set();
  return { success: true };
});

ipcMain.handle('get-predictions-monitoring-status', async () => {
  return { isMonitoring: isPredMonitoring };
});

// Analiza automáticamente: scrapea forg1 + busca stats en HLTV
ipcMain.handle('auto-analyze-predictions', async () => {
  try {
    // 1. Scrapear predicciones de forg1
    const forg1Data = await scrapeForg1Predictions();
    
    if (!forg1Data.loggedIn) {
      return { success: false, error: 'not-logged-in', data: forg1Data };
    }

    if (!forg1Data.predictions || forg1Data.predictions.length === 0) {
      return { success: true, data: { predictions: [], message: 'No hay predicciones abiertas', raw: forg1Data.raw } };
    }

    // 2. Analizar cada predicción con HLTV
    const analyzed = [];
    for (const pred of forg1Data.predictions) {
      if (pred.teams.length >= 2) {
        const team1Name = pred.teams[0].name;
        const team2Name = pred.teams[1].name;
        
        try {
          const analysis = await analyzeMatchup(team1Name, team2Name);
          analyzed.push({
            ...pred,
            analysis
          });
        } catch (err) {
          analyzed.push({
            ...pred,
            analysis: null,
            error: err.message
          });
        }
      }
    }

    return { success: true, data: { predictions: analyzed } };
  } catch (error) {
    console.error('Error en auto-analyze:', error.message);
    return { success: false, error: error.message };
  }
});

// Log de errores
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});
