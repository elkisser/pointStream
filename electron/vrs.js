// electron/vrs.js
// Proveedor de estadísticas CS2 basado en el ranking oficial de Valve (VRS,
// Valve Regional Standings): https://github.com/ValveSoftware/counter-strike_regional_standings
//
// Por qué es la red de seguridad: son archivos Markdown estáticos en GitHub
// (raw.githubusercontent.com). No hay Cloudflare, captcha ni login, y Valve los
// actualiza todos los meses. Si GitHub tampoco responde, se usa la última copia
// guardada en disco.
//
// Qué aporta (ZERO FAKE DATA, todo sale de los archivos de Valve):
// - ranking: puesto global del roster.
// - wins / losses / winrate: últimos 10 partidos del roster (tabla de "details").
// - h2h: partidos entre ambos equipos en la ventana de 6 meses de Valve.
// No aporta forma en el torneo actual (eventTotal queda en 0).

const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { StatsStatus, createEmptyTeamStats, createNormalizedStats } = require('./cs2-provider');

const REPO = 'ValveSoftware/counter-strike_regional_standings';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main`;
const API_BASE = `https://api.github.com/repos/${REPO}/contents`;
const HTTP_TIMEOUT = 8000;
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 h: Valve publica una vez por mes
const RECENT_MATCHES = 10;

// Nombres que Forg1 / HLTV escriben distinto a Valve. Clave y valor ya normalizados.
const ALIASES = {
  navi: 'natusvincere',
  nip: 'ninjasinpyjamas',
  vp: 'virtuspro',
  mongolz: 'themongolz',
  mousesports: 'mouz',
  col: 'complexity',
  eg: 'evilgeniuses',
  bb: 'betboom',
  bbteam: 'betboom',
  betboomteam: 'betboom',
  '9zglobant': '9z',
  '9zglobantxduki': '9z'
};

function normKey(name) {
  let canon = name;
  try {
    const { canonicalTeamName } = require('./team-aliases');
    canon = canonicalTeamName(name) || name;
  } catch (e) {}
  let k = String(canon || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  // Sufijos/prefijos de organización que no forman parte del nombre del equipo.
  k = k.replace(/^team\s+/, '').replace(/\s+(team|esports?|gaming|clan|gg)$/g, '');
  k = k.replace(/\s+/g, '');
  return ALIASES[k] || k;
}

// ----------------- Caché (memoria + disco) -----------------
let memory = { fetchedAt: 0, date: null, year: null, teams: null, details: {} };

function cacheFile() {
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') return path.join(app.getPath('userData'), 'vrs-cache.json');
  } catch (e) { /* fuera de Electron (tests) */ }
  return null;
}

function loadDiskCache() {
  const f = cacheFile();
  if (!f) return null;
  try {
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (data && Array.isArray(data.teams) && data.teams.length) return data;
  } catch (e) { /* sin caché */ }
  return null;
}

function saveDiskCache() {
  const f = cacheFile();
  if (!f || !memory.teams) return;
  try {
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(memory), 'utf8');
    fs.renameSync(tmp, f);
  } catch (e) {
    console.warn('[VRS] No se pudo guardar la caché:', e.message);
  }
}

// ----------------- HTTP -----------------
async function getText(url) {
  const { data } = await axios.get(url, {
    timeout: HTTP_TIMEOUT,
    responseType: 'text',
    transformResponse: [(d) => d],
    headers: { 'User-Agent': 'pointStream', Accept: 'application/vnd.github+json, text/plain, */*' }
  });
  return typeof data === 'string' ? data : JSON.stringify(data);
}

// ----------------- Parsers (puros, testeables) -----------------
function parseStandings(md) {
  const teams = [];
  const re = /^\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*\[details\]\(([^)]+)\)/;
  for (const line of String(md || '').split(/\r?\n/)) {
    const m = line.match(re);
    if (!m) continue;
    teams.push({
      rank: Number(m[1]),
      points: Number(m[2]),
      name: m[3].trim(),
      roster: m[4].split(',').map(s => s.trim()).filter(Boolean),
      details: m[5].trim(),
      key: normKey(m[3])
    });
  }
  return teams;
}

