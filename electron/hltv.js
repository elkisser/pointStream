const { BrowserWindow } = require('electron');
const {
  parsePlayerMatchRows,
  parsePlayerMatchesFromText,
  pickPlayerFromSearch,
  nickKey,
  deleetKey,
  splitPlayerTeamHint
} = require('./player-kills');
const { resolveAlias } = require('./player-aliases');
const { canonicalTeamName } = require('./team-aliases');

// Aliases: nombre en forg1 -> nombre/búsqueda en HLTV
const TEAM_ALIASES = {
  'bestia': 'Bestia',
  'besitas': 'Bestia',
  'bestias': 'Bestia',
  'betboom team': 'BetBoom',
  'navi': 'Natus Vincere',
  'na vi': 'Natus Vincere',
  'natus vincere': 'Natus Vincere',
  'g2': 'G2',
  'g2 esports': 'G2',
  'faze': 'FaZe',
  'faze clan': 'FaZe',
  'vitality': 'Vitality',
  'team vitality': 'Vitality',
  'spirit': 'Spirit',
  'team spirit': 'Spirit',
  'mouz': 'MOUZ',
  'mousesports': 'MOUZ',
  'liquid': 'Liquid',
  'team liquid': 'Liquid',
  'falcons': 'Falcons',
  'team falcons': 'Falcons',
  'heroic': 'Heroic',
  'eternal fire': 'Eternal Fire',
  'eternalfire': 'Eternal Fire',
  'complexity': 'Complexity',
  'col': 'Complexity',
  'the mongolz': 'The MongolZ',
  'mongolz': 'The MongolZ',
  'pain': 'paiN',
  'pain gaming': 'paiN',
  '3dmax': '3DMAX',
  'saw': 'SAW',
  'big': 'BIG',
  'astralis': 'Astralis',
  'cloud9': 'Cloud9',
  'c9': 'Cloud9',
  'virtus.pro': 'Virtus.pro',
  'virtus pro': 'Virtus.pro',
  'vp': 'Virtus.pro',
  'monte': 'Monte',
  'rare atom': 'Rare Atom',
  'flyquest': 'FlyQuest',
  'wildcard': 'Wildcard',
  'imperial': 'Imperial',
  'gamerlegion': 'GamerLegion',
  'gl': 'GamerLegion',
  'fnatic': 'fnatic',
  'ence': 'ENCE',
  'nip': 'Ninjas in Pyjamas',
  'ninjas in pyjamas': 'Ninjas in Pyjamas',
  'apeks': 'Apeks',
  ' go fcb': '9 Pandas',
  '9 pandas': '9 Pandas',
  '9pandas': '9 Pandas',
  'tyloo': 'TYLOO',
  'lynn vision': 'Lynn Vision',
  'linn vision': 'Lynn Vision',   // typo frecuente del DOM de Forg1
  'lynnvision': 'Lynn Vision',
  'luminosity': 'Luminosity',
  'luminosity gaming': 'Luminosity',
  'aurora': 'Aurora',
  'm80': 'M80',
  'nrg': 'NRG',
  'b8': 'B8',
  'fluxo': 'Fluxo',
  'legacy': 'Legacy',
  'sangal': 'Sangal',
  'metizport': 'Metizport',
  'passion ua': 'Passion UA',
  'betera': 'Betera'
};

function normalizeTeamName(name) {
  const lower = (name || '').toLowerCase().trim();
  if (TEAM_ALIASES[lower]) return TEAM_ALIASES[lower];
  const canonical = canonicalTeamName(name);
  if (canonical !== name) return canonical;

  // Fuzzy: "besitas" → "bestia". Solo para nombres cortos (≤15 chars),
  // distancia de edición ≤ 2, y el nombre más cercano del mapa de ranking.
  const nk = normKey(lower);
  if (nk.length >= 4 && nk.length <= 15) {
    const { resolveTeamFuzzy } = require('./team-aliases');
    const hit = resolveTeamFuzzy(nk);
    if (hit) return hit;
  }
  return (name || '').trim();
}

