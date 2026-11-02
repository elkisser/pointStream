// electron/cs2-stats-service.js
// Servicio coordinador de estadísticas de CS2
// Arquitectura jerárquica: HLTV (Primary) -> BO3.gg -> Ranking Valve VRS (GitHub) -> UNAVAILABLE
// Aplica estrictamente:
// 1. HLTV como fuente primaria.
// 2. Fallback a BO3.gg únicamente ante fallo o datos insuficientes de HLTV.
// 3. ZERO FAKE DATA: nunca inventar números, rankings o predicciones.
// 4. Preservación matemática de las fórmulas de scoring existentes.

const { StatsStatus, createNormalizedStats } = require('./cs2-provider');
const bo3 = require('./bo3');

/**
 * Evalúa si las estadísticas provistas por una fuente son suficientes
 * para alimentar el modelo de análisis con valor predictivo real.
 *
 * COMPLETE: Ambos equipos encontrados con ranking o historial de partidos.
 * PARTIAL: Al menos un equipo encontrado con ranking o historial.
 * INSUFFICIENT / FAILED: Ningún equipo encontrado, o ambos sin datos.
 */
function isStatsSufficient(stats) {
  if (!stats) return false;
  if (stats.status === StatsStatus.COMPLETE) return true;

  // Si es PARTIAL pero ambos equipos fueron encontrados y al menos uno tiene datos sustanciales
  if (stats.status === StatsStatus.PARTIAL) {
    const t1 = stats.team1;
    const t2 = stats.team2;
    const t1HasData = t1?.found && (t1.ranking != null || (t1.wins + t1.losses) > 0);
    const t2HasData = t2?.found && (t2.ranking != null || (t2.wins + t2.losses) > 0);

    // Si ambos tienen datos sustanciales, se considera suficiente
    if (t1HasData && t2HasData) return true;

    // Si solo 1 tiene datos, en HLTV se puede considerar parcial suficiente si tiene ranking top
    if (t1HasData || t2HasData) {
      return true;
    }
  }

  return false;
}

/**
 * Calcula la puntuación matemática y veredicto del matchup a partir del contrato normalizado.
 * PRESERVA EL 100% DE LA MATEMÁTICA Y UMBRALES EXISTENTES DE POINTSTREAM:
 * - Ranking diff: Math.min(abs(diff) * 1.5, 25)
 * - Single ranking: +12 pts
 * - Recent winrate diff: Math.min(abs(diff) * 0.35, 14)
 * - Tournament event winrate diff: Math.min(abs(diff) * 0.45, 18)
 * - H2H wins: +4 pts por victoria
 * - Solo uno con datos: +15 pts
 * - Blend: Math.max(15, Math.min(85, Math.round(raw1 * 0.78 + 50 * 0.22)))
 */
