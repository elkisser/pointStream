const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PredictionStatus,
  normalizePredictionStatus,
  parsePredictionFromState,
  parsePredictionsFromText,
  classifyPrediction
} = require('../electron/forg1-scraper');

test('Caso A — 1 predicción, 1 mercado, 2 elecciones (Ganador del mapa 1)', () => {
  const state = {
    prediction: {
      id: 'pred-map1-winner',
      title: 'Ganador del mapa 1',
      status: 'open',
      locks_at: '2026-09-17T23:00:00Z',
      outcomes: [
        { id: 'opt-1', label: 'Equipo 1', total_points: 60000, total_bettors: 40 },
        { id: 'opt-2', label: 'Equipo 2', total_points: 40000, total_bettors: 25 }
      ]
    }
  };

  const preds = parsePredictionFromState(state);
  assert.equal(preds.length, 1);
  const p = preds[0];
  assert.equal(p.id, 'pred-map1-winner');
  assert.equal(p.markets.length, 1);
  const m = p.markets[0];
  assert.equal(m.question, 'Ganador del mapa 1');
  assert.equal(m.selections.length, 2);
  assert.equal(m.selections[0].name, 'Equipo 1');
  assert.equal(m.selections[0].percentage, '60%');
  assert.equal(m.selections[1].name, 'Equipo 2');
  assert.equal(m.selections[1].percentage, '40%');
  assert.equal(m.type, 'team-matchup');
});

test('Caso B — 1 predicción, 1 mercado, 3 elecciones (Ganador de la serie con OT)', () => {
  const state = {
    prediction: {
      id: 'pred-series-ot',
      title: 'Ganador de la serie',
      status: 'open',
      locks_at: '2026-09-17T23:00:00Z',
      outcomes: [
        { id: 'opt-1', label: 'Equipo 1', total_points: 50000, total_bettors: 50 },
        { id: 'opt-2', label: 'OT', total_points: 10000, total_bettors: 10 },
        { id: 'opt-3', label: 'Equipo 2', total_points: 40000, total_bettors: 40 }
      ]
    }
  };

  const preds = parsePredictionFromState(state);
  assert.equal(preds.length, 1);
  const m = preds[0].markets[0];
  assert.equal(m.selections.length, 3);
  assert.equal(m.selections[1].name, 'OT');
  assert.equal(m.selections[1].percentage, '10%');
  assert.equal(m.type, 'ot');
});

test('Caso C — 1 predicción, 1 mercado, 4 elecciones (Kills de jugador)', () => {
  const state = {
    prediction: {
      id: 'pred-kills-apex',
      title: '¿Cuántas mata apEX?',
      status: 'open',
      locks_at: '2026-09-17T23:00:00Z',
      outcomes: [
        { id: 'k1', label: '1 - 5', total_points: 10000, total_bettors: 5 },
        { id: 'k2', label: '6 - 9', total_points: 20000, total_bettors: 12 },
        { id: 'k3', label: '10 - 14', total_points: 50000, total_bettors: 30 },
        { id: 'k4', label: '15 - 20', total_points: 20000, total_bettors: 15 }
      ]
    }
  };

  const preds = parsePredictionFromState(state);
  assert.equal(preds.length, 1);
  const m = preds[0].markets[0];
  assert.equal(m.selections.length, 4);
  assert.equal(m.type, 'kills-range');
  assert.equal(m.selections[2].name, '10 - 14');
  assert.equal(m.selections[2].percentage, '50%');
});

