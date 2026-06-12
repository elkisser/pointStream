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

// Log de errores
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});
