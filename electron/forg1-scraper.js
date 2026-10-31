const { BrowserWindow, session } = require('electron');
const { extractMapAndFormat } = require('./series-tracker');
const { isKillRangeLabel, extractPlayerNameFromQuestion } = require('./player-kills');

// Ventana persistente — se crea una sola vez y se reutiliza entre scans.
let _win = null;

function getForg1Window() {
  if (_win && !_win.isDestroyed()) return _win;
  const ses = session.fromPartition('persist:forg1');
  const chromeVersion = process.versions.chrome || '120.0.0.0';
  ses.setUserAgent(
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
  );
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
 * 'kills-range'  → rangos de kills de UN jugador (0-9 / 11 a 13)
 * 'kills-duel'   → quién mata más (opciones = nicks de jugadores)
 * 'ot'           → incluye opción de OT
 * 'yes-no'       → pregunta de sí/no
 * 'map'          → sobre un mapa
 * 'other'        → otro tipo, mostrar comunidad sin análisis
 */
function isMostKillsQuestion(question) {
  const q = String(question || '');
  return /qui[eé]n\s+(?:mata|kill|frag|hace\s+m[aá]s)|m[aá]s\s+(?:kills?|frags?|bajas)|mata\s+m[aá]s|m[aá]s\s+kills?|el\s+que\s+m[aá]s\s+mata|most\s+kills|kill\s*leader|top\s+fragg/i.test(q);
}

function classifyPrediction(question, options) {
  const q = (question || '').toLowerCase();
  const opts = options || [];
  const optNames = opts.map(o => (o.name || o.label || '').toLowerCase().trim());

  // Rangos de kills: "0-9", "10-14", "+20", "1 - 5", "11 a 13", "4 o menos", "17 o mas"
  if (optNames.some(o => isKillRangeLabel(o))) return 'kills-range';

  // Quién mata más: las opciones son jugadores, no rangos
  if (isMostKillsQuestion(question) && optNames.length >= 2) return 'kills-duel';

  if (/cu[aá]nt[oa]s?\s+(kills?|mata)|kills?\s+(de|hace)|frag|baja|bajas/i.test(question)) return 'kills-range';

  // Sí/No (evaluar antes de OT en pregunta por si la pregunta es "¿Habrá overtime? Sí / No")
  if (optNames.some(n => n === 'sí' || n === 'si' || n === 'no')) return 'yes-no';
  if (/llega|logra|clasifica|supera|pasa|termina/i.test(question) && !optNames.includes('ot')) return 'yes-no';

  // OT (opción 'OT' presente o pregunta de OT con 3 opciones)
  if (optNames.includes('ot') || (/\bot\b|overtime/i.test(question) && opts.length === 3)) return 'ot';

  // Matchup de equipos (ej: "Ganador del mapa 1", "Quién gana el partido", etc.)
  if (/quien gana|qui[eé]n gana|gana el partido|gana el mapa|ganador|winner/i.test(question)) return 'team-matchup';

  // Mapa específico (ej: "¿Qué mapa se juega?")
  if (/\bmapa\b|\bmap\b/i.test(question)) return 'map';

  if (opts.length === 2) return 'team-matchup';

  return 'other';
}

/**
 * Estados canónicos del ciclo de vida de predicciones.
 */
const PredictionStatus = {
  OPEN: 'OPEN',                     // Abierta para recibir apuestas
  WAITING_RESULT: 'WAITING_RESULT', // Cerrada para apuestas / esperando resolución
  RESOLVED: 'RESOLVED',             // Resuelta con resultado definitivo
  UNKNOWN: 'UNKNOWN'                // Estado no reconocido (no asumir abierto ni resuelto)
};

function isFinishedPrediction(pred) {
  if (!pred) return true;
  const s = pred.status;
  return s === PredictionStatus.RESOLVED || s === PredictionStatus.WAITING_RESULT;
}

function isLivePrediction(pred) {
  return pred && !isFinishedPrediction(pred);
}

function keepLivePredictions(preds) {
  return (preds || []).filter(isLivePrediction);
}

/**
 * Normaliza cualquier estado crudo (string, API o texto) al ciclo de vida canónico.
 * ZERO FAKE DATA: No asumir abierto si no es inequívocamente abierto.
 */
function normalizePredictionStatus(rawStatus, textContext = '', locksAt = null) {
  const s = String(rawStatus || '').toLowerCase().trim();
  const txt = String(textContext || '').toLowerCase();

  // Comprobar si el texto contiene indicadores explícitos de cierre
  if (
    /esperando\s+(?:ganador|resultado)/i.test(txt) ||
    /predicci[oó]n\s+cerrada/i.test(txt) ||
    /cerrada[.\s]+esperando/i.test(txt)
  ) {
    return PredictionStatus.WAITING_RESULT;
  }

  // Comprobación de locksAt si ya expiró en el tiempo
  if (locksAt) {
    const lockTime = new Date(locksAt).getTime();
    if (!isNaN(lockTime) && Date.now() >= lockTime) {
      // Si la fecha límite ya pasó, la predicción ya no es apostable
      if (s === 'resolved' || s === 'completed' || s === 'finished') {
        return PredictionStatus.RESOLVED;
      }
      return PredictionStatus.WAITING_RESULT;
    }
  }

  // Mapeo por valor de status
  if (s === 'open' || s === 'active' || s === 'live' || s === 'en vivo') {
    return PredictionStatus.OPEN;
  }

  if (
    s === 'locked' ||
    s === 'closed' ||
    s === 'waiting_result' ||
    s === 'waiting' ||
    s === 'pending_result' ||
    s === 'esperando ganador' ||
    s === 'esperando resultado' ||
    s === 'cerrada'
  ) {
    return PredictionStatus.WAITING_RESULT;
  }

  if (
    s === 'resolved' ||
    s === 'completed' ||
    s === 'finished' ||
    s === 'ended' ||
    s === 'settled' ||
    s === 'paid' ||
    s === 'finalizada' ||
    s === 'resuelta'
  ) {
    return PredictionStatus.RESOLVED;
  }

  return PredictionStatus.UNKNOWN;
}

/**
 * Extrae el resultado real de una predicción resuelta.
 * ZERO FAKE DATA: Si no hay resultado explícito comprobable, devuelve null.
 */
function extractPredictionResult(p, outcomes = []) {
  if (!p) return null;

  // 1. Ganador explícito en objeto
  if (p.winning_outcome_id) {
    const found = outcomes.find(o => String(o.id) === String(p.winning_outcome_id));
    if (found) return found.label || found.name || p.winning_outcome_id;
    return String(p.winning_outcome_id);
  }

  if (p.winner_label || p.winner_name || p.result) {
    return String(p.winner_label || p.winner_name || p.result);
  }

  // 2. Revisar si alguna outcome tiene flag 'won' o 'is_winner'
  const winOutcome = outcomes.find(o => o.won === true || o.is_winner === true);
  if (winOutcome) {
    return winOutcome.label || winOutcome.name || null;
  }

  return null;
}

/**
 * Forg1 ahora publica varias apuestas a la vez.
 * `predictions` (plural) es la lista completa; `prediction` es un destacado (a menudo la primera).
 */
function collectRawPredictions(data) {
  if (!data || typeof data !== 'object') return [];
  const seen = new Set();
  const list = [];

  const push = (p) => {
    if (!p || !p.id || seen.has(String(p.id))) return;
    seen.add(String(p.id));
    list.push(p);
  };

  if (Array.isArray(data.predictions) && data.predictions.length > 0) {
    data.predictions.forEach(push);
    return list;
  }

  if (Array.isArray(data.prediction)) {
    data.prediction.forEach(push);
    return list;
  }

  if (data.prediction) push(data.prediction);
  return list;
}

function attachUserBet(p, data) {
  const betsById = data.userBets || data.user_bets || null;
  let userBet = null;
  if (betsById && p.id && (betsById[p.id] || betsById[String(p.id)])) {
    userBet = betsById[p.id] || betsById[String(p.id)];
  } else if (data.userBet && (!data.userBet.prediction_id || String(data.userBet.prediction_id) === String(p.id))) {
    userBet = data.userBet;
  }
  if (!userBet) return { myBet: null, myWin: null };
  return {
    myBet: userBet.amount != null ? String(userBet.amount) : null,
    myWin: userBet.projected_payout != null ? String(userBet.projected_payout) + ' pts' : null
  };
}

/**
 * Transforma el estado estructurado recibido desde la API de Forg1 (/api/predictions/state)
 * al modelo de dominio: Prediction -> Markets -> Selections.
 */
function parsePredictionFromState(data) {
  const predItems = collectRawPredictions(data);
  const results = [];

  for (const p of predItems) {
    if (!p || !p.id) continue;

    // Extraer mercados: p puede tener un array .markets o representar él mismo un mercado
    const rawMarkets = Array.isArray(p.markets) && p.markets.length > 0 ? p.markets : [p];
    let totalPointsAll = 0;
    let totalBettorsAll = 0;

    const locksAt = p.locks_at || null;
    const globalStatus = normalizePredictionStatus(p.status, '', locksAt);

    const markets = rawMarkets.map((m, mIdx) => {
      const q = (m.title || m.question || p.title || 'Predicción abierta').trim();
      const outcomes = Array.isArray(m.outcomes) ? m.outcomes : [];

      const mPool = outcomes.reduce((sum, o) => sum + (Number(o.total_points) || 0), 0);
      const mBettors = outcomes.reduce((sum, o) => sum + (Number(o.total_bettors) || 0), 0);
      totalPointsAll += mPool;
      totalBettorsAll += mBettors;

      const selections = outcomes.map((o, oIdx) => {
        const pts = Number(o.total_points) || 0;
        const pct = mPool > 0
          ? Math.round((pts / mPool) * 100) + '%'
          : (outcomes.length > 0 ? Math.round(100 / outcomes.length) + '%' : '0%');
        const name = (o.label || o.name || '').trim();
        return {
          id: o.id || `${p.id}-m${mIdx}-o${oIdx}`,
          name,
          label: name,
          percentage: pct,
          points: pts,
          bettors: Number(o.total_bettors) || 0,
          color: o.color || null,
          position: o.position != null ? o.position : oIdx + 1
        };
      });

      const mType = classifyPrediction(q, selections);
      const mStatus = m.status ? normalizePredictionStatus(m.status, '', locksAt) : globalStatus;
      const mResult = extractPredictionResult(m, outcomes);

      return {
        id: m.id || `${p.id}-m${mIdx}`,
        question: q,
        type: mType,
        status: mStatus,
        result: mResult,
        totalPool: mPool,
        totalBettors: mBettors,
        selections
      };
    });

    if (markets.length === 0 || markets.every(m => m.selections.length === 0)) continue;

    let closesAt = '';
    if (locksAt) {
      const diffSec = Math.max(0, Math.floor((new Date(locksAt).getTime() - Date.now()) / 1000));
      const h = Math.floor(diffSec / 3600);
      const m = Math.floor((diffSec % 3600) / 60);
      const s = diffSec % 60;
      const pad = n => String(n).padStart(2, '0');
      closesAt = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    }

    const primaryMarket = markets[0];
    const options = primaryMarket.selections.map(s => ({
      name: s.name,
      percentage: s.percentage,
      points: s.points,
      bettors: s.bettors
    }));
    const teams = options.slice(0, 2);

    const { myBet, myWin } = attachUserBet(p, data);

    const predResult = extractPredictionResult(p, p.outcomes || []) || primaryMarket.result || null;
    const titleText = (p.title ? p.title + ' ' : '') + primaryMarket.question;
    const meta = extractMapAndFormat(titleText);
    const allMarketsResolved = markets.length > 0 && markets.every(m => m.status === PredictionStatus.RESOLVED);
    // Señales de que ya terminó aunque el status venga con un valor nuevo/no mapeado.
    const hasResolvedMarker = !!(p.resolved_at || p.resolvedAt || p.settled_at || p.winning_outcome_id ||
      p.winner_outcome_id || (p.outcomes || []).some(o => o && (o.won === true || o.is_winner === true || o.winner === true)));
    const status = (predResult || allMarketsResolved || hasResolvedMarker)
      ? PredictionStatus.RESOLVED
      : globalStatus;

    results.push({
      id: p.id,
      title: p.title || primaryMarket.question,
      question: primaryMarket.question,
      status,
      result: predResult,
      locksAt,
      closesAt,
      pool: totalPointsAll > 0 ? totalPointsAll.toLocaleString('es-AR') + ' pts' : '',
      players: totalBettorsAll > 0 ? String(totalBettorsAll) : '',
      myBet,
      myWin,
      predType: primaryMarket.type,
      playerName: primaryMarket.type === 'kills-range'
        ? extractPlayerNameFromQuestion(primaryMarket.question || p.title)
        : null,
      teams,
      options,
      markets,
      mapNumber: meta.mapNumber,
      format: meta.format,
      mapName: meta.mapName,
      minBet: p.min_bet != null ? p.min_bet : null,
      maxBet: p.max_bet != null ? p.max_bet : null,
      seriesId: null,
      mapSignature: null,
      seriesScore: null
    });
  }

  return results;
}

/**
 * Extrae predicciones del texto plano cuando la API directa no está disponible.
 * Soporta múltiples preguntas y mercados sin aplanarlos en una sola lista.
 */
/**
 * La página /predicciones muestra debajo de las activas la sección "ÚLTIMOS RESULTADOS"
 * (cards con "GANÓ · FURIA"). Esas predicciones ya terminaron: nunca deben parsearse
 * como abiertas. Devuelve solo el texto de la sección de activas.
 */
function activeSectionText(body) {
  let txt = String(body || '');
  const cut = txt.search(/^[ \t]*[ÚU]LTIMOS\s+RESULTADOS[ \t]*$/im);
  if (cut >= 0) txt = txt.slice(0, cut);
  return txt;
}

function hasNoActivePredictions(body) {
  return /no\s+hay\s+predicciones\s+activas/i.test(activeSectionText(body));
}

function parsePredictionsFromText(body) {
  if (hasNoActivePredictions(body)) {
    console.log('[Forg1] La página dice "No hay predicciones activas"');
    return [];
  }
  body = activeSectionText(body);
  const lines = (body || '').split('\n').map(l => l.trim()).filter(l => l.length > 0);
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

  const detectedUsername = (() => {
    for (let i = 0; i < Math.min(lines.length, 60); i++) {
      const l = lines[i], next = lines[i + 1] || '';
      if (/^[a-zA-Z0-9_]{3,25}$/.test(l) && /^[a-z]/.test(l) && /^\d{1,3}$/.test(next.trim())) {
        return l.toLowerCase();
      }
    }
    return null;
  })();

  function isValidOption(s) {
    if (!s) return false;
    const t = s.trim();
    if (t.length < 2 || t.length > 40) return false;
    if (/^[\d.,%:+\-]+$/.test(t)) return false;
    if (/^\d+$/.test(t)) return false;
    if (isTimeToken(t)) return false;
    if (/[./\\@#]/.test(t)) return false;
    if (/^\d+\s+JUGADORES$/i.test(t)) return false;
    if (/\bPTS\b/i.test(t)) return false;
    if (/^[a-z][a-z0-9_]+$/.test(t) && t.includes('_')) return false;
    const u = t.toUpperCase();
    if (UI_WORDS.has(u)) return false;
    if (detectedUsername && t.toLowerCase() === detectedUsername) return false;
    return true;
  }

  function isRangeOption(s) {
    if (!s) return false;
    const t = s.trim();
    return isKillRangeLabel(t) ||
           /^OT$/i.test(t) || /^(SÍ|SI|NO)$/i.test(t);
  }

  function isPct(s) {
    const t = (s || '').trim();
    if (!/^\d{1,2}\s*%?$/.test(t)) return false;
    const n = parseInt(t, 10);
    return n >= 0 && n <= 100;
  }

  const QKEYS = /gana|ganar|ganador|gane|hace|mata|kill|mapa|\bmap\b|stage|ronda|round|pistol|clutch|mvp|primer|primera|gan[aá]|m[aá]s\s|cu[aá]nt|cu[aá]l|qui[eé]n/i;

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

  // 1. Extraer todas las opciones candidatas con su porcentaje y posición de línea
  const hitIndices = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isValidOption(line) && !isRangeOption(line)) continue;

    if ((lines[i + 2] || '').toUpperCase() === 'JUGADORES') continue;
    if ((lines[i + 3] || '').toUpperCase() === 'JUGADORES') continue;

    const n1 = lines[i + 1] || '', n2 = lines[i + 2] || '';
    let pct = null;
    if (isPct(n1)) pct = parseInt(n1, 10);
    else if (isPct(n2)) pct = parseInt(n2, 10);

    if (pct != null) {
      hitIndices.push({ name: line, percentage: pct + '%', lineIdx: i });
    }
  }

  if (hitIndices.length < 2) {
    console.log('[Forg1] No hay suficientes hits para una predicción');
    return [];
  }

  // 2. Extraer todas las preguntas candidatas en el texto
  const questionCandidates = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (badHeading(l)) continue;
    if (l.endsWith('?') || QKEYS.test(l)) {
      questionCandidates.push({ question: l, lineIdx: i });
    }
  }

  // 3. Agrupar elecciones por mercado
  const marketGroups = [];
  if (questionCandidates.length === 0) {
    let fallbackQ = '';
    const firstIdx = hitIndices[0].lineIdx;
    for (let i = firstIdx - 1; i >= Math.max(0, firstIdx - 15); i--) {
      if (!badHeading(lines[i])) { fallbackQ = lines[i]; break; }
    }
    marketGroups.push({ question: fallbackQ || 'Predicción abierta', hits: hitIndices });
  } else {
    for (let qIdx = 0; qIdx < questionCandidates.length; qIdx++) {
      const currentQ = questionCandidates[qIdx];
      const nextQ = questionCandidates[qIdx + 1];
      const qHits = hitIndices.filter(h =>
        h.lineIdx > currentQ.lineIdx && (!nextQ || h.lineIdx < nextQ.lineIdx)
      );
      if (qHits.length >= 2) {
        marketGroups.push({ question: currentQ.question, hits: qHits });
      }
    }
    if (marketGroups.length === 0 && hitIndices.length >= 2) {
      marketGroups.push({ question: questionCandidates[0].question, hits: hitIndices });
    }
  }

  // Tiempo de cierre, pool, jugadores, apuesta
  let closesAt = '';
  for (let i = 0; i < lines.length; i++) {
    if (/CIERRA/i.test(lines[i])) {
      for (let j = i; j < Math.min(lines.length, i + 4); j++) {
        const m = lines[j].match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
        if (m) { closesAt = m[1]; break; }
      }
      if (closesAt) break;
    }
  }

  let pool = '', players = '', myBet = '', myWin = '';
  for (let i = 0; i < lines.length; i++) {
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

  // Detectar estado a partir del texto completo (ej: "Esperando ganador", "Predicción cerrada")
  const textStatus = normalizePredictionStatus('', body, null);
  const derivedStatus = textStatus !== PredictionStatus.UNKNOWN
    ? textStatus
    : (closesAt ? PredictionStatus.OPEN : PredictionStatus.UNKNOWN);

  const markets = marketGroups.map((g, idx) => {
    const q = g.question;
    const selections = g.hits.map((h, sIdx) => ({
      id: `text-m${idx + 1}-s${sIdx + 1}`,
      name: h.name,
      label: h.name,
      percentage: h.percentage,
      points: 0,
      bettors: 0
    }));
    const type = classifyPrediction(q, selections);
    return {
      id: `m${idx + 1}`,
      question: q,
      type,
      status: derivedStatus,
      result: null,
      selections
    };
  });

  const primaryMarket = markets[0];
  const options = primaryMarket.selections.map(s => ({ name: s.name, percentage: s.percentage }));
  const teams = options.slice(0, 2);

  const stableId = (teams.length >= 2)
    ? teams.map(t => t.name.toLowerCase().replace(/\s+/g, '')).sort().join('-vs-')
    : primaryMarket.question.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);

  const meta = extractMapAndFormat(primaryMarket.question);

  return [{
    id: stableId,
    title: primaryMarket.question,
    question: primaryMarket.question,
    status: derivedStatus,
    result: null,
    closesAt,
    pool,
    players,
    myBet,
    myWin,
    predType: primaryMarket.type,
    playerName: primaryMarket.type === 'kills-range'
      ? extractPlayerNameFromQuestion(primaryMarket.question)
      : null,
    teams,
    options,
    markets,
    mapNumber: meta.mapNumber,
    format: meta.format,
    mapName: meta.mapName,
    seriesId: null,
    mapSignature: null,
    seriesScore: null
  }];
}