test('Caso D — 1 predicción con múltiples mercados y cantidad variable de elecciones', () => {
  const state = {
    prediction: {
      id: 'match-event-100',
      title: 'Bestia vs Imperial — Bo3',
      status: 'open',
      locks_at: '2026-09-17T23:00:00Z',
      markets: [
        {
          id: 'm1',
          title: 'Ganador del mapa 1',
          outcomes: [
            { id: 'm1-1', label: 'Bestia', total_points: 700, total_bettors: 7 },
            { id: 'm1-2', label: 'Imperial', total_points: 300, total_bettors: 3 }
          ]
        },
        {
          id: 'm2',
          title: 'Ganador de la serie',
          outcomes: [
            { id: 'm2-1', label: 'Bestia', total_points: 500, total_bettors: 5 },
            { id: 'm2-2', label: 'OT', total_points: 100, total_bettors: 1 },
            { id: 'm2-3', label: 'Imperial', total_points: 400, total_bettors: 4 }
          ]
        },
        {
          id: 'm3',
          title: '¿Cuántas mata apEX?',
          outcomes: [
            { id: 'm3-1', label: '1 - 5', total_points: 100, total_bettors: 1 },
            { id: 'm3-2', label: '6 - 9', total_points: 200, total_bettors: 2 },
            { id: 'm3-3', label: '10 - 14', total_points: 500, total_bettors: 5 },
            { id: 'm3-4', label: '15 - 20', total_points: 200, total_bettors: 2 }
          ]
        }
      ]
    }
  };

  const preds = parsePredictionFromState(state);
  assert.equal(preds.length, 1);
  const p = preds[0];
  assert.equal(p.id, 'match-event-100');
  assert.equal(p.markets.length, 3);
  assert.equal(p.markets[0].selections.length, 2);
  assert.equal(p.markets[1].selections.length, 3);
  assert.equal(p.markets[2].selections.length, 4);
  assert.equal(p.markets[0].type, 'team-matchup');
  assert.equal(p.markets[1].type, 'ot');
  assert.equal(p.markets[2].type, 'kills-range');
});

test('Caso E — Mercado con 5+ elecciones', () => {
  const state = {
    prediction: {
      id: 'pred-mvp',
      title: '¿Quién será el MVP del partido?',
      status: 'open',
      outcomes: [
        { id: 'p1', label: 'tuchito', total_points: 100, total_bettors: 1 },
        { id: 'p2', label: 'luchov', total_points: 100, total_bettors: 1 },
        { id: 'p3', label: 'noktse', total_points: 200, total_bettors: 2 },
        { id: 'p4', label: 'deco', total_points: 100, total_bettors: 1 },
        { id: 'p5', label: 'meyern', total_points: 500, total_bettors: 5 }
      ]
    }
  };

  const preds = parsePredictionFromState(state);
  assert.equal(preds[0].markets[0].selections.length, 5);
  assert.equal(preds[0].markets[0].selections[4].percentage, '50%');
});

test('Caso F — Mercado con exactamente 2 opciones (no asumir 3)', () => {
  const state = {
    prediction: {
      id: 'pred-exact-2',
      title: '¿Habrá overtime en mapa 2?',
      outcomes: [
        { id: 'y', label: 'Sí', total_points: 300, total_bettors: 3 },
        { id: 'n', label: 'No', total_points: 700, total_bettors: 7 }
      ]
    }
  };

  const preds = parsePredictionFromState(state);
  assert.equal(preds[0].markets[0].selections.length, 2);
  assert.equal(preds[0].markets[0].type, 'yes-no');
});

test('Caso G — Mercado con exactamente 3 elecciones', () => {
  const state = {
    prediction: {
      id: 'pred-exact-3',
      title: 'Resultado de la serie',
      outcomes: [
        { id: 'r1', label: '2 - 0', total_points: 400, total_bettors: 4 },
        { id: 'r2', label: '2 - 1', total_points: 400, total_bettors: 4 },
        { id: 'r3', label: '0 - 2', total_points: 200, total_bettors: 2 }
      ]
    }
  };

  const preds = parsePredictionFromState(state);
  assert.equal(preds[0].markets[0].selections.length, 3);
});

test('Caso H — Mercado con 4+ opciones de rangos', () => {
  const state = {
    prediction: {
      id: 'pred-rounds',
      title: 'Total de rondas jugadas',
      outcomes: [
        { id: 'r1', label: 'Menos de 20.5', total_points: 250, total_bettors: 2 },
        { id: 'r2', label: '21 - 24', total_points: 250, total_bettors: 2 },
        { id: 'r3', label: '25 - 28', total_points: 250, total_bettors: 2 },
        { id: 'r4', label: 'Más de 28.5', total_points: 250, total_bettors: 2 }
      ]
    }
  };

  const preds = parsePredictionFromState(state);
  assert.equal(preds[0].markets[0].selections.length, 4);
});

