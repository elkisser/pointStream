// electron/team-aliases.js
// Siglas y apodos de equipos que usan Forg1 y los streamers ("100T", "NAVI", "C9")
// -> nombre completo con el que figuran en HLTV, BO3.gg y el ranking de Valve.
//
// Se aplica una sola vez, antes de consultar las fuentes (cs2-stats-service), así
// las tres fuentes reciben el nombre completo. En la card se sigue mostrando el
// nombre tal como lo escribió Forg1.
//
// Ampliable sin tocar código: %APPDATA%\pointstream\team-aliases.json
//   { "100t": "100 Thieves" }
// Si una sigla está en los dos lados, gana el archivo del usuario.

const fs = require('fs');
const path = require('path');

const BUILT_IN = {
  // Siglas comunes y apodos globales
  '100t': '100 Thieves',
  '100thieves': '100 Thieves',
  navi: 'Natus Vincere',
  'na vi': 'Natus Vincere',
  natusvincere: 'Natus Vincere',
  nv: 'Natus Vincere',
  nip: 'Ninjas in Pyjamas',
  ninjasinpyjamas: 'Ninjas in Pyjamas',
  vp: 'Virtus.pro',
  virtuspro: 'Virtus.pro',
  c9: 'Cloud9',
  cloud9: 'Cloud9',
  col: 'Complexity',
  complexity: 'Complexity',
  eg: 'Evil Geniuses',
  ef: 'Eternal Fire',
  eternalfire: 'Eternal Fire',
  gl: 'GamerLegion',
  gamerlegion: 'GamerLegion',
  tl: 'Liquid',
  liquid: 'Liquid',
  teamliquid: 'Liquid',
  bb: 'BetBoom',
  bbteam: 'BetBoom',
  betboom: 'BetBoom',
  betboomteam: 'BetBoom',
  '9z': '9z',
  '9zteam': '9z',
  '9zglobant': '9z',
  '9zglobantxduki': '9z',
  '9zxduki': '9z',
  '9zduki': '9z',
  mgz: 'The MongolZ',
  mongolz: 'The MongolZ',
  themongolz: 'The MongolZ',
  fly: 'FlyQuest',
  fq: 'FlyQuest',
  flyquest: 'FlyQuest',
  wc: 'Wildcard',
  wildcard: 'Wildcard',
  imp: 'Imperial',
  imperial: 'Imperial',
  lvg: 'Lynn Vision',
  lynnvision: 'Lynn Vision',
  pv: 'PARIVISION',
  parivision: 'PARIVISION',
  fal: 'Falcons',
  falcons: 'Falcons',
  teamfalcons: 'Falcons',
  vit: 'Vitality',
  vitality: 'Vitality',
  teamvitality: 'Vitality',
  ast: 'Astralis',
  astralis: 'Astralis',
  mibr: 'MIBR',
  '3dm': '3DMAX',
  '3dmax': '3DMAX',
  fnc: 'fnatic',
  fnatic: 'fnatic',
  hero: 'HEROIC',
  heroic: 'HEROIC',
  lgc: 'Legacy',
  legacy: 'Legacy',
  legacybr: 'Legacy',
  sprt: 'Spirit',
  spirit: 'Spirit',
  teamspirit: 'Spirit',
  ts: 'Spirit',
  mouz: 'MOUZ',
  mousesports: 'MOUZ',
  faze: 'FaZe',
  fazeclan: 'FaZe',
  g2: 'G2',
  g2esports: 'G2',
  ence: 'ENCE',
  saw: 'SAW',
  big: 'BIG',
  pain: 'paiN',
  paingaming: 'paiN',
  bestia: 'Bestia',
  besitas: 'Bestia',
  bestias: 'Bestia',
  furia: 'FURIA',
  furiagg: 'FURIA',
  furiaesports: 'FURIA',
  fluxo: 'Fluxo',
  fluxowap: 'Fluxo',
  redcanids: 'RED Canids',
  redcanidskalunga: 'RED Canids',
  kru: 'KRÜ Esports',
  krü: 'KRÜ Esports',
  kruesports: 'KRÜ Esports',
  sharks: 'Sharks',
  sharksesports: 'Sharks',
  case: 'Case',
  caseesports: 'Case',
  oddik: 'ODDIK',
  oddiik: 'ODDIK',
  w7m: 'w7m',
  w7mesports: 'w7m',
  bountyhunters: 'Bounty Hunters',
  solid: 'Team Solid',
  teamsolid: 'Team Solid',
  dustyroots: 'Dusty Roots',
  corinthians: 'Corinthians',
  flamengo: 'Flamengo Esports',
  sangal: 'Sangal',
  nemiga: 'Nemiga',
  betera: 'Betera',
  b8: 'B8',
  passionua: 'Passion UA',
  aurora: 'Aurora',
  auroragaming: 'Aurora',
  amkal: 'AMKAL',
  cybershoke: 'CYBERSHOKE',
  '9p': '9 Pandas',
  '9pandas': '9 Pandas',
  tyloo: 'TYLOO',
  m80: 'M80',
  nrg: 'NRG',
  metizport: 'Metizport',
  sashi: 'Sashi',
  sinners: 'Sinners',
  dynamoeclot: 'Dynamo ECLOT',
  eclot: 'Dynamo ECLOT',
  itb: 'Into the Breach',
  intothebreach: 'Into the Breach',
  rhyno: 'Rhyno',
  kpi: 'KPI'
};