// Tabla "Match Played | Match ID | Date | Opponent | W/L | ...". Viene del más nuevo al más viejo.
function parseDetails(md) {
  const matches = [];
  const re = /^\|\s*\d+\s*\|\s*\d+\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*([^|]+?)\s*\|\s*([WL])\s*\|/;
  for (const line of String(md || '').split(/\r?\n/)) {
    const m = line.match(re);
    if (!m) continue;
    matches.push({ date: m[1], opponent: m[2].trim(), opponentKey: normKey(m[2]), won: m[3] === 'W' });
  }
  matches.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return matches;
}

function findTeam(teams, name) {
  const key = normKey(name);
  if (!key) return null;
  // Ordenados por puesto: si hay dos rosters con el mismo nombre, gana el mejor rankeado.
  return (teams || []).find(t => t.key === key) || null;
}

function buildTeamStats(teamName, entry, matches) {
  const base = createEmptyTeamStats(teamName);
  if (!entry) return base;
  const recent = (matches || []).slice(0, RECENT_MATCHES);
  const wins = recent.filter(m => m.won).length;
  const losses = recent.length - wins;
  return {
    ...base,
    found: true,
    ranking: entry.rank,
    vrsPoints: entry.points,
    wins,
    losses,
    winrate: recent.length > 0 ? Math.round((wins / recent.length) * 100) : null,
    roster: entry.roster && entry.roster.length ? {
      players: entry.roster.map(p => ({ nickname: p })),
      source: 'vrs'
    } : null
  };
}

function computeH2H(matches1, team2Key) {
  const h = (matches1 || []).filter(m => m.opponentKey === team2Key);
  const team1Wins = h.filter(m => m.won).length;
  return { total: h.length, team1Wins, team2Wins: h.length - team1Wins };
}

// ----------------- Descubrimiento de la última publicación -----------------
function mondaysBack(days) {
  const out = [];
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i <= days; i++) {
    const x = new Date(d.getTime() - i * 86400000);
    if (x.getUTCDay() === 1) out.push(x);
  }
  return out;
}

const fmtDate = (d) => `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}_${String(d.getUTCDate()).padStart(2, '0')}`;

