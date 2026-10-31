// electron/ot-analysis.js
// Predicciones tipo "¿Hay OT?" con opciones No / 1 / 2 / 3 (cantidad de overtimes)
// o Sí / No.
//
// Fuente: marcadores reales de los mapas recientes de los dos equipos (HLTV, vía el
// historial de un jugador de cada roster). ZERO FAKE DATA: no hay tasa de OT
// inventada; sin mapas no hay recomendación.
//
// CS2 se juega MR12: un mapa sin overtime suma como máximo 24 rondas (13-11).
// Cada overtime es MR3 (hasta 6 rondas): 16-14 = 1 OT, 19-17 = 2 OT, 22-20 = 3 OT.

function otCountFromScore(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.max(a, b) < 13) return null; // mapa incompleto o abandonado
  const total = a + b;
  if (total <= 24) return 0;
  return Math.ceil((total - 24) / 6);
}

/** "No" -> 0..0, "Sí" -> 1..∞, "2" -> 2..2, "3+" / "3 o más" -> 3..∞ */
function parseOtLabel(label) {
  const t = String(label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if (!t) return null;
  if (/^(no|ninguno|sin ot|0)$/.test(t)) return { min: 0, max: 0 };
  if (/^(si|hay ot|con ot)$/.test(t)) return { min: 1, max: Infinity };
  let m = t.match(/^(\d)\s*(\+|o\s+mas|o\s+más|ot\s*o\s*mas)$/);
  if (m) return { min: Number(m[1]), max: Infinity };
  m = t.match(/^(\d)(\s*ots?)?$/);
  if (m) return { min: Number(m[1]), max: Number(m[1]) };
  return null;
}

function isOtQuestion(question, optionNames) {
  if (!/\bots?\b|overtime|over\s*time|alargue|tiempo\s+extra|pr[oó]rroga/i.test(String(question || ''))) return false;
  const names = (optionNames || []).map(n => String(n || '').trim()).filter(Boolean);
  return names.length >= 2 && names.every(n => parseOtLabel(n));
}

/**
 * maps: [{ map, date, rounds: { team, opponent } }] de los dos equipos.
 * Se deduplican mapas repetidos (el mismo partido aparece en el historial de ambos).
 */
function collectOtSample(maps, mapName, canonicalMapName) {
  const seen = new Set();
  const all = [];
  for (const m of maps || []) {
    if (!m || !m.rounds) continue;
    const ot = otCountFromScore(m.rounds.team, m.rounds.opponent);
    if (ot == null) continue;
    const hi = Math.max(m.rounds.team, m.rounds.opponent);
    const lo = Math.min(m.rounds.team, m.rounds.opponent);
    const k = `${m.date || ''}|${canonicalMapName ? canonicalMapName(m.map) : m.map}|${hi}-${lo}`;
    if (seen.has(k)) continue;
    seen.add(k);
    all.push({ ...m, ot });
  }
  if (mapName && canonicalMapName) {
    const target = canonicalMapName(mapName);
    const onMap = all.filter(m => canonicalMapName(m.map) === target);
    if (onMap.length >= 6) return { sample: onMap, mapFiltered: true };
  }
  return { sample: all, mapFiltered: false };
}

function emptyOt(reason) {
  return {
    kind: 'ot', source: 'none', status: 'UNAVAILABLE',
    recommendation: '', confidence: 0, verdictLevel: 'gray', dataQuality: 'none',
    verdict: reason || 'No encontré marcadores recientes de estos equipos. Guiate por el % de la comunidad.',
    factors: [], optionProbs: [], mapsSampled: 0
  };
}

function scoreOtPrediction(options, maps, ctx = {}) {
  const opts = (options || []).map(o => ({ label: o.name || o.label || '', percentage: o.percentage, range: parseOtLabel(o.name || o.label) }))
    .filter(o => o.range);
  if (!opts.length) return emptyOt('No reconozco las opciones de esta pregunta de OT.');

  const { sample, mapFiltered } = collectOtSample(maps, ctx.mapName, ctx.canonicalMapName);
  if (sample.length < 4) {
    return emptyOt(sample.length
      ? `Solo encontré ${sample.length} mapa${sample.length === 1 ? '' : 's'} con marcador: muy poco para estimar. Guiate por el % de la comunidad.`
      : undefined);
  }

  const n = sample.length;
  const withOt = sample.filter(m => m.ot > 0);
  const optionProbs = opts.map(o => {
    const hits = sample.filter(m => m.ot >= o.range.min && m.ot <= o.range.max).length;
    return { label: o.label, percentage: o.percentage, hits, probability: Math.round((hits / n) * 100) };
  });
  const best = [...optionProbs].sort((a, b) => b.probability - a.probability)[0];

  const where = mapFiltered ? ` en ${ctx.mapName}` : '';
  const factors = [
    `📊 ${withOt.length} de ${n} mapas recientes${where} fueron a overtime (${Math.round((withOt.length / n) * 100)}%)`,
    ...withOt.slice(0, 4).map(m => `⏱️ ${m.rounds.team}-${m.rounds.opponent}${m.map ? ' en ' + m.map : ''}${m.ot > 1 ? ` (${m.ot} OT)` : ''}`)
  ];
  if (ctx.teams && ctx.teams.length) factors.push(`👥 Mapas de: ${ctx.teams.join(', ')}`);

  let verdictLevel = 'gray';
  if (n >= 10 && best.probability >= 75) verdictLevel = 'green';
  else if (n >= 6 && best.probability >= 55) verdictLevel = 'yellow';

  const verdict = `${best.label.toUpperCase()} — pasó en ${best.hits} de ${n} mapas recientes${where} de estos equipos (${best.probability}%).`;

  return {
    kind: 'ot',
    source: 'hltv',
    status: 'COMPLETE',
    recommendation: best.label,
    confidence: best.probability,
    verdict,
    verdictLevel,
    dataQuality: n >= 10 ? 'full' : 'partial',
    factors,
    optionProbs,
    mapsSampled: n,
    mapName: mapFiltered ? ctx.mapName : null
  };
}

module.exports = { otCountFromScore, parseOtLabel, isOtQuestion, collectOtSample, scoreOtPrediction };
