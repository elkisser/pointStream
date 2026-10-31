/**
 * test/series-tracker.test.js
 *
 * Suite de tests para validar el gestor de estado de series y mapas (Fase 9.1).
 * Cubre los 20 escenarios obligatorios especificados en la arquitectura.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  createSeriesTracker,
  SERIES_STATUS,
  MAP_STATUS,
  extractMapAndFormat
} = require('../electron/series-tracker');

describe('FASE 9.1 — Series & Map State Tracker', () => {

  // Test 1: Crear una serie BO3. Esperado: seriesScore = { team1: 0, team2: 0 }
  test('Test 1 — Crear una serie BO3: seriesScore inicial es 0-0', () => {
    const tracker = createSeriesTracker();
    const pred = {
      id: 'p-init-1',
      title: 'Vitality vs MOUZ — BO3',
      question: '¿Quién gana el mapa 1?',
      teams: [{ name: 'Vitality' }, { name: 'MOUZ' }],
      mapNumber: 1,
      format: 'BO3',
      createdAt: '2026-09-18T19:00:00Z'
    };

    const res = tracker.upsertPrediction(pred);
    assert.ok(res);
    assert.ok(res.series);
    assert.equal(res.series.format, 'BO3');
    assert.deepEqual(res.series.seriesScore, { team1: 0, team2: 0 });
    assert.equal(res.series.status, SERIES_STATUS.LIVE);
  });

  // Test 2: Agregar Prediction Map 1. Esperado: series has map 1, prediction linked to map 1
  test('Test 2 — Agregar Prediction Map 1: mapa 1 registrado y predicción vinculada', () => {
    const tracker = createSeriesTracker();
    const pred = {
      id: 'p-map1-winner',
      title: 'Vitality vs MOUZ — BO3',
      question: 'Ganador del mapa 1',
      teams: [{ name: 'Vitality' }, { name: 'MOUZ' }],
      mapNumber: 1,
      format: 'BO3',
      createdAt: '2026-09-18T19:00:00Z'
    };

    tracker.upsertPrediction(pred);
    const series = tracker.getSeries(pred.seriesId);
    assert.ok(series);
    assert.equal(series.maps.length, 1);
    assert.equal(series.maps[0].number, 1);
    assert.ok(series.maps[0].predictions.includes('p-map1-winner'));
    assert.ok(series.predictions.includes('p-map1-winner'));
    assert.equal(pred.mapSignature, `${series.seriesId}_map_1`);
  });

  // Test 3: Cerrar Prediction Map 1. Esperado: prediction closed, series still exists, series NOT FINISHED
  test('Test 3 — Cerrar Prediction Map 1: serie sigue activa (NOT FINISHED)', () => {
    const tracker = createSeriesTracker();
    const pred = {
      id: 'p-map1-a',
      title: 'Vitality vs MOUZ — BO3',
      question: 'Ganador mapa 1',
      teams: [{ name: 'Vitality' }, { name: 'MOUZ' }],
      mapNumber: 1,
      format: 'BO3',
      createdAt: '2026-09-18T19:00:00Z'
    };

    tracker.upsertPrediction(pred);
    const seriesBefore = tracker.getSeries(pred.seriesId);
    assert.equal(seriesBefore.status, SERIES_STATUS.LIVE);

    // Cerrar la predicción del mapa 1
    const seriesAfter = tracker.markPredictionClosed('p-map1-a');
    assert.ok(seriesAfter);
    assert.notEqual(seriesAfter.status, SERIES_STATUS.FINISHED, 'Cerrar una predicción jamás debe finalizar la serie');
    assert.equal(seriesAfter.status, SERIES_STATUS.WAITING_NEXT_MAP);
  });

  // Test 4: Agregar Prediction Map 2 con NUEVO Forg1 ID. Esperado: same series, different prediction
  test('Test 4 — Agregar Prediction Map 2 con nuevo ID: misma serie, diferente predicción y mapa', () => {
    const tracker = createSeriesTracker();
    const pred1 = {
      id: 'forg1::pred-map1',
      title: 'Vitality vs MOUZ — BO3',
      question: 'Ganador del mapa 1',
      teams: [{ name: 'Vitality' }, { name: 'MOUZ' }],
      mapNumber: 1,
      format: 'BO3',
      createdAt: '2026-09-18T19:00:00Z'
    };
    const pred2 = {
      id: 'forg1::pred-map2',
      title: 'Vitality vs MOUZ — BO3',
      question: 'Ganador del mapa 2',
      teams: [{ name: 'Vitality' }, { name: 'MOUZ' }],
      mapNumber: 2,
      format: 'BO3',
      createdAt: '2026-09-18T19:40:00Z'
    };

    tracker.upsertPrediction(pred1);
    tracker.markPredictionClosed(pred1.id);

    tracker.upsertPrediction(pred2);
    assert.equal(pred1.seriesId, pred2.seriesId, 'Ambas predicciones deben compartir el mismo seriesId');
    assert.notEqual(pred1.id, pred2.id);
    assert.equal(pred1.mapNumber, 1);
    assert.equal(pred2.mapNumber, 2);
    assert.notEqual(pred1.mapSignature, pred2.mapSignature);

    const series = tracker.getSeries(pred1.seriesId);
    assert.equal(series.maps.length, 2);
    assert.equal(series.predictions.length, 2);
  });

  // Test 5: Verificar que recentlyClosed no bloquee Map 2 (CRÍTICO)
  test('Test 5 — Cooldown de cierre: Map 1 cerrado no bloquea nueva predicción de Map 2', () => {
    // Simular el mecanismo de main.js
    const tracker = createSeriesTracker();
    const recentlyClosed = new Map();
    const knownPredictions = new Map();

    const pred1 = {
      id: 'forg1::ticket-101',
      title: 'Vitality vs MOUZ — BO3',
      question: 'Ganador del mapa 1',
      teams: [{ name: 'Vitality' }, { name: 'MOUZ' }],
      mapNumber: 1,
      status: 'OPEN',
      createdAt: '2026-09-18T19:00:00Z'
    };

    tracker.upsertPrediction(pred1);
    const sig1 = `forg1::${pred1.id}`;
    knownPredictions.set(sig1, pred1);

    // Ciclo 2: Pred 1 desaparece (se cierra)
    knownPredictions.delete(sig1);
    recentlyClosed.set(sig1, Date.now());
    tracker.markPredictionClosed(pred1.id);

    // Ciclo 3: Comienza Mapa 2 con nueva predicción
    const pred2 = {
      id: 'forg1::ticket-102',
      title: 'Vitality vs MOUZ — BO3',
      question: 'Ganador del mapa 2',
      teams: [{ name: 'Vitality' }, { name: 'MOUZ' }],
      mapNumber: 2,
      status: 'OPEN',
      createdAt: '2026-09-18T19:40:00Z'
    };

    tracker.upsertPrediction(pred2);
    const sig2 = `forg1::${pred2.id}`;

    // Verificación de descarte o admisión
    assert.notEqual(sig1, sig2);
    assert.equal(recentlyClosed.has(sig2), false, 'La predicción del mapa 2 no debe estar en cooldown');
    assert.equal(knownPredictions.has(sig2), false, 'La predicción del mapa 2 debe ser detectada como nueva');

    // La serie debe mantenerse intacta
    const series = tracker.getSeries(pred2.seriesId);
    assert.ok(series);
    assert.equal(series.status, SERIES_STATUS.LIVE);
  });

  // Test 6: Actualizar resultado Map 1: 13-9. Esperado: seriesScore = 1-0
  test('Test 6 — Actualizar resultado Map 1: Vitality 13-9 MOUZ genera seriesScore 1-0', () => {
    const tracker = createSeriesTracker();
    const pred = {
      id: 'p-score-1',
      title: 'Vitality vs MOUZ — BO3',
      question: 'Ganador mapa 1',
      teams: [{ name: 'Vitality' }, { name: 'MOUZ' }],
      mapNumber: 1,
      format: 'BO3'
    };
    tracker.upsertPrediction(pred);

    const updated = tracker.updateMapResult(pred.seriesId, 1, {
      team1Score: 13,
      team2Score: 9,
      mapName: 'Mirage'
    });

    assert.ok(updated);
    assert.equal(updated.seriesScore.team1, 1);
    assert.equal(updated.seriesScore.team2, 0);
    assert.equal(updated.status, SERIES_STATUS.WAITING_NEXT_MAP);
    assert.equal(updated.maps[0].winner, 'team1');
  });

  // Test 7: Agregar Map 2. Esperado: seriesScore remains 1-0 hasta tener resultado del Map 2
  test('Test 7 — Agregar Map 2: seriesScore permanece 1-0 mientras se juega Map 2', () => {
    const tracker = createSeriesTracker();
    const pred1 = {
      id: 'p-m1',
      title: 'Vitality vs MOUZ — BO3',
      question: 'Mapa 1',
      teams: [{ name: 'Vitality' }, { name: 'MOUZ' }],
      mapNumber: 1,
      format: 'BO3'
    };
    tracker.upsertPrediction(pred1);
    tracker.updateMapResult(pred1.seriesId, 1, { team1Score: 13, team2Score: 9 });

    const pred2 = {
      id: 'p-m2',
      title: 'Vitality vs MOUZ — BO3',
      question: 'Mapa 2',
      teams: [{ name: 'Vitality' }, { name: 'MOUZ' }],
      mapNumber: 2,
      format: 'BO3'
    };
    tracker.upsertPrediction(pred2);

    assert.deepEqual(pred2.seriesScore, { team1: 1, team2: 0 });
    const s = tracker.getSeries(pred2.seriesId);
    assert.deepEqual(s.seriesScore, { team1: 1, team2: 0 });
    assert.equal(s.status, SERIES_STATUS.LIVE);
  });

  // Test 8: Map 2 termina: MOUZ 13-10 Vitality. Esperado: seriesScore = 1-1
  test('Test 8 — Map 2 termina (MOUZ 13-10 Vitality): seriesScore se empata a 1-1', () => {
    const tracker = createSeriesTracker();
    const pred1 = {
      id: 'p-seq-1',
      title: 'Vitality vs MOUZ — BO3',
      teams: [{ name: 'Vitality' }, { name: 'MOUZ' }],
      mapNumber: 1,
      format: 'BO3'
    };
    tracker.upsertPrediction(pred1);
    tracker.updateMapResult(pred1.seriesId, 1, { team1Score: 13, team2Score: 9 });

    const updated = tracker.updateMapResult(pred1.seriesId, 2, {
      team1Score: 10,
      team2Score: 13,
      mapName: 'Nuke'
    });

    assert.equal(updated.seriesScore.team1, 1);
    assert.equal(updated.seriesScore.team2, 1);
    assert.equal(updated.status, SERIES_STATUS.WAITING_NEXT_MAP);
  });

  // Test 9: Map 3 termina: Vitality 13-7 MOUZ. Esperado: seriesScore = 2-1, status = FINISHED
  test('Test 9 — Map 3 termina (Vitality 13-7 MOUZ): seriesScore = 2-1 y status = FINISHED', () => {
    const tracker = createSeriesTracker();
    const pred1 = {
      id: 'p-bo3-1',
      title: 'Vitality vs MOUZ — BO3',
      teams: [{ name: 'Vitality' }, { name: 'MOUZ' }],
      mapNumber: 1,
      format: 'BO3'
    };
    tracker.upsertPrediction(pred1);
    tracker.updateMapResult(pred1.seriesId, 1, { team1Score: 13, team2Score: 9 });
    tracker.updateMapResult(pred1.seriesId, 2, { team1Score: 10, team2Score: 13 });
    const finalSeries = tracker.updateMapResult(pred1.seriesId, 3, { team1Score: 13, team2Score: 7 });

    assert.equal(finalSeries.seriesScore.team1, 2);
    assert.equal(finalSeries.seriesScore.team2, 1);
    assert.equal(finalSeries.status, SERIES_STATUS.FINISHED);
    assert.ok(finalSeries.finishedAt);
  });

  // Test 10: BO1: map 1 ends. Esperado: series FINISHED on 1-0
  test('Test 10 — BO1: el fin del mapa 1 finaliza la serie de inmediato', () => {
    const tracker = createSeriesTracker();
    const pred = {
      id: 'p-bo1',
      title: 'FaZe vs G2 — BO1',
      teams: [{ name: 'FaZe' }, { name: 'G2' }],
      mapNumber: 1,
      format: 'BO1'
    };
    tracker.upsertPrediction(pred);
    const s = tracker.updateMapResult(pred.seriesId, 1, { team1Score: 13, team2Score: 11 });

    assert.equal(s.seriesScore.team1, 1);
    assert.equal(s.seriesScore.team2, 0);
    assert.equal(s.status, SERIES_STATUS.FINISHED);
  });

  // Test 11: BO3 2-0: map 1, map 2 won by same team. Esperado: FINISHED sin crear Map 3
  test('Test 11 — BO3 2-0: dos victorias consecutivas finalizan la serie sin esperar Mapa 3', () => {
    const tracker = createSeriesTracker();
    const pred = {
      id: 'p-clean-1',
      title: 'Spirit vs NaVi — BO3',
      teams: [{ name: 'Spirit' }, { name: 'NaVi' }],
      mapNumber: 1,
      format: 'BO3'
    };
    tracker.upsertPrediction(pred);
    tracker.updateMapResult(pred.seriesId, 1, { team1Score: 13, team2Score: 5 });
    const s = tracker.updateMapResult(pred.seriesId, 2, { team1Score: 13, team2Score: 8 });

    assert.equal(s.seriesScore.team1, 2);
    assert.equal(s.seriesScore.team2, 0);
    assert.equal(s.status, SERIES_STATUS.FINISHED);
    assert.equal(s.maps.length, 2, 'No debe crearse un mapa 3 espurio');
  });

  // Test 12: BO5: no finalizar antes de alcanzar 3 victorias
  test('Test 12 — BO5: 2-0 y 2-2 no finalizan la serie, requiere 3 victorias', () => {
    const tracker = createSeriesTracker();
    const pred = {
      id: 'p-bo5',
      title: 'FaZe vs MOUZ — BO5 Grand Final',
      teams: [{ name: 'FaZe' }, { name: 'MOUZ' }],
      mapNumber: 1,
      format: 'BO5'
    };
    tracker.upsertPrediction(pred);

    tracker.updateMapResult(pred.seriesId, 1, { team1Score: 13, team2Score: 5 }); // 1-0
    let s = tracker.updateMapResult(pred.seriesId, 2, { team1Score: 13, team2Score: 8 }); // 2-0
    assert.notEqual(s.status, SERIES_STATUS.FINISHED, 'BO5 con 2-0 aún no debe finalizar');

    s = tracker.updateMapResult(pred.seriesId, 3, { team1Score: 10, team2Score: 13 }); // 2-1
    assert.notEqual(s.status, SERIES_STATUS.FINISHED);

    s = tracker.updateMapResult(pred.seriesId, 4, { team1Score: 9, team2Score: 13 }); // 2-2
    assert.notEqual(s.status, SERIES_STATUS.FINISHED);

    s = tracker.updateMapResult(pred.seriesId, 5, { team1Score: 13, team2Score: 11 }); // 3-2
    assert.equal(s.status, SERIES_STATUS.FINISHED);
    assert.equal(s.seriesScore.team1, 3);
    assert.equal(s.seriesScore.team2, 2);
  });

  // Test 13: Prediction sin equipos. Esperado: seriesId = null (ZERO FAKE DATA)
  test('Test 13 — ZERO FAKE DATA: Predicción sin equipos no crea serie ni inventa ID', () => {
    const tracker = createSeriesTracker();
    const pred = {
      id: 'p-single-player',
      title: '¿Cuántas kills hace donk?',
      question: 'Kills de donk',
      teams: [], // Sin 2 equipos
      mapNumber: 1
    };

    const res = tracker.upsertPrediction(pred);
    assert.equal(res, null);
    assert.equal(pred.seriesId, null);
    assert.equal(pred.mapSignature, null);
    assert.equal(tracker.getActiveSeries().length, 0);
  });

  // Test 14: Mismos equipos pero fechas diferentes. Esperado: different series
  test('Test 14 — Mismos equipos pero fechas distintas corresponden a series independientes', () => {
    const tracker = createSeriesTracker();
    const predDay1 = {
      id: 'p-d1',
      title: 'Vitality vs MOUZ',
      teams: [{ name: 'Vitality' }, { name: 'MOUZ' }],
      mapNumber: 1,
      createdAt: '2026-09-17T18:00:00Z'
    };
    const predDay2 = {
      id: 'p-d2',
      title: 'Vitality vs MOUZ',
      teams: [{ name: 'Vitality' }, { name: 'MOUZ' }],
      mapNumber: 1,
      createdAt: '2026-09-18T18:00:00Z'
    };

    tracker.upsertPrediction(predDay1);
    tracker.upsertPrediction(predDay2);

    assert.notEqual(predDay1.seriesId, predDay2.seriesId);
    assert.equal(tracker.getActiveSeries().length, 2);
  });

  // Test 15: Liquid vs Liquid Academy. Esperado: different teams
  test('Test 15 — Identidad estricta: Liquid vs Liquid Academy son equipos diferentes', () => {
    const tracker = createSeriesTracker();
    const predA = {
      id: 'p-main',
      title: 'Liquid vs FaZe',
      teams: [{ name: 'Liquid' }, { name: 'FaZe' }],
      mapNumber: 1,
      createdAt: '2026-09-18T18:00:00Z'
    };
    const predB = {
      id: 'p-acad',
      title: 'Liquid Academy vs FaZe',
      teams: [{ name: 'Liquid Academy' }, { name: 'FaZe' }],
      mapNumber: 1,
      createdAt: '2026-09-18T18:00:00Z'
    };

    tracker.upsertPrediction(predA);
    tracker.upsertPrediction(predB);

    assert.notEqual(predA.seriesId, predB.seriesId);
  });

  // Test 16: Duplicate prediction. Esperado: same prediction identity, no duplicated series entry
  test('Test 16 — Deduplicación: re-insertar la misma predicción no duplica registros', () => {
    const tracker = createSeriesTracker();
    const pred = {
      id: 'p-dup-1',
      title: 'Vitality vs MOUZ',
      teams: [{ name: 'Vitality' }, { name: 'MOUZ' }],
      mapNumber: 1,
      createdAt: '2026-09-18T18:00:00Z'
    };

    tracker.upsertPrediction(pred);
    tracker.upsertPrediction(pred);

    const series = tracker.getSeries(pred.seriesId);
    assert.equal(series.predictions.length, 1);
    assert.equal(series.maps[0].predictions.length, 1);
  });

  // Test 17: Multiple markets. Una predicción con winner, OT, rounds debe pertenecer a una única serie/map
  test('Test 17 — Multi-Market: Múltiples mercados dentro de una predicción comparten un único Map y Series', () => {
    const tracker = createSeriesTracker();
    const pred = {
      id: 'p-multi-market',
      title: 'Bestia vs Imperial — BO3',
      question: 'Ganador del mapa 1',
      teams: [{ name: 'Bestia' }, { name: 'Imperial' }],
      mapNumber: 1,
      format: 'BO3',
      markets: [
        { id: 'm1', question: 'Ganador mapa 1' },
        { id: 'm2', question: '¿Habrá OT en mapa 1?' },
        { id: 'm3', question: 'Total de rondas mapa 1' }
      ],
      createdAt: '2026-09-18T20:00:00Z'
    };

    tracker.upsertPrediction(pred);
    const series = tracker.getSeries(pred.seriesId);

    assert.ok(series);
    assert.equal(series.maps.length, 1);
    assert.equal(series.predictions.length, 1);
    assert.equal(pred.mapSignature, `${series.seriesId}_map_1`);
  });

  // Test 18: Unknown format. No inferir BO3 automáticamente
  test('Test 18 — ZERO FAKE DATA: Formato no inferido permanece UNKNOWN', () => {
    const tracker = createSeriesTracker();
    const pred = {
      id: 'p-no-format',
      title: 'MIBR vs paiN',
      question: 'Quién gana',
      teams: [{ name: 'MIBR' }, { name: 'paiN' }],
      createdAt: '2026-09-18T20:00:00Z'
    };

    tracker.upsertPrediction(pred);
    const series = tracker.getSeries(pred.seriesId);

    assert.equal(series.format, 'UNKNOWN');
    assert.notEqual(series.format, 'BO3', 'No asumir BO3 sin evidencia');
  });

  // Test 19: Unknown map number. No inventar mapNumber
  test('Test 19 — ZERO FAKE DATA: Número de mapa no inferido permanece null', () => {
    const meta = extractMapAndFormat('¿Quién gana el partido entre Vitality y MOUZ?');
    assert.equal(meta.mapNumber, null);
    assert.equal(meta.format, 'UNKNOWN');

    const tracker = createSeriesTracker();
    const pred = {
      id: 'p-no-map',
      title: 'Vitality vs MOUZ',
      question: '¿Quién gana el partido?',
      teams: [{ name: 'Vitality' }, { name: 'MOUZ' }],
      createdAt: '2026-09-18T20:00:00Z'
    };

    tracker.upsertPrediction(pred);
    assert.equal(pred.mapNumber, null);
    assert.equal(pred.mapSignature, null);
  });

  // Test 20: Finished series purge. Después del TTL: series removed
  test('Test 20 — Purga de series finalizadas: se eliminan tras superar el TTL de retención', () => {
    const tracker = createSeriesTracker({ finishedRetentionMs: 1000 }); // 1 segundo para test
    const pred = {
      id: 'p-purge',
      title: 'Vitality vs MOUZ — BO1',
      teams: [{ name: 'Vitality' }, { name: 'MOUZ' }],
      mapNumber: 1,
      format: 'BO1',
      createdAt: '2026-09-18T20:00:00Z'
    };

    tracker.upsertPrediction(pred);
    tracker.updateMapResult(pred.seriesId, 1, { team1Score: 13, team2Score: 9 });

    assert.equal(tracker.getSeries(pred.seriesId).status, SERIES_STATUS.FINISHED);

    // Inmediatamente después: aún no purga
    const purgedEarly = tracker.removeExpiredSeries(Date.now());
    assert.equal(purgedEarly, 0);
    assert.ok(tracker.getSeries(pred.seriesId));

    // Tras superar el TTL (simulando tiempo futuro de 2 segundos)
    const futureTime = Date.now() + 2000;
    const purged = tracker.removeExpiredSeries(futureTime);
    assert.equal(purged, 1);
    assert.equal(tracker.getSeries(pred.seriesId), null);
  });

});
