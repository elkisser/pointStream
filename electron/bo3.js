// electron/bo3.js
// Proveedor de estadísticas de CS2 para BO3.gg (Fuente Fallback)
// Utiliza la API pública https://api.bo3.gg/api/v1 (REST JSON)
// Cumple estrictamente con la política ZERO FAKE DATA.

const https = require('https');
const { StatsStatus, createEmptyTeamStats, createNormalizedStats } = require('./cs2-provider');

const BO3_API_BASE = 'https://api.bo3.gg/api/v1';
const REQUEST_TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutos de caché en memoria

// Cachés en memoria
const teamCache = new Map();     // slug/name -> { team, ts }
const rankedTeamsCache = { list: null, ts: 0 };
const matchesCache = new Map();  // teamId -> { matches, ts }

// Mapeo conocido de aliases comunes a slugs canónicos de BO3.gg
const KNOWN_SLUGS = {
  'mouz': 'mousesports',
  'mousesports': 'mousesports',
  'faze': 'faze',
  'faze clan': 'faze',
  'navi': 'natus-vincere',
  'natus vincere': 'natus-vincere',
  'spirit': 'spirit',
  'team spirit': 'spirit',
  'vitality': 'vitality',
  'team vitality': 'vitality',
  'falcons': 'falcons-esports',
  'team falcons': 'falcons-esports',
  'g2': 'g2',
  'g2 esports': 'g2',
  'astralis': 'astralis',
  'virtus.pro': 'virtus-pro',
  'virtus pro': 'virtus-pro',
  'vp': 'virtus-pro',
  'liquid': 'liquid',
  'team liquid': 'liquid',
  'heroic': 'heroic',
  'nip': 'ninjas-in-pyjamas',
  'ninjas in pyjamas': 'ninjas-in-pyjamas',
  'ence': 'ence',
  'furia': 'furia',
  'eternal fire': 'eternal-fire',
  'ef': 'eternal-fire',
  'betboom': 'betboom-team',
  'betboom team': 'betboom-team',
  'aurora': 'aurora-gaming',
  'aurora gaming': 'aurora-gaming',
  '9z': '9z',
  '9z team': '9z',
  'pain': 'pain-gaming',
  'pain gaming': 'pain-gaming',
  'mibr': 'mibr',
  'big': 'big',
  'the mongolz': 'the-mongolz',
  'mongolz': 'the-mongolz',
  'complexity': 'complexity-gaming',
  'flyquest': 'flyquest'
};

