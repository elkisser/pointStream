const { BrowserWindow } = require('electron');

// Ventana persistente — se crea una sola vez y se reutiliza entre scans.
let _win = null;

function getForg1Window() {
  if (_win && !_win.isDestroyed()) return _win;

  _win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:forg1'
    }
  });

  _win.on('closed', () => { _win = null; });
  return _win;
}

/**
 * Extrae predicciones del texto plano de la página.
 * Sin whitelist rígida — detecta cualquier par (nombre + %) dinámicamente.
 */
function parsePredictions(body) {
  const UI_WORDS = new Set([
    'POOL','JUGADORES','TU JUGADA','SI GANÁS','SI GANAS','PTS','PREDICCIÓN',
    'PREDICCION','LIVE','EN VIVO','EVOLUCIÓN','EVOLUCION','POR OPCIÓN','POR OPCION',
    'CIERRA','TU ELECCIÓN','TU ELECCION','COMUNIDAD','INICIO','EXTENSIÓN',
    'EXTENSION','PREDICCIONES','TIENDA','SORTEOS','CÓDIGOS','CODIGOS',
    'LEADERBOARD','BOT 1XBET','MI PERFIL','TU BALANCE','GANÁS','GANAS',
    'APOSTAR','APUESTA','TOTAL','VS','EMPATE','RESULTADO','MAPA','MAPAS',
    'SPONSOR','OFICIAL','STUDIO','ESTUDIO','CREATED BY','PRIVACIDAD','TWITTER',
    'INSTAGRAM','YOUTUBE','FACEBOOK','CONECTAR','LEADERBOARD','SORTEO',
    'PENDIENTE','HISTORIAL','NOVEDADES','PISO9',
  ]);

  function isTimeToken(s) {
    const u = s.toUpperCase().trim();
    return /HACE\s|AHORA|\bAYER\b|\bHOY\b|^EN\s+\d|\d+\s*(H|HS|HORA|HORAS|MIN|MINUTO|MINUTOS|M|D|DÍA|DÍAS|SEG|SEGUNDOS)\b|^\d{1,2}:\d{2}$/.test(u);
  }

  function isValidOption(s) {
    if (!s) return false;
    const t = s.trim();
    if (t.length < 2 || t.length > 32) return false;
    if (!/^[A-Za-zÀ-ÿ0-9]/.test(t)) return false;
    if (!/[A-Za-zÀ-ÿ]/.test(t)) return false;
    if (/^[\d.,%:+\-]+$/.test(t)) return false;
    if (isTimeToken(t)) return false;
    if (/[./\\@#]/.test(t)) return false;   // no URLs
    if (/^\d+$/.test(t)) return false;       // no solo números
    const u = t.toUpperCase();
    if (UI_WORDS.has(u)) return false;
    for (const w of UI_WORDS) {
      if (w.length > 5 && u === w) return false;
    }
    return true;
  }

  function isPct(s) {
    return /^\d{1,3}\s*%?$/.test((s || '').trim());
  }

  const QKEYS = /gana|ganar|ganador|gane|hace|mata|kill|mapa|\bmap\b|stage|ronda|round|pistol|clutch|mvp|primer|primera|gan[aá]|m[aá]s\s|cu[aá]nt|cu[aá]l|qui[eé]n/i;

  const lines = body.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Buscar pares opción + %
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isValidOption(lines[i])) continue;
    const n1 = lines[i + 1] || '', n2 = lines[i + 2] || '';
    let pct = null;
    if (isPct(n1))      pct = parseInt(n1);
    else if (isPct(n2)) pct = parseInt(n2);
    if (pct != null && !hits.find(h => h.name === lines[i])) {
      hits.push({ name: lines[i], percentage: pct + '%', idx: i });
    }
  }

  if (hits.length < 2) return [];

  const teams = [hits[0], hits[1]].map(h => ({ name: h.name, percentage: h.percentage }));
  const firstIdx = hits[0].idx;

  // Buscar pregunta hacia arriba
  const HELP_WORDS = ['CÓMO FUNCIONA','COMO FUNCIONA','¿CÓMO','¿COMO','QUÉ ES','QUE ES',
    'AYUDA','FAQ','PREGUNTAS','REGLAS','TÉRMINOS','TERMINOS','SOPORTE','TUTORIAL',
    'CONTACTO','ACERCA','POLÍTICA','POLITICA','PRIVACIDAD','NOVEDADES','HISTORIAL'];

  function badHeading(l) {
    if (!l || l.length < 5 || l.length > 100) return true;
    if (/^[\d.,%:+\-]/.test(l)) return true;
    const u = l.toUpperCase();
    if (HELP_WORDS.some(w => u.includes(w))) return true;
    if (UI_WORDS.has(u)) return true;
    return false;
  }

  let question = '';
  for (let i = firstIdx - 1; i >= Math.max(0, firstIdx - 18); i--) {
    if (badHeading(lines[i])) continue;
    if (lines[i].endsWith('?') || QKEYS.test(lines[i])) { question = lines[i]; break; }
  }
  if (!question) {
    for (let i = firstIdx - 1; i >= Math.max(0, firstIdx - 18); i--) {
      if (badHeading(lines[i])) continue;
      question = lines[i]; break;
    }
  }
  if (!question) question = 'Predicción abierta';

  // Tiempo de cierre
  let closesAt = '';
  for (let i = Math.max(0, firstIdx - 25); i < Math.min(lines.length, firstIdx + 25); i++) {
    if (/CIERRA/i.test(lines[i])) {
      for (let j = i; j < Math.min(lines.length, i + 4); j++) {
        const m = lines[j].match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
        if (m) { closesAt = m[1]; break; }
      }
      if (closesAt) break;
    }
  }

  // Pool y jugadores
  let pool = '', players = '';
  for (let i = firstIdx; i < Math.min(lines.length, firstIdx + 30); i++) {
    const poolM = lines[i].match(/^([\d.,]+)\s*pts$/i);
    if (poolM && !pool) pool = poolM[1];
    if (lines[i].toUpperCase() === 'JUGADORES' && lines[i + 1]?.match(/^\d+$/)) {
      players = lines[i + 1];
    }
  }

  return [{ question, closesAt, teams, pool, players, status: 'open' }];
}