function calculateMatchupScoring(norm, opts = {}) {
  const t1Name = norm.team1.name;
  const t2Name = norm.team2.name;

  const result = {
    source: norm.source,
    status: norm.status,
    team1: {
      name: t1Name,
      data: norm.team1.found ? norm.team1 : null,
      probability: 50,
      found: !!norm.team1.found
    },
    team2: {
      name: t2Name,
      data: norm.team2.found ? norm.team2 : null,
      probability: 50,
      found: !!norm.team2.found
    },
    h2h: norm.h2h,
    sharedEvent: norm.sharedEvent,
    roster1: norm.team1?.roster || norm.team1?.data?.roster || null,
    roster2: norm.team2?.roster || norm.team2?.data?.roster || null,
    recentMatches1: norm.recentMatches1 || [],
    recentMatches2: norm.recentMatches2 || [],
    recommendation: '',
    confidence: 0,
    verdict: '',
    verdictLevel: 'gray',
    factors: [],
    dataQuality: 'none'
  };

  const found1 = norm.team1.found;
  const found2 = norm.team2.found;

  if (!found1 && !found2) {
    result.recommendation = 'Sin datos';
    result.verdict = `No encontré datos para ${t1Name} ni ${t2Name} en las fuentes estadísticas. Guiate por el % de la comunidad.`;
    result.verdictLevel = 'gray';
    result.dataQuality = 'none';
    return result;
  }

  result.dataQuality = (found1 && found2) ? 'full' : 'partial';

  let s1 = 0, s2 = 0;
  const d1 = norm.team1;
  const d2 = norm.team2;

  // 1. Ranking mundial
  if (d1?.ranking && d2?.ranking) {
    const diff = d2.ranking - d1.ranking;
    const bonus = Math.min(Math.abs(diff) * 1.5, 25);
    if (diff > 0) s1 += bonus; else s2 += bonus;
    result.factors.push(`📊 Ranking mundial: ${t1Name} #${d1.ranking} vs ${t2Name} #${d2.ranking}`);
  } else if (d1?.ranking) {
    s1 += 12;
    result.factors.push(`📊 ${t1Name} está #${d1.ranking} en el mundo; ${t2Name} sin ranking top`);
  } else if (d2?.ranking) {
    s2 += 12;
    result.factors.push(`📊 ${t2Name} está #${d2.ranking} en el mundo; ${t1Name} sin ranking top`);
  }

  // 2. Forma reciente (winrate de últimos partidos)
  if (d1?.winrate != null && d2?.winrate != null) {
    const diff = d1.winrate - d2.winrate;
    const bonus = Math.min(Math.abs(diff) * 0.35, 14);
    if (diff > 0) s1 += bonus; else s2 += bonus;
    result.factors.push(`📈 Forma reciente: ${t1Name} ${d1.wins}V-${d1.losses}D (${d1.winrate}%) vs ${t2Name} ${d2.wins}V-${d2.losses}D (${d2.winrate}%)`);
  }

  // 3. Forma en la competencia
  const eventWinrate = (d) => {
    if (!d || !d.eventTotal) return null;
    const den = d.eventWins + d.eventLosses;
    return den > 0 ? Math.round((d.eventWins / den) * 100) : null;
  };

  const e1 = eventWinrate(d1);
  const e2 = eventWinrate(d2);
  if (e1 != null && e2 != null) {
    const diff = e1 - e2;
    const bonus = Math.min(Math.abs(diff) * 0.45, 18);
    if (diff > 0) s1 += bonus; else s2 += bonus;
  }
  if (d1?.event || d2?.event) {
    const evName = d1?.event || d2?.event;
    const tag1 = (d1 && d1.eventTotal > 0) ? `${t1Name} ${d1.eventWins}V-${d1.eventLosses}D${d1.eventFallback ? ' (evento previo)' : ''}` : `${t1Name} sin datos`;
    const tag2 = (d2 && d2.eventTotal > 0) ? `${t2Name} ${d2.eventWins}V-${d2.eventLosses}D${d2.eventFallback ? ' (evento previo)' : ''}` : `${t2Name} sin datos`;
    result.factors.push(`🏆 En ${evName}: ${tag1} | ${tag2}`);
  }

  // 4. Head-to-Head
  if (norm.h2h?.total > 0) {
    s1 += norm.h2h.team1Wins * 4;
    s2 += norm.h2h.team2Wins * 4;
    result.factors.push(`⚔️ Historial directo: ${t1Name} ${norm.h2h.team1Wins} - ${norm.h2h.team2Wins} ${t2Name}`);
  }

  // 5a. Racha actual (últimos 5 partidos consecutivos)
  //     Racha de 4-5 victorias: +8pts. 3: +4pts. Racha de 4-5 derrotas: -8pts (al rival).
  const streakScore = (matches) => {
    if (!Array.isArray(matches) || !matches.length) return 0;
    const last5 = matches.slice(0, 5);
    const wins = last5.filter(m => m.won === true).length;
    if (wins >= 4) return 8;
    if (wins === 3) return 4;
    if (wins <= 1) return -8; // racha negativa
    return 0;
  };
  const streak1 = streakScore(norm.recentMatches1);
  const streak2 = streakScore(norm.recentMatches2);
  if (streak1 !== 0 || streak2 !== 0) {
    const net = streak1 - streak2;
    if (net > 0) s1 += net; else s2 += -net;
    const last5fmt = (matches, name) => {
      if (!Array.isArray(matches) || !matches.length) return '';
      const icons = matches.slice(0, 5).map(m => m.won ? '✅' : '❌').join('');
      return `${name} ${icons}`;
    };
    result.recentForm = {
      team1: last5fmt(norm.recentMatches1, t1Name),
      team2: last5fmt(norm.recentMatches2, t2Name)
    };
    const f1 = last5fmt(norm.recentMatches1, t1Name);
    const f2 = last5fmt(norm.recentMatches2, t2Name);
    if (f1 || f2) result.factors.push(`🔥 Últimos 5: ${f1 || t1Name} | ${f2 || t2Name}`);
  }

  // 5b. Calidad de victorias recientes (si la fuente es HLTV tenemos opponentKey,
  //     que cruzamos con el ranking para ver si venció a equipos top).
  //     Victoria vs top-10: +3pts; top-20: +1.5pts. Derrota vs fuera del top-30: -3pts.
  //     Se evalúan los últimos 5 y se acumula la diferencia neta (cap ±10pts).
  const rankMap = (norm.source === 'hltv') ? (() => {
    try { return require('./hltv').getRankingMapSync?.() || null; } catch (e) { return null; }
  })() : null;

  const qualityScore = (matches) => {
    if (!Array.isArray(matches) || !rankMap) return 0;
    let q = 0;
    for (const m of matches.slice(0, 5)) {
      if (!m.opponentKey) continue;
      const opp = rankMap[m.opponentKey];
      if (!opp) continue;
      const rank = opp.rank;
      if (!rank) continue;
      if (m.won && rank <= 10) q += 3;
      else if (m.won && rank <= 20) q += 1.5;
      else if (!m.won && rank > 30) q -= 3;
    }
    return Math.max(-10, Math.min(10, q));
  };
  const q1 = qualityScore(norm.recentMatches1);
  const q2 = qualityScore(norm.recentMatches2);
  if (q1 !== 0 || q2 !== 0) {
    const net = q1 - q2;
    if (net > 0) s1 += net; else s2 += -net;
  }

  // 5c. Partidos recientes detallados (los últimos 5, se muestra en la card y Telegram)
  const formatRecent = (matches, teamName) => {
    if (!Array.isArray(matches) || !matches.length) return null;
    return matches.slice(0, 5).map(m => ({
      won: m.won,
      opponent: m.opponent || null,
      score: m.score || null,
      event: m.event || null
    }));
  };
  result.recentMatches1 = formatRecent(norm.recentMatches1, t1Name);
  result.recentMatches2 = formatRecent(norm.recentMatches2, t2Name);

  // 5d. Fuerza del Roster y Ratings Individuales (BO3 / Multi-fuente)
  const ros1 = result.roster1;
  const ros2 = result.roster2;
  if (ros1?.avgRating && ros2?.avgRating) {
    const rDiff = ros1.avgRating - ros2.avgRating;
    const rBonus = Math.min(Math.abs(rDiff) * 30, 14);
    if (rDiff > 0) s1 += rBonus; else s2 += rBonus;
    result.factors.push(`🌟 Roster: ${t1Name} (avg ${ros1.avgRating}) vs ${t2Name} (avg ${ros2.avgRating})`);
  }
  if (ros1?.newPlayer && (ros1.newPlayer.rating >= 6.2 || ros1.starPlayer?.nickname === ros1.newPlayer.nickname)) {
    s1 += 4;
    result.factors.push(`⚡ Jugador clave: ${ros1.newPlayer.nickname} (${ros1.newPlayer.rating ? ros1.newPlayer.rating + ' rating · ' : ''}refuerzo de alto impacto de ${t1Name})`);
  }
  if (ros2?.newPlayer && (ros2.newPlayer.rating >= 6.2 || ros2.starPlayer?.nickname === ros2.newPlayer.nickname)) {
    s2 += 4;
    result.factors.push(`⚡ Jugador clave: ${ros2.newPlayer.nickname} (${ros2.newPlayer.rating ? ros2.newPlayer.rating + ' rating · ' : ''}refuerzo de alto impacto de ${t2Name})`);
  } else if (ros2?.starPlayer && ros2.starPlayer.rating >= 6.5) {
    result.factors.push(`⭐ Estrella: ${ros2.starPlayer.nickname} (${ros2.starPlayer.rating} rating en ${t2Name})`);
  }

  // 5e. Contexto en Vivo de Serie (Live Series Context) y Momentum
  const seriesScore = opts.seriesScore || norm.seriesScore || null;
  const mapNumber = opts.mapNumber != null ? opts.mapNumber : (norm.mapNumber != null ? norm.mapNumber : null);
  const format = opts.format || norm.format || 'BO3';
  const question = String(opts.question || norm.question || '').toLowerCase();

  if (seriesScore && (seriesScore.team1 > 0 || seriesScore.team2 > 0)) {
    const t1Score = seriesScore.team1 || 0;
    const t2Score = seriesScore.team2 || 0;
    result.seriesScore = { team1: t1Score, team2: t2Score };

    if (format === 'BO3' || format === 'UNKNOWN') {
      if (t2Score === 1 && t1Score === 0) {
        if (mapNumber === 2) {
          s2 += 20;
          s1 = Math.max(0, s1 - 4);
          result.factors.push(`🔥 ${t2Name} lidera 1-0 tras ganar en el pick de ${t1Name}. En Mapa 2 juega con momentum y ventaja de mapa propio`);
        } else {
          s2 += 22;
          result.factors.push(`⚔️ ${t2Name} lidera la serie 1-0 en BO3 (a 1 mapa de ganar la serie)`);
        }
      } else if (t1Score === 1 && t2Score === 0) {
        if (mapNumber === 2) {
          s2 += 12;
          result.factors.push(`⚔️ ${t1Name} lidera 1-0. Mapa 2 es el pick de ${t2Name} para buscar igualar la serie`);
        } else {
          s1 += 22;
          result.factors.push(`⚔️ ${t1Name} lidera la serie 1-0 en BO3 (a 1 mapa de ganar la serie)`);
        }
      } else if (t1Score === 1 && t2Score === 1) {
        result.factors.push(`⚔️ Serie empatada 1-1: Mapa 3 decisivo (máxima tensión, decider)`);
      }
    }
  }

  // 5f. Ventaja de Pick de Mapa (Map Pick Advantage)
  let pickTeamName = null;
  if (opts.mapPick) {
    pickTeamName = opts.mapPick;
  } else if (/pick\s+de\s+([a-z0-9\s]+)/i.test(question)) {
    const m = question.match(/pick\s+de\s+([a-z0-9\s]+)/i);
    if (m) pickTeamName = m[1].trim();
  }

  if (pickTeamName) {
    const { canonicalTeamName } = require('./team-aliases');
    const cPick = canonicalTeamName(pickTeamName).toLowerCase();
    const c1 = canonicalTeamName(t1Name).toLowerCase();
    const c2 = canonicalTeamName(t2Name).toLowerCase();
    if (cPick === c1 || cPick.includes(c1) || c1.includes(cPick)) {
      s1 += 12;
      result.factors.push(`🗺️ Ventaja de pick: mapa elegido por ${t1Name}`);
    } else if (cPick === c2 || cPick.includes(c2) || c2.includes(cPick)) {
      s2 += 12;
      result.factors.push(`🗺️ Ventaja de pick: mapa elegido por ${t2Name}`);
    }
  }

  // 6. Solo uno con datos
  if (found1 && !found2) {
    s1 += 15;
    result.factors.push(`ℹ️ Solo ${t1Name} tiene datos suficientes`);
  }
  if (found2 && !found1) {
    s2 += 15;
    result.factors.push(`ℹ️ Solo ${t2Name} tiene datos suficientes`);
  }

  // 6. Normalización final y probabilidades
  const total = s1 + s2;
  if (total > 0) {
    const raw1 = (s1 / total) * 100;
    result.team1.probability = Math.max(15, Math.min(85, Math.round(raw1 * 0.78 + 50 * 0.22)));
    result.team2.probability = 100 - result.team1.probability;
  }

  const fav = result.team1.probability >= result.team2.probability ? result.team1 : result.team2;
  const und = result.team1.probability >= result.team2.probability ? result.team2 : result.team1;
  const diff = fav.probability - und.probability;

  result.recommendation = fav.name;
  result.confidence = fav.probability;

  const srcLabel = norm.source === 'bo3gg' ? 'BO3.gg' : (norm.source === 'vrs' ? 'el ranking de Valve' : 'HLTV');

  if (result.factors.length === 0) {
    result.verdict = `Datos limitados de ${srcLabel}. ${fav.name} sale levemente favorito pero con poca info. Apuesta chica.`;
    result.verdictLevel = 'gray';
  } else if (diff >= 24) {
    result.verdict = `APOSTAR A ${fav.name.toUpperCase()} — ventaja sólida (${fav.probability}% vs ${und.probability}%). Buena si el multiplicador es mayor a 1.2x.`;
    result.verdictLevel = 'green';
  } else if (diff >= 12) {
    result.verdict = `${fav.name.toUpperCase()} FAVORITO — ventaja moderada (${fav.probability}% vs ${und.probability}%). Apostá con cabeza, no todo.`;
    result.verdictLevel = 'yellow';
  } else {
    result.verdict = `PARTIDO PAREJO — apenas ${diff}% de diferencia. Conviene SKIP o apuesta mínima. Mucho riesgo.`;
    result.verdictLevel = 'red';
  }

  // Con datos de un solo equipo el porcentaje sale casi todo del bonus "solo uno
  // con datos": no alcanza para decir "ventaja sólida". Se baja a "favorito".
  if (result.dataQuality === 'partial' && result.verdictLevel === 'green') {
    const missing = found1 ? t2Name : t1Name;
    result.verdictLevel = 'yellow';
    result.verdict = `${fav.name.toUpperCase()} FAVORITO — ${missing} no figura en ${srcLabel}, así que el análisis usa datos de un solo equipo. Apostá con cabeza, no todo.`;
  }

  return result;
}

