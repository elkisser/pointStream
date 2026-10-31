const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractPlayerNameFromQuestion,
  isKillRangeLabel,
  parseKillRange,
  parsePlayerMatchRows,
  parsePlayerMatchesFromText,
  pickPlayerFromSearch,
  scoreKillPrediction,
  scoreKillsDuel
} = require('../electron/player-kills');
const {
  parsePredictionFromState,
  classifyPrediction,
  keepLivePredictions,
  PredictionStatus
} = require('../electron/forg1-scraper');

test('extrae el nick del jugador desde la pregunta de kills', () => {
  assert.equal(extractPlayerNameFromQuestion('Cuantas kills Fallen?'), 'Fallen');
  assert.equal(extractPlayerNameFromQuestion('¿Cuántas mata apEX?'), 'apEX');
  assert.equal(extractPlayerNameFromQuestion('¿Cuántas kills hace donk?'), 'donk');
  assert.equal(extractPlayerNameFromQuestion('Cuantas kills robo de nemiga?'), 'robo');
  assert.equal(extractPlayerNameFromQuestion('Quién gana el mapa 1?'), null);
});

test('detecta rangos de Forg1 tipo "11 a 13" y "4 o menos"', () => {
  assert.equal(isKillRangeLabel('4 o menos'), true);
  assert.equal(isKillRangeLabel('5 a 7'), true);
  assert.equal(isKillRangeLabel('11 a 13'), true);
  assert.equal(isKillRangeLabel('17 o mas'), true);
  assert.equal(isKillRangeLabel('17 o más'), true);
  assert.equal(isKillRangeLabel('10-14'), true);
  assert.equal(isKillRangeLabel('FURIA'), false);

  assert.deepEqual(parseKillRange('4 o menos'), { min: 0, max: 4, openMax: false });
  assert.deepEqual(parseKillRange('11 a 13'), { min: 11, max: 13, openMax: false });
  assert.equal(parseKillRange('17 o mas').min, 17);
  assert.equal(parseKillRange('17 o mas').openMax, true);
});

test('classifyPrediction marca "Cuantas kills Fallen?" como kills-range', () => {
  const type = classifyPrediction('Cuantas kills Fallen?', [
    { name: '4 o menos' },
    { name: '5 a 7' },
    { name: '8 a 10' },
    { name: '11 a 13' },
    { name: '14 a 16' },
    { name: '17 o mas' }
  ]);
  assert.equal(type, 'kills-range');
});

test('API de Forg1 con predictions[] devuelve las dos apuestas activas', () => {
  const state = {
    prediction: {
      id: 'kills-fallen',
      title: 'Cuantas kills Fallen?',
      status: 'locked',
      outcomes: [
        { id: 'a', label: '4 o menos', total_points: 100, total_bettors: 1 },
        { id: 'b', label: '11 a 13', total_points: 900, total_bettors: 9 }
      ]
    },
    predictions: [
      {
        id: 'kills-fallen',
        title: 'Cuantas kills Fallen?',
        status: 'locked',
        outcomes: [
          { id: 'a', label: '4 o menos', total_points: 129510, total_bettors: 6 },
          { id: 'b', label: '5 a 7', total_points: 559722, total_bettors: 23 },
          { id: 'c', label: '8 a 10', total_points: 1639797, total_bettors: 61 },
          { id: 'd', label: '11 a 13', total_points: 2207453, total_bettors: 87 },
          { id: 'e', label: '14 a 16', total_points: 1252639, total_bettors: 54 },
          { id: 'f', label: '17 o mas', total_points: 743680, total_bettors: 30 }
        ]
      },
      {
        id: 'map1-winner',
        title: 'Quien gana el 1er MAPA?',
        status: 'locked',
        outcomes: [
          { id: 'f1', label: 'FURIA', total_points: 6650480, total_bettors: 109 },
          { id: 'n1', label: 'NEMIGA', total_points: 6447895, total_bettors: 93 },
          { id: 'ot', label: 'OT', total_points: 1230498, total_bettors: 27 }
        ]
      }
    ]
  };

  const preds = parsePredictionFromState(state);
  assert.equal(preds.length, 2);
  assert.equal(preds[0].question, 'Cuantas kills Fallen?');
  assert.equal(preds[0].predType, 'kills-range');
  assert.equal(preds[0].playerName, 'Fallen');
  assert.equal(preds[0].status, 'WAITING_RESULT');
  assert.equal(preds[0].options.length, 6);
  assert.equal(preds[1].question, 'Quien gana el 1er MAPA?');
  assert.equal(preds[1].predType, 'ot');
  assert.equal(preds[1].status, 'WAITING_RESULT');
  assert.equal(preds[1].options[0].name, 'FURIA');
});

