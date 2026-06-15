const { BrowserWindow } = require('electron');

// Aliases: nombre en forg1 -> nombre/búsqueda en HLTV
const TEAM_ALIASES = {
  'betboom': 'BetBoom',
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
  return TEAM_ALIASES[lower] || (name || '').trim();
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
            if (tries > 30) finish(reject, new Error('Cloudflare bloqueó HLTV (usá "Conectar HLTV" una vez)'));
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
          const empty = data == null || (Array.isArray(data) && data.length === 0);
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
const RANK_TTL = 30 * 60 * 1000;   // ranking mundial
let rankingCache = null, rankingTs = 0;
const searchCache = new Map();
const resultsCache = new Map();

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
  if (searchCache.has(ck)) return searchCache.get(ck);

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
  searchCache.set(ck, resolved);
  return resolved;
}

/**
 * Resuelve un equipo: primero por ranking (rápido y nos da el rank), si no, búsqueda.
 */
async function resolveTeam(teamName) {
  const normalized = normalizeTeamName(teamName);
  const key = normKey(normalized);
  const rmap = await getRankingMap();

  if (rmap[key]) return { ...rmap[key], name: normalized };
  // coincidencia parcial sólo con claves largas para evitar falsos positivos
  if (key.length >= 4) {
    for (const k of Object.keys(rmap)) {
      if (k.length >= 4 && (k.includes(key) || key.includes(k))) {
        return { ...rmap[k], name: normalized };
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
        if (teams.length >= 2 && scoreEl) {
          const sm = (scoreEl.textContent || '').match(/(\\d+)\\D+(\\d+)/);
          if (sm) out.push({
            t1: teams[0].textContent.trim(),
            t2: teams[1].textContent.trim(),
            s1: parseInt(sm[1]), s2: parseInt(sm[2]),
            event: evEl ? evEl.textContent.trim() : ''
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
    let won = null;
    if (k1 && (k1 === key || k1.includes(key) || key.includes(k1))) won = r.s1 > r.s2;
    else if (k2 && (k2 === key || k2.includes(key) || key.includes(k2))) won = r.s2 > r.s1;
    else continue;
    results.push({ won, event: r.event });
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
 * Head-to-head entre dos equipos.
 */
async function getH2H(team1Id, team2Id) {
  try {
    const { text } = await fetchHLTV(`https://www.hltv.org/results?team=${team1Id}&team=${team2Id}`);
    const scores = text.match(/\b(\d{1,2})\s*[-:]\s*(\d{1,2})\b/g) || [];
    let t1 = 0, t2 = 0;
    for (const s of scores.slice(0, 10)) {
      const p = s.split(/[-:]/).map(x => parseInt(x.trim()));
      if (p.length === 2 && !isNaN(p[0]) && !isNaN(p[1])) {
        if (p[0] > p[1]) t1++; else if (p[1] > p[0]) t2++;
      }
    }
    return { total: Math.min(scores.length, 10), team1Wins: t1, team2Wins: t2 };
  } catch (err) {
    console.error('[HLTV] Error H2H:', err.message);
    return { total: 0, team1Wins: 0, team2Wins: 0 };
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
 * Análisis completo de un enfrentamiento (rápido + por competencia).
 */
async function analyzeMatchup(team1Name, team2Name) {
  console.log(`[HLTV] ===== ${team1Name} vs ${team2Name} =====`);

  const A = {
    team1: { name: normalizeTeamName(team1Name), data: null, probability: 50, found: false },
    team2: { name: normalizeTeamName(team2Name), data: null, probability: 50, found: false },
    h2h: null,
    recommendation: '',
    confidence: 0,
    verdict: '',
    verdictLevel: 'gray',
    factors: [],
    dataQuality: 'none'
  };

  // resolveTeam(t1) hace la primera petición (ranking) y calienta Cloudflare.
  const r1 = await resolveTeam(team1Name);
  const r2 = await resolveTeam(team2Name);
  A.team1.found = !!r1;
  A.team2.found = !!r2;

  if (!r1 && !r2) {
    A.recommendation = 'Sin datos de HLTV';
    A.verdict = `No encontré ${A.team1.name} ni ${A.team2.name} en HLTV. Probá "Conectar HLTV" o guiate por el % de la comunidad.`;
    A.verdictLevel = 'gray';
    return A;
  }

  // Resultados de ambos + H2H EN PARALELO (cookie ya caliente)
  let res1 = [], res2 = [];
  const tasks = [];
  if (r1) tasks.push(getTeamResults(r1.id, A.team1.name).then(x => { res1 = x; }));
  if (r2) tasks.push(getTeamResults(r2.id, A.team2.name).then(x => { res2 = x; }));
  if (r1 && r2) tasks.push(getH2H(r1.id, r2.id).then(x => { A.h2h = x; }));
  await Promise.all(tasks);

  A.team1.data = buildTeamData(r1, res1);
  A.team2.data = buildTeamData(r2, res2);
  A.dataQuality = (r1 && r2) ? 'full' : 'partial';

  // ---- Scoring ----
  let s1 = 0, s2 = 0;
  const d1 = A.team1.data, d2 = A.team2.data;

  // Ranking
  if (d1?.ranking && d2?.ranking) {
    const diff = d2.ranking - d1.ranking;
    const bonus = Math.min(Math.abs(diff) * 1.5, 25);
    if (diff > 0) s1 += bonus; else s2 += bonus;
    A.factors.push(`📊 Ranking mundial: ${A.team1.name} #${d1.ranking} vs ${A.team2.name} #${d2.ranking}`);
  } else if (d1?.ranking) {
    s1 += 12;
    A.factors.push(`📊 ${A.team1.name} está #${d1.ranking} en el mundo; ${A.team2.name} sin ranking top`);
  } else if (d2?.ranking) {
    s2 += 12;
    A.factors.push(`📊 ${A.team2.name} está #${d2.ranking} en el mundo; ${A.team1.name} sin ranking top`);
  }

  // Forma reciente (últimos partidos)
  if (d1?.winrate != null && d2?.winrate != null) {
    const diff = d1.winrate - d2.winrate;
    const bonus = Math.min(Math.abs(diff) * 0.35, 14);
    if (diff > 0) s1 += bonus; else s2 += bonus;
    A.factors.push(`📈 Forma reciente: ${A.team1.name} ${d1.wins}V-${d1.losses}D (${d1.winrate}%) vs ${A.team2.name} ${d2.wins}V-${d2.losses}D (${d2.winrate}%)`);
  }

  // Forma EN LA COMPETENCIA (pesa más: es el contexto del partido)
  const e1 = eventWinrate(d1), e2 = eventWinrate(d2);
  if (e1 != null && e2 != null) {
    const diff = e1 - e2;
    const bonus = Math.min(Math.abs(diff) * 0.45, 18);
    if (diff > 0) s1 += bonus; else s2 += bonus;
  }
  if (d1?.event || d2?.event) {
    const evName = d1?.event || d2?.event;
    const tag1 = (d1 && d1.eventTotal > 0) ? `${A.team1.name} ${d1.eventWins}V-${d1.eventLosses}D${d1.eventFallback ? ' (evento previo)' : ''}` : `${A.team1.name} sin datos`;
    const tag2 = (d2 && d2.eventTotal > 0) ? `${A.team2.name} ${d2.eventWins}V-${d2.eventLosses}D${d2.eventFallback ? ' (evento previo)' : ''}` : `${A.team2.name} sin datos`;
    A.factors.push(`🏆 En ${evName}: ${tag1} | ${tag2}`);
  }

  // Head to head
  if (A.h2h?.total > 0) {
    s1 += A.h2h.team1Wins * 4;
    s2 += A.h2h.team2Wins * 4;
    A.factors.push(`⚔️ Historial directo: ${A.team1.name} ${A.h2h.team1Wins} - ${A.h2h.team2Wins} ${A.team2.name}`);
  }

  // Solo uno con datos
  if (r1 && !r2) { s1 += 15; A.factors.push(`ℹ️ Solo ${A.team1.name} tiene datos en HLTV`); }
  if (r2 && !r1) { s2 += 15; A.factors.push(`ℹ️ Solo ${A.team2.name} tiene datos en HLTV`); }

  // Normalizar (blend 78% datos / 22% base)
  const total = s1 + s2;
  if (total > 0) {
    const raw1 = (s1 / total) * 100;
    A.team1.probability = Math.max(15, Math.min(85, Math.round(raw1 * 0.78 + 50 * 0.22)));
    A.team2.probability = 100 - A.team1.probability;
  }

  const fav = A.team1.probability >= A.team2.probability ? A.team1 : A.team2;
  const und = A.team1.probability >= A.team2.probability ? A.team2 : A.team1;
  const diff = fav.probability - und.probability;

  A.recommendation = fav.name;
  A.confidence = fav.probability;

  if (A.factors.length === 0) {
    A.verdict = `Datos limitados de HLTV. ${fav.name} sale levemente favorito pero con poca info. Apuesta chica.`;
    A.verdictLevel = 'gray';
  } else if (diff >= 24) {
    A.verdict = `APOSTAR A ${fav.name.toUpperCase()} — ventaja sólida (${fav.probability}% vs ${und.probability}%). Buena si el multiplicador es mayor a 1.2x.`;
    A.verdictLevel = 'green';
  } else if (diff >= 12) {
    A.verdict = `${fav.name.toUpperCase()} FAVORITO — ventaja moderada (${fav.probability}% vs ${und.probability}%). Apostá con cabeza, no todo.`;
    A.verdictLevel = 'yellow';
  } else {
    A.verdict = `PARTIDO PAREJO — apenas ${diff}% de diferencia. Conviene SKIP o apuesta mínima. Mucho riesgo.`;
    A.verdictLevel = 'red';
  }

  return A;
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

module.exports = { analyzeMatchup, searchTeam, normalizeTeamName, openHLTVConnect };