function isLoggedIn(body) {
  if (body.includes('CONECTAR CON KICK') && !body.includes('TU BALANCE') && !body.includes('MI PERFIL')) {
    return false;
  }
  return body.includes('TU BALANCE') ||
    body.includes('MI PERFIL') ||
    body.includes('Tu balance') ||
    body.includes('Mi perfil') ||
    body.includes('CERRAR SESIÓN') ||
    body.includes('MI CUENTA') ||
    (body.includes('PREDICCION') && body.length > 2000 && !body.includes('CONECTAR CON KICK'));
}

/**
 * Scrapea forg1.com/predicciones reutilizando la ventana persistente.
 * No usa did-finish-load — solo polling del DOM hasta tener contenido.
 */
async function scrapeForg1Predictions() {
  const win = getForg1Window();

  // Navegar a predicciones (sin esperar evento de carga — el SPA es complicado)
  win.loadURL('https://forg1.com/predicciones');

  // Poll puro: intentar leer el DOM cada 2.5s hasta 30s
  return new Promise((resolve, reject) => {
    const TOTAL_TIMEOUT = 30000;
    const POLL_INTERVAL = 2500;
    const startTime = Date.now();

    const poll = setInterval(async () => {
      try {
        const body = await win.webContents.executeJavaScript(
          `document.body ? document.body.innerText : ''`
        );

        // Todavía cargando o página vacía
        if (!body || body.length < 200) return;

        // No logueado
        if (!isLoggedIn(body)) {
          if (body.includes('CONECTAR CON KICK')) {
            clearInterval(poll);
            resolve({ ready: true, loggedIn: false });
            return;
          }
          // Esperar un poco más, puede estar cargando
        } else {
          // Logueado — esperar un tick más para que cargue el contenido dinámico
          // Solo resolver si ya tenemos suficiente contenido
          if (body.length > 1000) {
            clearInterval(poll);
            const predictions = parsePredictions(body);
            resolve({ ready: true, loggedIn: true, predictions, raw: body.substring(0, 300) });
            return;
          }
        }
      } catch (e) {
        // DOM aún no disponible, seguir esperando
      }

      if (Date.now() - startTime > TOTAL_TIMEOUT) {
        clearInterval(poll);
        reject(new Error('Forg1 tardó demasiado en responder (30s). Revisá tu conexión.'));
      }
    }, POLL_INTERVAL);
  });
}

/**
 * Abre ventana visible para que el usuario se loguee en forg1.
 */
function openForg1Login() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    title: 'Forg1 — Iniciar sesión',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:forg1'
    }
  });
  win.loadURL('https://forg1.com');

  // Al cerrar el login, resetear la ventana del scraper para recargar con cookies frescas
  win.on('closed', () => {
    if (_win && !_win.isDestroyed()) {
      _win.destroy();
      _win = null;
    }
  });

  return win;
}

module.exports = { scrapeForg1Predictions, openForg1Login };