function normKey(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

/**
 * Carga una URL de HLTV usando sesión persistente (mantiene cookie de Cloudflare).
 * Espera a que pase el challenge "Just a moment" antes de leer el contenido.
 *
 * @param {string} url
 * @param {string} [extractorBody] - Cuerpo de una función JS que corre DENTRO de la
 *   página (tiene acceso al DOM) y devuelve un objeto serializable. Si se omite,
 *   resuelve con { text, html }.
 */
function fetchHLTV(url, extractorBody) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 1366,
      height: 900,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: 'persist:hltv' // sesión persistente = cookie cf_clearance se guarda
      }
    });

    let settled = false;
    let poll = null;
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (poll) clearInterval(poll);
      try { win.destroy(); } catch (e) {}
      fn(val);
    };

    const timeout = setTimeout(() => finish(reject, new Error('Timeout HLTV')), 40000);

    win.webContents.on('did-finish-load', async () => {
      let tries = 0;
      let extractTries = 0;
      poll = setInterval(async () => {
        tries++;
        try {
          const state = await win.webContents.executeJavaScript(`
            (function() {
              const t = document.body.innerText || '';
              const challenge = t.includes('Just a moment') || t.includes('Verifying you are human')
                || t.includes('Checking your browser') || t.includes('Enable JavaScript and cookies');
              return { challenge, len: (document.documentElement.outerHTML || '').length };
            })()
          `);

          if (state.challenge) {
            if (tries > 30) {
              // Marcar HLTV como caído antes de rechazar
              try { require('electron').ipcMain.emit('hltv-cf-blocked'); } catch (e) {}
              finish(reject, new Error('Cloudflare bloqueó HLTV (usá "Conectar HLTV" una vez)'));
            }
            return;
          }
          if (state.len < 3000) {
            if (tries > 30) finish(reject, new Error('HLTV no cargó contenido'));
            return;
          }

          if (!extractorBody) {
            const full = await win.webContents.executeJavaScript(
              `(function(){ return { text: document.body.innerText || '', html: document.documentElement.outerHTML || '' }; })()`
            );
            finish(resolve, full);
            return;
          }

          extractTries++;
          const data = await win.webContents.executeJavaScript(`(function(){ ${extractorBody} })()`);
          const emptyArray = Array.isArray(data) && data.length === 0;
          const emptyRows = data && Array.isArray(data.rows) && data.rows.length === 0
            && !/\d{1,2}\s*[-–]\s*\d{1,2}/.test(data.text || '');
          const empty = data == null || emptyArray || emptyRows;
          if (!empty) { finish(resolve, data); return; }
          if (extractTries > 5) finish(resolve, data != null ? data : null);
        } catch (e) {
          if (tries > 30) finish(reject, e);
        }
      }, 700);
    });

    win.webContents.on('did-fail-load', (ev, code, desc) => {
      if (code === -3) return; // aborted, ignorar
      finish(reject, new Error(`HLTV fail: ${desc}`));
    });

    win.loadURL(url);
  });
}

// ---------------- Caches (aceleran re-escaneos y monitoreo) ----------------
const CACHE_TTL = 15 * 60 * 1000;  // resultados de equipo
const SEARCH_TTL = 60 * 60 * 1000; // búsqueda de equipo (1 hora)
const RANK_TTL = 30 * 60 * 1000;   // ranking mundial
let rankingCache = null, rankingTs = 0;
const searchCache = new Map(); // key -> { result, ts }
const resultsCache = new Map();

/** Devuelve el ranking cacheado en memoria sin hacer fetch (puede ser null si no cargó aún). */
function getRankingMapSync() {
  return rankingCache || null;
}

/**
 * Ranking mundial (cacheado). Devuelve un mapa normKey -> {id, slug, rank, name}.
 * Resolver el equipo desde acá evita la búsqueda (más rápido y confiable) y de
 * paso ya nos da el ranking. Es la primera petición, así "calienta" Cloudflare.
 */
async function getRankingMap() {
  if (rankingCache && Date.now() - rankingTs < RANK_TTL) return rankingCache;
  try {
    const list = await fetchHLTV('https://www.hltv.org/ranking/teams', `
      const out = [];
      document.querySelectorAll('.ranked-team').forEach(box => {
        const a = box.querySelector('a[href*="/team/"]');
        const nameEl = box.querySelector('.name');
        const posEl = box.querySelector('.position');
        if (a) {
          const m = (a.getAttribute('href') || '').match(/\\/team\\/(\\d+)\\/([\\w%.-]+)/);
          if (m) out.push({
            id: m[1], slug: m[2],
            name: (nameEl ? nameEl.textContent : '').trim(),
            rank: posEl ? parseInt((posEl.textContent || '').replace(/\\D/g, '')) : null
          });
        }
      });
      return out;
    `);
    const map = {};
    (list || []).forEach((t, i) => {
      const rank = t.rank || (i + 1);
      if (t.name) map[normKey(t.name)] = { id: t.id, slug: t.slug, rank, name: t.name };
      if (t.slug) {
        const sk = normKey(t.slug);
        if (!map[sk]) map[sk] = { id: t.id, slug: t.slug, rank, name: t.name || t.slug };
      }
    });
    rankingCache = map;
    rankingTs = Date.now();
    console.log(`[HLTV] Ranking cacheado: ${Object.keys(map).length} entradas`);
    return map;
  } catch (e) {
    console.error('[HLTV] ranking page:', e.message);
    return rankingCache || {};
  }
}

/**
 * Busca un equipo en HLTV (fallback cuando no está en el ranking top).
 */
async function searchTeam(teamName) {
  const normalized = normalizeTeamName(teamName);
  const ck = normKey(normalized);
  const cached = searchCache.get(ck);
  if (cached && Date.now() - cached.ts < SEARCH_TTL) return cached.result;

  console.log(`[HLTV] Buscando: "${teamName}" -> "${normalized}"`);
  let resolved = null;
  try {
    const results = await fetchHLTV(`https://www.hltv.org/search?query=${encodeURIComponent(normalized)}`, `
      const links = Array.from(document.querySelectorAll('a[href*="/team/"]'));
      const seen = new Set();
      const out = [];
      for (const a of links) {
        const m = (a.getAttribute('href') || '').match(/\\/team\\/(\\d+)\\/([\\w%.-]+)/);
        if (m && !seen.has(m[1])) { seen.add(m[1]); out.push({ id: m[1], slug: m[2] }); }
      }
      return out;
    `);

    if (results && results.length) {
      if (results.length > 1 && results.every(r => r.id === results[0].id)) {
        console.warn('[HLTV] Búsqueda con fallback de Cloudflare. Ignorada.');
      } else {
        resolved = { id: results[0].id, slug: results[0].slug, name: normalized };
        console.log(`[HLTV] OK: ${normalized} -> /team/${resolved.id}/${resolved.slug}`);
      }
    } else {
      console.log(`[HLTV] No encontrado: ${normalized}`);
    }
  } catch (err) {
    console.error(`[HLTV] Error buscando ${normalized}:`, err.message);
  }
  searchCache.set(ck, { result: resolved, ts: Date.now() });
  return resolved;
}

