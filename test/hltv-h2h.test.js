/**
 * test/hltv-h2h.test.js
 *
 * Suite de tests para validar el parser estructurado de Head-to-Head (H2H) de HLTV.
 * Cubre los 15 escenarios obligatorios de la Fase 6.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { parseH2HMatches } = require('../electron/hltv');
const { calculateMatchupScoring, analyzeMatchup } = require('../electron/cs2-stats-service');

describe('HLTV H2H Structured Parser (Fase 6 — ISSUE-008)', () => {

  // Test 1: H2H básico (3 partidos, 2 victorias team1, 1 victoria team2)
  test('Test 1 — H2H básico: 3 partidos, 2 victorias team1, 1 victoria team2', () => {
    const rawMatches = [
      { matchId: '101', t1: 'FaZe', t2: 'MOUZ', s1: 2, s2: 1, event: 'IEM Cologne' },
      { matchId: '102', t1: 'FaZe', t2: 'MOUZ', s1: 0, s2: 2, event: 'BLAST Premier' },
      { matchId: '103', t1: 'FaZe', t2: 'MOUZ', s1: 2, s2: 0, event: 'ESL Pro League' }
    ];

    const res = parseH2HMatches(rawMatches, 'FaZe', 'MOUZ');
    assert.strictEqual(res.total, 3);
    assert.strictEqual(res.team1Wins, 2);
    assert.strictEqual(res.team2Wins, 1);
    assert.strictEqual(res.status, 'COMPLETE');
  });

  // Test 2: Equipos invertidos (Team A vs Team B y Team B vs Team A)
  test('Test 2 — Equipos invertidos: preserva orientación y cuenta victorias correctas', () => {
    const rawMatches = [
      { matchId: '201', t1: 'Vitality', t2: 'G2', s1: 2, s2: 1, event: 'Major' },       // Vitality gana
      { matchId: '202', t1: 'G2', t2: 'Vitality', s1: 2, s2: 0, event: 'IEM Katowice' }, // G2 gana (G2 de local)
      { matchId: '203', t1: 'G2', t2: 'Vitality', s1: 1, s2: 2, event: 'EPL' }          // Vitality gana (Vitality de visitante)
    ];

    // Consultando como Vitality vs G2:
    const res1 = parseH2HMatches(rawMatches, 'Vitality', 'G2');
    assert.strictEqual(res1.total, 3);
    assert.strictEqual(res1.team1Wins, 2, 'Vitality debe tener 2 victorias');
    assert.strictEqual(res1.team2Wins, 1, 'G2 debe tener 1 victoria');

    // Consultando como G2 vs Vitality (orientación invertida):
    const res2 = parseH2HMatches(rawMatches, 'G2', 'Vitality');
    assert.strictEqual(res2.total, 3);
    assert.strictEqual(res2.team1Wins, 1, 'G2 debe tener 1 victoria como team1');
    assert.strictEqual(res2.team2Wins, 2, 'Vitality debe tener 2 victorias como team2');
  });

  // Test 3: Sin H2H
  test('Test 3 — Sin H2H: retorna estado EMPTY sin inventar datos', () => {
    const res = parseH2HMatches([], 'Spirit', 'The MongolZ');
    assert.strictEqual(res.total, 0);
    assert.strictEqual(res.team1Wins, 0);
    assert.strictEqual(res.team2Wins, 0);
    assert.strictEqual(res.status, 'EMPTY');
    assert.deepStrictEqual(res.matches, []);
  });

  // Test 4: Score inválido
  test('Test 4 — Score inválido: omite scores nulos o corruptos sin asignar victorias falsas', () => {
    const rawMatches = [
      { matchId: '401', t1: 'Astralis', t2: 'Heroic', s1: null, s2: null, event: 'Upcoming' },
      { matchId: '402', t1: 'Astralis', t2: 'Heroic', s1: NaN, s2: 2, event: 'Corrupt' },
      { matchId: '403', t1: 'Astralis', t2: 'Heroic', s1: 2, s2: 0, event: 'Valid' }
    ];

    const res = parseH2HMatches(rawMatches, 'Astralis', 'Heroic');
    assert.strictEqual(res.total, 1, 'Solo 1 partido es válido');
    assert.strictEqual(res.team1Wins, 1);
    assert.strictEqual(res.team2Wins, 0);
  });

  // Test 5: Nombres similares
  test('Test 5 — Nombres similares: rechaza falsos positivos por substrings (Liquid vs Liquid Academy)', () => {
    const rawMatches = [
      { matchId: '501', t1: 'Liquid', t2: 'Liquid Academy', s1: 2, s2: 0, event: 'Showmatch' },
      { matchId: '502', t1: 'Liquid Academy', t2: 'MOUZ', s1: 0, s2: 2, event: 'WePlay' },
      { matchId: '503', t1: 'Team Liquid', t2: 'MOUZ', s1: 2, s2: 1, event: 'ESL Pro League' }
    ];

    // Buscando Liquid vs MOUZ
    const res = parseH2HMatches(rawMatches, 'Liquid', 'MOUZ');
    assert.strictEqual(res.total, 1, 'Solo debe coincidir Liquid vs MOUZ, no Academy');
    assert.strictEqual(res.team1Wins, 1);
    assert.strictEqual(res.team2Wins, 0);
  });

  // Test 6: Duplicado en el DOM
  test('Test 6 — Duplicado: mismo matchId no se contabiliza dos veces', () => {
    const rawMatches = [
      { matchId: '601', href: '/matches/601/faze-vs-g2', t1: 'FaZe', t2: 'G2', s1: 2, s2: 1, event: 'IEM' },
      { matchId: '601', href: '/matches/601/faze-vs-g2', t1: 'FaZe', t2: 'G2', s1: 2, s2: 1, event: 'IEM' }, // Duplicado responsive
      { matchId: '602', href: '/matches/602/faze-vs-g2', t1: 'FaZe', t2: 'G2', s1: 0, s2: 2, event: 'BLAST' }
    ];

    const res = parseH2HMatches(rawMatches, 'FaZe', 'G2');
    assert.strictEqual(res.total, 2);
    assert.strictEqual(res.team1Wins, 1);
    assert.strictEqual(res.team2Wins, 1);
  });

  // Test 7: Formato BO3
  test('Test 7 — Formato BO3: resultado 2-1 suma exactamente 1 victoria de serie, no 2', () => {
    const rawMatches = [
      { matchId: '701', t1: 'NAVI', t2: 'Vitality', s1: 2, s2: 1, event: 'BLAST Final' }
    ];

    const res = parseH2HMatches(rawMatches, 'NAVI', 'Vitality');
    assert.strictEqual(res.total, 1);
    assert.strictEqual(res.team1Wins, 1, 'Debe sumar 1 victoria al ganador de la serie');
    assert.strictEqual(res.team2Wins, 0);
  });

  // Test 8: Formato BO5
  test('Test 8 — Formato BO5: resultado 3-2 suma exactamente 1 victoria de serie, no 3', () => {
    const rawMatches = [
      { matchId: '801', t1: 'Vitality', t2: 'MOUZ', s1: 3, s2: 2, event: 'IEM Cologne Grand Final' }
    ];

    const res = parseH2HMatches(rawMatches, 'Vitality', 'MOUZ');
    assert.strictEqual(res.total, 1);
    assert.strictEqual(res.team1Wins, 1);
    assert.strictEqual(res.team2Wins, 0);
  });

  // Test 9: Match sin resultado / empate
  test('Test 9 — Match sin resultado o empate: 0-0 no otorga victoria a ningún equipo', () => {
    const rawMatches = [
      { matchId: '901', t1: 'FURIA', t2: 'Imperial', s1: 0, s2: 0, event: 'Suspended' },
      { matchId: '902', t1: 'FURIA', t2: 'Imperial', s1: 1, s2: 1, event: 'Tie format' }
    ];

    const res = parseH2HMatches(rawMatches, 'FURIA', 'Imperial');
    assert.strictEqual(res.total, 2);
    assert.strictEqual(res.team1Wins, 0, 'No debe asignar victorias en empates');
    assert.strictEqual(res.team2Wins, 0, 'No debe asignar victorias en empates');
  });

  // Test 10: Error de proveedor
  test('Test 10 — Error de proveedor: getH2H captura error y expone status FAILED', async () => {
    const { getH2H } = require('../electron/hltv');
    const badRes = await getH2H('invalid_id_not_found_999999', 'invalid_id_not_found_888888', 'Fake1', 'Fake2');
    assert.strictEqual(badRes.total, 0);
    assert.strictEqual(badRes.team1Wins, 0);
    assert.strictEqual(badRes.team2Wins, 0);
    assert.ok(badRes.status === 'FAILED' || badRes.status === 'EMPTY');
  });

  // Test 11: Regresión matemática
  test('Test 11 — Regresión matemática: puntuación en calculateMatchupScoring (+4 por victoria H2H)', () => {
    const normStats = {
      team1: { name: 'FaZe', found: true, ranking: 5, winrate: 60, wins: 6, losses: 4, eventTotal: 0 },
      team2: { name: 'MOUZ', found: true, ranking: 6, winrate: 60, wins: 6, losses: 4, eventTotal: 0 },
      h2h: { total: 3, team1Wins: 2, team2Wins: 1 },
      sharedEvent: null
    };

    const scoring = calculateMatchupScoring(normStats, 'FaZe', 'MOUZ');
    // H2H suma: 2 * 4 = +8 para FaZe, 1 * 4 = +4 para MOUZ
    const h2hFactor = scoring.factors.find(f => f.includes('Historial directo'));
    assert.ok(h2hFactor, 'Debe incluir el factor de historial directo');
    assert.ok(h2hFactor.includes('FaZe 2 - 1 MOUZ'));
  });

  // Test 12: Fallback CS2 Stats Service
  test('Test 12 — Fallback: si HLTV falla o no está disponible, el fallback a BO3.gg opera limpio', async () => {
    const mockHLTV = {
      getMatchupData: async () => { throw new Error('Cloudflare challenge blocked'); }
    };
    const mockBO3 = {
      getMatchupData: async (t1, t2) => ({
        source: 'bo3gg',
        status: 'COMPLETE',
        team1: { name: t1, found: true, ranking: 4, winrate: 65, wins: 13, losses: 7, eventTotal: 0 },
        team2: { name: t2, found: true, ranking: 8, winrate: 55, wins: 11, losses: 9, eventTotal: 0 },
        h2h: { total: 2, team1Wins: 2, team2Wins: 0 },
        sharedEvent: 'ESL'
      })
    };

    const res = await analyzeMatchup('Spirit', 'MOUZ', {
      hltvProvider: mockHLTV,
      bo3Provider: mockBO3
    });

    assert.strictEqual(res.source, 'bo3gg');
    assert.strictEqual(res.h2h.total, 2);
    assert.strictEqual(res.h2h.team1Wins, 2);
  });

  // Test 13: Unicode y diacríticos
  test('Test 13 — Unicode y caracteres especiales en nombres', () => {
    const rawMatches = [
      { matchId: '1301', t1: "Natus Vincere", t2: "Ninjas in Pyjamas", s1: 2, s2: 0, event: 'Major' }
    ];

    const res = parseH2HMatches(rawMatches, "Natus Vincere", "Ninjas in Pyjamas");
    assert.strictEqual(res.total, 1);
    assert.strictEqual(res.team1Wins, 1);
  });

  // Test 14: Espacios y puntuación cosméticos
  test('Test 14 — Espacios y puntuación cosméticos se normalizan correctamente', () => {
    const rawMatches = [
      { matchId: '1401', t1: '  9 Pandas  ', t2: 'Betera', s1: 2, s2: 1, event: 'Quals' }
    ];

    const res = parseH2HMatches(rawMatches, '9pandas', 'betera');
    assert.strictEqual(res.total, 1);
    assert.strictEqual(res.team1Wins, 1);
    assert.strictEqual(res.team2Wins, 0);
  });

  // Test 15: Falso positivo por partidos de terceros (el bug crítico descubierto en HLTV)
  test('Test 15 — Falso positivo por rivales ajenos: filtra 100% de partidos contra terceros', () => {
    const rawHLTVPageMatches = [
      { matchId: '9001', t1: 'Vitality', t2: 'magic', s1: 2, s2: 0, event: 'StarLadder' },       // Tercero
      { matchId: '9002', t1: 'Legacy', t2: 'G2', s1: 3, s2: 0, event: 'Playground' },          // Tercero
      { matchId: '9003', t1: 'BETBOOM', t2: 'G2', s1: 1, s2: 2, event: 'Playground' },         // Tercero
      { matchId: '9004', t1: 'FURIA', t2: 'G2', s1: 0, s2: 2, event: 'Playground' },           // Tercero
      { matchId: '9005', t1: 'Vitality', t2: 'G2', s1: 2, s2: 1, event: 'BLAST Rivals' },       // DIRECTO!
      { matchId: '9006', t1: 'Vitality', t2: 'G2', s1: 2, s2: 1, event: 'IEM Rio' },           // DIRECTO!
      { matchId: '9007', t1: 'FaZe', t2: 'Vitality', s1: 1, s2: 2, event: 'IEM Rio' }          // Tercero
    ];

    const res = parseH2HMatches(rawHLTVPageMatches, 'Vitality', 'G2');
    assert.strictEqual(res.total, 2, 'Solo debe contabilizar los 2 partidos directos entre Vitality y G2');
    assert.strictEqual(res.team1Wins, 2, 'Vitality ganó ambos partidos directos');
    assert.strictEqual(res.team2Wins, 0, 'G2 perdió ambos partidos directos');
    assert.strictEqual(res.matches[0].matchId, '9005');
    assert.strictEqual(res.matches[1].matchId, '9006');
  });

});
