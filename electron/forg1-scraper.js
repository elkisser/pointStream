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

              // Buscar predicciones por DOM real, no por texto
              // En forg1, las predicciones tienen cards con opciones
              // Intentar buscar por estructura DOM
              const predictions = [];
              
              // Buscar todos los elementos que parecen predicciones
              // Basándome en la screenshot: hay un título tipo "Quien gana el 1er MAPA?"
              // y dos opciones con nombre + porcentaje
              
              // Estrategia: buscar headings o divs grandes que contengan "gana" o "MAPA" o "predicci"
              const allElements = document.querySelectorAll('h1, h2, h3, h4, h5, [class*="title"], [class*="question"], [class*="heading"]');
              
              let questionEl = null;
              allElements.forEach(el => {
                const t = el.textContent.trim();
                if (t.match(/gana|MAPA|ganador|predicci/i) && t.length < 80) {
                  questionEl = el;
                }
              });

              // Buscar por texto completo como fallback
              const lines = body.split('\\n').map(l => l.trim()).filter(l => l.length > 0);
              
              // Encontrar la pregunta de predicción
              let questionIdx = -1;
              let question = '';
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].match(/quien gana|quién gana|ganador|MAPA/i) && lines[i].length < 80) {
                  question = lines[i];
                  questionIdx = i;
                  break;
                }
              }

              if (questionIdx === -1) {
                // No hay predicción con pregunta visible
                return { ready: true, loggedIn: true, predictions: [], raw: body.substring(0, 2000) };
              }

              // Buscar el tiempo de cierre (CIERRA · XX:XX)
              let closesAt = '';
              for (let i = Math.max(0, questionIdx - 5); i < Math.min(lines.length, questionIdx + 3); i++) {
                const m = lines[i].match(/(\\d{1,2}:\\d{2})/);
                if (m) { closesAt = m[1]; break; }
              }

              // Buscar los equipos: vienen DESPUÉS de la pregunta
              // El patrón en forg1 es: NombreEquipo luego XX% (en líneas separadas)
              // Pero hay ruido (POOL, JUGADORES, PTS, etc)
              
              const teams = [];
              const skipWords = ['POOL', 'JUGADORES', 'TU JUGADA', 'SI GANÁS', 'PTS', 'PREDICCIÓN', 
                                 'LIVE', 'EVOLUCIÓN', 'POR OPCIÓN', 'CIERRA', question,
                                 'pts', 'TU ELECCIÓN', 'COMUNIDAD', 'INICIO', 'EXTENSIÓN',
                                 'PREDICCIONES', 'TIENDA', 'SORTEOS', 'CÓDIGOS', 'LEADERBOARD',
                                 'BOT 1XBET', 'MI PERFIL', 'TU BALANCE'];
              
              // Buscar desde después de la pregunta
              for (let i = questionIdx + 1; i < Math.min(lines.length, questionIdx + 40); i++) {
                const line = lines[i];
                
                // Saltar líneas que son números, porcentajes, timestamps, o palabras clave
                if (line.match(/^[\\d.,]+$/) || 
                    line.match(/^\\d+%$/) || 
                    line.match(/^\\d+:\\d+$/) ||
                    line.match(/^\\d+[.,]\\d+/) ||
                    line.match(/^[+]/) ||
                    line.length > 25 ||
                    line.length < 2) continue;
                
                // Saltar keywords
                let isSkip = false;
                for (const sw of skipWords) {
                  if (line.toUpperCase().includes(sw.toUpperCase())) { isSkip = true; break; }
                }
                if (isSkip) continue;
                
                // Verificar si la siguiente línea es un porcentaje (indica que esta línea es un equipo)
                const nextLine = lines[i + 1] || '';
                const nextNextLine = lines[i + 2] || '';
                
                if (nextLine.match(/^\\d{1,3}\\s*[%]?$/) || nextNextLine.match(/^\\d{1,3}\\s*[%]?$/)) {
                  const pctLine = nextLine.match(/^\\d{1,3}/) ? nextLine : nextNextLine;
                  const pct = parseInt(pctLine) || 0;
                  
                  // Verificar que no es un duplicado y que parece un nombre de equipo
                  if (!teams.find(t => t.name === line) && line.match(/^[A-Za-z]/) && teams.length < 2) {
                    teams.push({ name: line, percentage: pct + '%' });
                  }
                }
              }

              // Si no encontramos por el método de siguiente-línea-es-%, buscar otro patrón
              if (teams.length < 2) {
                // Buscar dos palabras que parezcan nombres de equipo (capitalizadas, cortas)
                // seguidas eventualmente de un número
                const teamCandidates = [];
                for (let i = questionIdx + 1; i < Math.min(lines.length, questionIdx + 30); i++) {
                  const line = lines[i];
                  if (line.match(/^[A-Z][a-zA-Z0-9 ]{1,20}$/) && !skipWords.some(sw => line.toUpperCase().includes(sw.toUpperCase()))) {
                    teamCandidates.push({ name: line, idx: i });
                  }
                }
                
                // Los primeros 2 candidatos son probablemente los equipos
                for (const cand of teamCandidates.slice(0, 2)) {
                  // Buscar % cerca
                  let pct = '?';
                  for (let j = cand.idx + 1; j < Math.min(lines.length, cand.idx + 3); j++) {
                    const m = lines[j].match(/^(\\d{1,3})\\s*%?$/);
                    if (m) { pct = m[1] + '%'; break; }
                  }
                  if (!teams.find(t => t.name === cand.name)) {
                    teams.push({ name: cand.name, percentage: pct });
                  }
                }
              }

              // Pool y jugadores
              let pool = '', players = '';
              for (let i = questionIdx; i < Math.min(lines.length, questionIdx + 25); i++) {
                const poolM = lines[i].match(/^([\\d.,]+)\\s*pts$/);
                if (poolM && !pool) pool = poolM[1];
                
                if (lines[i] === 'JUGADORES' && lines[i+1] && lines[i+1].match(/^\\d+$/)) {
                  players = lines[i+1];
                }
              }

              if (teams.length >= 2) {
                predictions.push({ question, closesAt, teams: teams.slice(0, 2), pool, players, status: 'open' });
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