/**
 * IDs fijos de equipos en HLTV. Se usan cuando el nombre es ambiguo, el equipo
 * no está en el ranking top, o la búsqueda falla.
 */
const HLTV_TEAM_IDS = {
  barca: { id: '14107', slug: 'barca', name: 'BARCA' }
};

/**
 * IDs fijos de jugadores en HLTV. Cuando un jugador no aparece en la búsqueda
 * (Cloudflare bloqueó el endpoint, nombre muy genérico, etc.) se salta directo
 * a la página de stats con el ID. Clave: nickKey del nick tal como lo escribe Forg1.
 * Para agregar más: npm run dev -> ver el log "[HLTV] Buscando jugador" y agregar aquí.
 */
const HLTV_PLAYER_IDS = {
  // Aurora Gaming
  xantares:  { id: '7533',  slug: 'XANTARES' },
  woxic:     { id: '11816', slug: 'woxic'    },
  wicadia:   { id: '20636', slug: 'Wicadia'  },
  kyxsan:    { id: '15352', slug: 'kyxsan'   },
  jimpphat:  { id: '19744', slug: 'Jimpphat' },
  // Bestia / Latinoamérica
  buda:      { id: '10483', slug: 'buda'     },
  laser:     { id: '22770', slug: 'laser'    },
  zevy:      { id: '20065', slug: 'Zevy'     },
  meyern:    { id: '16267', slug: 'meyern'   },
  max:       { id: '19001', slug: 'max'      },
  // 100 Thieves
  device:    { id: '7592',  slug: 'device'   },
  // Natus Vincere
  aleksib:   { id: '10397', slug: 'aleksib'  },
  // Spirit
  donk:      { id: '22716', slug: 'donk'     },
  sh1ro:     { id: '12578', slug: 'sh1ro'    },
  zont1x:    { id: '20641', slug: 'zont1x'   },
  magixx:    { id: '19193', slug: 'magixx'   },
  // G2
  monesy:    { id: '19230', slug: 'm0NESY'   },
  m0nesy:    { id: '19230', slug: 'm0NESY'   },
  // Vitality
  zywoo:     { id: '11893', slug: 'ZywOo'    },
  // MOUZ
  torzsi:    { id: '18127', slug: 'torzsi'   },
  spinx:     { id: '14261', slug: 'Spinx'    },
  // FaZe
  karrigan:  { id: '429',   slug: 'karrigan' },
  ropz:      { id: '16803', slug: 'ropz'     },
  // Falcons
  niko:      { id: '3741',  slug: 'NiKo'     },
  // FURIA
  fallen:    { id: '1534',  slug: 'FalleN'   },
  kscerato:  { id: '11517', slug: 'KSCERATO' },
  yuurih:    { id: '11507', slug: 'yuurih'   },
  yekindar:  { id: '12011', slug: 'YEKINDAR' },
  molodoy:   { id: '22703', slug: 'molodoy'  },
};

/**
 * Resuelve un equipo: primero por ID fijo, luego por ranking, luego por búsqueda.
 */
async function resolveTeam(teamName) {
  const normalized = normalizeTeamName(teamName);
  const key = normKey(normalized);

  // 1. ID fijo: nunca falla por ranking ni por búsqueda.
  if (HLTV_TEAM_IDS[key]) {
    const pinned = HLTV_TEAM_IDS[key];
    console.log(`[HLTV] ID fijo: "${teamName}" → ${pinned.id}/${pinned.slug}`);
    return { id: pinned.id, slug: pinned.slug, rank: null, name: pinned.name };
  }

  const rmap = await getRankingMap();

  // Coincidencia exacta primero
  if (rmap[key]) return { ...rmap[key], name: normalized };

  // Coincidencia parcial SOLO si la clave es larga (≥6 chars) para evitar falsos positivos
  // Ejemplo: "luminosity" incluye "on" que matchea con "mouz" -> INCORRECTO
  // Solo permitir si la clave del ranking ESTÁ COMPLETAMENTE incluida en la búsqueda
  if (key.length >= 6) {
    for (const k of Object.keys(rmap)) {
      if (k.length >= 6 && (k === key.substring(0, k.length) || key === k.substring(0, key.length))) {
        // Verificar que es un prefijo real, no substring aleatorio
        if (key.startsWith(k) || k.startsWith(key)) {
          return { ...rmap[k], name: normalized };
        }
      }
    }
  }

  const s = await searchTeam(normalized);
  return s ? { id: s.id, slug: s.slug, rank: null, name: normalized } : null;
}

/**
 * Resultados recientes del equipo CON nombre de evento, desde la página de
 * resultados de HLTV (estructura estable). Sirve para forma reciente y por
 * competencia. Cacheado.
 */