function normalizeSlug(rawName) {
  if (!rawName) return '';
  const clean = String(rawName).trim().toLowerCase();
  if (KNOWN_SLUGS[clean]) return KNOWN_SLUGS[clean];
  return clean.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Petición HTTP GET con promesas y timeout a la API de BO3.gg.
 */
function fetchBO3(endpoint) {
  return new Promise((resolve, reject) => {
    const url = endpoint.startsWith('http') ? endpoint : `${BO3_API_BASE}${endpoint}`;
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
        'Accept': 'application/json'
      },
      timeout: REQUEST_TIMEOUT_MS
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`[BO3] Error parseando JSON de ${url}: ${e.message}`));
          }
        } else if (res.statusCode === 404) {
          resolve(null);
        } else {
          reject(new Error(`[BO3] Error HTTP ${res.statusCode} en ${url}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`[BO3] Timeout después de ${REQUEST_TIMEOUT_MS}ms en ${url}`));
    });

    req.on('error', (err) => {
      reject(new Error(`[BO3] Error de red: ${err.message}`));
    });
  });
}

/**
 * Obtiene la lista de equipos rankeados (top 50) para resolución de nombres y rankings.
 */
async function getRankedTeams() {
  if (rankedTeamsCache.list && (Date.now() - rankedTeamsCache.ts < CACHE_TTL_MS)) {
    return rankedTeamsCache.list;
  }
  try {
    const data = await fetchBO3('/teams?page[limit]=50&sort=rank&filter[teams.rank][not_eq_null]=true');
    if (data && Array.isArray(data.results)) {
      rankedTeamsCache.list = data.results;
      rankedTeamsCache.ts = Date.now();
      return data.results;
    }
  } catch (err) {
    console.warn('[BO3] No se pudo obtener lista de ranking:', err.message);
  }
  return rankedTeamsCache.list || [];
}

/**
 * Resuelve un equipo por nombre o slug en BO3.gg.
 * ZERO FAKE DATA: Si el equipo no tiene ranking, ranking es null.
 */
async function resolveTeam(teamName) {
  if (!teamName) return null;
  const slug = normalizeSlug(teamName);
  const cacheKey = slug || teamName.toLowerCase().trim();

  const cached = teamCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts < CACHE_TTL_MS)) {
    return cached.team;
  }

  // 1. Intentar resolver contra la lista de equipos rankeados
  const ranked = await getRankedTeams();
  const foundRanked = ranked.find(t => {
    const s = (t.slug || '').toLowerCase();
    const n = (t.name || '').toLowerCase();
    const k = cacheKey.toLowerCase();
    return s === slug || n === k || s === k || n === teamName.toLowerCase();
  });

  if (foundRanked) {
    const teamObj = {
      id: foundRanked.id,
      slug: foundRanked.slug,
      name: foundRanked.name,
      rank: typeof foundRanked.rank === 'number' ? foundRanked.rank : null
    };
    teamCache.set(cacheKey, { team: teamObj, ts: Date.now() });
    return teamObj;
  }

  // 2. Intentar buscar directo por slug en endpoint /teams/{slug}
  try {
    const direct = await fetchBO3(`/teams/${slug}`);
    if (direct && direct.id) {
      const teamObj = {
        id: direct.id,
        slug: direct.slug || slug,
        name: direct.name || teamName,
        rank: typeof direct.rank === 'number' ? direct.rank : null
      };
      teamCache.set(cacheKey, { team: teamObj, ts: Date.now() });
      return teamObj;
    }
  } catch (e) {
    // 404 o no encontrado
  }

  // No encontrado
  teamCache.set(cacheKey, { team: null, ts: Date.now() });
  return null;
}

/**
 * Obtiene los partidos finalizados recientes de un equipo (hasta 25).
 */
async function getTeamMatches(teamId) {
  if (!teamId) return [];
  const cached = matchesCache.get(teamId);
  if (cached && (Date.now() - cached.ts < CACHE_TTL_MS)) {
    return cached.matches;
  }

  try {
    const endpoint = `/matches?page[offset]=0&page[limit]=25&sort=-start_date&filter[matches.status][in]=finished,defwin&filter[matches.team_ids][overlap]=${teamId}&filter[matches.discipline_id][eq]=1&with=tournament,teams`;
    const data = await fetchBO3(endpoint);
    const results = [];
    if (data && Array.isArray(data.results)) {
      for (const m of data.results) {
        const isWinner = m.winner_team_id === teamId;
        const tournamentName = m.tournament?.name || '';
        results.push({
          id: m.id,
          team1Id: m.team1_id,
          team2Id: m.team2_id,
          won: isWinner,
          event: tournamentName,
          startDate: m.start_date
        });
      }
    }
    matchesCache.set(teamId, { matches: results, ts: Date.now() });
    return results;
  } catch (err) {
    console.warn(`[BO3] Error obteniendo partidos para team ${teamId}:`, err.message);
    return [];
  }
}

/**
 * Extrae la forma del torneo actual (o torneo previo si el actual tiene < 2 partidos).
 * Mantiene la misma lógica exacta que HLTV.
 */
function extractCompetitionForm(matches) {
  if (!matches || !matches.length) {
    return { event: '', wins: 0, losses: 0, total: 0, fallback: false };
  }

  const withEvent = matches.filter(m => m.event);
  if (!withEvent.length) {
    const last5 = matches.slice(0, 5);
    return {
      event: '',
      fallback: true,
      wins: last5.filter(m => m.won === true).length,
      losses: last5.filter(m => m.won === false).length,
      total: last5.length
    };
  }

  const currentEvent = withEvent[0].event;
  let group = withEvent.filter(m => m.event === currentEvent);
  let eventName = currentEvent;
  let fallback = false;

  if (group.length < 2) {
    const order = [];
    const byEvent = {};
    for (const m of withEvent) {
      if (!byEvent[m.event]) { byEvent[m.event] = []; order.push(m.event); }
      byEvent[m.event].push(m);
    }
    const prev = order.find(ev => ev !== currentEvent && byEvent[ev].length >= 2);
    if (prev) {
      group = byEvent[prev];
      eventName = prev;
      fallback = true;
    }
  }

  return {
    event: eventName,
    wins: group.filter(m => m.won === true).length,
    losses: group.filter(m => m.won === false).length,
    total: group.length,
    fallback
  };
}

/**
 * Construye los datos de un equipo a partir de su resolución y partidos recientes.
 * ZERO FAKE DATA: No inventar campos.
 */
function buildTeamStats(resolved, matches) {
  if (!resolved) return null;
  const recent = (matches || []).slice(0, 10);
  const wins = recent.filter(m => m.won === true).length;
  const losses = recent.filter(m => m.won === false).length;
  const winrate = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : null;
  const form = extractCompetitionForm(matches || []);

  return {
    name: resolved.name,
    found: true,
    ranking: resolved.rank != null ? resolved.rank : null,
    winrate,
    wins,
    losses,
    event: form.event,
    eventWins: form.wins,
    eventLosses: form.losses,
    eventTotal: form.total,
    eventFallback: form.fallback
  };
}

/**
 * Calcula el H2H filtrando enfrentamientos directos entre ambos equipos.
 */
function computeH2H(matches1, team1Id, team2Id) {
  if (!matches1 || !team1Id || !team2Id) return { total: 0, team1Wins: 0, team2Wins: 0 };
  const direct = matches1.filter(m =>
    (m.team1Id === team1Id && m.team2Id === team2Id) ||
    (m.team1Id === team2Id && m.team2Id === team1Id)
  );

  let t1Wins = 0, t2Wins = 0;
  for (const m of direct.slice(0, 10)) {
    if (m.won) t1Wins++;
    else t2Wins++;
  }

  return {
    total: Math.min(direct.length, 10),
    team1Wins: t1Wins,
    team2Wins: t2Wins
  };
}

/**
 * Detecta si ambos equipos comparten competencia en sus partidos recientes.
 */
function detectSharedEvent(matches1, matches2) {
  if (!matches1?.length || !matches2?.length) return null;
  const recent1 = matches1.slice(0, 6).map(m => m.event).filter(Boolean);
  const recent2 = matches2.slice(0, 6).map(m => m.event).filter(Boolean);

  for (const ev of recent1) {
    if (recent2.includes(ev)) return ev;
  }
  return recent1[0] || null;
}

/**
 * Obtiene el matchup completo desde BO3.gg normalizado al contrato común.
 */
async function getMatchupData(team1Name, team2Name) {
  console.log(`[BO3] Obteniendo datos para: "${team1Name}" vs "${team2Name}"...`);
  try {
    const [r1, r2] = await Promise.all([
      resolveTeam(team1Name),
      resolveTeam(team2Name)
    ]);

    const found1 = !!r1;
    const found2 = !!r2;

    if (!found1 && !found2) {
      console.log(`[BO3] Ninguno de los dos equipos fue encontrado ("${team1Name}", "${team2Name}")`);
      return createNormalizedStats({
        source: 'bo3gg',
        status: StatsStatus.UNAVAILABLE,
        team1Name,
        team2Name
      });
    }

    const [matches1, matches2] = await Promise.all([
      found1 ? getTeamMatches(r1.id) : Promise.resolve([]),
      found2 ? getTeamMatches(r2.id) : Promise.resolve([])
    ]);

    const team1Data = found1 ? buildTeamStats(r1, matches1) : createEmptyTeamStats(team1Name);
    const team2Data = found2 ? buildTeamStats(r2, matches2) : createEmptyTeamStats(team2Name);

    const h2h = (found1 && found2) ? computeH2H(matches1, r1.id, r2.id) : { total: 0, team1Wins: 0, team2Wins: 0 };
    const sharedEvent = (found1 && found2) ? detectSharedEvent(matches1, matches2) : null;

    let status = StatsStatus.PARTIAL;
    if (found1 && found2 && (team1Data.ranking || team1Data.wins + team1Data.losses > 0) &&
                            (team2Data.ranking || team2Data.wins + team2Data.losses > 0)) {
      status = StatsStatus.COMPLETE;
    }

    console.log(`[BO3] Matchup procesado. Status: ${status}. Found: ${found1}/${found2}`);

    return createNormalizedStats({
      source: 'bo3gg',
      status,
      team1Name,
      team2Name,
      team1: team1Data,
      team2: team2Data,
      h2h,
      sharedEvent
    });
  } catch (err) {
    console.error(`[BO3] Error crítico en getMatchupData:`, err.message);
    return createNormalizedStats({
      source: 'bo3gg',
      status: StatsStatus.FAILED,
      team1Name,
      team2Name
    });
  }
}

module.exports = {
  resolveTeam,
  getTeamMatches,
  getMatchupData,
  normalizeSlug,
  fetchBO3
};