test('Caso I — Datos incompletos sin inventar valores (Zero Fake Data)', () => {
  const state = {
    prediction: {
      id: 'pred-incomplete',
      title: 'Pregunta sin puntos',
      outcomes: [
        { id: 'o1', label: 'Opción Alpha' },
        { id: 'o2', label: 'Opción Beta' }
      ]
    }
  };

  const preds = parsePredictionFromState(state);
  assert.equal(preds.length, 1);
  const m = preds[0].markets[0];
  assert.equal(m.selections.length, 2);
  assert.equal(m.selections[0].points, 0);
  assert.equal(m.selections[0].bettors, 0);
  assert.equal(m.selections[0].name, 'Opción Alpha');
});

test('Caso J — Dos mercados con preguntas similares no deben fusionarse', () => {
  const state = {
    prediction: {
      id: 'pred-dual-map',
      title: 'Match Day',
      markets: [
        {
          id: 'map-1-winner',
          title: '¿Quién gana el mapa 1?',
          outcomes: [
            { id: 'm1-a', label: 'FaZe', total_points: 500, total_bettors: 5 },
            { id: 'm1-b', label: 'NaVi', total_points: 500, total_bettors: 5 }
          ]
        },
        {
          id: 'map-2-winner',
          title: '¿Quién gana el mapa 2?',
          outcomes: [
            { id: 'm2-a', label: 'FaZe', total_points: 400, total_bettors: 4 },
            { id: 'm2-b', label: 'NaVi', total_points: 600, total_bettors: 6 }
          ]
        }
      ]
    }
  };

  const preds = parsePredictionFromState(state);
  assert.equal(preds.length, 1);
  assert.equal(preds[0].markets.length, 2);
  assert.equal(preds[0].markets[0].id, 'map-1-winner');
  assert.equal(preds[0].markets[1].id, 'map-2-winner');
  assert.notEqual(preds[0].markets[0].id, preds[0].markets[1].id);
});

test('Caso K — Mismo mercado con cambios de odds/estado conserva identidad', () => {
  const state1 = {
    prediction: {
      id: 'pred-stable-id',
      title: '¿Quién gana?',
      status: 'open',
      outcomes: [
        { id: 'a', label: 'Equipo A', total_points: 100, total_bettors: 1 },
        { id: 'b', label: 'Equipo B', total_points: 100, total_bettors: 1 }
      ]
    }
  };

  const state2 = {
    prediction: {
      id: 'pred-stable-id',
      title: '¿Quién gana?',
      status: 'locked',
      outcomes: [
        { id: 'a', label: 'Equipo A', total_points: 800, total_bettors: 8 },
        { id: 'b', label: 'Equipo B', total_points: 200, total_bettors: 2 }
      ]
    }
  };

  const p1 = parsePredictionFromState(state1)[0];
  const p2 = parsePredictionFromState(state2)[0];

  assert.equal(p1.id, p2.id);
  assert.equal(p1.status, 'OPEN');
  assert.equal(p2.status, 'WAITING_RESULT');
  assert.equal(p1.markets[0].selections[0].percentage, '50%');
  assert.equal(p2.markets[0].selections[0].percentage, '80%');
});

test('Caso L — Parser de texto plano detecta múltiples mercados sin mezclarlos', () => {
  const rawText = `
PREDICCIONES
¿Quién gana el mapa 1?
Bestia
60%
CLANSBRS
40%
¿Cuántas mata apEX?
1 - 5
10%
6 - 9
20%
10 - 14
50%
15 - 20
20%
CIERRA 15:30
  `;

  const preds = parsePredictionsFromText(rawText);
  assert.equal(preds.length, 1);
  const p = preds[0];
  assert.equal(p.markets.length, 2);
  assert.equal(p.markets[0].question, '¿Quién gana el mapa 1?');
  assert.equal(p.markets[0].selections.length, 2);
  assert.equal(p.markets[1].question, '¿Cuántas mata apEX?');
  assert.equal(p.markets[1].selections.length, 4);
});

