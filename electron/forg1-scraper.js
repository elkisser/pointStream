const { BrowserWindow } = require('electron');

// Ventana persistente — se crea una sola vez y se reutiliza entre scans.
let _win = null;

function getForg1Window() {
  if (_win && !_win.isDestroyed()) return _win;
  _win = new BrowserWindow({
    width: 1280, height: 900, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'persist:forg1' }
  });
  _win.on('closed', () => { _win = null; });
  return _win;
}

/**
 * Clasifica el tipo de predicción para que el análisis HLTV sepa qué hacer.
 * 'team-matchup' → dos equipos pro, analizar con HLTV
 * 'kills-range'  → rangos de kills (0-9/10-14/etc), sin análisis HLTV
 * 'ot'           → incluye opción de OT
 * 'yes-no'       → pregunta de sí/no
 * 'map'          → sobre un mapa
 * 'other'        → otro tipo, mostrar comunidad sin análisis
 */
function classifyPrediction(question, options) {
  const q = (question || '').toLowerCase();
  const optNames = options.map(o => (o.name || '').toLowerCase());

  // Rangos de kills: "0-9", "10-14", "+20"
  if (options.some(o => /^\d+-\d+$/.test(o.name) || /^\+\d+$/.test(o.name))) return 'kills-range';
  if (/kill|kills|frag|baja|bajas/i.test(question)) return 'kills-range';

  // OT
  if (optNames.includes('ot') || /\bot\b|overtime/i.test(question)) return 'ot';

  // Sí/No
  if (optNames.some(n => n === 'sí' || n === 'si' || n === 'no')) return 'yes-no';
  if (/llega|logra|clasifica|supera|pasa|termina/i.test(question)) return 'yes-no';

  // Mapa específico
  if (/\bmapa\b|\bmap\b/i.test(question) && !/quien gana|qui[eé]n gana/i.test(question)) return 'map';

  // Matchup de equipos
  if (/quien gana|qui[eé]n gana|gana el partido|gana el mapa|winner/i.test(question)) return 'team-matchup';
  if (options.length === 2) return 'team-matchup';

  return 'other';
}

/**
 * Extrae predicciones del texto plano de la página.
 * Soporta predicciones de 2+ opciones (equipos, rangos, sí/no, OT).
 */