/**
 * Analizador principal de enfrentamientos con jerarquía HLTV -> BO3.gg.
 *
 * @param {string} team1Name
 * @param {string} team2Name
 * @param {object} [opts] Inyección de dependencias opcional para testing de providers.
 */
function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} no respondió en ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function teamsFound(norm) {
  return (norm?.team1?.found ? 1 : 0) + (norm?.team2?.found ? 1 : 0);
}

/**
 * Cadena de fuentes: HLTV -> BO3.gg -> Ranking oficial de Valve (VRS, GitHub).
 * - Cada fuente tiene su propio timeout, así una fuente colgada no consume el
 *   tiempo de las demás.
 * - Si una fuente trae a los dos equipos (COMPLETE) se usa esa.
 * - Si solo trae a uno (PARTIAL), se sigue buscando una que traiga a los dos y,
 *   si ninguna lo logra, se usa la mejor parcial.
 */
async function analyzeMatchup(team1Name, team2Name, opts = {}) {
  // "100T" -> "100 Thieves" antes de consultar las fuentes. El resultado vuelve
  // con los nombres originales para que la card y el pick coincidan con Forg1.
  const { canonicalTeamName } = require('./team-aliases');
  const q1 = canonicalTeamName(team1Name);
  const q2 = canonicalTeamName(team2Name);
  if (q1 !== team1Name || q2 !== team2Name) {
    console.log(`[CS2-STATS] Siglas: "${team1Name}" -> "${q1}", "${team2Name}" -> "${q2}"`);
    const r = await analyzeMatchupResolved(q1, q2, opts);
    if (r && r.team1 && r.team1.name === q1) r.team1.name = team1Name;
    if (r && r.team2 && r.team2.name === q2) r.team2.name = team2Name;
    if (r && r.recommendation === q1) r.recommendation = team1Name;
    else if (r && r.recommendation === q2) r.recommendation = team2Name;
    return r;
  }
  return analyzeMatchupResolved(team1Name, team2Name, opts);
}