async function discoverLatest() {
  const year = new Date().getUTCFullYear();
  // 1) API de GitHub: lista de archivos del año (y el anterior en enero).
  for (const y of [year, year - 1]) {
    try {
      const list = JSON.parse(await getText(`${API_BASE}/live/${y}`));
      const dates = (Array.isArray(list) ? list : [])
        .map(f => (f && f.name || '').match(/^standings_global_(\d{4}_\d{2}_\d{2})\.md$/))
        .filter(Boolean).map(m => m[1]).sort();
      if (dates.length) return { year: y, date: dates[dates.length - 1] };
    } catch (e) {
      console.warn(`[VRS] API de GitHub no respondió (${y}):`, e.response?.status || e.message);
      break; // si la API falla (rate limit), probar directo con raw
    }
  }
  // 2) Sin API: Valve publica los lunes. Probar lunes recientes contra raw.
  for (const d of mondaysBack(75)) {
    const date = fmtDate(d);
    const y = d.getUTCFullYear();
    try {
      const md = await getText(`${RAW_BASE}/live/${y}/standings_global_${date}.md`);
      if (/\[details\]\(/.test(md)) return { year: y, date, md };
    } catch (e) { /* 404: ese lunes no hubo publicación */ }
  }
  return null;
}

async function ensureStandings() {
  if (memory.teams && Date.now() - memory.fetchedAt < CACHE_TTL) return memory;
  try {
    const latest = await discoverLatest();
    if (latest) {
      if (latest.date === memory.date && memory.teams) {
        memory.fetchedAt = Date.now();
        return memory;
      }
      const md = latest.md || await getText(`${RAW_BASE}/live/${latest.year}/standings_global_${latest.date}.md`);
      const teams = parseStandings(md);
      if (teams.length) {
        memory = { fetchedAt: Date.now(), date: latest.date, year: latest.year, teams, details: {} };
        saveDiskCache();
        console.log(`[VRS] Ranking de Valve ${latest.date}: ${teams.length} equipos`);
        return memory;
      }
    }
  } catch (e) {
    console.warn('[VRS] No se pudo actualizar el ranking:', e.message);
  }
  // 3) Sin red: última copia en memoria o disco.
  if (memory.teams) return memory;
  const disk = loadDiskCache();
  if (disk) {
    console.log(`[VRS] Usando ranking guardado en disco (${disk.date})`);
    memory = { ...disk, details: disk.details || {} };
    return memory;
  }
  return null;
}

// Roster oficial de un equipo según Valve (para buscar sus mapas en HLTV).
async function getRoster(teamName) {
  const state = await ensureStandings();
  const entry = state ? findTeam(state.teams, teamName) : null;
  return entry ? { name: entry.name, rank: entry.rank, roster: entry.roster.slice() } : null;
}

async function getMatches(state, entry) {
  if (!entry) return [];
  const cached = state.details[entry.details];
  if (cached) return cached;
  try {
    const md = await getText(`${RAW_BASE}/live/${state.year}/${entry.details}`);
    const matches = parseDetails(md);
    state.details[entry.details] = matches;
    saveDiskCache();
    return matches;
  } catch (e) {
    console.warn(`[VRS] Sin detalle de ${entry.name}:`, e.message);
    return [];
  }
}

async function getMatchupData(team1Name, team2Name) {
  try {
    const state = await ensureStandings();
    if (!state) {
      return createNormalizedStats({ source: 'vrs', status: StatsStatus.FAILED, team1Name, team2Name });
    }
    const e1 = findTeam(state.teams, team1Name);
    const e2 = findTeam(state.teams, team2Name);
    console.log(`[VRS] "${team1Name}" -> ${e1 ? `#${e1.rank} ${e1.name}` : 'no está'} | "${team2Name}" -> ${e2 ? `#${e2.rank} ${e2.name}` : 'no está'}`);

    if (!e1 && !e2) {
      return createNormalizedStats({ source: 'vrs', status: StatsStatus.UNAVAILABLE, team1Name, team2Name });
    }

    const [m1, m2] = await Promise.all([getMatches(state, e1), getMatches(state, e2)]);
    // H2H desde el lado que tenga detalle; si es desde team2, se invierte.
    let h2h = { total: 0, team1Wins: 0, team2Wins: 0 };
    if (e1 && e2) {
      if (m1.length) h2h = computeH2H(m1, e2.key);
      else if (m2.length) {
        const r = computeH2H(m2, e1.key);
        h2h = { total: r.total, team1Wins: r.team2Wins, team2Wins: r.team1Wins };
      }
    }

    return createNormalizedStats({
      source: 'vrs',
      status: e1 && e2 ? StatsStatus.COMPLETE : StatsStatus.PARTIAL,
      team1Name,
      team2Name,
      team1: buildTeamStats(team1Name, e1, m1),
      team2: buildTeamStats(team2Name, e2, m2),
      h2h,
      recentMatches1: m1.slice(0, 5),
      recentMatches2: m2.slice(0, 5)
    });
  } catch (err) {
    console.error('[VRS] Error en getMatchupData:', err.message);
    return createNormalizedStats({ source: 'vrs', status: StatsStatus.FAILED, team1Name, team2Name });
  }
}

module.exports = {
  getMatchupData,
  getRoster,
  normKey,
  parseStandings,
  parseDetails,
  findTeam,
  computeH2H,
  buildTeamStats
};
