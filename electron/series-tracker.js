// electron/series-tracker.js
// Gestor de estado de series y mapas para PointStream (Fase 9.1)
// Modela la jerarquía canónica: SERIES -> MAPS -> PREDICTIONS
// Aplica estrictamente la política ZERO FAKE DATA.

let hltvModule = null;
try {
  hltvModule = require('./hltv');
} catch (e) {
  // En testing unitario o contextos aislados
}

function safeNormalizeTeamName(name) {
  if (hltvModule && typeof hltvModule.normalizeTeamName === 'function') {
    return hltvModule.normalizeTeamName(name);
  }
  return (name || '').trim();
}

function safeNormKey(s) {
  if (hltvModule && typeof hltvModule.normKey === 'function') {
    return hltvModule.normKey(s);
  }
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Estados canónicos de una Serie.
 */
const SERIES_STATUS = {
  UNKNOWN: 'UNKNOWN',
  UPCOMING: 'UPCOMING',
  LIVE: 'LIVE',
  WAITING_NEXT_MAP: 'WAITING_NEXT_MAP',
  FINISHED: 'FINISHED'
};

/**
 * Estados canónicos de un Mapa.
 */
const MAP_STATUS = {
  UNKNOWN: 'UNKNOWN',
  UPCOMING: 'UPCOMING',
  LIVE: 'LIVE',
  PLAYED: 'PLAYED'
};

/**
 * Normaliza una fecha a formato YYYY-MM-DD para firmas de serie.
 */
function formatDateKey(dateInput) {
  if (!dateInput) {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateInput)) {
    return dateInput.slice(0, 10);
  }
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) {
    const now = new Date();
    return now.toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Extrae número de mapa y formato a partir del texto de una pregunta o título.
 * ZERO FAKE DATA: Si no hay evidencia, retorna null o UNKNOWN.
 */
function extractMapAndFormat(text) {
  const t = String(text || '').trim();
  if (!t) return { mapNumber: null, format: 'UNKNOWN', mapName: null };

  let mapNumber = null;
  // Regex específicas: "mapa 1", "map 2", "mapa3", etc.
  const mapMatch = t.match(/\b(?:mapa|map)\s*([1-5])\b/i);
  if (mapMatch) {
    mapNumber = parseInt(mapMatch[1], 10);
  }

  let format = 'UNKNOWN';
  if (/\b(?:bo1|best of 1|al mejor de 1)\b/i.test(t)) {
    format = 'BO1';
  } else if (/\b(?:bo3|best of 3|al mejor de 3)\b/i.test(t)) {
    format = 'BO3';
  } else if (/\b(?:bo5|best of 5|al mejor de 5)\b/i.test(t)) {
    format = 'BO5';
  }

  // Detección opcional de nombre de mapa común si está explícito
  let mapName = null;
  const knownMaps = ['mirage', 'inferno', 'nuke', 'dust2', 'anubis', 'ancient', 'vertigo', 'train', 'cache', 'overpass'];
  for (const km of knownMaps) {
    const reg = new RegExp(`\\b${km}\\b`, 'i');
    if (reg.test(t)) {
      mapName = km.charAt(0).toUpperCase() + km.slice(1);
      break;
    }
  }

  return { mapNumber, format, mapName };
}

/**
 * Crea una nueva instancia del Series Tracker.
 */
function createSeriesTracker(options = {}) {
  // seriesId -> SeriesState
  const seriesStore = new Map();
  // predictionId -> seriesId
  const predictionToSeries = new Map();
  // predictionId -> predictionObject
  const predictionStore = new Map();

  const finishedRetentionMs = options.finishedRetentionMs || 30 * 60 * 1000; // 30 min

  /**
   * Resuelve los dos equipos de una predicción.
   * Rechaza si hay menos de 2 equipos válidos.
   */
  function extractTeams(prediction) {
    if (!prediction) return null;
    if (prediction.predType === 'kills-range' || prediction.predType === 'kills-duel' || prediction.predType === 'yes-no') {
      return null;
    }
    const teams = prediction.teams || [];
    if (!Array.isArray(teams) || teams.length < 2) {
      return null;
    }
    const t1Name = (teams[0].name || '').trim();
    const t2Name = (teams[1].name || '').trim();
    if (!t1Name || !t2Name) return null;

    const norm1 = safeNormalizeTeamName(t1Name);
    const norm2 = safeNormalizeTeamName(t2Name);
    const key1 = safeNormKey(norm1);
    const key2 = safeNormKey(norm2);

    if (!key1 || !key2 || key1 === key2) return null;

    return {
      t1: { name: norm1, key: key1 },
      t2: { name: norm2, key: key2 }
    };
  }

  /**
   * Genera una clave canónica e invariable al orden de los equipos para la serie.
   */
  function buildSeriesKey(keyA, keyB, dateStr) {
    const sorted = [keyA, keyB].sort();
    return `${sorted[0]}_vs_${sorted[1]}_${dateStr}`;
  }

  /**
   * Determina a qué serie pertenece una predicción sin inventar datos.
   */
  function resolveSeries(prediction, context = {}) {
    const teams = extractTeams(prediction);
    if (!teams) {
      return null;
    }

    // Fecha relevante de la serie
    const dateStr = formatDateKey(context.date || prediction.locksAt || prediction.createdAt);
    const seriesId = buildSeriesKey(teams.t1.key, teams.t2.key, dateStr);

    const textInfo = extractMapAndFormat(
      (prediction.title ? prediction.title + ' ' : '') + (prediction.question || '')
    );
    const mapNumber = prediction.mapNumber != null ? prediction.mapNumber : textInfo.mapNumber;
    const format = (prediction.format && prediction.format !== 'UNKNOWN') ? prediction.format : textInfo.format;
    const mapName = prediction.mapName || textInfo.mapName || null;

    const mapSignature = (seriesId && mapNumber != null) ? `${seriesId}_map_${mapNumber}` : null;

    return {
      seriesId,
      team1: teams.t1,
      team2: teams.t2,
      mapNumber,
      mapName,
      format,
      mapSignature,
      dateStr
    };
  }

  /**
   * Registra o actualiza una predicción en su respectiva serie.
   * Adhiere seriesId, mapSignature y mapNumber al objeto de predicción.
   */
  function upsertPrediction(prediction, context = {}) {
    if (!prediction) return null;

    const resolved = resolveSeries(prediction, context);
    if (!resolved) {
      // Sin dos equipos válidos: ZERO FAKE DATA -> no inventar serie
      prediction.seriesId = null;
      prediction.mapNumber = null;
      prediction.mapSignature = null;
      return null;
    }

    const { seriesId, team1, team2, mapNumber, mapName, format, mapSignature } = resolved;
    const nowIso = new Date().toISOString();

    let series = seriesStore.get(seriesId);
    if (!series) {
      series = {
        seriesId,
        matchId: context.matchId || prediction.matchId || null,
        team1: {
          name: team1.name,
          normalized: team1.key,
          id: null,
          score: 0
        },
        team2: {
          name: team2.name,
          normalized: team2.key,
          id: null,
          score: 0
        },
        format: format || 'UNKNOWN',
        currentMapNumber: mapNumber || 1,
        maps: [],
        predictions: [],
        status: SERIES_STATUS.LIVE,
        seriesScore: { team1: 0, team2: 0 },
        createdAt: nowIso,
        updatedAt: nowIso,
        finishedAt: null
      };
      seriesStore.set(seriesId, series);
    } else {
      series.updatedAt = nowIso;
      // Actualizar formato si ahora se conoce y antes era UNKNOWN
      if (series.format === 'UNKNOWN' && format && format !== 'UNKNOWN') {
        series.format = format;
      }
      if (context.matchId && !series.matchId) {
        series.matchId = context.matchId;
      }
      if (mapNumber != null) {
        series.currentMapNumber = mapNumber;
        if (series.status === SERIES_STATUS.WAITING_NEXT_MAP) {
          series.status = SERIES_STATUS.LIVE;
        }
      }
    }

    // Gestionar el mapa dentro de la serie si mapNumber está disponible
    if (mapNumber != null) {
      let mapRecord = series.maps.find(m => m.number === mapNumber);
      if (!mapRecord) {
        mapRecord = {
          number: mapNumber,
          name: mapName,
          status: MAP_STATUS.LIVE,
          score: { team1: null, team2: null },
          winner: null,
          pickedBy: null,
          source: 'forg1',
          predictions: []
        };
        series.maps.push(mapRecord);
        series.maps.sort((a, b) => a.number - b.number);
      } else {
        if (mapName && !mapRecord.name) {
          mapRecord.name = mapName;
        }
        if (mapRecord.status === MAP_STATUS.UPCOMING) {
          mapRecord.status = MAP_STATUS.LIVE;
        }
      }

      const predId = prediction.id || prediction.predictionId;
      if (predId && !mapRecord.predictions.includes(predId)) {
        mapRecord.predictions.push(predId);
      }
    }

    // Vincular la predicción
    const predId = prediction.id || prediction.predictionId;
    if (predId) {
      if (!series.predictions.includes(predId)) {
        series.predictions.push(predId);
      }
      predictionToSeries.set(predId, seriesId);
      predictionStore.set(predId, prediction);
    }

    // Anexar metadatos de serie a la predicción
    prediction.seriesId = seriesId;
    prediction.mapNumber = mapNumber;
    prediction.mapSignature = mapSignature;
    prediction.seriesScore = { ...series.seriesScore };

    return {
      series,
      mapSignature,
      mapNumber
    };
  }

  /**
   * Actualiza el resultado verificado de un mapa y recalcula el seriesScore.
   */
  function updateMapResult(seriesId, mapNumber, result = {}) {
    const series = seriesStore.get(seriesId);
    if (!series) return null;

    let mapRecord = series.maps.find(m => m.number === mapNumber);
    if (!mapRecord) {
      mapRecord = {
        number: mapNumber,
        name: result.mapName || null,
        status: MAP_STATUS.PLAYED,
        score: { team1: null, team2: null },
        winner: null,
        pickedBy: null,
        source: result.source || 'hltv',
        predictions: []
      };
      series.maps.push(mapRecord);
      series.maps.sort((a, b) => a.number - b.number);
    }

    const s1 = typeof result.team1Score === 'number' ? result.team1Score : null;
    const s2 = typeof result.team2Score === 'number' ? result.team2Score : null;

    mapRecord.score = { team1: s1, team2: s2 };

    let winner = null;
    if (result.winner === 'team1' || result.winner === 'team2') {
      winner = result.winner;
    } else if (s1 !== null && s2 !== null) {
      if (s1 > s2) winner = 'team1';
      else if (s2 > s1) winner = 'team2';
    }

    if (winner) {
      mapRecord.winner = winner;
      mapRecord.status = MAP_STATUS.PLAYED;
    }

    // Recalcular puntaje acumulado de la serie
    let t1Wins = 0;
    let t2Wins = 0;
    for (const m of series.maps) {
      if (m.winner === 'team1') t1Wins++;
      else if (m.winner === 'team2') t2Wins++;
    }

    series.seriesScore = { team1: t1Wins, team2: t2Wins };
    series.team1.score = t1Wins;
    series.team2.score = t2Wins;
    series.updatedAt = new Date().toISOString();

    // Evaluar finalización de serie según formato
    let isFinished = false;
    if (series.format === 'BO1') {
      if (t1Wins >= 1 || t2Wins >= 1) isFinished = true;
    } else if (series.format === 'BO3') {
      if (t1Wins >= 2 || t2Wins >= 2) isFinished = true;
    } else if (series.format === 'BO5') {
      if (t1Wins >= 3 || t2Wins >= 3) isFinished = true;
    }

    if (isFinished) {
      series.status = SERIES_STATUS.FINISHED;
      series.finishedAt = new Date().toISOString();
    } else if (series.status !== SERIES_STATUS.FINISHED) {
      series.status = SERIES_STATUS.WAITING_NEXT_MAP;
    }

    return series;
  }

  /**
   * Notifica que una predicción se cerró.
   * Regla de oro: Cerrar una predicción NUNCA finaliza la serie.
   */
  function markPredictionClosed(predictionId) {
    if (!predictionId) return null;
    const seriesId = predictionToSeries.get(predictionId);
    if (!seriesId) return null;

    const series = seriesStore.get(seriesId);
    if (!series) return null;

    // Actualizar timestamp y pasar estado a WAITING_NEXT_MAP si estaba en LIVE
    series.updatedAt = new Date().toISOString();
    if (series.status === SERIES_STATUS.LIVE) {
      series.status = SERIES_STATUS.WAITING_NEXT_MAP;
    }

    return series;
  }

  function getSeries(seriesId) {
    return seriesStore.get(seriesId) || null;
  }

  function getActiveSeries() {
    const active = [];
    for (const s of seriesStore.values()) {
      if (s.status !== SERIES_STATUS.FINISHED) {
        active.push(s);
      }
    }
    return active;
  }

  /**
   * Limpia series finalizadas que superaron el tiempo de retención.
   */
  function removeExpiredSeries(now = Date.now()) {
    let removedCount = 0;
    for (const [id, s] of seriesStore.entries()) {
      if (s.status === SERIES_STATUS.FINISHED && s.finishedAt) {
        const finishedTs = new Date(s.finishedAt).getTime();
        if (!isNaN(finishedTs) && now - finishedTs > finishedRetentionMs) {
          seriesStore.delete(id);
          // Limpiar referencias en índices auxiliares
          for (const pid of s.predictions) {
            predictionToSeries.delete(pid);
            predictionStore.delete(pid);
          }
          removedCount++;
        }
      }
    }
    return removedCount;
  }

  function clear() {
    seriesStore.clear();
    predictionToSeries.clear();
    predictionStore.clear();
  }

  return {
    SERIES_STATUS,
    MAP_STATUS,
    createSeriesTracker,
    resolveSeries,
    upsertPrediction,
    updateMapResult,
    markPredictionClosed,
    getSeries,
    getActiveSeries,
    removeExpiredSeries,
    clear,
    extractMapAndFormat
  };
}

const defaultTracker = createSeriesTracker();

module.exports = {
  SERIES_STATUS,
  MAP_STATUS,
  createSeriesTracker,
  extractMapAndFormat,
  defaultTracker
};