function parsePredictions(body) {
  const lines = body.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  console.log('[Forg1] Total líneas:', lines.length);

  const UI_WORDS = new Set([
    'POOL','JUGADORES','TU JUGADA','SI GANÁS','SI GANAS','PTS','PREDICCIÓN',
    'PREDICCION','LIVE','EN VIVO','EVOLUCIÓN','EVOLUCION','POR OPCIÓN','POR OPCION',
    'CIERRA','TU ELECCIÓN','TU ELECCION','COMUNIDAD','INICIO','EXTENSIÓN',
    'EXTENSION','PREDICCIONES','TIENDA','SORTEOS','CÓDIGOS','CODIGOS',
    'LEADERBOARD','BOT 1XBET','MI PERFIL','TU BALANCE','GANÁS','GANAS',
    'APOSTAR','APUESTA','TOTAL','VS','EMPATE','RESULTADO','MAPA','MAPAS',
    'SPONSOR','OFICIAL','STUDIO','ESTUDIO','CREATED BY','PRIVACIDAD','TWITTER',
    'INSTAGRAM','YOUTUBE','FACEBOOK','CONECTAR','SORTEO','MIS PREDICCIONES',
    'PENDIENTE','HISTORIAL','NOVEDADES','PISO9','JUGADAS','GANADAS','PERDIDAS',
    'PUNTOS GANADOS','PUNTOS PERDIDOS','AUTH / KICK','CONECTAR CON KICK',
    'EVOLUCIÓN DEL POOL','EVOLUCION DEL POOL',
  ]);

  function isTimeToken(s) {
    const u = s.toUpperCase().trim();
    return /HACE\s|AHORA|\bAYER\b|\bHOY\b|^EN\s+\d|\d+\s*(H|HS|HORA|HORAS|MIN|MINUTO|MINUTOS|M|D|DÍA|DÍAS|SEG|SEGUNDOS)\b|^\d{1,2}:\d{2}$/.test(u);
  }

  // Detectar username del usuario logueado (ej: el_kast1 seguido de número pequeño)
  const detectedUsername = (() => {
    for (let i = 0; i < Math.min(lines.length, 60); i++) {
      const l = lines[i], next = lines[i + 1] || '';
      if (/^[a-zA-Z0-9_]{3,25}$/.test(l) && /^[a-z]/.test(l) && /^\d{1,3}$/.test(next.trim())) {
        return l.toLowerCase();
      }
    }
    return null;
  })();
  if (detectedUsername) console.log('[Forg1] Username ignorado:', detectedUsername);

  // Opción de texto válida (equipo, jugador, etc.)
  function isValidOption(s) {
    if (!s) return false;
    const t = s.trim();
    if (t.length < 2 || t.length > 40) return false;
    if (/^[\d.,%:+\-]+$/.test(t)) return false;
    if (/^\d+$/.test(t)) return false;
    if (isTimeToken(t)) return false;
    if (/[./\\@#]/.test(t)) return false;
    if (/^\d+\s+JUGADORES$/i.test(t)) return false;   // "98 JUGADORES"
    if (/\bPTS\b/i.test(t)) return false;               // "441.245 PTS"
    if (/^[a-z][a-z0-9_]+$/.test(t) && t.includes('_')) return false; // username kick
    const u = t.toUpperCase();
    if (UI_WORDS.has(u)) return false;
    if (detectedUsername && t.toLowerCase() === detectedUsername) return false;
    return true;
  }

  // Opción de rango válida: "0-9", "10-14", "+20", "OT", "SÍ", "NO"
  function isRangeOption(s) {
    if (!s) return false;
    const t = s.trim();
    return /^\d+-\d+$/.test(t) || /^\+\d+$/.test(t) ||
           /^OT$/i.test(t) || /^(SÍ|SI|NO)$/i.test(t);
  }

  // Porcentaje: exactamente 2 dígitos entre 10-99
  // Los porcentajes reales de Forg1 siempre son así; 104 o 98 (jugadores) no pasan
  function isPct(s) {
    const t = (s || '').trim();
    if (!/^\d{2}\s*%?$/.test(t)) return false;
    const n = parseInt(t);
    return n >= 10 && n <= 99;
  }

  const QKEYS = /gana|ganar|ganador|gane|hace|mata|kill|mapa|\bmap\b|stage|ronda|round|pistol|clutch|mvp|primer|primera|gan[aá]|m[aá]s\s|cu[aá]nt|cu[aá]l|qui[eé]n/i;

  // Buscar todas las opciones con % — puede ser 2, 3 o 4 opciones
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isValidOption(line) && !isRangeOption(line)) continue;

    const n1 = lines[i + 1] || '', n2 = lines[i + 2] || '';

    // Saltar si el número va seguido de JUGADORES (es contador de apostadores)
    if ((lines[i + 2] || '').toUpperCase() === 'JUGADORES') continue;
    if ((lines[i + 3] || '').toUpperCase() === 'JUGADORES') continue;

    let pct = null;
    if (isPct(n1)) pct = parseInt(n1);
    else if (isPct(n2)) pct = parseInt(n2);

    if (pct != null && !hits.find(h => h.name === line)) {
      console.log(`[Forg1] Hit: "${line}" -> ${pct}%`);
      hits.push({ name: line, percentage: pct + '%', idx: i });
    }
  }

  if (hits.length < 2) {
    console.log('[Forg1] No hay suficientes hits para una predicción');
    return [];
  }

  const options = hits.map(h => ({ name: h.name, percentage: h.percentage }));
  const firstIdx = hits[0].idx;
  console.log(`[Forg1] Opciones: ${options.map(o => `"${o.name}" ${o.percentage}`).join(' | ')}`);

  // Buscar pregunta hacia arriba desde el primer hit
  const HELP_WORDS = ['CÓMO FUNCIONA','COMO FUNCIONA','¿CÓMO','¿COMO','QUÉ ES','QUE ES',
    'AYUDA','FAQ','PREGUNTAS','REGLAS','TÉRMINOS','TERMINOS','SOPORTE','TUTORIAL',
    'CONTACTO','ACERCA','POLÍTICA','POLITICA','PRIVACIDAD','NOVEDADES','HISTORIAL'];

  function badHeading(l) {
    if (!l || l.length < 3 || l.length > 120) return true;
    if (/^[\d.,%:+\-]/.test(l)) return true;
    const u = l.toUpperCase();
    if (HELP_WORDS.some(w => u.includes(w))) return true;
    if (UI_WORDS.has(u)) return true;
    return false;
  }

  let question = '';
  for (let i = firstIdx - 1; i >= Math.max(0, firstIdx - 20); i--) {
    if (badHeading(lines[i])) continue;
    if (lines[i].endsWith('?') || QKEYS.test(lines[i])) { question = lines[i]; break; }
  }
  if (!question) {
    for (let i = firstIdx - 1; i >= Math.max(0, firstIdx - 20); i--) {
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

  // Pool, jugadores, apuesta y ganancia del usuario
  let pool = '', players = '', myBet = '', myWin = '';
  for (let i = firstIdx; i < Math.min(lines.length, firstIdx + 40); i++) {
    const poolM = lines[i].match(/^([\d.,]+)\s*pts$/i);
    if (poolM && !pool) pool = poolM[1];
    if (lines[i].toUpperCase() === 'JUGADORES' && lines[i + 1]?.match(/^\d+$/)) {
      players = lines[i + 1];
    }
    if (/^TU JUGADA$/i.test(lines[i]) && lines[i + 1]) {
      myBet = lines[i + 1].replace(/\s*pts?\.?$/i, '').trim();
    }
    if (/^SI GAN[AÁ]S?$/i.test(lines[i]) && lines[i + 1]) {
      myWin = lines[i + 1].trim();
    }
  }

  // Clasificar tipo de predicción
  const predType = classifyPrediction(question, options);
  console.log(`[Forg1] Tipo: ${predType} | Pregunta: "${question}"`);

  // teams: las dos primeras opciones (para compatibilidad con el análisis HLTV)
  const teams = options.slice(0, 2);

  return [{ question, closesAt, teams, options, predType, pool, players, myBet, myWin, status: 'open' }];
}

/**
 * Busca predicciones resueltas recientemente.
 * Forg1 muestra "GANASTE"/"PERDISTE" + equipo ganador + cambio de puntos.
 */
function parseRecentResults(body) {
  const lines = body.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const results = [];
  for (let i = 0; i < lines.length; i++) {
    const u = lines[i].toUpperCase();
    if (u.includes('GANASTE') || u.includes('PERDISTE')) {
      const won = u.includes('GANASTE');
      let winner = '', pointsChange = '';
      for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
        if (/^[+\-][\d.,]+\s*pts?/i.test(lines[j])) pointsChange = lines[j];
        if (lines[j].length > 2 && lines[j].length < 30 && /^[A-ZÀ-Ÿa-z]/.test(lines[j]) && !winner) {
          winner = lines[j];
        }
      }
      if (winner) results.push({ winner, won, pointsChange });
    }
  }
  return results;
}

function isLoggedIn(body) {
  const hasKickConnect = body.includes('CONECTAR CON KICK');
  const hasBalance = body.includes('TU BALANCE') || body.includes('Tu balance');
  const hasPerfil = body.includes('MI PERFIL') || body.includes('Mi perfil');
  const hasCerrar = body.includes('CERRAR SESIÓN') || body.includes('Cerrar sesión');
  const hasCuenta = body.includes('MI CUENTA') || body.includes('Mi cuenta');
  console.log(`[Forg1] login: kickConnect=${hasKickConnect} balance=${hasBalance} perfil=${hasPerfil} cerrar=${hasCerrar} len=${body.length}`);
  if (hasKickConnect && !hasBalance && !hasPerfil && !hasCerrar && !hasCuenta) return false;
  return hasBalance || hasPerfil || hasCerrar || hasCuenta ||
    (body.includes('PREDICCION') && body.length > 2000 && !hasKickConnect);
}

async function scrapeForg1Predictions() {
  const win = getForg1Window();
  win.loadURL('https://forg1.com/predicciones');

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const poll = setInterval(async () => {
      try {
        const body = await win.webContents.executeJavaScript(`document.body ? document.body.innerText : ''`);
        if (!body || body.length < 200) return;

        if (!isLoggedIn(body)) {
          if (body.includes('CONECTAR CON KICK')) {
            clearInterval(poll);
            resolve({ ready: true, loggedIn: false });
          }
          return;
        }

        if (body.length > 1000) {
          clearInterval(poll);
          const predictions = parsePredictions(body);
          const recentResults = parseRecentResults(body);
          resolve({ ready: true, loggedIn: true, predictions, recentResults, raw: body.substring(0, 300) });
        }
      } catch (e) { /* SPA cargando */ }

      if (Date.now() - startTime > 30000) {
        clearInterval(poll);
        reject(new Error('Forg1 tardó demasiado en responder (30s). Revisá tu conexión.'));
      }
    }, 2500);
  });
}

function openForg1Login() {
  const win = new BrowserWindow({
    width: 1100, height: 750, title: 'Forg1 — Iniciar sesión',
    webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'persist:forg1' }
  });
  win.loadURL('https://forg1.com');
  win.on('closed', () => {
    if (_win && !_win.isDestroyed()) { _win.destroy(); _win = null; }
  });
  return win;
}

module.exports = { scrapeForg1Predictions, openForg1Login };