async function getTeamResults(teamId, teamName) {
  const cached = resultsCache.get(teamId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  let rows = [];
  try {
    rows = await fetchHLTV(`https://www.hltv.org/results?team=${teamId}`, `
      const out = [];
      document.querySelectorAll('.result-con').forEach(con => {
        const teams = con.querySelectorAll('.team');
        const scoreEl = con.querySelector('.result-score');
        const evEl = con.querySelector('.event-name') || con.querySelector('.event');
        // Fecha: HLTV expone data-unix en el contenedor padre de cada día,
        // o en un elemento .date dentro del .result-con en algunas versiones del DOM.
        const dateEl = con.querySelector('[data-unix]') || con.closest('[data-unix]');
        const dateUnix = dateEl ? parseInt(dateEl.getAttribute('data-unix'), 10) : null;
        // Formato de serie (BO1/BO3/BO5) y href del partido
        const linkEl = con.querySelector('a[href*="/matches/"]') || con.closest('a[href*="/matches/"]');
        const href = linkEl ? linkEl.getAttribute('href') : null;
        const matchId = href ? (href.match(/\\/matches\\/(\\d+)\\//) || [])[1] : null;
        const formatEl = con.querySelector('.bestof, .map-count, .map-status');
        if (teams.length >= 2 && scoreEl) {
          const sm = (scoreEl.textContent || '').match(/(\\d+)\\D+(\\d+)/);
          if (sm) out.push({
            t1: teams[0].textContent.trim(),
            t2: teams[1].textContent.trim(),
            s1: parseInt(sm[1]), s2: parseInt(sm[2]),
            event: evEl ? evEl.textContent.trim() : '',
            dateUnix: Number.isFinite(dateUnix) ? dateUnix : null,
            format: formatEl ? (formatEl.textContent || '').trim() : null,
            matchId: matchId || null,
            href: href || null
          });
        }
      });
      return out.slice(0, 25);
    `) || [];
  } catch (e) {
    console.error('[HLTV] results', teamName, e.message);
  }

  const key = normKey(teamName);
  const results = [];
  for (const r of (rows || [])) {
    const k1 = normKey(r.t1), k2 = normKey(r.t2);
    let won = null, opponent = null, opponentKey = null;
    let score = null;
    if (k1 && (k1 === key || k1.includes(key) || key.includes(k1))) {
      won = r.s1 > r.s2;
      score = `${r.s1}-${r.s2}`;
      opponent = r.t2;
      opponentKey = k2;
    } else if (k2 && (k2 === key || k2.includes(key) || key.includes(k2))) {
      won = r.s2 > r.s1;
      score = `${r.s2}-${r.s1}`;
      opponent = r.t1;
      opponentKey = k1;
    } else { continue; }
    results.push({
      won,
      event: r.event,
      opponent: opponent || null,
      opponentKey: opponentKey || null,
      score: score || null,
      dateUnix: r.dateUnix || null,
      format: r.format || null,
      matchId: r.matchId || null
    });
  }
  resultsCache.set(teamId, { data: results, ts: Date.now() });
  return results;
}

/**
 * Forma en la competencia actual. Si es el primer partido del equipo en ese
 * evento (sin datos suficientes), usa la competencia más reciente con datos.
 */
function competitionForm(results) {
  if (!results || !results.length) return { event: '', wins: 0, losses: 0, total: 0, fallback: false };

  const withEvent = results.filter(r => r.event);
  if (!withEvent.length) {
    const last5 = results.slice(0, 5);
    return {
      event: '', fallback: true,
      wins: last5.filter(r => r.won === true).length,
      losses: last5.filter(r => r.won === false).length,
      total: last5.length
    };
  }

  const currentEvent = withEvent[0].event;
  let group = withEvent.filter(r => r.event === currentEvent);
  let eventName = currentEvent;
  let fallback = false;

  if (group.length < 2) {
    // primer partido (o casi) en este evento -> evento previo con >= 2 resultados
    const order = [];
    const byEvent = {};
    for (const r of withEvent) {
      if (!byEvent[r.event]) { byEvent[r.event] = []; order.push(r.event); }
      byEvent[r.event].push(r);
    }
    const prev = order.find(ev => ev !== currentEvent && byEvent[ev].length >= 2);
    if (prev) { group = byEvent[prev]; eventName = prev; fallback = true; }
  }

  return {
    event: eventName,
    wins: group.filter(r => r.won === true).length,
    losses: group.filter(r => r.won === false).length,
    total: group.length,
    fallback
  };
}

function buildTeamData(resolved, results) {
  if (!resolved) return null;
  const recent = (results || []).slice(0, 10);
  const wins = recent.filter(r => r.won === true).length;
  const losses = recent.filter(r => r.won === false).length;
  const winrate = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : null;
  const form = competitionForm(results || []);
  return {
    ranking: resolved.rank || null,
    winrate, wins, losses,
    event: form.event,
    eventWins: form.wins,
    eventLosses: form.losses,
    eventTotal: form.total,
    eventFallback: form.fallback
  };
}

/**
 * Procesa y contabiliza una lista de partidos extraídos del DOM de HLTV,
 * filtrando estrictamente los enfrentamientos directos entre team1 y team2.
 * Evita falsos positivos por substrings (ej. Liquid vs Liquid Academy) y
 * maneja inversión de local/visitante, empates y deduplicación.
 *
 * @param {Array<{matchId?: string, href?: string, t1: string, t2: string, s1: number, s2: number, event?: string}>} rawMatches
 * @param {string} [team1Name]
 * @param {string} [team2Name]
 * @returns {{ total: number, team1Wins: number, team2Wins: number, status: 'COMPLETE'|'EMPTY', matches: Array<any> }}
 */
function parseH2HMatches(rawMatches, team1Name = '', team2Name = '') {
  if (!Array.isArray(rawMatches) || !rawMatches.length) {
    return { total: 0, team1Wins: 0, team2Wins: 0, status: 'EMPTY', matches: [] };
  }

  const k1 = normKey(normalizeTeamName(team1Name));
  const k2 = normKey(normalizeTeamName(team2Name));

  const seen = new Set();
  const direct = [];

  for (const m of rawMatches) {
    if (!m || !m.t1 || !m.t2) continue;

    // Deduplicación por matchId o href si existe, o clave combinada
    const dedupKey = m.matchId || m.href || `${normKey(m.t1)}-${normKey(m.t2)}-${m.s1}-${m.s2}-${m.event || ''}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const mk1 = normKey(normalizeTeamName(m.t1));
    const mk2 = normKey(normalizeTeamName(m.t2));

    let isDirect = false;
    let t1IsFirst = true;

    if (!k1 || !k2) {
      // Sin nombres de referencia (compatibilidad por IDs solos)
      isDirect = true;
      t1IsFirst = true;
    } else if (mk1 === k1 && mk2 === k2) {
      isDirect = true;
      t1IsFirst = true;
    } else if (mk1 === k2 && mk2 === k1) {
      isDirect = true;
      t1IsFirst = false;
    }

    if (!isDirect) continue;

    // Validar scores numéricos
    const s1 = typeof m.s1 === 'number' && !isNaN(m.s1) ? m.s1 : null;
    const s2 = typeof m.s2 === 'number' && !isNaN(m.s2) ? m.s2 : null;

    if (s1 === null || s2 === null) continue;

    const scoreTeam1 = t1IsFirst ? s1 : s2;
    const scoreTeam2 = t1IsFirst ? s2 : s1;

    let winner = null;
    if (scoreTeam1 > scoreTeam2) winner = 'team1';
    else if (scoreTeam2 > scoreTeam1) winner = 'team2';
    // Si hay empate o 0-0, winner queda null (Zero Fake Data)

    direct.push({
      matchId: m.matchId || null,
      team1: t1IsFirst ? m.t1 : m.t2,
      team2: t1IsFirst ? m.t2 : m.t1,
      scoreTeam1,
      scoreTeam2,
      winner,
      event: m.event || ''
    });
  }

  const validSubset = direct.slice(0, 10);
  let t1Wins = 0, t2Wins = 0;

  for (const m of validSubset) {
    if (m.winner === 'team1') t1Wins++;
    else if (m.winner === 'team2') t2Wins++;
  }

  return {
    total: validSubset.length,
    team1Wins: t1Wins,
    team2Wins: t2Wins,
    status: validSubset.length > 0 ? 'COMPLETE' : 'EMPTY',
    matches: validSubset
  };
}

/**
 * Head-to-head estructurado entre dos equipos desde el DOM de HLTV.
 */
async function getH2H(team1Id, team2Id, team1Name = '', team2Name = '') {
  try {
    const rawMatches = await fetchHLTV(`https://www.hltv.org/results?team=${team1Id}&team=${team2Id}`, `
      const cons = document.querySelectorAll('.result-con');
      const seen = new Set();
      const out = [];
      cons.forEach(con => {
        const link = con.querySelector('a[href*="/matches/"]') || con.closest('a[href*="/matches/"]');
        const href = link ? link.getAttribute('href') : null;
        const matchId = href ? (href.match(/\\/matches\\/(\\d+)\\//) || [])[1] : null;
        if (matchId && seen.has(matchId)) return;
        if (matchId) seen.add(matchId);

        const teams = con.querySelectorAll('.team');
        const scoreEl = con.querySelector('.result-score');
        const evEl = con.querySelector('.event-name') || con.querySelector('.event');
        if (teams.length >= 2 && scoreEl) {
          const sm = (scoreEl.textContent || '').match(/(\\d+)\\D+(\\d+)/);
          if (sm) {
            out.push({
              matchId,
              href,
              t1: teams[0].textContent.trim(),
              t2: teams[1].textContent.trim(),
              s1: parseInt(sm[1], 10),
              s2: parseInt(sm[2], 10),
              event: evEl ? evEl.textContent.trim() : ''
            });
          }
        }
      });
      return out;
    `);

    return parseH2HMatches(rawMatches || [], team1Name, team2Name);
  } catch (err) {
    console.error('[HLTV] Error H2H:', err.message);
    return { total: 0, team1Wins: 0, team2Wins: 0, status: 'FAILED', matches: [], error: err.message };
  }
}

/**
 * Win rate de una competencia para un equipo (eventTotal > 0).
 */
function eventWinrate(d) {
  if (!d || !d.eventTotal) return null;
  const den = d.eventWins + d.eventLosses;
  return den > 0 ? Math.round((d.eventWins / den) * 100) : null;
}

/**
 * Busca la competencia en que se están enfrentando los dos equipos HOY.
 * Estrategia: tomar los resultados recientes (últimos 25) de ambos equipos
 * y buscar el evento que aparezca en común entre los últimos ~5 resultados de cada uno.
 * Si hay un partido reciente de A vs B, el evento de ese partido es la respuesta exacta.
 */
function getSharedEvent(res1, res2, team1Name, team2Name) {
  if (!res1?.length || !res2?.length) return null;

  // Estrategia 1: buscar el evento actual de ambos equipos (sus últimos partidos)
  // Si ambos están jugando en el mismo torneo → eso es lo que buscamos
  const recent1 = res1.slice(0, 6).map(r => r.event).filter(Boolean);
  const recent2 = res2.slice(0, 6).map(r => r.event).filter(Boolean);

  // Coincidencia exacta en los últimos resultados de ambos
  for (const ev of recent1) {
    if (recent2.includes(ev)) return { event: ev, source: 'shared-recent' };
  }

  // Estrategia 2: coincidencia parcial de nombre de evento (un evento puede tener
  // variaciones de nombre como "ESL Pro League S20" vs "ESL Pro League Season 20")
  for (const ev1 of recent1) {
    const k1 = ev1.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const ev2 of recent2) {
      const k2 = ev2.toLowerCase().replace(/[^a-z0-9]/g, '');
      // Si comparten al menos 8 caracteres clave seguidos
      if (k1.length > 6 && k2.length > 6) {
        const shorter = k1.length < k2.length ? k1 : k2;
        const longer  = k1.length < k2.length ? k2 : k1;
        if (longer.includes(shorter.substring(0, Math.min(shorter.length, 12)))) {
          return { event: ev1, source: 'shared-fuzzy' };
        }
      }
    }
  }

  // Estrategia 3: usar el evento actual del equipo 1 (más probable que sea el contexto)
  if (recent1[0]) return { event: recent1[0], source: 'team1-current' };

  return null;
}

/**
 * Obtiene los datos del enfrentamiento desde HLTV normalizados al contrato común.
 */
async function getMatchupData(team1Name, team2Name) {
  const norm1 = normalizeTeamName(team1Name);
  const norm2 = normalizeTeamName(team2Name);

  const r1 = await resolveTeam(team1Name);
  const r2 = await resolveTeam(team2Name);

  const found1 = !!r1;
  const found2 = !!r2;

  if (!found1 && !found2) {
    return {
      source: 'hltv',
      status: 'UNAVAILABLE',
      team1: { name: norm1, found: false, ranking: null, winrate: null, wins: 0, losses: 0, event: '', eventWins: 0, eventLosses: 0, eventTotal: 0, eventFallback: false },
      team2: { name: norm2, found: false, ranking: null, winrate: null, wins: 0, losses: 0, event: '', eventWins: 0, eventLosses: 0, eventTotal: 0, eventFallback: false },
      h2h: { total: 0, team1Wins: 0, team2Wins: 0 },
      sharedEvent: null
    };
  }

  let res1 = [], res2 = [];
  const tasks = [];
  let h2h = { total: 0, team1Wins: 0, team2Wins: 0 };
  if (r1) tasks.push(getTeamResults(r1.id, norm1).then(x => { res1 = x; }));
  if (r2) tasks.push(getTeamResults(r2.id, norm2).then(x => { res2 = x; }));
  if (r1 && r2) tasks.push(getH2H(r1.id, r2.id, norm1, norm2).then(x => { h2h = x; }));
  await Promise.all(tasks);

  const d1 = buildTeamData(r1, res1);
  const d2 = buildTeamData(r2, res2);

  const shared = getSharedEvent(res1, res2, norm1, norm2);

  let status = 'PARTIAL';
  if (found1 && found2 && (d1?.ranking || d1?.wins + d1?.losses > 0) &&
                          (d2?.ranking || d2?.wins + d2?.losses > 0)) {
    status = 'COMPLETE';
  }

  return {
    source: 'hltv',
    status,
    team1: {
      name: norm1,
      found: found1,
      ranking: d1?.ranking || null,
      winrate: d1?.winrate != null ? d1.winrate : null,
      wins: d1?.wins || 0,
      losses: d1?.losses || 0,
      event: d1?.event || '',
      eventWins: d1?.eventWins || 0,
      eventLosses: d1?.eventLosses || 0,
      eventTotal: d1?.eventTotal || 0,
      eventFallback: !!d1?.eventFallback
    },
    team2: {
      name: norm2,
      found: found2,
      ranking: d2?.ranking || null,
      winrate: d2?.winrate != null ? d2.winrate : null,
      wins: d2?.wins || 0,
      losses: d2?.losses || 0,
      event: d2?.event || '',
      eventWins: d2?.eventWins || 0,
      eventLosses: d2?.eventLosses || 0,
      eventTotal: d2?.eventTotal || 0,
      eventFallback: !!d2?.eventFallback
    },
    h2h,
    sharedEvent: shared ? shared.event : null,
    recentMatches1: res1.slice(0, 10),
    recentMatches2: res2.slice(0, 10)
  };
}

/**
 * Delegación principal hacia cs2-stats-service para asegurar que todas
 * las llamadas existentes a analyzeMatchup gocen del fallback robusto.
 */
async function analyzeMatchup(team1Name, team2Name, opts = {}) {
  const cs2StatsService = require('./cs2-stats-service');
  return cs2StatsService.analyzeMatchup(team1Name, team2Name, { ...opts, hltvProvider: { getMatchupData } });
}

/**
 * Abre una ventana VISIBLE de HLTV para pasar la verificación de Cloudflare una
 * sola vez. La cookie queda en la sesión persistente y el scraping la reutiliza.
 */
function openHLTVConnect() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'HLTV — Conectar (pasá la verificación una vez)',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:hltv'
    }
  });
  win.loadURL('https://www.hltv.org/');
  return win;
}

async function searchPlayerCandidates(playerName) {
  const query = String(playerName || '').trim();
  if (!query) return [];
  const ck = 'player-candidates:' + normKey(query);
  const cached = searchCache.get(ck);
  if (cached && Date.now() - cached.ts < SEARCH_TTL) return cached.result;

  let results = [];
  try {
    results = await fetchHLTV(`https://www.hltv.org/search?query=${encodeURIComponent(query)}`, `
      const seen = new Set();
      const out = [];
      const links = Array.from(document.querySelectorAll('a[href*="/player/"]'));
      for (const a of links) {
        const href = a.getAttribute('href') || '';
        const m = href.match(/\\/player\\/(\\d+)\\/([\\w%.-]+)\\/?$/);
        if (!m || seen.has(m[1])) continue;
        const name = (a.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!name || name.length > 24) continue;
        let team = null;
        const tr = a.closest('tr');
        if (tr) {
          const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.textContent || '').replace(/\\s+/g, ' ').trim());
          team = tds.find(t => t && t !== name && !/^player$/i.test(t) && t.length < 40) || null;
        }
        if (!team) {
          const box = a.closest('td, .search, li, div');
          const nearby = box ? (box.innerText || '').replace(/\\s+/g, ' ').trim() : '';
          const rest = nearby.replace(name, '').trim();
          if (rest && rest.length < 40 && !/player of the week/i.test(rest)) team = rest;
        }
        seen.add(m[1]);
        out.push({ id: m[1], slug: decodeURIComponent(m[2]), name, team });
      }
      return out;
    `) || [];
  } catch (err) {
    console.error(`[HLTV] Error buscando jugador ${query}:`, err.message);
  }

  searchCache.set(ck, { result: results, ts: Date.now() });
  return results;
}

async function searchPlayer(playerName, teamHints = []) {
  const query = String(playerName || '').trim();
  if (!query) return null;
  const ck = 'player:' + nickKey(query) + ':' + (teamHints || []).map(nickKey).join(',');
  const cached = searchCache.get(ck);
  if (cached && Date.now() - cached.ts < SEARCH_TTL) return cached.result;

  const results = await searchPlayerCandidates(query);
  const resolved = pickPlayerFromSearch(results, query, teamHints);
  if (resolved) {
    console.log(`[HLTV] Jugador OK: ${query} -> /player/${resolved.id}/${resolved.slug}${resolved.team ? ' (' + resolved.team + ')' : ''}`);
  } else {
    console.log(`[HLTV] Jugador no encontrado: ${query}`);
  }
  searchCache.set(ck, { result: resolved, ts: Date.now() });
  return resolved;
}

/**
 * Promedio real de kills por mapa reciente del jugador (HLTV).
 * ZERO FAKE DATA: si no hay mapas, maps = [] y found = false.
 */
const PLAYER_MAPS_EXTRACTOR = `
  const rows = [];
  const tables = Array.from(document.querySelectorAll('table'));
  const table = tables.find(t => /k\\s*-\\s*d|rating/i.test((t.innerText || '').slice(0, 800)))
    || document.querySelector('.stats-table, table.stats-table')
    || tables[0];
  const trs = table
    ? table.querySelectorAll('tbody tr, tr')
    : document.querySelectorAll('.stats-table tbody tr, table.stats-table tr');
  trs.forEach(tr => {
    const tds = Array.from(tr.querySelectorAll('td'));
    if (tds.length < 3) return;
    const mapEl = tr.querySelector('.statsMapPlayed, .stats-match-map, td.statsMapPlayed, .map-name, .stats-map');
    rows.push({
      date: (tds[0].textContent || '').trim(),
      map: mapEl ? (mapEl.textContent || '').trim() : null,
      opponent: null,
      cells: tds.map(td => (td.textContent || '').replace(/\\s+/g, ' ').trim()),
      tableText: ''
    });
  });
  return {
    rows: rows.slice(0, 40),
    text: table ? (table.innerText || '') : (document.body.innerText || '')
  };
`;

async function scrapePlayerMatchMaps(resolved) {
  const end = new Date();
  const start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
  const fmt = d => d.toISOString().slice(0, 10);
  const urls = [
    `https://www.hltv.org/stats/players/matches/${resolved.id}/${resolved.slug}?startDate=${fmt(start)}&endDate=${fmt(end)}`,
    `https://www.hltv.org/stats/players/matches/${resolved.id}/${resolved.slug}`
  ];

  for (const url of urls) {
    try {
      const data = await fetchHLTV(url, PLAYER_MAPS_EXTRACTOR);
      const rawRows = Array.isArray(data) ? data : (data && data.rows) || [];
      let maps = parsePlayerMatchRows(rawRows);
      if (!maps.length) {
        const text = (data && data.text) || '';
        maps = parsePlayerMatchesFromText(text);
      }
      if (maps.length) return maps.slice(0, 15);
    } catch (e) {
      console.error('[HLTV] player matches', resolved.slug || resolved.id, e.message);
    }
  }
  return [];
}

async function getPlayerKillStats(playerName, teamHints = []) {
  const parsed = splitPlayerTeamHint(playerName);
  // Sobrenombre del stream ("HUEVO") -> nick real en HLTV ("buda") + su equipo.
  const alias = resolveAlias(parsed.player || playerName);
  let query = alias ? alias.player : (parsed.player || playerName);
  const hints = [...(teamHints || [])];
  if (parsed.team) hints.push(parsed.team);
  if (alias && alias.team) hints.unshift(alias.team);
  if (alias) console.log(`[HLTV] Sobrenombre "${alias.alias}" -> ${alias.player}${alias.team ? ' (' + alias.team + ')' : ''}`);
  // Nombre que se muestra: el nick real. Si la pregunta usó solo el sobrenombre
  // ("HUEVO"), se aclara entre comillas para que se entienda de quién se habla.
  const label = (resolvedName) => {
    if (!alias) return resolvedName || playerName;
    // "dev1ce" -> device: es el mismo nick escrito distinto, se muestra como vino.
    if (deleetKey(alias.alias) === deleetKey(alias.player)) return alias.alias;
    const real = alias.player.charAt(0).toUpperCase() + alias.player.slice(1);
    const mentionsReal = nickKey(alias.alias).includes(nickKey(alias.player));
    return mentionsReal ? real : `${real} ("${alias.alias}")`;
  };

  // ID fijo: saltear búsqueda completamente y scrapeamos directo.
  const pinnedKey = nickKey(query);
  const pinned = HLTV_PLAYER_IDS[pinnedKey];
  if (pinned) {
    console.log(`[HLTV] ID fijo jugador: "${query}" → ${pinned.id}/${pinned.slug}`);
    const maps = await scrapePlayerMatchMaps({ id: pinned.id, slug: pinned.slug });
    if (maps.length) {
      return { found: true, playerName: label(pinned.slug), source: 'hltv',
        playerId: pinned.id, slug: pinned.slug, team: null, maps };
    }
    console.warn(`[HLTV] ID fijo ${pinned.id} no trajo mapas, intentando búsqueda normal`);
  }

  let candidates = await searchPlayerCandidates(query);
  // "APODO Nick" sin sobrenombre cargado: probar cada palabra (la última primero,
  // suele ser el nick real) hasta que HLTV encuentre un jugador.
  const words = String(query).trim().split(/\s+/).filter(w => w.length >= 3);
  if (!(candidates || []).length && words.length > 1) {
    for (const w of words.reverse()) {
      const c = await searchPlayerCandidates(w);
      if ((c || []).length) {
        console.log(`[HLTV] "${query}" no existe; pruebo con "${w}"`);
        candidates = c;
        query = w;
        break;
      }
    }
  }
  // "dev1ce" -> HLTV lo tiene como "device". Si la búsqueda no trae al jugador
  // exacto, se busca también la versión con letras y se juntan los resultados.
  const sameNick = (c) => nickKey(c.name) === nickKey(query) || nickKey(c.slug) === nickKey(query) ||
    deleetKey(c.name) === deleetKey(query) || deleetKey(c.slug) === deleetKey(query);
  const lettersOnly = deleetKey(query);
  if (!(candidates || []).some(sameNick) && lettersOnly !== nickKey(query)) {
    const more = await searchPlayerCandidates(lettersOnly);
    if ((more || []).length) {
      console.log(`[HLTV] "${query}" no apareció; pruebo con "${lettersOnly}"`);
      const ids = new Set((candidates || []).map(c => c.id));
      candidates = [...(candidates || []), ...more.filter(c => !ids.has(c.id))];
    }
  }
  const picked = pickPlayerFromSearch(candidates, query, hints);
  const exact = (candidates || []).filter(sameNick);
  const ordered = [];
  const pushUnique = (p) => {
    if (!p || ordered.some(x => x.id === p.id)) return;
    ordered.push(p);
  };
  pushUnique(picked);
  exact.forEach(pushUnique);

  if (!ordered.length) {
    return { found: false, playerName: label(alias ? null : query), source: 'hltv', maps: [] };
  }

  for (const resolved of ordered.slice(0, 3)) {
    const maps = await scrapePlayerMatchMaps(resolved);
    console.log(`[HLTV] ${resolved.name || query}: ${maps.length} mapas con kills`);
    if (maps.length) {
      return {
        found: true,
        playerName: label(resolved.name),
        source: 'hltv',
        playerId: resolved.id,
        slug: resolved.slug,
        team: resolved.team || null,
        maps
      };
    }
  }

  return {
    found: false,
    playerName: label(picked?.name),
    source: 'hltv',
    maps: []
  };
}

module.exports = {
  analyzeMatchup,
  getMatchupData,
  searchTeam,
  searchPlayer,
  searchPlayerCandidates,
  getPlayerKillStats,
  parsePlayerMatchRows,
  parsePlayerMatchesFromText,
  pickPlayerFromSearch,
  normalizeTeamName,
  openHLTVConnect,
  getH2H,
  parseH2HMatches,
  getRankingMapSync,
  normKey
};

