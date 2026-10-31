// electron/player-kills.js
// Análisis de predicciones de kills por promedio real del jugador.
// ZERO FAKE DATA: nunca inventa kills, rangos ni recomendaciones sin sample.

/**
 * Extrae K-D de filas de la tabla de mapas de un jugador en HLTV.
 * Ignora la primera celda (fecha) para no confundir 31-10 con kills.
 */
const KD_CELL_RE = /^(\d{1,2})\s*[-–]\s*(\d{1,2})$/;

function parseKdPair(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const m = t.match(KD_CELL_RE);
  if (!m) return null;
  const kills = parseInt(m[1], 10);
  const deaths = parseInt(m[2], 10);
  if (kills > 50 || deaths > 50) return null;
  return { kills, deaths };
}

function parsePlayerMatchRows(rawRows) {
  const maps = [];
  const seen = new Set();
  for (const row of rawRows || []) {
    if (!row) continue;
    const cells = Array.isArray(row.cells) ? row.cells : [];
    const rest = cells.slice(1).map(c => String(c || '').replace(/\s+/g, ' ').trim());
    const mapFromRow = row.map && canonicalMapName(row.map) ? row.map : null;
    const mapIdx = rest.findIndex(t => canonicalMapName(t));
    const map = mapFromRow || (mapIdx >= 0 ? rest[mapIdx] : null);

    const kdHits = rest
      .map((t, i) => ({ i, kd: parseKdPair(t) }))
      .filter(x => x.kd);
    if (!kdHits.length) continue;
    // En HLTV el K-D viene DESPUÉS del mapa (anc / d2 / cch). El marcador 13-2 no.
    const afterMap = mapIdx >= 0 ? kdHits.find(x => x.i > mapIdx) : null;
    const picked = afterMap || kdHits[kdHits.length - 1];
    const { kills, deaths } = picked.kd;

    const key = `${row.date || ''}|${map || ''}|${kills}-${deaths}|${maps.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Marcador del mapa: HLTV lo muestra entre paréntesis junto a cada equipo,
    // "Nemiga (13)" / "FURIA (2)". Solo se toma lo que está antes del mapa.
    const beforeMap = (mapIdx >= 0 ? rest.slice(0, mapIdx) : rest.slice(0, picked.i)).join(' ');
    const rs = [...beforeMap.matchAll(/\((\d{1,2})\)/g)].map(x => parseInt(x[1], 10));
    const rounds = rs.length >= 2 ? { team: rs[0], opponent: rs[1] } : null;
    maps.push({
      kills,
      deaths,
      map,
      opponent: row.opponent || null,
      date: row.date || null,
      rounds
    });
  }
  return maps;
}

/**
 * Fallback cuando el DOM de HLTV no expone .stats-table: parsea el texto de la tabla.
 * Filas reales: "31/10/26 Nemiga (13) FURIA (2) anc 15 - 9 +6 1.44"
 */
function parsePlayerMatchesFromText(text) {
  const src = String(text || '');
  if (!src) return [];
  const mapToken = Object.values(MAP_ALIASES).flat().concat(Object.keys(MAP_ALIASES)).join('|');
  const re = new RegExp(
    `(\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})([\\s\\S]{0,80}?)\\b(${mapToken})\\b[\\s\\S]{0,40}?(\\d{1,2})\\s*[-–]\\s*(\\d{1,2})`,
    'gi'
  );
  const rows = [];
  let m;
  while ((m = re.exec(src)) && rows.length < 40) {
    rows.push({
      date: m[1],
      map: m[3],
      // m[2] = "Nemiga (13) FURIA (2)": se conserva para leer el marcador del mapa.
      cells: [m[1], m[2].trim(), m[3], `${m[4]} - ${m[5]}`],
      opponent: null
    });
  }
  return parsePlayerMatchRows(rows);
}

/**
 * Elige el jugador HLTV correcto entre homónimos (robo Nemiga vs ROBO retirado).
 * Prefiere nick exacto + equipo del partido en curso.
 */
function pickPlayerFromSearch(results, query, teamHints = []) {
  const list = Array.isArray(results) ? results.filter(r => r && r.id) : [];
  if (!list.length) return null;

  const qk = nickKey(query);
  const hints = (teamHints || []).map(nickKey).filter(Boolean);

  const ranked = list.map((r, i) => {
    const nk = nickKey(r.name);
    const sk = nickKey(r.slug);
    const tk = nickKey(r.team);
    let score = 0;
    if (qk && (nk === qk || sk === qk)) score += 100;
    else if (qk && (nk.startsWith(qk) || qk.startsWith(nk)) && Math.min(nk.length, qk.length) >= 3) score += 25;
    if (hints.length && tk && hints.some(h => h === tk || h.includes(tk) || tk.includes(h))) score += 80;
    if (r.team) score += 15;
    score -= i * 0.01;
    return { r, score };
  }).sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best || best.score < 50) return null;
  return best.r;
}

function extractPlayerNameFromQuestion(question) {
  const s = String(question || '').replace(/[¿?¡!]+/g, ' ').trim();
  if (!s) return null;

  const patterns = [
    /cu[aá]nt[oa]s?\s+kills?\s+(?:hace\s+(?:el\s+)?)?(?:de\s+)?(.+)$/i,
    /cu[aá]nt[oa]s?\s+mata\s+(.+)$/i,
    /kills?\s+(?:de|del|de\s+el)\s+(.+)$/i,
    /bajas\s+(?:de|del)\s+(.+)$/i,
    /frags?\s+(?:de|del)\s+(.+)$/i
  ];

  for (const re of patterns) {
    const m = s.match(re);
    if (m && m[1]) {
      const parsed = splitPlayerTeamHint(m[1].replace(/\s+/g, ' ').trim());
      const name = parsed.player;
      if (name.length >= 2 && name.length <= 24) return name;
    }
  }
  return null;
}

function isKillRangeLabel(label) {
  const t = String(label || '').toLowerCase().trim();
  if (!t) return false;
  if (/^\d+\s*[-–]\s*\d+$/.test(t)) return true;
  if (/^\+\d+$/.test(t)) return true;
  if (/^\d+\s*a\s*\d+$/.test(t)) return true;
  if (/^\d+\s*o\s*menos/.test(t)) return true;
  if (/^\d+\s*o\s*m[aá]s/.test(t)) return true;
  if (/menos\s+de\s+\d/.test(t)) return true;
  if (/m[aá]s\s+de\s+\d/.test(t)) return true;
  return false;
}

function parseKillRange(label) {
  const t = String(label || '').toLowerCase().replace(',', '.').trim();
  if (!t) return null;

  let m = t.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (m) return { min: Number(m[1]), max: Number(m[2]), openMax: false };

  m = t.match(/^(\d+)\s*a\s*(\d+)$/);
  if (m) return { min: Number(m[1]), max: Number(m[2]), openMax: false };

  m = t.match(/^(\d+)\s*o\s*menos/);
  if (m) return { min: 0, max: Number(m[1]), openMax: false };

  m = t.match(/^(\d+)\s*o\s*m[aá]s/);
  if (m) return { min: Number(m[1]), max: Infinity, openMax: true };

  m = t.match(/^\+(\d+)$/);
  if (m) return { min: Number(m[1]), max: Infinity, openMax: true };

  m = t.match(/menos\s+de\s+(\d+(?:\.\d+)?)/);
  if (m) return { min: 0, max: Math.floor(Number(m[1]) - 0.0001), openMax: false };

  m = t.match(/m[aá]s\s+de\s+(\d+(?:\.\d+)?)/);
  if (m) {
    const n = Number(m[1]);
    return { min: Number.isInteger(n) ? n + 1 : Math.ceil(n), max: Infinity, openMax: true };
  }

  return null;
}

function rangeContains(range, value) {
  if (!range || value == null || !Number.isFinite(value)) return false;
  if (value < range.min) return false;
  if (range.openMax) return value >= range.min;
  return value <= range.max;
}

function rangeMidpoint(range) {
  if (!range) return null;
  if (range.openMax) return range.min + 2;
  return (range.min + range.max) / 2;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

function emptyKillAnalysis(playerName, reason) {
  return {
    kind: 'kills',
    source: 'none',
    status: 'UNAVAILABLE',
    playerName: playerName || null,
    avgKills: null,
    typicalLow: null,
    typicalHigh: null,
    mapsSampled: 0,
    recentKills: [],
    recommendation: '',
    confidence: 0,
    verdict: reason || 'No hay stats de kills para este jugador. Guiate por el % de la comunidad.',
    verdictLevel: 'gray',
    dataQuality: 'none',
    factors: [],
    hitRate: null
  };
}

function scoreKillPrediction(options, stats) {
  const playerName = stats?.playerName || null;
  const maps = Array.isArray(stats?.maps) ? stats.maps.filter(m => m && Number.isFinite(m.kills)) : [];

  if (!playerName || maps.length === 0) {
    return emptyKillAnalysis(playerName, playerName
      ? `No encontré mapas recientes de ${playerName} en HLTV. Guiate por el % de la comunidad.`
      : 'No pude identificar al jugador de la predicción. Guiate por el % de la comunidad.');
  }

  const kills = maps.map(m => m.kills);
  const avg = kills.reduce((a, b) => a + b, 0) / kills.length;
  const sorted = [...kills].sort((a, b) => a - b);
  const typicalLow = percentile(sorted, 0.25);
  const typicalHigh = percentile(sorted, 0.75);

  const opts = (options || []).map((o, i) => {
    const label = o.name || o.label || '';
    return {
      label,
      range: parseKillRange(label),
      percentage: o.percentage,
      index: i
    };
  }).filter(o => o.range);

  let recommendation = '';
  let hitCount = 0;
  const avgRounded = round1(avg);

  if (opts.length) {
    const containing = opts.filter(o => rangeContains(o.range, avg));
    if (containing.length === 1) {
      recommendation = containing[0].label;
    } else if (containing.length > 1) {
      containing.sort((a, b) => Math.abs(rangeMidpoint(a.range) - avg) - Math.abs(rangeMidpoint(b.range) - avg));
      recommendation = containing[0].label;
    } else {
      opts.sort((a, b) => Math.abs(rangeMidpoint(a.range) - avg) - Math.abs(rangeMidpoint(b.range) - avg));
      recommendation = opts[0].label;
    }

    const recOpt = opts.find(o => o.label === recommendation);
    if (recOpt) hitCount = kills.filter(k => rangeContains(recOpt.range, k)).length;
  }

  const hitRate = recommendation && kills.length ? Math.round((hitCount / kills.length) * 100) : null;
  const band = `${typicalLow}–${typicalHigh}`;

  const factors = [
    `🎯 ${playerName} promedia ${avgRounded} kills por mapa (últimos ${kills.length})`,
    `📉 Rango habitual: ${band} kills`
  ];
  if (recommendation && hitRate != null) {
    factors.push(`📌 El rango "${recommendation}" cubre ${hitRate}% de esos mapas`);
  }

  let verdictLevel = 'gray';
  let verdict = `${playerName} hace un promedio de ${avgRounded} kills por mapa (últimos ${kills.length}). Rango habitual ${band}.`;
  if (recommendation) {
    verdict += ` Por estadística del jugador tiene más chance ${recommendation}.`;
    if (hitRate >= 45) verdictLevel = 'green';
    else if (hitRate >= 30) verdictLevel = 'yellow';
    else verdictLevel = 'gray';
  }

  return {
    kind: 'kills',
    source: stats.source || 'hltv',
    status: 'COMPLETE',
    playerName,
    avgKills: avgRounded,
    typicalLow,
    typicalHigh,
    mapsSampled: kills.length,
    recentKills: kills.slice(0, 12),
    recommendation,
    confidence: hitRate || 0,
    verdict,
    verdictLevel,
    dataQuality: kills.length >= 5 ? 'full' : 'partial',
    factors,
    hitRate
  };
}

function nickKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** "robo de nemiga" -> { player: "robo", team: "nemiga" } */
function splitPlayerTeamHint(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(.{2,20}?)\s+de\s+(.{2,30})$/i);
  if (m) return { player: m[1].trim(), team: m[2].trim() };
  return { player: s, team: null };
}

const MAP_ALIASES = {
  mirage: ['mirage', 'mrg', 'de_mirage'],
  inferno: ['inferno', 'inf', 'de_inferno'],
  nuke: ['nuke', 'de_nuke'],
  dust2: ['dust2', 'dust 2', 'd2', 'de_dust2'],
  anubis: ['anubis', 'anb', 'de_anubis'],
  ancient: ['ancient', 'anc', 'de_ancient'],
  vertigo: ['vertigo', 'vert', 'de_vertigo'],
  train: ['train', 'trn', 'de_train'],
  overpass: ['overpass', 'ovp', 'de_overpass'],
  cache: ['cache', 'cch', 'de_cache']
};

function canonicalMapName(name) {
  const k = nickKey(name);
  if (!k) return null;
  for (const [canon, aliases] of Object.entries(MAP_ALIASES)) {
    if (k === nickKey(canon) || aliases.some(a => nickKey(a) === k)) return canon;
  }
  return null;
}

function mapsMatch(rowMap, targetMap) {
  const a = canonicalMapName(rowMap);
  const b = canonicalMapName(targetMap);
  return a && b && a === b;
}

function selectMapsForContext(maps, mapName) {
  const all = Array.isArray(maps) ? maps.filter(m => m && Number.isFinite(m.kills)) : [];
  if (!mapName) return { maps: all, mapFiltered: false, mapName: null };
  const filtered = all.filter(m => mapsMatch(m.map, mapName));
  if (filtered.length >= 2) {
    return { maps: filtered, mapFiltered: true, mapName };
  }
  return { maps: all, mapFiltered: false, mapName };
}

function playerAvgFromStats(stats, mapName) {
  const picked = selectMapsForContext(stats?.maps, mapName);
  const maps = picked.maps;
  if (!maps.length) {
    return {
      name: stats?.playerName || null,
      found: false,
      avgKills: null,
      typicalLow: null,
      typicalHigh: null,
      mapsSampled: 0,
      mapFiltered: false
    };
  }
  const kills = maps.map(m => m.kills);
  const sorted = [...kills].sort((a, b) => a - b);
  return {
    name: stats.playerName || null,
    found: true,
    avgKills: round1(kills.reduce((a, b) => a + b, 0) / kills.length),
    typicalLow: percentile(sorted, 0.25),
    typicalHigh: percentile(sorted, 0.75),
    mapsSampled: kills.length,
    mapFiltered: picked.mapFiltered
  };
}

/**
 * Compara jugadores de una predicción "quién mata más".
 * ZERO FAKE DATA: solo recomienda si al menos un jugador tiene mapas reales.
 */
function scoreKillsDuel(options, playersStats, context = {}) {
  const mapName = context.mapName || null;
  const list = Array.isArray(playersStats) ? playersStats : [];
  const rows = (options || []).map(o => {
    const label = o.name || o.label || '';
    const key = nickKey(label);
    const stats = list.find(s => nickKey(s.playerName) === key || nickKey(s.queryName) === key) || null;
    const summary = playerAvgFromStats(stats || { playerName: label, maps: [] }, mapName);
    return {
      name: label,
      percentage: o.percentage || null,
      avgKills: summary.avgKills,
      typicalLow: summary.typicalLow,
      typicalHigh: summary.typicalHigh,
      mapsSampled: summary.mapsSampled,
      found: summary.found,
      mapFiltered: summary.mapFiltered
    };
  });

  const ranked = rows.filter(r => r.found && r.avgKills != null).sort((a, b) => b.avgKills - a.avgKills);
  if (!ranked.length) {
    return {
      kind: 'kills-duel',
      source: 'none',
      status: 'UNAVAILABLE',
      recommendation: '',
      confidence: 0,
      verdict: 'No encontré kills recientes de estos jugadores en HLTV. Guiate por el % de la comunidad.',
      verdictLevel: 'gray',
      dataQuality: 'none',
      factors: [],
      players: rows
    };
  }

  const fav = ranked[0];
  const runner = ranked[1] || null;
  const diff = runner ? round1(fav.avgKills - runner.avgKills) : fav.avgKills;
  const usedMap = ranked.some(p => p.mapFiltered) ? mapName : null;
  const scope = usedMap ? ` en ${usedMap}` : ' por mapa';
  const factors = ranked.map(p => {
    const where = p.mapFiltered && mapName ? ` en ${mapName}` : '';
    return `🎯 ${p.name}: ${p.avgKills} kills${where || '/mapa'} (últimos ${p.mapsSampled}, rango ${p.typicalLow}–${p.typicalHigh})`;
  });
  if (mapName && !usedMap) {
    factors.push(`ℹ️ Sin sample suficiente de ${mapName}: usé el promedio general de mapas recientes.`);
  }

  let verdictLevel = 'gray';
  let verdict = `${fav.name} promedia ${fav.avgKills} kills${scope}`;
  if (runner) {
    verdict += ` vs ${runner.name} con ${runner.avgKills}`;
    if (diff >= 2.5) {
      verdictLevel = 'green';
      verdict += `. Por estadística ${fav.name} es el más propenso a matar más en el mapa.`;
    } else if (diff >= 1) {
      verdictLevel = 'yellow';
      verdict += `. Ligera ventaja de ${fav.name} para ser el que más mata.`;
    } else {
      verdictLevel = 'gray';
      verdict += `. Están parejos: cualquiera puede terminar arriba en el mapa.`;
    }
  } else {
    verdict += `. Es el único con datos; más chance de ser el que más mata, pero el resto no tiene sample.`;
    verdictLevel = 'yellow';
  }

  const confidence = runner && fav.avgKills > 0
    ? Math.max(15, Math.min(85, Math.round((fav.avgKills / (fav.avgKills + runner.avgKills)) * 100)))
    : (fav.mapsSampled >= 5 ? 60 : 40);

  return {
    kind: 'kills-duel',
    source: list.find(s => s.source)?.source || 'hltv',
    status: ranked.length >= 2 ? 'COMPLETE' : 'PARTIAL',
    recommendation: fav.name,
    confidence,
    verdict,
    verdictLevel,
    dataQuality: ranked.length >= 2 && ranked.every(p => p.mapsSampled >= 5) ? 'full' : 'partial',
    factors,
    players: rows,
    avgGap: runner ? diff : null,
    mapName: usedMap || null
  };
}

module.exports = {
  extractPlayerNameFromQuestion,
  isKillRangeLabel,
  parseKillRange,
  parsePlayerMatchRows,
  parsePlayerMatchesFromText,
  pickPlayerFromSearch,
  rangeContains,
  scoreKillPrediction,
  scoreKillsDuel,
  emptyKillAnalysis,
  nickKey,
  canonicalMapName,
  selectMapsForContext,
  splitPlayerTeamHint
};