test('scoreKillPrediction recomienda el rango del promedio real', () => {
  const options = [
    { name: '4 o menos' },
    { name: '5 a 7' },
    { name: '8 a 10' },
    { name: '11 a 13' },
    { name: '14 a 16' },
    { name: '17 o mas' }
  ];
  const stats = {
    playerName: 'FalleN',
    source: 'hltv',
    maps: [12, 11, 14, 13, 10, 15, 12, 9, 13, 11].map(kills => ({ kills, deaths: 14 }))
  };

  const a = scoreKillPrediction(options, stats);
  assert.equal(a.kind, 'kills');
  assert.equal(a.dataQuality, 'full');
  assert.equal(a.recommendation, '11 a 13');
  assert.ok(a.avgKills >= 11 && a.avgKills <= 13);
  assert.match(a.verdict, /promedio/i);
  assert.match(a.verdict, /11 a 13/);
});

test('sin mapas no inventa kills', () => {
  const a = scoreKillPrediction([{ name: '11 a 13' }], { playerName: 'FalleN', maps: [] });
  assert.equal(a.dataQuality, 'none');
  assert.equal(a.recommendation, '');
  assert.equal(a.avgKills, null);
});

test('parsePlayerMatchRows ignora la fecha y lee el K-D', () => {
  const maps = parsePlayerMatchRows([
    { date: '31/10/26', cells: ['31/10/26', 'vs Nemiga', 'Mirage', '12-14'] },
    { date: '30/10/26', cells: ['30/10/26', 'vs Liquid', 'Nuke', '8-17'] },
    { date: 'bad', cells: ['31-10', 'no-kd-here'] }
  ]);
  assert.equal(maps.length, 2);
  assert.equal(maps[0].kills, 12);
  assert.equal(maps[0].map, 'Mirage');
  assert.equal(maps[1].kills, 8);
  assert.equal(maps[1].map, 'Nuke');
});

test('parsePlayerMatchRows lee el historial real de HLTV (PGL, mapa abreviado, K-D con espacios)', () => {
  const maps = parsePlayerMatchRows([
    { date: '31/10/26', cells: ['31/10/26', 'Nemiga (13)', 'FURIA (2)', 'anc', '15 - 9', '+6', '1.44'] },
    { date: '30/10/26', cells: ['30/10/26', 'Nemiga (13)', 'Vitality (8)', 'cch', '24 - 11', '+13', '1.73'] },
    { date: '30/10/26', cells: ['30/10/26', 'Nemiga (13)', 'Vitality (11)', 'd2', '22 - 16', '+6', '1.34'] }
  ]);
  assert.equal(maps.length, 3);
  assert.equal(maps[0].kills, 15);
  assert.equal(maps[0].map, 'anc');
  assert.equal(maps[1].kills, 24);
  assert.equal(maps[1].map, 'cch');
  assert.equal(maps[2].kills, 22);
});

test('parsePlayerMatchRows no toma el marcador del mapa como kills', () => {
  const maps = parsePlayerMatchRows([
    { date: '31/10/26', cells: ['31/10/26', '13-2', 'anc', '15-9'] }
  ]);
  assert.equal(maps.length, 1);
  assert.equal(maps[0].kills, 15);
});

test('parsePlayerMatchesFromText extrae mapas recientes del texto de HLTV', () => {
  const text = `
    31/10/26 Nemiga (13) FURIA (2) anc 15 - 9 +6 1.44
    30/10/26 Nemiga (13) Vitality (8) cch 24 - 11 +13 1.73
  `;
  const maps = parsePlayerMatchesFromText(text);
  assert.equal(maps.length, 2);
  assert.equal(maps[0].kills, 15);
  assert.equal(maps[1].kills, 24);
});

