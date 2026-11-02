// test/cs2-stats-fallback.test.js
// Tests de integración y unitarios para el sistema de estadísticas CS2
// HLTV (Primary) -> BO3.gg (Fallback) -> UNAVAILABLE
// Verifica contratos, suficiencia, cero fake data y preservación matemática.

const test = require('node:test');
const assert = require('node:assert');

const { StatsStatus, createEmptyTeamStats, createNormalizedStats } = require('../electron/cs2-provider');
const { isStatsSufficient, calculateMatchupScoring, analyzeMatchup } = require('../electron/cs2-stats-service');
const bo3 = require('../electron/bo3');

test('CS2 Provider Contracts: createEmptyTeamStats cumple ZERO FAKE DATA', () => {
  const empty = createEmptyTeamStats('FaZe');
  assert.strictEqual(empty.name, 'FaZe');
  assert.strictEqual(empty.found, false);
  assert.strictEqual(empty.ranking, null, 'El ranking ausente debe ser null, nunca 0');
  assert.strictEqual(empty.winrate, null, 'El winrate ausente debe ser null, nunca 0');
  assert.strictEqual(empty.wins, 0);
  assert.strictEqual(empty.losses, 0);
});

test('CS2 Sufficiency: isStatsSufficient clasifica correctamente los estados', () => {
  // Caso COMPLETE: ambos equipos con ranking o partidos
  const completeStats = createNormalizedStats({
    source: 'hltv',
    status: StatsStatus.COMPLETE,
    team1: { name: 'FaZe', found: true, ranking: 13, winrate: 60, wins: 6, losses: 4 },
    team2: { name: 'MOUZ', found: true, ranking: 3, winrate: 70, wins: 7, losses: 3 }
  });
  assert.strictEqual(isStatsSufficient(completeStats), true);

  // Caso PARTIAL pero con datos sustanciales en al menos uno
  const partialStats = createNormalizedStats({
    source: 'hltv',
    status: StatsStatus.PARTIAL,
    team1: { name: 'FaZe', found: true, ranking: 13, winrate: 60, wins: 6, losses: 4 },
    team2: { name: 'AmateurTeam', found: true, ranking: null, winrate: null, wins: 0, losses: 0 }
  });
  assert.strictEqual(isStatsSufficient(partialStats), true);

  // Caso INSUFFICIENT / UNAVAILABLE: ninguno encontrado o ambos sin datos
  const emptyStats = createNormalizedStats({
    source: 'hltv',
    status: StatsStatus.UNAVAILABLE,
    team1: { name: 'Unknown1', found: false, ranking: null, winrate: null, wins: 0, losses: 0 },
    team2: { name: 'Unknown2', found: false, ranking: null, winrate: null, wins: 0, losses: 0 }
  });
  assert.strictEqual(isStatsSufficient(emptyStats), false);
});

test('Caso A: HLTV Complete -> usa HLTV y BO3.gg NO es consultado', async () => {
  let bo3Called = false;
  const mockHLTV = {
    getMatchupData: async (t1, t2) => createNormalizedStats({
      source: 'hltv',
      status: StatsStatus.COMPLETE,
      team1: { name: t1, found: true, ranking: 5, winrate: 65, wins: 6, losses: 3 },
      team2: { name: t2, found: true, ranking: 10, winrate: 50, wins: 5, losses: 5 }
    })
  };
  const mockBO3 = {
    getMatchupData: async () => {
      bo3Called = true;
      return null;
    }
  };

  const result = await analyzeMatchup('Vitality', 'G2', { hltvProvider: mockHLTV, bo3Provider: mockBO3 });
  assert.strictEqual(bo3Called, false, 'BO3.gg no debe ser llamado si HLTV es completo');
  assert.strictEqual(result.source, 'hltv');
  assert.strictEqual(result.dataQuality, 'full');
  assert.strictEqual(result.recommendation, 'Vitality');
});

test('Caso B: HLTV Fails -> Fallback automático a BO3.gg', async () => {
  const mockHLTV = {
    getMatchupData: async () => {
      throw new Error('Cloudflare challenge blocked');
    }
  };
  const mockBO3 = {
    getMatchupData: async (t1, t2) => createNormalizedStats({
      source: 'bo3gg',
      status: StatsStatus.COMPLETE,
      team1: { name: t1, found: true, ranking: 1, winrate: 80, wins: 8, losses: 2 },
      team2: { name: t2, found: true, ranking: 15, winrate: 40, wins: 4, losses: 6 }
    })
  };

  const result = await analyzeMatchup('Spirit', 'The MongolZ', { hltvProvider: mockHLTV, bo3Provider: mockBO3 });
  assert.strictEqual(result.source, 'bo3gg');
  assert.strictEqual(result.dataQuality, 'full');
  assert.strictEqual(result.recommendation, 'Spirit');
  assert.ok(result.verdict.includes('APOSTAR A SPIRIT'));
});

