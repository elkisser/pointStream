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
    frame: true,
    titleBarStyle: 'default'
  });

  mainWindow.loadFile('ui/index.html');
  
  // Abrir DevTools en modo desarrollo
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (monitorInterval) {
      clearInterval(monitorInterval);
    }
  });
}

app.whenReady().then(() => {
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
// API de Kick
// ============================================================

async function checkStreamStatus(streamerName) {
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
    console.error(`Error checking ${streamerName}:`, error.message);
    return { isLive: false, error: error.message };
  }
}

function openInBrave(streamerName) {
  const url = `https://kick.com/${streamerName}`;
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

ipcMain.handle('check-stream', async (event, streamerName) => {
  return await checkStreamStatus(streamerName);
});

ipcMain.handle('open-stream', async (event, streamerName) => {
  return openInBrave(streamerName);
});

ipcMain.handle('start-monitoring', async (event, config) => {
  if (isMonitoring) {
    return { success: false, message: 'Ya está monitoreando' };
  }

  isMonitoring = true;
  const { streamers, interval, autoOpen, notifications } = config;

  // Inicializar estados
  openedStreamers.clear();
  streamers.forEach(name => {
    currentStreamers.set(name, false);
  });

  // Función de monitoreo
  const monitor = async () => {
    for (const streamerName of streamers) {
      const status = await checkStreamStatus(streamerName);
      const wasLive = currentStreamers.get(streamerName);

      // Enviar actualización a la UI
      mainWindow.webContents.send('stream-update', {
        streamer: streamerName,
        ...status
      });

      if (status.isLive && !wasLive) {
        // Stream acaba de empezar
        console.log(`🔴 ${streamerName} está EN VIVO!`);

        // Notificación
        if (notifications) {
          showNotification(
            `🔴 ${streamerName} está en vivo!`,
            status.title
          );
        }

        // Abrir automáticamente solo si no se abrió antes para esta sesión en vivo
        if (autoOpen && !openedStreamers.has(streamerName)) {
          openInBrave(streamerName);
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
// Predicciones CS2 - HLTV Analysis + Forg1 Scraper
// ============================================================

const { analyzeMatchup } = require('./hltv');
const { scrapeForg1Predictions, openForg1Login } = require('./forg1-scraper');

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
            analysis,
            crowdVsData: getCrowdComparison(pred, analysis)
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

function getCrowdComparison(prediction, analysis) {
  if (!analysis || !analysis.team1 || !prediction.teams[0]) return null;

  // Si no hay datos de HLTV, no tiene sentido comparar
  if (analysis.dataQuality === 'none') return null;

  const crowdT1 = parseInt(prediction.teams[0].percentage) || 50;
  const crowdT2 = parseInt(prediction.teams[1]?.percentage) || (100 - crowdT1);
  const dataT1 = analysis.team1.probability || 50;
  const dataT2 = analysis.team2.probability || 50;

  const diffT1 = dataT1 - crowdT1;

  let verdict = '';
  let hasValue = false;
  if (Math.abs(diffT1) >= 12) {
    hasValue = true;
    if (diffT1 > 0) {
      verdict = `🎯 VALUE en ${prediction.teams[0].name}: el crowd le da ${crowdT1}% pero los datos dicen ${dataT1}%. El multiplicador está inflado a tu favor.`;
    } else {
      verdict = `🎯 VALUE en ${prediction.teams[1].name}: el crowd le da ${crowdT2}% pero los datos dicen ${dataT2}%. El multiplicador está inflado a tu favor.`;
    }
  } else {
    verdict = `El crowd y los datos coinciden bastante (diferencia ${Math.abs(diffT1)}%). No hay value escondido: apostá al favorito por seguridad.`;
  }

  return { crowdT1, crowdT2, dataT1, dataT2, diffT1, verdict, hasValue };
}

// Log de errores
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});
