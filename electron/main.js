const { app, BrowserWindow, ipcMain, Notification, shell, Menu, session } = require('electron');
const path = require('path');
const axios = require('axios');
const configStore = require('./config-store');
const { createSeriesTracker, SERIES_STATUS } = require('./series-tracker');

const seriesTracker = createSeriesTracker();

// Deshabilitar aceleración de hardware y sandbox de GPU en Windows para evitar que
// reCAPTCHA / Cloudflare Turnstile en id.kick.com provoquen crashes de proceso
// (STATUS_BREAKPOINT / 0x80000003 / exitCode: -2147483645).
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-sandbox');

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

        // Abrir automáticamente solo la primera vez que pasa a live en esta sesión.
        // No se vuelve a abrir aunque el monitor siga corriendo.
        if (autoOpen && !openedStreamers.has(streamerName)) {
          openInBrave(streamerName, platform);
          openedStreamers.add(streamerName);
        }

        currentStreamers.set(streamerName, true);
      } else if (!status.isLive && wasLive) {
        // Stream terminó.
        console.log(`⭕ ${streamerName} ya no está en vivo`);
        currentStreamers.set(streamerName, false);
        // NO borramos de openedStreamers: si el streamer vuelve a salir en vivo
        // en la misma sesión de monitoreo, ya abrimos una pestaña y no queremos
        // abrir otra. El Set se limpia cuando el usuario detiene el monitor.
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

const { analyzeMatchup, getPlayerKillStats, openHLTVConnect, normalizeTeamName, normKey } = require('./hltv');
const { scrapeForg1Predictions, openForg1Login } = require('./forg1-scraper');
const {
  extractPlayerNameFromQuestion,
  isKillRangeLabel,
  scoreKillPrediction,
  scoreKillsDuel,
  canonicalMapName
} = require('./player-kills');
const { scoreOtPrediction } = require('./ot-analysis');
const vrs = require('./vrs');
const telegram = require('./telegram');
console.log('[Main] Módulo Telegram cargado. isConfigured:', telegram.isConfigured());

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

async function checkServicesStatus() {
  let forg1Active = false;
  let hltvActive = false;

  try {
    const forg1Ses = session.fromPartition('persist:forg1');
    const cookies = await forg1Ses.cookies.get({});
    forg1Active = cookies.some(c =>
      c.domain && c.domain.includes('forg1.com') && (
        c.name.toLowerCase().includes('session') ||
        c.name.toLowerCase().includes('auth') ||
        c.name.toLowerCase().includes('token') ||
        c.name.toLowerCase().includes('connect') ||
        c.name.toLowerCase().includes('user')
      )
    );
  } catch (e) {}

  try {
    const hltvSes = session.fromPartition('persist:hltv');
    const hltvCookies = await hltvSes.cookies.get({ domain: 'hltv.org' });
    hltvActive = hltvCookies.some(c => c.name === 'cf_clearance' && (!c.expirationDate || c.expirationDate > Date.now() / 1000));
  } catch (e) {}

  return { forg1Active, hltvActive };
}

ipcMain.handle('check-services-status', async () => {
  return await checkServicesStatus();
});

ipcMain.handle('forg1-login', async () => {
  try {
    const win = openForg1Login();
    if (win && !win.isDestroyed()) {
      win.on('closed', async () => {
        const status = await checkServicesStatus();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('services-status-update', status);
        }
      });
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('hltv-connect', async () => {
  try {
    const win = openHLTVConnect();
    if (win && !win.isDestroyed()) {
      win.on('closed', async () => {
        const status = await checkServicesStatus();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('services-status-update', status);
        }
      });
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Cuando fetchHLTV detecta que Cloudflare está bloqueando, apaga el indicador
// en la UI y avisa para que el usuario pase la verificación de nuevo.
ipcMain.on('hltv-cf-blocked', () => {
  console.warn('[Main] Cloudflare bloqueó HLTV: avisando a la UI');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('services-status-update', { hltvActive: false, cf_blocked: true });
  }
});

// ============================================================
// Monitoreo de predicciones: avisa cuando se abre una nueva
// ============================================================

let predMonitorInterval = null;
let isPredMonitoring = false;
let knownPredictions = new Map();    // sig -> pred completo, para poder usar datos al cerrar
let notifiedPredictions = new Set(); // aviso rápido ya enviado
let notifiedFull = new Set();        // análisis / pick ya enviado
let notifyingPredictions = new Set(); // envío en curso, evita duplicar escaneo vs monitor
let recentlyClosed = new Map();      // sig -> timestamp, cooldown 5min para no re-notificar
let telegramChain = Promise.resolve();

function enqueueTelegram(fn) {
  const run = telegramChain.then(fn, fn);
  telegramChain = run.then(() => {}, () => {});
  return run;
}

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(label || `timeout ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

// La firma prioriza el ID de Forg1 si existe (estable ante cambios de texto/odds).
// Fallback: equipos ordenados + mapa/pregunta para evitar colisiones entre mapas de la misma serie.
function predictionSignature(pred) {
  if (pred.id) return `forg1::${pred.id}`;
  const teams = (pred.teams || [])
    .map(t => (t.name || '').toLowerCase().trim().replace(/\s+/g, ''))
    .sort()
    .join('::');
  const mapSuffix = pred.mapNumber != null ? `::map${pred.mapNumber}` : '';
  const q = (pred.question || '').toLowerCase().trim();
  if (!teams) return q;
  return `${teams}${mapSuffix}::${q}`;
}

// ----- Telegram: armado y envío de avisos de predicciones -----
function escTg(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function listOptions(opts) {
  return (opts || []).map(o => `  • ${escTg(o.name || o.label)} — ${escTg(o.percentage || '—')}`);
}

function appendMatchupStats(lines, a, status) {
  if (!a || a.dataQuality === 'none' || !a.recommendation) {
    if (status === 'WAITING_RESULT') lines.push('🔒 Ya no se aceptan apuestas para esta predicción.');
    else if (status === 'OPEN') lines.push('ℹ️ Sin estadísticas en HLTV, BO3.gg ni el ranking de Valve — guiate por el % de la comunidad.');
    return;
  }

  const icon = a.verdictLevel === 'green' ? '✅' : a.verdictLevel === 'yellow' ? '⚠️' : a.verdictLevel === 'red' ? '🛑' : 'ℹ️';
  if (status === 'OPEN') {
    lines.push(`${icon} <b>Apostar a: ${escTg(a.recommendation)}</b>${a.confidence ? ` (${a.confidence}%)` : ''}`);
  } else {
    lines.push(`${icon} Favorito por stats: <b>${escTg(a.recommendation)}</b>${a.confidence ? ` (${a.confidence}%)` : ''}`);
  }
  if (a.team1?.probability != null && a.team2?.probability != null) {
    lines.push(`📈 Stats: ${escTg(a.team1.name)} ${a.team1.probability}% · ${escTg(a.team2.name)} ${a.team2.probability}%`);
  }
  if (a.verdict) lines.push(`🧠 ${escTg(a.verdict)}`);

  const d1 = a.team1?.data, d2 = a.team2?.data;
  const stat = [];
  if ((d1?.ranking) || (d2?.ranking)) {
    stat.push(`• Ranking: ${d1?.ranking ? '#' + d1.ranking : '—'} vs ${d2?.ranking ? '#' + d2.ranking : '—'}`);
  }
  if (d1?.winrate != null || d2?.winrate != null) {
    stat.push(`• Winrate: ${d1?.winrate != null ? d1.winrate + '%' : '—'} vs ${d2?.winrate != null ? d2.winrate + '%' : '—'}`);
  }
  if (d1 && d2 && (d1.wins + d1.losses > 0 || d2.wins + d2.losses > 0)) {
    stat.push(`• Últimos: ${d1.wins}V-${d1.losses}D vs ${d2.wins}V-${d2.losses}D`);
  }
  const ev = d1?.event || d2?.event || '';
  if (ev && (d1?.eventTotal > 0 || d2?.eventTotal > 0)) {
    const v1 = (d1?.eventTotal > 0) ? `${d1.eventWins}V-${d1.eventLosses}D` : '—';
    const v2 = (d2?.eventTotal > 0) ? `${d2.eventWins}V-${d2.eventLosses}D` : '—';
    stat.push(`• ${escTg(ev)}: ${v1} vs ${v2}`);
  }
  if (a.h2h?.total > 0) stat.push(`• H2H: ${a.h2h.team1Wins} - ${a.h2h.team2Wins}`);
  if (stat.length) {
    const srcName = a.source === 'bo3gg' ? 'BO3.gg' : (a.source === 'vrs' ? 'Ranking Valve' : 'HLTV');
    lines.push('');
    lines.push(`📊 <b>Estadísticas (${srcName})</b>`);
    lines.push(stat.join('\n'));
  }
}

function appendKillsDuelStats(lines, a, status) {
  if (a && a.kind === 'kills-duel' && a.dataQuality !== 'none') {
    const icon = a.verdictLevel === 'green' ? '✅' : a.verdictLevel === 'yellow' ? '⚠️' : 'ℹ️';
    for (const p of a.players || []) {
      const avg = p.avgKills != null ? `${p.avgKills} kills/mapa` : 'sin datos';
      const sample = p.mapsSampled ? ` · ${p.mapsSampled} mapas` : '';
      lines.push(`  • ${escTg(p.name)} — ${avg}${sample}${p.percentage ? ` · comunidad ${escTg(p.percentage)}` : ''}`);
    }
    lines.push('');
    if (a.recommendation) {
      const verb = status === 'OPEN' ? 'Apostar a' : 'Más propenso';
      lines.push(`${icon} <b>${verb}: ${escTg(a.recommendation)}</b>${a.confidence ? ` (${a.confidence}%)` : ''}`);
    }
    if (a.verdict) lines.push(`🧠 ${escTg(a.verdict)}`);
    return;
  }
  lines.push('ℹ️ Sin promedio de kills de estos jugadores — guiate por el % de la comunidad.');
}

function appendKillStats(lines, a, status) {
  if (a && a.kind === 'kills' && a.dataQuality !== 'none') {
    const icon = a.verdictLevel === 'green' ? '✅' : a.verdictLevel === 'yellow' ? '⚠️' : 'ℹ️';
    lines.push(`📊 <b>${escTg(a.playerName)}</b> · ${a.avgKills} kills/mapa (últimos ${a.mapsSampled})`);
    if (a.typicalLow != null && a.typicalHigh != null) {
      lines.push(`📉 Rango habitual: ${a.typicalLow}–${a.typicalHigh}`);
    }
    if (a.recommendation) {
      const verb = status === 'OPEN' ? 'Apostar a' : 'Más probable';
      lines.push(`${icon} <b>${verb}: ${escTg(a.recommendation)}</b>${a.hitRate != null ? ` (${a.hitRate}% de mapas recientes)` : ''}`);
    }
    if (a.verdict) lines.push(`🧠 ${escTg(a.verdict)}`);
    return;
  }
  lines.push('ℹ️ Sin promedio de kills del jugador — guiate por el % de la comunidad.');
}

function buildPredictionMessage(pred, a, isNew, extra = {}) {
  const predType = pred.predType || 'team-matchup';
  const status = pred.status || 'OPEN';
  const lines = [];

  if (!extra.skipHeader) {
    if (status === 'WAITING_RESULT') lines.push('🔒 <b>Cerrada — esperando resultado</b>');
    else if (status === 'RESOLVED') lines.push('🏁 <b>Predicción finalizada</b>');
    else if (status === 'UNKNOWN') lines.push('ℹ️ <b>Predicción CS2</b>');
    else lines.push(isNew ? '🆕 <b>Nueva predicción abierta</b>' : '🟢 <b>Predicción abierta</b>');
  }

  if (a && a.sharedEvent) lines.push(`🏆 <b>${escTg(a.sharedEvent)}</b>`);
  if (pred.mapNumber != null) {
    lines.push(`🗺️ <b>Mapa ${pred.mapNumber}</b>${pred.mapName ? ` (<i>${escTg(pred.mapName)}</i>)` : ''}`);
  }
  if (pred.seriesScore && (pred.seriesScore.team1 > 0 || pred.seriesScore.team2 > 0)) {
    lines.push(`⚔️ Serie: <b>${pred.seriesScore.team1} - ${pred.seriesScore.team2}</b>${pred.format && pred.format !== 'UNKNOWN' ? ` (${pred.format})` : ''}`);
  }

  if (pred.question) lines.push(`❓ <b>${escTg(pred.question)}</b>`);
  if (status === 'RESOLVED' && pred.result) {
    lines.push(`🏆 Ganador oficial: <b>${escTg(pred.result)}</b>`);
  }

  const opts = pred.options || pred.teams || [];
  lines.push('');

  if (pred.markets && pred.markets.length > 1) {
    for (const m of pred.markets) {
      lines.push(`📌 <b>${escTg(m.question)}</b>`);
      lines.push(...listOptions(m.selections || []));
      if (m.status === 'RESOLVED' && m.result) {
        lines.push(`  🏆 Resultado: <b>${escTg(m.result)}</b>`);
      }
      lines.push('');
    }
  } else if (predType === 'kills-range') {
    lines.push('🎯 <b>Rangos</b>');
    lines.push(...listOptions(opts));
    lines.push('');
    appendKillStats(lines, a, status);
  } else if (predType === 'kills-duel') {
    lines.push('🔫 <b>Quién mata más</b>');
    lines.push('');
    appendKillsDuelStats(lines, a, status);
  } else if (predType === 'ot-count') {
    lines.push('⏱️ <b>¿Hay overtime?</b>');
    const probs = (a && a.kind === 'ot' && a.optionProbs) || [];
    lines.push(...opts.map(o => {
      const p = probs.find(x => x.label === (o.name || o.label));
      return `  • ${escTg(o.name || o.label)} — comunidad ${escTg(o.percentage || '—')}${p ? ` · stats ${p.probability}%` : ''}`;
    }));
    lines.push('');
    if (a && a.kind === 'ot' && a.recommendation) {
      const icon = a.verdictLevel === 'green' ? '✅' : a.verdictLevel === 'yellow' ? '⚠️' : 'ℹ️';
      lines.push(`${icon} <b>${status === 'OPEN' ? 'Apostar a' : 'Más probable'}: ${escTg(a.recommendation)}</b> (${a.confidence}%)`);
      lines.push(`🧠 ${escTg(a.verdict)}`);
      if (a.factors && a.factors[0]) lines.push(escTg(a.factors[0]));
    } else {
      lines.push(`ℹ️ ${escTg((a && a.verdict) || 'Sin marcadores recientes de estos equipos — guiate por el % de la comunidad.')}`);
    }
  } else if (predType === 'yes-no') {
    lines.push('🎯 <b>Opciones</b>');
    lines.push(...listOptions(opts));
    lines.push('');
    lines.push('👥 Sin análisis de stats — guiate por la comunidad.');
  } else if (predType === 'ot' && opts.length > 2) {
    lines.push('🎮 <b>Opciones (incluye OT)</b>');
    lines.push(...listOptions(opts));
    lines.push('');
    appendMatchupStats(lines, a, status);
  } else if (predType === 'team-matchup' && opts.length === 2) {
    const t1 = opts[0], t2 = opts[1];
    lines.push(`🎮 <b>${escTg(t1.name)}</b> vs <b>${escTg(t2.name)}</b>`);
    lines.push(`👥 Comunidad: ${escTg(t1.percentage || '—')} / ${escTg(t2.percentage || '—')}`);
    lines.push('');
    appendMatchupStats(lines, a, status);
  } else {
    lines.push('🎯 <b>Opciones</b>');
    lines.push(...listOptions(opts));
    lines.push('');
    lines.push('👥 Guiate por el porcentaje de la comunidad.');
  }

  if (pred.myBet) {
    lines.push('');
    lines.push(`💸 Tu apuesta: <b>${escTg(pred.myBet)} pts</b>${pred.myWin ? ` — ganás <b>${escTg(pred.myWin)}</b>` : ''}`);
  }

  lines.push('');
  if (status === 'WAITING_RESULT') lines.push('🔒 Cerrada — esperando resultado');
  else if (status === 'RESOLVED') lines.push('🏁 Finalizada');
  else if (status === 'OPEN') {
    lines.push(pred.closesAt ? `🟢 ABIERTA — cierra en ${escTg(pred.closesAt)}` : '🟢 ABIERTA — podés apostar ahora');
  } else if (pred.closesAt) {
    lines.push(`⏰ Cierra en ${escTg(pred.closesAt)}`);
  }

  return lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n');
}

function collectPlayerTeamHints(pred) {
  const hints = [];
  const push = (name) => {
    if (!name) return;
    const raw = String(name).trim();
    if (!raw || isKillRangeLabel(raw) || /^ot$/i.test(raw) || /^(sí|si|no)$/i.test(raw)) return;
    const n = normalizeTeamName(raw);
    if (n && n.length >= 2 && n.length <= 40) hints.push(n);
  };
  try {
    for (const s of seriesTracker.getActiveSeries()) {
      push(s.team1 && s.team1.name);
      push(s.team2 && s.team2.name);
    }
  } catch (e) { /* tracker vacío */ }
  for (const p of knownPredictions.values()) {
    if (p.predType === 'team-matchup' || p.predType === 'ot') {
      (p.options || []).forEach(o => push(o.name || o.label));
    }
  }
  if (pred && (pred.predType === 'team-matchup' || pred.predType === 'ot')) {
    (pred.options || []).forEach(o => push(o.name || o.label));
  }
  const seen = new Set();
  return hints.filter(h => {
    const k = normKey(h);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Equipos del partido en curso: la serie actualizada más recientemente o, si no hay,
// la última predicción de "quién gana".
function currentMatchTeams() {
  try {
    const notATeam = (n) => /^(\d+\+?|no|s[ií]|ot|ninguno)$/i.test(String(n || '').trim());
    const series = seriesTracker.getActiveSeries()
      .filter(s => s.team1 && s.team2 && s.team1.name && s.team2.name)
      .filter(s => !notATeam(s.team1.name) && !notATeam(s.team2.name))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    if (series.length) return [series[0].team1.name, series[0].team2.name];
  } catch (e) { /* tracker vacío */ }
  const matchups = [...knownPredictions.values()]
    .filter(p => (p.predType === 'team-matchup' || p.predType === 'ot') && (p.options || []).length >= 2);
  const last = matchups[matchups.length - 1];
  if (!last) return [];
  return last.options.map(o => o.name).filter(n => n && !/^ot$/i.test(n)).slice(0, 2);
}

// Mapas recientes (con marcador) de los dos equipos, vía un jugador de cada roster.
async function getTeamsRecentMaps(teams) {
  // Secuencial: HLTV se consulta con una sola ventana (igual que en kills-duel).
  const perTeam = [];
  for (const team of teams) {
    const all = [];
    let roster = null;
    try { roster = await vrs.getRoster(team); } catch (e) { /* sin ranking */ }
    const players = roster ? roster.roster.slice(0, 2) : [];
    if (!players.length) console.log(`[OT] ${team}: no tengo roster en el ranking de Valve`);
    for (const player of players) {
      try {
        const s = await getPlayerKillStats(player, [roster.name || team]);
        const withScore = (s.maps || []).filter(m => m.rounds);
        console.log(`[OT] ${team} vía ${player}: ${withScore.length} mapas con marcador`);
        if (withScore.length) { all.push(...withScore); break; }
      } catch (e) {
        console.warn(`[OT] ${team} vía ${player} falló:`, e.message);
      }
    }
    perTeam.push(...all);
  }
  return perTeam;
}

async function analyzePrediction(pred) {
  const predType = pred.predType || 'team-matchup';
  const teamHints = collectPlayerTeamHints(pred);

  if (predType === 'ot-count') {
    const teams = currentMatchTeams();
    if (teams.length < 2) {
      return scoreOtPrediction(pred.options || [], [], {});
    }
    const maps = await getTeamsRecentMaps(teams);
    return scoreOtPrediction(pred.options || [], maps, { mapName: pred.mapName || null, canonicalMapName, teams });
  }

  if (predType === 'kills-range') {
    const playerName = pred.playerName || extractPlayerNameFromQuestion(pred.question || pred.title);
    if (!playerName) return null;
    const stats = await getPlayerKillStats(playerName, teamHints);
    return scoreKillPrediction(pred.options || pred.markets?.[0]?.selections || [], stats);
  }

  if (predType === 'kills-duel') {
    const names = (pred.options || pred.markets?.[0]?.selections || [])
      .map(o => o.name || o.label)
      .filter(n => n && !/^ot$/i.test(n) && !isKillRangeLabel(n) && !/^(sí|si|no)$/i.test(n));
    // Buscar todos los jugadores en paralelo para no tardar el triple.
    const stats = await Promise.all(names.map(async (name) => {
      try {
        const s = await getPlayerKillStats(name, teamHints);
        return { ...s, queryName: name, playerName: s.playerName || name };
      } catch (e) {
        return { found: false, playerName: name, queryName: name, maps: [] };
      }
    }));
    return scoreKillsDuel(pred.options || [], stats, { mapName: pred.mapName || null });
  }

  if (predType === 'team-matchup' || predType === 'ot') {
    const names = (pred.options || pred.teams || [])
      .map(t => t.name)
      .filter(n => n && !/^ot$/i.test(n) && !isKillRangeLabel(n));
    if (names.length < 2) return null;
    return analyzeMatchup(names[0], names[1]);
  }

  return null;
}

function buildQuickPredictionMessage(pred, isNew) {
  const status = pred.status || 'OPEN';
  const opts = pred.options || pred.teams || [];
  const lines = [];
  if (status === 'OPEN') lines.push(isNew ? '🆕 <b>Nueva predicción abierta</b>' : '🟢 <b>Predicción abierta</b>');
  else lines.push('ℹ️ <b>Predicción CS2</b>');
  if (pred.question) lines.push(`❓ <b>${escTg(pred.question)}</b>`);
  if (opts.length) {
    lines.push('');
    lines.push(...listOptions(opts));
  }
  lines.push('');
  lines.push('⏳ Analizando stats… te mando el pick enseguida.');
  if (pred.closesAt) lines.push(`🟢 ABIERTA — cierra en ${escTg(pred.closesAt)}`);
  else lines.push('🟢 ABIERTA — podés apostar ahora');
  return lines.join('\n');
}

async function notifyTelegramBatch(preds, isNew) {
  return enqueueTelegram(() => notifyTelegramBatchInner(preds, isNew));
}

async function notifyTelegramBatchInner(preds, isNew) {
  const cfg = telegram.loadConfig();
  if (!telegram.isConfigured() || !cfg.enabled) {
    console.log('[Main] Telegram omitido:', !telegram.isConfigured() ? 'sin vincular' : 'avisos pausados');
    return;
  }

  const work = (preds || []).filter(p => {
    // Solo se avisa lo que se puede apostar. UNKNOWN no es "abierta":
    // antes se colaban resultados viejos con estado no reconocido.
    if ((p.status || 'OPEN') !== 'OPEN') return false;
    const sig = predictionSignature(p);
    if (notifyingPredictions.has(sig)) {
      console.log('[Main] Telegram en vuelo:', sig);
      return false;
    }
    const needQuick = !notifiedPredictions.has(sig);
    const needFull = !!p.analysis && !notifiedFull.has(sig);
    return needQuick || needFull;
  });
  if (!work.length) {
    console.log('[Main] Telegram: nada pendiente de avisar');
    return;
  }

  for (const pred of work) notifyingPredictions.add(predictionSignature(pred));

  try {
    const fresh = work.filter(p => !notifiedPredictions.has(predictionSignature(p)));
    const openCount = fresh.filter(p => (p.status || 'OPEN') === 'OPEN').length;
    if (fresh.length > 1) {
      const intro = [
        isNew ? `🆕 <b>${fresh.length} predicciones nuevas en Forg1</b>` : `🎯 <b>${fresh.length} predicciones activas en Forg1</b>`,
        '',
        openCount > 0
          ? `👉 Hay <b>${openCount}</b> abierta${openCount === 1 ? '' : 's'} para apostar. Jugá <b>todas</b> las que puedas: cada una suma puntos por separado.`
          : `🔒 Las ${fresh.length} ya cerraron. Esperando resultado — cuando se abra otra, te aviso.`
      ].join('\n');
      const introRes = await telegram.sendMessage(intro);
      if (!introRes.ok) console.error('[Main] Telegram intro falló:', introRes.error);
    }

    // 1) Aviso inmediato (o pick completo si el análisis ya vino)
    await Promise.all(work.map(async (pred) => {
      const sig = predictionSignature(pred);
      console.log('[Main] Notificando Telegram:', { isNew, predType: pred.predType, question: pred?.question, sig });
      if (pred.analysis && !notifiedFull.has(sig)) {
        const sent = await telegram.sendMessage(buildPredictionMessage(pred, pred.analysis, isNew));
        if (sent.ok) {
          notifiedPredictions.add(sig);
          notifiedFull.add(sig);
        } else {
          console.error('[Main] Telegram envío falló:', sent.error);
        }
        return;
      }
      if (notifiedPredictions.has(sig)) return;
      const quick = await telegram.sendMessage(buildQuickPredictionMessage(pred, isNew));
      if (quick.ok) notifiedPredictions.add(sig);
      else console.error('[Main] Telegram aviso rápido falló:', quick.error);
    }));

    // 2) Análisis y pick — no bloquea el aviso inicial
    for (const pred of work) {
      const sig = predictionSignature(pred);
      if (notifiedFull.has(sig) || !notifiedPredictions.has(sig)) continue;
      let analysis = pred.analysis || null;
      if (!analysis) {
        try {
          analysis = await withTimeout(analyzePrediction(pred), 40000, 'análisis Telegram timeout');
        } catch (e) {
          console.error('[Main] Error analizando para aviso:', e.message);
        }
      }
      if (!analysis) continue;
      const full = await telegram.sendMessage(buildPredictionMessage(pred, analysis, isNew));
      if (full.ok) notifiedFull.add(sig);
      else console.error('[Main] Telegram análisis falló:', full.error);
    }
  } finally {
    for (const pred of work) notifyingPredictions.delete(predictionSignature(pred));
  }
}

async function notifyTelegramForPrediction(pred, isNew) {
  await notifyTelegramBatch([pred], isNew);
}

// Pasada de monitoreo: scrapea, detecta predicciones nuevas y notifica.
// Si una pasada tarda más que el intervalo (análisis HLTV + Telegram), no se
// arranca otra encima: se pisarían knownPredictions y se duplicarían avisos.
let predScanInFlight = false;
async function runPredictionScan() {
  if (predScanInFlight) {
    console.log('[Main] Pasada anterior todavía en curso, salteo esta');
    return;
  }
  predScanInFlight = true;
  try {
    await runPredictionScanInner();
  } catch (e) {
    console.error('[Main] Error en pasada de monitoreo:', e.message);
  } finally {
    predScanInFlight = false;
  }
}

async function runPredictionScanInner() {
  let data;
  try {
    data = await scrapeForg1Predictions();
  } catch (err) {
    console.error('[Main] Error scrapeando Forg1:', err.message);
    if (mainWindow) mainWindow.webContents.send('predictions-update', { ok: false, error: err.message });
    return;
  }

  if (!data.loggedIn) {
    console.log('[Main] No está logueado en Forg1');
    if (mainWindow) mainWindow.webContents.send('predictions-update', { ok: false, loggedIn: false });
    return;
  }

  const preds = data.predictions || [];
  console.log('[Main] Predicciones encontradas:', preds.length);

  // Mapa actual: sig -> pred
  const currentMap = new Map(preds.map(p => [predictionSignature(p), p]));

  // Registrar predicciones en seriesTracker
  for (const p of preds) {
    seriesTracker.upsertPrediction(p);
  }
  seriesTracker.removeExpiredSeries();

  // Cerradas = estaban antes y ahora desaparecieron
  for (const [sig, oldPred] of knownPredictions) {
    if (!currentMap.has(sig)) {
      console.log('[Main] Predicción cerrada:', sig);
      const oldPredId = oldPred.id || sig;
      const updatedSeries = seriesTracker.markPredictionClosed(oldPredId);

      if (telegram.isConfigured() && telegram.loadConfig().enabled) {
        // Usar los datos de la predicción original (antes del cierre)
        const q = oldPred.question || 'Predicción';
        const teamsTxt = (oldPred.teams || []).map(t => t.name).join(' vs ');

        // Buscar resultado en el DOM actual
        const recentResults = data.recentResults || [];
        const result = recentResults[0];

        let msg = `🔒 <b>Predicción cerrada</b>`;
        if (q && q !== 'Predicción abierta') msg += `\n❓ <i>${escTg(q)}</i>`;
        if (teamsTxt) msg += `\n⚔️ <b>${escTg(teamsTxt)}</b>`;

        if (result) {
          msg += `\n`;
          if (result.won) {
            msg += `\n🏆 <b>¡GANASTE!</b> — Ganó <b>${escTg(result.winner)}</b>`;
            if (result.pointsChange) msg += `\n💰 <b>${escTg(result.pointsChange)}</b>`;
          } else {
            msg += `\n❌ <b>Perdiste.</b> — Ganó <b>${escTg(result.winner)}</b>`;
            if (result.pointsChange) msg += `\n💸 ${escTg(result.pointsChange)}`;
          }
        } else {
          msg += `\n\nResultado aún no disponible.`;
        }

        if (updatedSeries) {
          if (updatedSeries.status === SERIES_STATUS.FINISHED) {
            msg += `\n\n🏁 <b>Serie finalizada: ${escTg(updatedSeries.team1.name)} ${updatedSeries.seriesScore.team1} - ${updatedSeries.seriesScore.team2} ${escTg(updatedSeries.team2.name)}</b>`;
          } else {
            msg += `\n\n🎮 <b>Serie activa:</b> ${escTg(updatedSeries.team1.name)} ${updatedSeries.seriesScore.team1} - ${updatedSeries.seriesScore.team2} ${escTg(updatedSeries.team2.name)}${updatedSeries.format && updatedSeries.format !== 'UNKNOWN' ? ` (${updatedSeries.format})` : ''}\n⏳ Esperando siguiente mapa...`;
          }
        }

        const closedRes = await telegram.sendMessage(msg);
        if (!closedRes.ok) console.error('[Main] Telegram aviso de cierre falló:', closedRes.error);
      }
      notifiedPredictions.delete(sig);
      notifiedFull.delete(sig);
      recentlyClosed.set(sig, Date.now());
    }
  }

  // Limpiar cooldowns expirados (>5 min)
  const CLOSE_COOLDOWN = 5 * 60 * 1000;
  for (const [sig, ts] of recentlyClosed) {
    if (Date.now() - ts > CLOSE_COOLDOWN) recentlyClosed.delete(sig);
  }

  // Nuevas = están ahora pero no estaban en el ciclo anterior y no en cooldown
  // IMPORTANTE: Solo predicciones con status OPEN califican como nuevas oportunidades para apostar
  const fresh = preds.filter(p => {
    const sig = predictionSignature(p);
    if (knownPredictions.has(sig)) return false;
    if (recentlyClosed.has(sig)) {
      console.log('[Main] Predicción en cooldown de cierre, ignorando:', sig);
      return false;
    }
    const status = p.status || 'OPEN';
    if (status !== 'OPEN') {
      console.log(`[Main] Predicción no apostable detectada (${status}), omitiendo alerta de apuesta:`, sig);
      return false;
    }
    return true;
  });
  console.log('[Main] Predicciones nuevas (OPEN):', fresh.length);

  if (fresh.length) {
    const titles = fresh.map(p => p.question || p.title).filter(Boolean).join(' · ');
    showNotification(
      fresh.length === 1 ? '🎯 Nueva predicción CS2' : `🎯 ${fresh.length} predicciones CS2`,
      titles || 'Predicciones abiertas en Forg1'
    );
    await notifyTelegramBatch(fresh, true);
  }

  // Guardar mapa completo (sig -> pred) para próximo ciclo
  knownPredictions = currentMap;

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
    knownPredictions = new Map((data.predictions || []).map(p => {
      seriesTracker.upsertPrediction(p);
      return [predictionSignature(p), p];
    }));
    if (mainWindow) {
      mainWindow.webContents.send('predictions-update', {
        ok: true, loggedIn: true, predictions: data.predictions || [], hasNew: false, newCount: 0
      });
    }

    if (telegram.isConfigured() && telegram.loadConfig().enabled) {
      telegram.sendMessage(
        '📡 <b>Monitoreo activo</b>\nTe aviso acá apenas se abra una predicción en Forg1.'
      ).then((r) => {
        if (!r.ok) console.error('[Main] Telegram aviso de monitoreo falló:', r.error);
      }).catch((e) => console.error('[Main] Telegram aviso de monitoreo falló:', e.message));
      notifyTelegramBatch(data.predictions || [], false).catch((e) => {
        console.error('[Main] Telegram en primera pasada falló:', e.message);
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
  knownPredictions = new Map();
  notifiedPredictions = new Set();
  notifiedFull = new Set();
  notifyingPredictions = new Set();
  recentlyClosed = new Map();
  return { success: true };
});

ipcMain.handle('get-predictions-monitoring-status', async () => {
  return { isMonitoring: isPredMonitoring };
});

// ============================================================
// Telegram: configuración y prueba
// ============================================================

ipcMain.handle('telegram-get-config', () => {
  const c = telegram.loadConfig();
  return {
    chatId: c.chatId,
    enabled: c.enabled,
    configured: telegram.isConfigured(),
    botUsername: telegram.BOT_USERNAME,
    lastError: telegram.getLastError()
  };
});

// Inicia la vinculación: genera el código y abre el chat del bot en el navegador.
ipcMain.handle('telegram-begin-link', () => {
  const link = telegram.beginLink();
  if (link.ok) shell.openExternal(link.url);
  return link;
});

// La UI llama repetidamente esto hasta que el usuario toca "Iniciar" en Telegram.
ipcMain.handle('telegram-poll-link', async () => {
  return await telegram.pollLink();
});

ipcMain.handle('telegram-set-enabled', (event, enabled) => {
  telegram.saveConfig({ enabled: !!enabled });
  return { ok: true, enabled: !!enabled };
});

ipcMain.handle('telegram-unlink', () => {
  return telegram.unlink();
});

ipcMain.handle('telegram-test', async () => {
  return await telegram.sendMessage(
    '✅ <b>pointStream</b> conectado a Telegram.\nVas a recibir acá cada predicción de Forg1 (pueden ser varias a la vez) con stats y recomendación.\n👉 Si hay más de una abierta, apostá en todas las que puedas.'
  );
});

// ============================================================
// Configuración Local y Streamers (Fase 7 — ISSUE-005)
// ============================================================

ipcMain.handle('config-get', async () => {
  return configStore.loadConfig();
});

ipcMain.handle('config-save', async (event, data) => {
  return configStore.saveConfig(data);
});

ipcMain.handle('config-reset', async () => {
  return configStore.resetConfig();
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

    notifyTelegramBatch(forg1Data.predictions, false).catch((e) => {
      console.error('[Main] Telegram aviso rápido en escaneo falló:', e.message);
    });

    const analyzed = [];
    for (const pred of forg1Data.predictions) {
      seriesTracker.upsertPrediction(pred);
      try {
        const analysis = await withTimeout(analyzePrediction(pred), 40000, 'análisis timeout');
        analyzed.push({ ...pred, analysis });
      } catch (err) {
        analyzed.push({ ...pred, analysis: null, error: err.message });
      }
    }

    notifyTelegramBatch(analyzed, false).catch((e) => {
      console.error('[Main] Telegram en escaneo falló:', e.message);
    });

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

module.exports = {
  predictionSignature,
  seriesTracker
};