test('Caso C: HLTV Partial insuficiente -> Fallback a BO3.gg', async () => {
  const mockHLTV = {
    getMatchupData: async (t1, t2) => createNormalizedStats({
      source: 'hltv',
      status: StatsStatus.UNAVAILABLE,
      team1: { name: t1, found: false, ranking: null, winrate: null, wins: 0, losses: 0 },
      team2: { name: t2, found: false, ranking: null, winrate: null, wins: 0, losses: 0 }
    })
  };
  const mockBO3 = {
    getMatchupData: async (t1, t2) => createNormalizedStats({
      source: 'bo3gg',
      status: StatsStatus.COMPLETE,
      team1: { name: t1, found: true, ranking: 3, winrate: 70, wins: 7, losses: 3 },
      team2: { name: t2, found: true, ranking: 13, winrate: 55, wins: 5, losses: 4 }
    })
  };

  const result = await analyzeMatchup('MOUZ', 'FaZe', { hltvProvider: mockHLTV, bo3Provider: mockBO3 });
  assert.strictEqual(result.source, 'bo3gg');
  assert.strictEqual(result.dataQuality, 'full');
  assert.strictEqual(result.recommendation, 'MOUZ');
});

test('Caso E: Ambos fallan -> resultado UNAVAILABLE sin inventar datos', async () => {
  const mockHLTV = {
    getMatchupData: async () => createNormalizedStats({
      source: 'hltv',
      status: StatsStatus.UNAVAILABLE
    })
  };
  const mockBO3 = {
    getMatchupData: async () => createNormalizedStats({
      source: 'bo3gg',
      status: StatsStatus.UNAVAILABLE
    })
  };

  const result = await analyzeMatchup('EquipoFantasma1', 'EquipoFantasma2', { hltvProvider: mockHLTV, bo3Provider: mockBO3 });
  assert.strictEqual(result.dataQuality, 'none');
  assert.strictEqual(result.team1.data, null);
  assert.strictEqual(result.team2.data, null);
  assert.strictEqual(result.recommendation, 'Sin datos');
});

test('Preservación matemática: Cálculo idéntico de scoring entre providers', () => {
  const datasetHLTV = createNormalizedStats({
    source: 'hltv',
    status: StatsStatus.COMPLETE,
    team1: { name: 'TeamA', found: true, ranking: 2, winrate: 70, wins: 7, losses: 3 },
    team2: { name: 'TeamB', found: true, ranking: 12, winrate: 45, wins: 4, losses: 5 },
    h2h: { total: 2, team1Wins: 2, team2Wins: 0 }
  });

  const datasetBO3 = createNormalizedStats({
    source: 'bo3gg',
    status: StatsStatus.COMPLETE,
    team1: { name: 'TeamA', found: true, ranking: 2, winrate: 70, wins: 7, losses: 3 },
    team2: { name: 'TeamB', found: true, ranking: 12, winrate: 45, wins: 4, losses: 5 },
    h2h: { total: 2, team1Wins: 2, team2Wins: 0 }
  });

  const resHLTV = calculateMatchupScoring(datasetHLTV);
  const resBO3 = calculateMatchupScoring(datasetBO3);

  assert.strictEqual(resHLTV.team1.probability, resBO3.team1.probability, 'Probabilidad team1 debe ser exactamente idéntica');
  assert.strictEqual(resHLTV.team2.probability, resBO3.team2.probability, 'Probabilidad team2 debe ser exactamente idéntica');
  assert.strictEqual(resHLTV.confidence, resBO3.confidence);
  assert.strictEqual(resHLTV.verdictLevel, resBO3.verdictLevel);
});

test('BO3 Slug Normalization: reconoce aliases conocidos y limpia slugs', () => {
  assert.strictEqual(bo3.normalizeSlug('MOUZ'), 'mousesports');
  assert.strictEqual(bo3.normalizeSlug('FaZe Clan'), 'faze');
  assert.strictEqual(bo3.normalizeSlug('NaVi'), 'natus-vincere');
  assert.strictEqual(bo3.normalizeSlug('Virtus.pro'), 'virtus-pro');
  assert.strictEqual(bo3.normalizeSlug('Unknown Team Name 2026'), 'unknown-team-name-2026');
});