// ============================================================================
// FASE 4.1 — TESTS DE SEMÁNTICA Y CICLO DE VIDA (OPEN, WAITING_RESULT, RESOLVED, UNKNOWN)
// ============================================================================

test('Fase 4.1 — Test 1: Predicción con status "open" se normaliza a OPEN', () => {
  assert.equal(normalizePredictionStatus('open'), PredictionStatus.OPEN);
  assert.equal(normalizePredictionStatus('active'), PredictionStatus.OPEN);
  assert.equal(normalizePredictionStatus('live'), PredictionStatus.OPEN);

  const state = {
    prediction: {
      id: 'pred-open-1',
      title: '¿Quién gana?',
      status: 'open',
      locks_at: new Date(Date.now() + 600000).toISOString(),
      outcomes: [
        { id: '1', label: 'A', total_points: 100 },
        { id: '2', label: 'B', total_points: 100 }
      ]
    }
  };
  const parsed = parsePredictionFromState(state);
  assert.equal(parsed[0].status, PredictionStatus.OPEN);
});

test('Fase 4.1 — Test 2: "Esperando ganador" se clasifica como WAITING_RESULT', () => {
  // Desde string de status o desde contexto de texto
  assert.equal(normalizePredictionStatus('esperando ganador'), PredictionStatus.WAITING_RESULT);
  assert.equal(normalizePredictionStatus('', 'Esperando ganador'), PredictionStatus.WAITING_RESULT);
  assert.equal(normalizePredictionStatus('', 'Partida en juego. Esperando ganador...'), PredictionStatus.WAITING_RESULT);

  const textWithWaitingWinner = `
PREDICCIONES
¿Quién gana el mapa 1?
Bestia
60%
CLANSBRS
40%
Esperando ganador
  `;
  const preds = parsePredictionsFromText(textWithWaitingWinner);
  assert.equal(preds.length, 1);
  assert.equal(preds[0].status, PredictionStatus.WAITING_RESULT);
});

test('Fase 4.1 — Test 3: "Predicción cerrada. Esperando resultado" se clasifica como WAITING_RESULT', () => {
  assert.equal(normalizePredictionStatus('locked'), PredictionStatus.WAITING_RESULT);
  assert.equal(normalizePredictionStatus('closed'), PredictionStatus.WAITING_RESULT);
  assert.equal(normalizePredictionStatus('', 'Predicción cerrada. Esperando resultado'), PredictionStatus.WAITING_RESULT);

  const textWithClosedWaiting = `
PREDICCIONES
¿Quién gana el mapa 1?
Bestia
55%
CLANSBRS
45%
Predicción cerrada. Esperando resultado
  `;
  const preds = parsePredictionsFromText(textWithClosedWaiting);
  assert.equal(preds.length, 1);
  assert.equal(preds[0].status, PredictionStatus.WAITING_RESULT);
});

test('Fase 4.1 — Test 4: Predicción resuelta se clasifica como RESOLVED y extrae resultado real', () => {
  assert.equal(normalizePredictionStatus('resolved'), PredictionStatus.RESOLVED);
  assert.equal(normalizePredictionStatus('completed'), PredictionStatus.RESOLVED);
  assert.equal(normalizePredictionStatus('finished'), PredictionStatus.RESOLVED);

  const state = {
    prediction: {
      id: 'pred-res-1',
      title: 'Ganador de la serie',
      status: 'resolved',
      winning_outcome_id: 'opt-vitality',
      outcomes: [
        { id: 'opt-vitality', label: 'Vitality', total_points: 75000 },
        { id: 'opt-g2', label: 'G2', total_points: 25000 }
      ]
    }
  };
  const parsed = parsePredictionFromState(state);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].status, PredictionStatus.RESOLVED);
  assert.equal(parsed[0].result, 'Vitality');
});

