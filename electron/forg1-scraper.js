const { BrowserWindow } = require('electron');

/**
 * Scrapea forg1.com/predicciones usando una ventana oculta.
 * Espera a que el SPA cargue y extrae predicciones del DOM.
 */
async function scrapeForg1Predictions() {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: 'persist:forg1'
      }
    });

    const timeout = setTimeout(() => {
      win.destroy();
      reject(new Error('Timeout: forg1 tardó más de 25s en cargar'));
    }, 25000);

    win.webContents.on('did-finish-load', () => {
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const result = await win.webContents.executeJavaScript(`
            (function() {
              const body = document.body.innerText || '';
              
              // Check login
              const loggedIn = body.includes('TU BALANCE') || body.includes('MI PERFIL');
              if (!loggedIn) {
                return { ready: true, loggedIn: false, raw: body.substring(0, 500) };
              }

              // --- Validación de nombre de equipo ---
              // Rechaza timestamps ("HACE 1H", "AHORA", "EN 5 MIN"), números,
              // y palabras de la UI que NO son equipos.
              function isTimeToken(s) {
                const u = s.toUpperCase().trim();
                return /HACE\\s|AHORA|\\bAYER\\b|\\bHOY\\b|^EN\\s+\\d|\\d+\\s*(H|HS|HORA|HORAS|MIN|MINUTO|MINUTOS|M|D|D[IÍ]A|D[IÍ]AS|SEG|SEGUNDOS)\\b|^\\d{1,2}:\\d{2}$/.test(u);
              }
              const UI_WORDS = ['POOL','JUGADORES','TU JUGADA','SI GANÁS','SI GANAS','PTS','PREDICCIÓN',
                'PREDICCION','LIVE','EN VIVO','EVOLUCIÓN','EVOLUCION','POR OPCIÓN','POR OPCION','CIERRA',
                'TU ELECCIÓN','TU ELECCION','COMUNIDAD','INICIO','EXTENSIÓN','EXTENSION','PREDICCIONES',
                'TIENDA','SORTEOS','CÓDIGOS','CODIGOS','LEADERBOARD','BOT 1XBET','MI PERFIL','TU BALANCE',
                'GANÁS','GANAS','APOSTAR','APUESTA','TOTAL','VS','EMPATE','RESULTADO','MAPA','MAPAS'];

              // Equipos conocidos (whitelist para evitar falsos positivos)
              const KNOWN_TEAMS_LOWER = new Set(['vitality', 'navi', 'faze', 'g2', 'spirit', 'mouz', 'liquid', 'heroic', 
                'astralis', 'ence', 'fnatic', 'falcons', 'monte', 'mibr', '9z', 'pain', 'mk', 'tn', 'eternal fire',
                'complexity', 'nip', 'apeks', '3dmax', 'saw', 'bnj', 'big', 'betboom', 'sangal', 'fluxo', 'forze',
                'legacy', 'sharks', 'bad news', 'chicken fighters', 'aurora', 'tyloo', 'renegades', 'order',
                'cloud9', 'c9', 'wildcard', 'flyquest', 'imperial', 'gamerlegion', 'bnj', 'sprout', 'anonymous',
                'sashi esports', 'pera esports', 'dizzy', 'sence', 'lions', 'furia', 'rebels', 'winstrike', 'entropiq']);

              function validTeam(name) {
                if (!name) return false;
                const t = name.trim();
                if (t.length < 2 || t.length > 22) return false;
                if (!/^[A-Za-z0-9]/.test(t)) return false;
                if (!/[A-Za-z]/.test(t)) return false;
                if (/^[\\d.,%:+\\-]+$/.test(t)) return false;
                if (isTimeToken(t)) return false;
                const u = t.toUpperCase();
                for (const w of UI_WORDS) { if (u === w || u.includes(w)) return false; }
                // NUEVO: si no está en la lista de equipos conocidos, rechazar
                // (evita xplay.gg, el_kast1, etc que no son equipos reales)
                if (!KNOWN_TEAMS_LOWER.has(t.toLowerCase())) return false;
                return true;
              }

              // ============================================================
              // Detección: PRIMERO los equipos (opción + %), DESPUÉS la pregunta.
              // Así evitamos confundir la pregunta con headings de la UI como
              // "¿CÓMO FUNCIONA?".
              // ============================================================
              const predictions = [];

              const QKEYS = /gana|ganar|ganador|gane|hace|mata|kill|mapa|\\bmap\\b|stage|ronda|round|pistol|clutch|mvp|primer|primera|gan[aá]|m[aá]s\\s|cu[aá]nt|cu[aá]l|qui[eé]n/i;
              const HELP_WORDS = ['CÓMO FUNCIONA','COMO FUNCIONA','¿CÓMO','¿COMO','QUÉ ES','QUE ES','AYUDA','FAQ',
                'PREGUNTAS','REGLAS','TÉRMINOS','TERMINOS','SOPORTE','TUTORIAL','CONTACTO','ACERCA',
                'POLÍTICA','POLITICA','PRIVACIDAD','NOVEDADES','HISTORIAL'];

              const lines = body.split('\\n').map(l => l.trim()).filter(l => l.length > 0);

              function isPct(s) { return /^\\d{1,3}\\s*%?$/.test(s || ''); }

              // 1) Opciones: línea = equipo válido seguido (1 o 2 líneas) por un %
              const hits = [];
              for (let i = 0; i < lines.length; i++) {
                if (!validTeam(lines[i])) continue;
                const n1 = lines[i + 1] || '', n2 = lines[i + 2] || '';
                let pct = null;
                if (isPct(n1)) pct = parseInt(n1);
                else if (isPct(n2)) pct = parseInt(n2);
                if (pct != null && !hits.find(h => h.name === lines[i])) {
                  hits.push({ name: lines[i], percentage: pct + '%', idx: i });
                }
              }

              if (hits.length < 2) {
                // No hay una predicción con dos opciones claras
                return { ready: true, loggedIn: true, predictions: [], raw: body.substring(0, 2000) };
              }

              const teams = [hits[0], hits[1]].map(h => ({ name: h.name, percentage: h.percentage }));
              const firstIdx = hits[0].idx;

              // 2) Pregunta: el heading más cercano ARRIBA de las opciones,
              //    descartando headings de ayuda/UI y nombres de equipo.
              function badHeading(l) {
                if (!l || l.length < 5 || l.length > 90) return true;
                if (/^[\\d.,%:+\\-]/.test(l)) return true;
                const u = l.toUpperCase();
                if (HELP_WORDS.some(w => u.includes(w))) return true;
                if (UI_WORDS.some(w => u.includes(w))) return true;
                if (validTeam(l)) return true;
                return false;
              }
              let question = '';
              for (let i = firstIdx - 1; i >= Math.max(0, firstIdx - 14); i--) {
                if (badHeading(lines[i])) continue;
                if (lines[i].endsWith('?') || QKEYS.test(lines[i])) { question = lines[i]; break; }
              }
              if (!question) {
                for (let i = firstIdx - 1; i >= Math.max(0, firstIdx - 14); i--) {
                  if (badHeading(lines[i])) continue;
                  question = lines[i]; break;
                }
              }
              if (!question) question = 'Predicción abierta';

              // 3) Cierre: "CIERRA" cerca de las opciones (cuenta regresiva mm:ss)
              let closesAt = '';
              for (let i = Math.max(0, firstIdx - 20); i < Math.min(lines.length, firstIdx + 20); i++) {
                if (/CIERRA/i.test(lines[i])) {
                  for (let j = i; j < Math.min(lines.length, i + 3); j++) {
                    const m = lines[j].match(/(\\d{1,2}:\\d{2}(?::\\d{2})?)/);
                    if (m) { closesAt = m[1]; break; }
                  }
                  if (closesAt) break;
                }
              }

              // Pool y jugadores
              let pool = '', players = '';
              for (let i = firstIdx; i < Math.min(lines.length, firstIdx + 25); i++) {
                const poolM = lines[i].match(/^([\\d.,]+)\\s*pts$/);
                if (poolM && !pool) pool = poolM[1];
                
                if (lines[i] === 'JUGADORES' && lines[i+1] && lines[i+1].match(/^\\d+$/)) {
                  players = lines[i+1];
                }
              }

              // Solo emitir si hay DOS equipos válidos de verdad
              const validTeams = teams.filter(t => validTeam(t.name)).slice(0, 2);
              if (validTeams.length >= 2) {
                predictions.push({ question, closesAt, teams: validTeams, pool, players, status: 'open' });
              }

              return { ready: true, loggedIn: true, predictions, raw: body.substring(0, 2000) };
            })()
          `);

          if (result.ready) {
            clearInterval(poll);
            clearTimeout(timeout);
            win.destroy();
            resolve(result);
          }
        } catch (e) {
          // SPA aún cargando
        }

        if (attempts > 12) {
          clearInterval(poll);
          clearTimeout(timeout);
          win.destroy();
          reject(new Error('No se pudo leer forg1 después de múltiples intentos'));
        }
      }, 2000);
    });

    win.loadURL('https://forg1.com/predicciones');
  });
}

/**
 * Abre ventana visible para que el usuario se loguee en forg1
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
  return win;
}

module.exports = { scrapeForg1Predictions, openForg1Login };