function parsePredictions(input) {
  if (input && typeof input === 'object' && ('prediction' in input || Array.isArray(input.predictions))) {
    return parsePredictionFromState(input);
  }
  if (typeof input === 'string') {
    return parsePredictionsFromText(input);
  }
  return [];
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

    // Detectar "GANASTE" o "PERDISTE" (o variantes con emojis/símbolos)
    const isWon  = u.includes('GANASTE') || u === '✓ GANASTE' || u === 'GANASTE ✓';
    const isLost = u.includes('PERDISTE') || u === '✗ PERDISTE' || u === 'PERDISTE ✗';

    if (!isWon && !isLost) continue;

    let winner = '', pointsChange = '';

    // Buscar hacia adelante y atrás para encontrar el ganador y los puntos
    const searchRange = lines.slice(Math.max(0, i - 15), Math.min(lines.length, i + 10));

    for (const line of searchRange) {
      // Cambio de puntos: "+9.156 pts", "-5.000 pts", "9.156 pts"
      if (/^[+\-]?[\d.,]+\s*pts?\.?$/i.test(line) && !pointsChange) {
        pointsChange = line.startsWith('+') || line.startsWith('-') ? line : (isWon ? '+' + line : '-' + line);
      }
      // "SI GANÁS" seguido de monto
      if (/^SI GAN[AÁ]S?$/i.test(line)) continue;
    }

    // Buscar el equipo ganador: línea de texto corta cerca del indicador
    for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
      const l = lines[j];
      if (l.length > 1 && l.length < 35 &&
          /^[A-ZÀ-ÿa-z0-9]/.test(l) &&
          !/^(TU JUGADA|SI GAN|POOL|JUGADORES|CIERRA|LIVE|EN VIVO|POR OPCI)/i.test(l) &&
          !/^\d+$/.test(l) &&
          !/^\d+[.,]\d+\s*pts?/i.test(l)) {
        winner = l;
        break;
      }
    }

    if (isWon || isLost) {
      console.log(`[Forg1] Resultado: ${isWon ? 'GANASTE' : 'PERDISTE'} | winner="${winner}" | pts="${pointsChange}"`);
      results.push({ winner, won: isWon, pointsChange });
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
  win.loadURL('https://www.forg1.com/predicciones');

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const poll = setInterval(async () => {
      try {
        const extraction = await win.webContents.executeJavaScript(`
          (async function() {
            try {
              const res = await fetch('/api/predictions/state', { cache: 'no-store' });
              if (res.ok) {
                const json = await res.json();
                // Si la API respondió, es la verdad aunque la lista venga vacía.
                // Antes una lista vacía caía al parser de texto, que leía la sección
                // "ÚLTIMOS RESULTADOS" y avisaba predicciones ya terminadas.
                if (json && typeof json === 'object' &&
                    ('prediction' in json || Array.isArray(json.predictions))) {
                  return { success: true, type: 'state', data: json };
                }
              }
            } catch (e) {}

            return {
              success: true,
              type: 'text',
              body: document.body ? document.body.innerText : ''
            };
          })()
        `);

        if (!extraction) return;

        const bodyForLoginCheck = extraction.type === 'text'
          ? (extraction.body || '')
          : (await win.webContents.executeJavaScript(`document.body ? document.body.innerText : ''`));

        if (bodyForLoginCheck && !isLoggedIn(bodyForLoginCheck)) {
          if (bodyForLoginCheck.includes('CONECTAR CON KICK')) {
            clearInterval(poll);
            resolve({ ready: true, loggedIn: false });
            return;
          }
        }

        if (extraction.type === 'state') {
          clearInterval(poll);
          const predictions = keepLivePredictions(parsePredictionFromState(extraction.data));
          const recentResults = parseRecentResults(bodyForLoginCheck || '');
          resolve({ ready: true, loggedIn: true, predictions, recentResults, raw: 'state-api' });
          return;
        }

        const body = extraction.body || '';
        if (body.length > 1000) {
          clearInterval(poll);
          const predictions = keepLivePredictions(parsePredictionsFromText(body));
          const recentResults = parseRecentResults(body);
          resolve({ ready: true, loggedIn: true, predictions, recentResults, raw: body.substring(0, 300) });
          return;
        }
      } catch (e) { /* SPA cargando */ }

      if (Date.now() - startTime > 30000) {
        clearInterval(poll);
        reject(new Error('Forg1 tardó demasiado en responder (30s). Revisá tu conexión.'));
      }
    }, 2500);
  });
}