async function analyzeMatchupResolved(team1Name, team2Name, opts = {}) {
  const hltvProvider = opts.hltvProvider || require('./hltv');
  const bo3Provider = opts.bo3Provider || bo3;
  const vrsProvider = opts.vrsProvider || require('./vrs');
  const timeouts = { hltv: 15000, bo3gg: 10000, vrs: 10000, ...(opts.timeouts || {}) };

  console.log(`[CS2-STATS] Iniciando análisis para: "${team1Name}" vs "${team2Name}"`);

  const chain = [
    {
      id: 'hltv', label: 'HLTV',
      run: () => typeof hltvProvider.getMatchupData === 'function'
        ? hltvProvider.getMatchupData(team1Name, team2Name)
        : (typeof hltvProvider.analyzeRawMatchup === 'function'
          ? hltvProvider.analyzeRawMatchup(team1Name, team2Name)
          : null)
    },
    { id: 'bo3gg', label: 'BO3.gg', run: () => bo3Provider.getMatchupData(team1Name, team2Name) },
    { id: 'vrs', label: 'Ranking Valve', run: () => vrsProvider.getMatchupData(team1Name, team2Name) }
  ];

  async function enrichRosters(targetNorm) {
    if (!targetNorm) return;
    if (typeof bo3Provider.getTeamRoster === 'function' && !opts.skipEnrichment) {
      try {
        const [r1, r2] = await Promise.all([
          (!targetNorm.team1?.roster) ? bo3Provider.getTeamRoster(team1Name) : Promise.resolve(targetNorm.team1.roster),
          (!targetNorm.team2?.roster) ? bo3Provider.getTeamRoster(team2Name) : Promise.resolve(targetNorm.team2.roster)
        ]);
        if (targetNorm.team1 && r1) targetNorm.team1.roster = r1;
        if (targetNorm.team2 && r2) targetNorm.team2.roster = r2;
      } catch (e) {
        // En caso de fallo de red en enriquecimiento, se preservan los datos existentes
      }
    }
  }

  let bestPartial = null;
  for (const src of chain) {
    let norm = null;
    try {
      norm = await withTimeout(Promise.resolve(src.run()), timeouts[src.id], src.label);
    } catch (err) {
      console.warn(`[CS2-STATS] ${src.label} falló: ${err.message}`);
      continue;
    }
    if (!norm || !isStatsSufficient(norm)) {
      console.log(`[CS2-STATS] ${src.label} sin datos suficientes (${norm ? norm.status : 'null'}). Siguiente fuente...`);
      continue;
    }
    if (teamsFound(norm) === 2) {
      console.log(`[CS2-STATS] Usando fuente: ${src.label} (${norm.status}).`);
      await enrichRosters(norm);
      return calculateMatchupScoring(norm, opts);
    }
    if (!bestPartial) bestPartial = norm;
    console.log(`[CS2-STATS] ${src.label} solo encontró un equipo. Busco una fuente con los dos...`);
  }

  if (bestPartial) {
    console.log(`[CS2-STATS] Ninguna fuente tiene a los dos equipos. Uso parcial de ${bestPartial.source}.`);
    await enrichRosters(bestPartial);
    return calculateMatchupScoring(bestPartial, opts);
  }

  // Ninguna fuente respondió con datos
  console.log(`[CS2-STATS] Ninguna fuente ofreció datos suficientes para "${team1Name}" vs "${team2Name}". Retornando UNAVAILABLE.`);
  const unavailable = createNormalizedStats({
    source: 'none',
    status: StatsStatus.UNAVAILABLE,
    team1Name,
    team2Name
  });
  return calculateMatchupScoring(unavailable, opts);
}

module.exports = {
  isStatsSufficient,
  calculateMatchupScoring,
  analyzeMatchup
};
