const { app, BrowserWindow, ipcMain, Notification, shell, Menu, session } = require('electron');
const path = require('path');
const axios = require('axios');

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

// ============================================================
// Monitoreo de predicciones: avisa cuando se abre una nueva
// ============================================================

let predMonitorInterval = null;
let isPredMonitoring = false;
let knownPredictions = new Map();    // sig -> pred completo, para poder usar datos al cerrar
let notifiedPredictions = new Set(); // predicciones ya notificadas por Telegram (no repetir)
let recentlyClosed = new Map();      // sig -> timestamp, cooldown 5min para no re-notificar

// La firma prioriza el ID de Forg1 si existe (estable ante cambios de texto/odds).
// Fallback: equipos ordenados o la pregunta.
function predictionSignature(pred) {
  if (pred.id) return `forg1::${pred.id}`;
  const teams = (pred.teams || [])
    .map(t => (t.name || '').toLowerCase().trim().replace(/\s+/g, ''))
    .sort()
    .join('::');
  // Fallback: si no hay equipos, usar la pregunta
  if (!teams) return (pred.question || '').toLowerCase().trim();
  return teams;
}

// ----- Telegram: armado y envío de avisos de predicciones -----
function escTg(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Construye el mensaje HTML para Telegram con la estadística y la recomendación.
function buildPredictionMessage(pred, a, isNew) {
  const predType = pred.predType || 'team-matchup';
  const lines = [isNew ? '🆕 <b>Nueva predicción en Forg1</b>' : '⏳ <b>Predicción en curso</b>'];

  // Competencia detectada
  if (a && a.sharedEvent) lines.push(`🏆 <b>${escTg(a.sharedEvent)}</b>`);

  if (pred.question) lines.push(`❓ <i>${escTg(pred.question)}</i>`);

  // Si tiene múltiples mercados, mostrar cada uno con sus selecciones
  if (pred.markets && pred.markets.length > 1) {
    for (let mi = 0; mi < pred.markets.length; mi++) {
      const m = pred.markets[mi];
      lines.push('');
      lines.push(`📌 <b>${escTg(m.question)}</b>`);
      const mOpts = m.selections || [];
      for (const o of mOpts) {
        lines.push(`  • ${escTg(o.name || o.label)} — ${escTg(o.percentage || '—')}`);
      }
    }
  } else {
    // Mercado único: mostrar TODAS las opciones
    const opts = pred.options || pred.teams || [];
    if (opts.length > 0) {
      lines.push('');
      if (predType === 'kills-range') {
      // Predicción de rangos de kills
      lines.push(`🎯 <b>Opciones:</b>`);
      for (const o of opts) {
        lines.push(`  • ${escTg(o.name)} — ${escTg(o.percentage || '—')}`);
      }
      lines.push('');
      lines.push(`👥 <b>Recomendación:</b> guiate por el % de la comunidad.`);
      lines.push(`ℹ️ Este tipo de predicción no tiene análisis de stats disponible.`);
    } else if (predType === 'yes-no') {
      lines.push(`🎯 <b>Opciones:</b>`);
      for (const o of opts) {
        lines.push(`  • ${escTg(o.name)} — ${escTg(o.percentage || '—')}`);
      }
      lines.push('');
      lines.push(`👥 Sin análisis de stats para esta predicción — guiate por la comunidad.`);
    } else if (predType === 'ot' && opts.length > 2) {
      // 3 opciones: equipo A / OT / equipo B
      lines.push(`🎮 <b>Opciones con OT:</b>`);
      for (const o of opts) {
        lines.push(`  • ${escTg(o.name)} — ${escTg(o.percentage || '—')}`);
      }
      if (a && a.recommendation) {
        lines.push('');
        const icon = a.verdictLevel === 'green' ? '✅' : a.verdictLevel === 'yellow' ? '⚠️' : '🛑';
        lines.push(`${icon} <b>Equipos: ${escTg(a.team1?.name)} vs ${escTg(a.team2?.name)}</b> (sin considerar OT)`);
        if (a.verdict) lines.push(`🧠 ${escTg(a.verdict)}`);
      }
    } else if (predType === 'team-matchup' && opts.length === 2) {
      const t1 = opts[0], t2 = opts[1];
      lines.push(`🎮 <b>${escTg(t1.name)}</b> vs <b>${escTg(t2.name)}</b>`);
      lines.push(`👥 Comunidad: ${escTg(t1.percentage || '—')} / ${escTg(t2.percentage || '—')}`);

      if (a && a.dataQuality && a.dataQuality !== 'none' && a.recommendation) {
        const icon = a.verdictLevel === 'green' ? '✅' : a.verdictLevel === 'yellow' ? '⚠️' : a.verdictLevel === 'red' ? '🛑' : 'ℹ️';
        lines.push('');
        lines.push(`${icon} <b>Apostar a: ${escTg(a.recommendation)}</b> (${a.confidence}%)`);
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
          lines.push('');
          lines.push('📊 <b>Estadísticas (HLTV)</b>');
          lines.push(stat.join('\n'));
        }
      } else {
        lines.push('');
        lines.push('ℹ️ Sin stats de HLTV — guiate por el % de la comunidad (conectá HLTV).');
      }
    } else {
      // Otro tipo o más de 2 opciones sin clasificar
      lines.push(`🎯 <b>Opciones:</b>`);
      for (const o of opts) {
        lines.push(`  • ${escTg(o.name)} — ${escTg(o.percentage || '—')}`);
      }
      lines.push('');
      lines.push(`👥 Guiate por el porcentaje de la comunidad.`);
    }
  }
}

  // Apuesta del usuario si la tiene
  if (pred.myBet) {
    lines.push('');
    lines.push(`💸 Tu apuesta: <b>${escTg(pred.myBet)} pts</b>${pred.myWin ? ` — ganás <b>${escTg(pred.myWin)}</b>` : ''}`);
  }

  lines.push('');
  if (pred.closesAt) {
    lines.push(`⏰ Cierra en ${escTg(pred.closesAt)}`);
  } else {
    lines.push('⏰ Predicción abierta');
  }

  return lines.join('\n');
}