const FILE_NAME = 'team-aliases.json';
let cache = null;
let cacheMtime = 0;

function key(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

function userFile() {
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') return path.join(app.getPath('userData'), FILE_NAME);
  } catch (e) { /* fuera de Electron (tests) */ }
  return null;
}

function loadUserAliases() {
  const f = userFile();
  if (!f) return {};
  try {
    if (!fs.existsSync(f)) {
      fs.writeFileSync(f, JSON.stringify({
        _ayuda: 'Sigla o apodo del equipo -> nombre completo (como figura en HLTV). Guardá y listo, no hace falta reiniciar.',
        '100t': '100 Thieves'
      }, null, 2), 'utf8');
    }
    const mtime = fs.statSync(f).mtimeMs;
    if (cache && mtime === cacheMtime) return cache;
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    const out = {};
    for (const [k, v] of Object.entries(raw || {})) {
      const kk = key(k);
      if (!kk || kk === 'ayuda' || kk === 'proto' || typeof v !== 'string' || !v.trim()) continue;
      out[kk] = v.trim().slice(0, 50);
    }
    cache = out;
    cacheMtime = mtime;
    return out;
  } catch (e) {
    console.warn('[Alias] No pude leer ' + FILE_NAME + ':', e.message);
    return cache || {};
  }
}

/**
 * Normaliza nombres complejos, con colaboraciones, patrocinadores o formatos compuestos.
 * Ejemplos resueltos:
 * - "BB/BB Team" -> "BetBoom"
 * - "BB Team" -> "BetBoom"
 * - "9z Globant x Duki" -> "9z"
 * - "9z Globant" -> "9z"
 */
function canonicalTeamName(name, extra) {
  const raw = String(name || '').trim();
  if (!raw) return raw;

  // Equipos filiales / sub-teams no deben ser reducidos al equipo principal
  if (/\b(academy|junior|youth|female|fe)\b/i.test(raw)) {
    return raw;
  }

  const all = { ...BUILT_IN, ...(extra || loadUserAliases()) };

  // 1. Coincidencia directa por clave exacta
  const k = key(raw);
  if (k && all[k]) return all[k];

  // 2. Formato compuesto por barras o pipes: "BB / BB Team", "Virtus.pro / VP"
  if (/[\/|]/.test(raw)) {
    const parts = raw.split(/[\/|]/).map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
      const pk = key(part);
      if (pk && all[pk]) return all[pk];
    }
  }

  // 3. Quitar colaboraciones tipo "x Duki", "x Messi", etc.
  const noCollab = raw.replace(/\s+x\s+.*$/i, '').trim();
  if (noCollab !== raw) {
    const nck = key(noCollab);
    if (nck && all[nck]) return all[nck];
  }

  // 4. Quitar patrocinadores conocidos y sufijos de organización
  const noSponsors = noCollab
    .replace(/^(team|el\s+team|clan|club)\s+/i, '')
    .replace(/\s+(globant|kalunga|wap|betclic|betera|1xbet|bc\.?game|stake|dafabet|roobet|mostbet|redragon|monster|lenovo|hyperx)$/i, '')
    .replace(/\s+(team|esports?|gaming|clan|club|gg|squad)$/i, '')
    .trim();

  if (noSponsors && noSponsors !== raw) {
    const nsk = key(noSponsors);
    if (nsk && all[nsk]) return all[nsk];
  }

  // 5. Si la primera palabra o token es un equipo/alias conocido (ej: "9z Globant", "BB Team")
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const firstWord = tokens[0];
    const fwk = key(firstWord);
    if (fwk && fwk.length >= 2 && all[fwk]) {
      return all[fwk];
    }
  }

  // 6. Fuzzy matching para nombres cortos con errores tipográficos
  if (k && k.length >= 4 && k.length <= 15) {
    const hit = resolveTeamFuzzy(k);
    if (hit) return hit;
  }

  return raw;
}

/** Distancia de edición mínima entre dos strings (Levenshtein). */
function editDistance(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/**
 * Dada una clave normalizada ("besitas"), busca el nombre de equipo conocido
 * más cercano con distancia de edición ≤ 2. Devuelve el nombre canónico o null.
 * Solo se usa cuando el matching exacto falló, para tipos comunes del stream.
 */
function resolveTeamFuzzy(nk) {
  const all = { ...BUILT_IN };
  let best = null, bestDist = 3;
  for (const [aliasKey, canonical] of Object.entries(all)) {
    const d = editDistance(nk, key(canonical));
    if (d < bestDist) { best = canonical; bestDist = d; }
    const dAlias = editDistance(nk, aliasKey);
    if (dAlias < bestDist) { best = canonical; bestDist = dAlias; }
  }
  return best; // null si nada está a distancia ≤ 2
}

module.exports = { canonicalTeamName, resolveTeamFuzzy, BUILT_IN, key };
