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

/**
 * Carga una URL de HLTV usando sesión persistente (mantiene cookie de Cloudflare).
 * Espera a que pase el challenge "Just a moment" antes de leer el contenido.
 */
function fetchHLTV(url, waitForSelector) {
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
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { win.destroy(); } catch (e) {}
      fn(val);
    };

    const timeout = setTimeout(() => finish(reject, new Error('Timeout HLTV')), 35000);

    win.webContents.on('did-finish-load', async () => {
      // Polling: esperar a que Cloudflare resuelva y el contenido aparezca
      let tries = 0;
      const poll = setInterval(async () => {
        tries++;
        try {
          const state = await win.webContents.executeJavaScript(`
            (function() {
              const t = document.body.innerText || '';
              const challenge = t.includes('Just a moment') || t.includes('Verifying you are human') || t.includes('Checking your browser');
              const html = document.documentElement.outerHTML;
              return { challenge, len: html.length, text: t, html: html };
            })()
          `);

          // Si todavía está el challenge de Cloudflare, seguir esperando
          if (state.challenge) {
            if (tries > 18) finish(reject, new Error('Cloudflare bloqueó HLTV'));
            return;
          }

          // Contenido cargado
          if (state.len > 5000) {
            finish(resolve, { text: state.text, html: state.html });
          } else if (tries > 18) {
            finish(reject, new Error('HLTV no cargó contenido'));
          }
        } catch (e) {
          if (tries > 18) finish(reject, e);
        }
      }, 1500);
    });

    win.webContents.on('did-fail-load', (ev, code, desc) => {
      if (code === -3) return; // aborted, ignorar
      finish(reject, new Error(`HLTV fail: ${desc}`));
    });

    win.loadURL(url, {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    });
  });
}

/**
 * Busca un equipo en HLTV. Devuelve {id, slug, name} o null.
 */
async function searchTeam(teamName) {
  const normalized = normalizeTeamName(teamName);
  console.log(`[HLTV] Buscando: "${teamName}" -> "${normalized}"`);

  try {
    const { html } = await fetchHLTV(`https://www.hltv.org/search?query=${encodeURIComponent(normalized)}`);

    const teamPattern = /\/team\/(\d+)\/([\w%.-]+)/g;
    const seen = new Set();
    const matches = [];
    let m;
    while ((m = teamPattern.exec(html)) !== null) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        matches.push({ id: m[1], slug: m[2] });
      }
    }

    if (matches.length > 0) {
      console.log(`[HLTV] OK: ${normalized} -> /team/${matches[0].id}/${matches[0].slug}`);
      return { id: matches[0].id, slug: matches[0].slug, name: normalized };
    }
    console.log(`[HLTV] No encontrado: ${normalized}`);
    return null;
  } catch (err) {
    console.error(`[HLTV] Error buscando ${normalized}:`, err.message);
    return null;
  }
}

/**
 * Perfil del equipo: ranking, winrate, forma, jugadores, racha.
 */
async function getTeamProfile(teamId, teamSlug) {
  try {
    const { text, html } = await fetchHLTV(`https://www.hltv.org/team/${teamId}/${teamSlug}`);

    // Ranking mundial
    let ranking = null;
    const rankPatterns = [
      /World ranking[\s\S]{0,30}?#(\d+)/i,
      /#(\d+)[\s\S]{0,30}?World ranking/i,
      /Ranking[\s\S]{0,15}?#(\d+)/i
    ];
    for (const p of rankPatterns) {
      const mm = text.match(p);
      if (mm) { ranking = parseInt(mm[1]); break; }
    }

    // Forma reciente: HLTV muestra "Last matches" con W/L
    // Buscar secuencia de W/L
    const formSection = text.match(/(?:Last matches|Recent results)([\s\S]{0,400})/i);
    let recentForm = [];
    if (formSection) {
      recentForm = (formSection[1].match(/\b[WL]\b/g) || []).slice(0, 10);
    }
    if (recentForm.length === 0) {
      recentForm = (text.match(/\b[WL]\b/g) || []).slice(0, 8);
    }
    const wins = recentForm.filter(r => r === 'W').length;
    const losses = recentForm.filter(r => r === 'L').length;
    const winrate = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : null;

    // Racha actual
    let streak = '';
    if (recentForm.length > 0) {
      const first = recentForm[0];
      let count = 0;
      for (const r of recentForm) { if (r === first) count++; else break; }
      streak = `${count}${first}`;
    }

    // Jugadores
    const playerPattern = /\/player\/(\d+)\/([\w%-]+)/g;
    const players = [];
    const seenP = new Set();
    let pm;
    while ((pm = playerPattern.exec(html)) !== null && players.length < 5) {
      const nick = decodeURIComponent(pm[2]).replace(/-/g, ' ');
      if (!seenP.has(pm[1]) && nick.length < 20) {
        seenP.add(pm[1]);
        players.push(nick);
      }
    }

    return { ranking, winrate, wins, losses, recentForm, players, streak };
  } catch (err) {
    console.error(`[HLTV] Error profile ${teamSlug}:`, err.message);
    return { ranking: null, winrate: null, wins: 0, losses: 0, recentForm: [], players: [], streak: '' };
  }
}