test('Contexto en Vivo: Si Team 2 lidera 1-0 tras ganar el pick rival, en Mapa 2 pasa a favorito', () => {
  const norm = createNormalizedStats({
    source: 'hltv',
    status: StatsStatus.COMPLETE,
    team1: { name: 'The MongolZ', found: true, ranking: 12, winrate: 60, wins: 6, losses: 4 },
    team2: { name: 'Legacy', found: true, ranking: 28, winrate: 50, wins: 5, losses: 5 },
    h2h: { total: 0, team1Wins: 0, team2Wins: 0 }
  });

  // Sin contexto de serie (0-0, antes de empezar el partido)
  const initial = calculateMatchupScoring(norm);
  assert.strictEqual(initial.recommendation, 'The MongolZ', 'Sin serie iniciada, el favorito estático es MongolZ');

  // En vivo: Legacy ganó Mapa 1 (pick de MongolZ). Ahora juegan Mapa 2 (pick de Legacy).
  const inLiveMatch = calculateMatchupScoring(norm, {
    mapNumber: 2,
    seriesScore: { team1: 0, team2: 1 },
    mapPick: 'Legacy',
    format: 'BO3'
  });

  assert.strictEqual(inLiveMatch.recommendation, 'Legacy', 'Con la serie 0-1 abajo y en Mapa 2, Legacy debe ser el recomendado');
  assert.ok(inLiveMatch.team2.probability > inLiveMatch.team1.probability, 'Probabilidad de Legacy debe ser mayor');
  assert.ok(inLiveMatch.factors.some(f => f.includes('lidera 1-0 tras ganar en el pick')));
  assert.ok(inLiveMatch.factors.some(f => f.includes('Ventaja de pick: mapa elegido por Legacy')));
});

test('Roster & Jugador Clave: Reconoce ventaja de rating individual y refuerzo destacado', () => {
  const norm = createNormalizedStats({
    source: 'bo3gg',
    status: StatsStatus.COMPLETE,
    team1: { name: 'TeamA', found: true, ranking: 20, winrate: 50, wins: 5, losses: 5 },
    team2: { name: 'TeamB', found: true, ranking: 22, winrate: 50, wins: 5, losses: 5 }
  });

  norm.team1.roster = {
    avgRating: 5.95,
    starPlayer: { nickname: 'playerA', rating: 6.10 }
  };
  norm.team2.roster = {
    avgRating: 6.35,
    starPlayer: { nickname: 'starB', rating: 6.70 },
    newPlayer: { nickname: 'newB', rating: 6.70, date: '2026-02-15' }
  };

  const scored = calculateMatchupScoring(norm);
  assert.strictEqual(scored.recommendation, 'TeamB');
  assert.ok(scored.factors.some(f => f.includes('Roster: TeamA (avg 5.95) vs TeamB (avg 6.35)')));
  assert.ok(scored.factors.some(f => f.includes('Jugador clave: newB')));
});

test('Alias y Nombres Complejos: BB/BB Team y 9z Globant x Duki se normalizan y analizan con HLTV inactivo', async () => {
  const { canonicalTeamName } = require('../electron/team-aliases');

  assert.strictEqual(canonicalTeamName('BB/BB Team'), 'BetBoom');
  assert.strictEqual(canonicalTeamName('BB Team'), 'BetBoom');
  assert.strictEqual(canonicalTeamName('9z Globant x Duki'), '9z');
  assert.strictEqual(canonicalTeamName('9z Globant'), '9z');

  // Simular HLTV completamente inactivo / caído
  const mockHLTV = {
    getMatchupData: async () => {
      throw new Error('HLTV Cloudflare blocked / BrowserWindow unavailable');
    }
  };

  const mockBO3 = {
    getMatchupData: async (t1, t2) => {
      assert.strictEqual(t1, 'BetBoom', 'Debe consultar BO3 con BetBoom');
      assert.strictEqual(t2, '9z', 'Debe consultar BO3 con 9z');
      return createNormalizedStats({
        source: 'bo3gg',
        status: StatsStatus.COMPLETE,
        team1: { name: t1, found: true, ranking: 11, winrate: 70, wins: 7, losses: 3 },
        team2: { name: t2, found: true, ranking: 17, winrate: 60, wins: 6, losses: 4 }
      });
    }
  };

  const result = await analyzeMatchup('BB Team', '9z Globant x Duki', {
    hltvProvider: mockHLTV,
    bo3Provider: mockBO3
  });

  assert.strictEqual(result.source, 'bo3gg');
  assert.strictEqual(result.dataQuality, 'full');
  // Debe preservar los nombres de la card para coincidir con la UI de Forg1
  assert.strictEqual(result.team1.name, 'BB Team');
  assert.strictEqual(result.team2.name, '9z Globant x Duki');
  assert.strictEqual(result.recommendation, 'BB Team');
  assert.ok(result.confidence >= 50);
});

