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
function calculateMatchupScoring(norm) {
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

  // 5. Solo uno con datos
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
      return calculateMatchupScoring(norm);
    }
    if (!bestPartial) bestPartial = norm;
    console.log(`[CS2-STATS] ${src.label} solo encontró un equipo. Busco una fuente con los dos...`);
  }

  if (bestPartial) {
    console.log(`[CS2-STATS] Ninguna fuente tiene a los dos equipos. Uso parcial de ${bestPartial.source}.`);
    return calculateMatchupScoring(bestPartial);
  }

  // Ninguna fuente respondió con datos
  console.log(`[CS2-STATS] Ninguna fuente ofreció datos suficientes para "${team1Name}" vs "${team2Name}". Retornando UNAVAILABLE.`);
  const unavailable = createNormalizedStats({
    source: 'none',
    status: StatsStatus.UNAVAILABLE,
    team1Name,
    team2Name
  });
  return calculateMatchupScoring(unavailable);
}

module.exports = {
  isStatsSufficient,
  calculateMatchupScoring,
  analyzeMatchup
};