test('pickPlayerFromSearch elige al robo de Nemiga, no al homónimo retirado', () => {
  const picked = pickPlayerFromSearch([
    { id: '1111', slug: 'robo', name: 'ROBO', team: null },
    { id: '22864', slug: 'robo', name: 'robo', team: 'Nemiga' }
  ], 'robo', ['Nemiga', 'FURIA']);
  assert.equal(picked.id, '22864');
  assert.equal(picked.team, 'Nemiga');
});

test('pickPlayerFromSearch no se queda con el Player of the week si no matchea el nick', () => {
  const picked = pickPlayerFromSearch([
    { id: '99', slug: 'frozen', name: 'frozen', team: 'MOUZ' }
  ], 'robo');
  assert.equal(picked, null);
});

test('classifyPrediction marca "Quién mata más?" como kills-duel', () => {
  assert.equal(classifyPrediction('Quién mata más?', [
    { name: 'donk' },
    { name: 'm0NESY' },
    { name: 'ZywOo' }
  ]), 'kills-duel');
  assert.equal(classifyPrediction('Quien mata mas en el mapa?', [
    { name: 'FalleN' },
    { name: 'yuurih' }
  ]), 'kills-duel');
});

test('keepLivePredictions oculta cerradas y finalizadas', () => {
  const live = keepLivePredictions([
    { id: '1', status: PredictionStatus.OPEN, question: 'Quién gana?' },
    { id: '2', status: PredictionStatus.WAITING_RESULT, question: 'Cerrada' },
    { id: '3', status: PredictionStatus.RESOLVED, question: 'Terminó', result: 'FURIA' },
    { id: '4', status: PredictionStatus.UNKNOWN, question: 'Sin estado' }
  ]);
  assert.deepEqual(live.map(p => p.id), ['1', '4']);
});

test('predicción locked con ganador oficial se trata como finalizada', () => {
  const parsed = parsePredictionFromState({
    prediction: {
      id: 'done-1',
      title: 'Quién mata más?',
      status: 'locked',
      winning_outcome_id: 'p1',
      outcomes: [
        { id: 'p1', label: 'donk', total_points: 100 },
        { id: 'p2', label: 'm0NESY', total_points: 80 }
      ]
    }
  });
  assert.equal(parsed[0].status, PredictionStatus.RESOLVED);
  assert.equal(parsed[0].result, 'donk');
  assert.equal(keepLivePredictions(parsed).length, 0);
});

test('scoreKillsDuel elige al jugador con más kills por mapa', () => {
  const a = scoreKillsDuel(
    [{ name: 'donk' }, { name: 'm0NESY' }],
    [
      { playerName: 'donk', queryName: 'donk', maps: [22, 24, 19, 21, 25].map(kills => ({ kills, map: 'Mirage' })) },
      { playerName: 'm0NESY', queryName: 'm0NESY', maps: [16, 15, 18, 14, 17].map(kills => ({ kills, map: 'Mirage' })) }
    ]
  );
  assert.equal(a.kind, 'kills-duel');
  assert.equal(a.recommendation, 'donk');
  assert.match(a.verdict, /propenso a matar más/i);
  assert.ok(a.players.find(p => p.name === 'donk').avgKills > a.players.find(p => p.name === 'm0NESY').avgKills);
});

test('scoreKillsDuel usa kills del mapa de la predicción si hay sample', () => {
  const a = scoreKillsDuel(
    [{ name: 'donk' }, { name: 'apEX' }],
    [
      {
        playerName: 'donk',
        queryName: 'donk',
        maps: [
          { kills: 10, map: 'Nuke' },
          { kills: 11, map: 'Nuke' },
          { kills: 28, map: 'Mirage' },
          { kills: 30, map: 'Mirage' },
          { kills: 29, map: 'Mirage' }
        ]
      },
      {
        playerName: 'apEX',
        queryName: 'apEX',
        maps: [
          { kills: 20, map: 'Nuke' },
          { kills: 22, map: 'Nuke' },
          { kills: 8, map: 'Mirage' },
          { kills: 9, map: 'Mirage' },
          { kills: 7, map: 'Mirage' }
        ]
      }
    ],
    { mapName: 'Mirage' }
  );
  assert.equal(a.recommendation, 'donk');
  assert.equal(a.mapName, 'Mirage');
  assert.match(a.verdict, /Mirage/i);
  assert.ok(a.players[0].mapFiltered);
});