function sanitizeUrl(rawUrl) {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    const sensitive = ['code', 'state', 'token', 'access_token', 'secret', 'authorization_code', 'ticket', 'session'];
    for (const key of sensitive) {
      if (u.searchParams.has(key)) {
        u.searchParams.set(key, '[REDACTED]');
      }
    }
    return u.toString();
  } catch (e) {
    return rawUrl;
  }
}

function openForg1Login() {
  console.log('[FORG1] create login window');
  const ses = session.fromPartition('persist:forg1');
  const chromeVersion = process.versions.chrome || '120.0.0.0';
  const cleanUA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  ses.setUserAgent(cleanUA);

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

  if (process.argv.includes('--dev')) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  win.webContents.setWindowOpenHandler((details) => {
    const target = details.url || '';
    console.log('[FORG1] setWindowOpenHandler:', sanitizeUrl(target), `(disposition: ${details.disposition})`);
    if (target.includes('forg1.com') || target.includes('kick.com')) {
      setImmediate(() => {
        if (!win.isDestroyed()) {
          win.loadURL(target);
        }
      });
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  const initialUrl = 'https://www.forg1.com/login';
  console.log('[FORG1] initial URL:', sanitizeUrl(initialUrl));

  win.webContents.on('will-navigate', (event, url) => {
    console.log('[FORG1] navigation:', sanitizeUrl(url));
  });

  win.webContents.on('will-redirect', (event, url) => {
    console.log('[FORG1] redirect:', sanitizeUrl(url));
  });

  win.webContents.on('did-finish-load', () => {
    console.log('[FORG1] load success:', sanitizeUrl(win.webContents.getURL()));
  });

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error(`[FORG1] load failure: code=${errorCode} desc="${errorDescription}" url=${sanitizeUrl(validatedURL)} mainFrame=${isMainFrame}`);
  });

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (level >= 2 || /error|fail|turnstile|block/i.test(message)) {
      console.log(`[FORG1] renderer console [lvl ${level}]: ${message} (${sourceId}:${line})`);
    }
  });

  win.webContents.on('render-process-gone', (event, details) => {
    console.error('[FORG1] renderer error (process gone):', details);
    if (!win.isDestroyed()) {
      console.log('[FORG1] recargando ventana para recuperar sesión tras fallo del renderer...');
      setImmediate(() => {
        if (!win.isDestroyed()) win.webContents.reload();
      });
    }
  });

  win.webContents.on('did-navigate', async (event, url, httpResponseCode, httpStatusText) => {
    console.log(`[FORG1] did-navigate: ${sanitizeUrl(url)} [HTTP ${httpResponseCode} ${httpStatusText || ''}]`);
    if (url.includes('forg1.com') && !url.includes('login') && !url.includes('kick-start') && !url.includes('kick-callback')) {
      try {
        const body = await win.webContents.executeJavaScript('document.body ? document.body.innerText : ""');
        if (isLoggedIn(body)) {
          console.log('[FORG1] login detected: usuario autenticado exitosamente');
        }
      } catch (e) {}
    }
  });

  win.loadURL(initialUrl);

  win.on('closed', () => {
    console.log('[FORG1] login window closed');
    if (_win && !_win.isDestroyed()) { _win.destroy(); _win = null; }
  });
  return win;
}

module.exports = {
  PredictionStatus,
  normalizePredictionStatus,
  scrapeForg1Predictions,
  openForg1Login,
  parsePredictionFromState,
  parsePredictionsFromText,
  parsePredictions,
  classifyPrediction,
  collectRawPredictions,
  isLivePrediction,
  isFinishedPrediction,
  keepLivePredictions,
  isMostKillsQuestion
};