test('Fase 4.1 — Test 5: Estado no reconocido se clasifica como UNKNOWN (Zero Fake Data)', () => {
  assert.equal(normalizePredictionStatus('something-new-unrecognized'), PredictionStatus.UNKNOWN);
  assert.equal(normalizePredictionStatus(''), PredictionStatus.UNKNOWN);
  assert.equal(normalizePredictionStatus(null), PredictionStatus.UNKNOWN);

  const state = {
    prediction: {
      id: 'pred-unknown-1',
      title: 'Predicción misteriosa',
      status: 'custom_bizarre_state',
      outcomes: [
        { id: '1', label: 'A', total_points: 10 },
        { id: '2', label: 'B', total_points: 10 }
      ]
    }
  };
  const parsed = parsePredictionFromState(state);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].status, PredictionStatus.UNKNOWN);
  assert.notEqual(parsed[0].status, PredictionStatus.OPEN, 'Un estado desconocido jamás debe asumirse OPEN');
  assert.notEqual(parsed[0].status, PredictionStatus.RESOLVED, 'Un estado desconocido jamás debe asumirse RESOLVED');
});

test('Fase 4.1 — Test 6: ZERO FAKE DATA — WAITING_RESULT sin ganador conserva result === null', () => {
  const state = {
    prediction: {
      id: 'pred-waiting-no-fake',
      title: '¿Quién gana?',
      status: 'locked',
      outcomes: [
        { id: 'opt-1', label: 'Favorito Comunidad', total_points: 90000 },
        { id: 'opt-2', label: 'Underdog', total_points: 10000 }
      ]
    }
  };
  const parsed = parsePredictionFromState(state);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].status, PredictionStatus.WAITING_RESULT);
  assert.strictEqual(parsed[0].result, null, 'El resultado en WAITING_RESULT debe ser null, no adivinado por porcentajes');
});

test('Fase 4.1 — Test 7: Transición temporal por locksAt en el pasado convierte a WAITING_RESULT', () => {
  const pastTime = new Date(Date.now() - 30000).toISOString(); // expiró hace 30s
  const state = {
    prediction: {
      id: 'pred-expired-lock',
      title: '¿Quién gana?',
      status: 'open', // La API decía open pero locks_at ya pasó
      locks_at: pastTime,
      outcomes: [
        { id: '1', label: 'A', total_points: 50 },
        { id: '2', label: 'B', total_points: 50 }
      ]
    }
  };
  const parsed = parsePredictionFromState(state);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].status, PredictionStatus.WAITING_RESULT);
});

test('Fase 4.1 — Test 8: Identidad y deduplicación idéntica a través de transiciones de ciclo', () => {
  const predId = 'uuid-pred-lifecycle-123';
  const openState = {
    prediction: { id: predId, title: 'Team 1 vs Team 2', status: 'open', outcomes: [{ id: '1', label: 'T1' }, { id: '2', label: 'T2' }] }
  };
  const waitingState = {
    prediction: { id: predId, title: 'Team 1 vs Team 2', status: 'locked', outcomes: [{ id: '1', label: 'T1' }, { id: '2', label: 'T2' }] }
  };
  const resolvedState = {
    prediction: { id: predId, title: 'Team 1 vs Team 2', status: 'resolved', winning_outcome_id: '1', outcomes: [{ id: '1', label: 'T1' }, { id: '2', label: 'T2' }] }
  };

  const pOpen = parsePredictionFromState(openState)[0];
  const pWaiting = parsePredictionFromState(waitingState)[0];
  const pResolved = parsePredictionFromState(resolvedState)[0];

  assert.equal(pOpen.id, predId);
  assert.equal(pWaiting.id, predId);
  assert.equal(pResolved.id, predId);
  assert.equal(`forg1::${pOpen.id}`, `forg1::${pWaiting.id}`);
  assert.equal(`forg1::${pWaiting.id}`, `forg1::${pResolved.id}`);
});