// Analiza (si hay dos equipos) y envía el aviso por Telegram.
// Deduplicado: solo notifica UNA VEZ por predicción (firma única).
async function notifyTelegramForPrediction(pred, isNew) {
  if (!telegram.isConfigured()) return;
  if (!telegram.loadConfig().enabled) return;

  const sig = predictionSignature(pred);
  if (notifiedPredictions.has(sig)) {
    console.log('[Main] Ya notificada:', sig);
    return;
  }
  notifiedPredictions.add(sig);
  console.log('[Main] Notificando Telegram:', { isNew, predType: pred.predType, question: pred?.question });

  let analysis = null;
  // Solo analizar con HLTV si es un matchup de equipos profesionales
  const predType = pred.predType || 'team-matchup';
  if ((predType === 'team-matchup' || predType === 'ot') && pred.teams && pred.teams.length >= 2) {
    try {
      analysis = await analyzeMatchup(pred.teams[0].name, pred.teams[1].name);
    } catch (e) {
      console.error('[Main] Error analizando para aviso:', e.message);
    }
  }

  const msg = buildPredictionMessage(pred, analysis, isNew);
  await telegram.sendMessage(msg);
}

// Pasada de monitoreo: scrapea, detecta predicciones nuevas y notifica.
async function runPredictionScan() {
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

  // Cerradas = estaban antes y ahora desaparecieron
  for (const [sig, oldPred] of knownPredictions) {
    if (!currentMap.has(sig)) {
      console.log('[Main] Predicción cerrada:', sig);
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

        await telegram.sendMessage(msg);
      }
      notifiedPredictions.delete(sig);
      recentlyClosed.set(sig, Date.now());
    }
  }

  // Limpiar cooldowns expirados (>5 min)
  const CLOSE_COOLDOWN = 5 * 60 * 1000;
  for (const [sig, ts] of recentlyClosed) {
    if (Date.now() - ts > CLOSE_COOLDOWN) recentlyClosed.delete(sig);
  }

  // Nuevas = están ahora pero no estaban en el ciclo anterior y no en cooldown
  const fresh = preds.filter(p => {
    const sig = predictionSignature(p);
    if (knownPredictions.has(sig)) return false;
    if (recentlyClosed.has(sig)) {
      console.log('[Main] Predicción en cooldown de cierre, ignorando:', sig);
      return false;
    }
    return true;
  });
  console.log('[Main] Predicciones nuevas:', fresh.length);

  for (const p of fresh) {
    const teamsTxt = (p.teams || []).map(t => t.name).join(' vs ');
    console.log('[Main] Nueva predicción detectada:', teamsTxt);
    showNotification('🎯 Nueva predicción CS2', teamsTxt ? `${p.question || 'Predicción'} — ${teamsTxt}` : (p.question || 'Predicción abierta en Forg1'));
    await notifyTelegramForPrediction(p, true);
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
    knownPredictions = new Map((data.predictions || []).map(p => [predictionSignature(p), p]));
    if (mainWindow) {
      mainWindow.webContents.send('predictions-update', {
        ok: true, loggedIn: true, predictions: data.predictions || [], hasNew: false, newCount: 0
      });
    }

    // Notificar por Telegram las predicciones que YA están abiertas al iniciar
    if (telegram.isConfigured() && telegram.loadConfig().enabled) {
      for (const p of (data.predictions || [])) {
        await notifyTelegramForPrediction(p, false); // false = "en curso", no "nueva"
      }
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
    botUsername: telegram.BOT_USERNAME
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
    '✅ <b>pointStream</b> conectado a Telegram.\nVas a recibir acá las predicciones de Forg1 con su estadística y recomendación.'
  );
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