/**
 * Map pool stats.
 */
async function getTeamMaps(teamId) {
  try {
    const { text } = await fetchHLTV(`https://www.hltv.org/stats/teams/maps/${teamId}`);
    const maps = [];
    const mapNames = ['Mirage', 'Inferno', 'Nuke', 'Overpass', 'Ancient', 'Anubis', 'Dust2', 'Vertigo', 'Train'];
    for (const name of mapNames) {
      const re = new RegExp(name + '[\\s\\S]{0,80}?(\\d{1,3}(?:\\.\\d)?)%', 'i');
      const mm = text.match(re);
      if (mm) maps.push({ map: name, winrate: Math.round(parseFloat(mm[1])) });
    }
    return maps.sort((a, b) => b.winrate - a.winrate).slice(0, 5);
  } catch (err) {
    console.error('[HLTV] Error maps:', err.message);
    return [];
  }
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
 * Análisis completo de un enfrentamiento.
 */
async function analyzeMatchup(team1Name, team2Name) {
  console.log(`[HLTV] ===== ${team1Name} vs ${team2Name} =====`);

  const A = {
    team1: { name: normalizeTeamName(team1Name), data: null, maps: [], probability: 50, found: false },
    team2: { name: normalizeTeamName(team2Name), data: null, maps: [], probability: 50, found: false },
    h2h: null,
    recommendation: '',
    confidence: 0,
    verdict: '',
    verdictLevel: 'gray',
    factors: [],
    dataQuality: 'none'
  };

  const [t1, t2] = await Promise.all([searchTeam(team1Name), searchTeam(team2Name)]);
  A.team1.found = !!t1;
  A.team2.found = !!t2;

  // Caso: no se encontró ninguno
  if (!t1 && !t2) {
    A.recommendation = 'Sin datos de HLTV';
    A.verdict = `No se encontraron ${A.team1.name} ni ${A.team2.name} en HLTV. Puede ser por bloqueo de Cloudflare o equipos no listados. Guiate por el favorito del crowd.`;
    A.verdictLevel = 'gray';
    A.factors.push('No se pudieron obtener datos de ninguno de los equipos');
    return A;
  }

  // Obtener datos de los que sí se encontraron
  const tasks = [];
  if (t1) {
    tasks.push(getTeamProfile(t1.id, t1.slug).then(d => A.team1.data = d));
    tasks.push(getTeamMaps(t1.id).then(d => A.team1.maps = d));
  }
  if (t2) {
    tasks.push(getTeamProfile(t2.id, t2.slug).then(d => A.team2.data = d));
    tasks.push(getTeamMaps(t2.id).then(d => A.team2.maps = d));
  }
  if (t1 && t2) {
    tasks.push(getH2H(t1.id, t2.id).then(d => A.h2h = d));
  }
  await Promise.all(tasks);

  A.dataQuality = (t1 && t2) ? 'full' : 'partial';

  // --- Scoring ---
  let s1 = 0, s2 = 0;
  const d1 = A.team1.data;
  const d2 = A.team2.data;

  // Ranking
  if (d1?.ranking && d2?.ranking) {
    const diff = d2.ranking - d1.ranking;
    const bonus = Math.min(Math.abs(diff) * 1.5, 25);
    if (diff > 0) s1 += bonus; else s2 += bonus;
    A.factors.push(`📊 Ranking mundial: ${A.team1.name} #${d1.ranking} vs ${A.team2.name} #${d2.ranking}`);
  } else if (d1?.ranking) {
    A.factors.push(`📊 ${A.team1.name} está #${d1.ranking} en el mundo; ${A.team2.name} sin ranking top`);
    s1 += 12;
  } else if (d2?.ranking) {
    A.factors.push(`📊 ${A.team2.name} está #${d2.ranking} en el mundo; ${A.team1.name} sin ranking top`);
    s2 += 12;
  }

  // Winrate
  if (d1?.winrate != null && d2?.winrate != null) {
    const diff = d1.winrate - d2.winrate;
    const bonus = Math.min(Math.abs(diff) * 0.4, 15);
    if (diff > 0) s1 += bonus; else s2 += bonus;
    A.factors.push(`📈 Winrate reciente: ${A.team1.name} ${d1.winrate}% vs ${A.team2.name} ${d2.winrate}%`);
  }

  // Racha
  if (d1?.streak) {
    if (d1.streak.includes('W')) s1 += Math.min(parseInt(d1.streak) * 3, 12);
    if (d1.streak.includes('L')) s2 += Math.min(parseInt(d1.streak) * 2, 8);
  }
  if (d2?.streak) {
    if (d2.streak.includes('W')) s2 += Math.min(parseInt(d2.streak) * 3, 12);
    if (d2.streak.includes('L')) s1 += Math.min(parseInt(d2.streak) * 2, 8);
  }
  if (d1?.streak || d2?.streak) {
    A.factors.push(`🔥 Racha: ${A.team1.name} ${d1?.streak || '—'} | ${A.team2.name} ${d2?.streak || '—'}`);
  }

  // Forma W/L
  if (d1 && d2 && (d1.wins + d1.losses > 0 || d2.wins + d2.losses > 0)) {
    s1 += d1.wins * 2;
    s2 += d2.wins * 2;
    A.factors.push(`⚡ Últimos partidos: ${A.team1.name} ${d1.wins}V-${d1.losses}D | ${A.team2.name} ${d2.wins}V-${d2.losses}D`);
  }

  // H2H
  if (A.h2h?.total > 0) {
    s1 += A.h2h.team1Wins * 5;
    s2 += A.h2h.team2Wins * 5;
    A.factors.push(`⚔️ Historial directo: ${A.team1.name} ${A.h2h.team1Wins} - ${A.h2h.team2Wins} ${A.team2.name}`);
  }

  // Map pool
  if (A.team1.maps.length && A.team2.maps.length) {
    const avg1 = A.team1.maps.reduce((s, m) => s + m.winrate, 0) / A.team1.maps.length;
    const avg2 = A.team2.maps.reduce((s, m) => s + m.winrate, 0) / A.team2.maps.length;
    if (Math.abs(avg1 - avg2) > 4) {
      const bonus = Math.min(Math.abs(avg1 - avg2) * 0.3, 10);
      if (avg1 > avg2) s1 += bonus; else s2 += bonus;
    }
    A.factors.push(`🗺️ Promedio en mapas: ${A.team1.name} ${Math.round(avg1)}% | ${A.team2.name} ${Math.round(avg2)}%`);
  }

  // Si solo encontramos uno, darle ventaja por tener presencia en HLTV
  if (t1 && !t2) { s1 += 15; A.factors.push(`ℹ️ Solo ${A.team1.name} tiene datos en HLTV`); }
  if (t2 && !t1) { s2 += 15; A.factors.push(`ℹ️ Solo ${A.team2.name} tiene datos en HLTV`); }

  // Normalizar (blend 75% datos / 25% base para no ser extremo)
  const total = s1 + s2;
  if (total > 0) {
    const raw1 = (s1 / total) * 100;
    A.team1.probability = Math.round(raw1 * 0.75 + 50 * 0.25);
    A.team1.probability = Math.max(15, Math.min(85, A.team1.probability));
    A.team2.probability = 100 - A.team1.probability;
  }

  // Recomendación
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

module.exports = { analyzeMatchup, searchTeam, normalizeTeamName };
