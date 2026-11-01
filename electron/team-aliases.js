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
  '100t': '100 Thieves',
  '100thieves': '100 Thieves',
  navi: 'Natus Vincere',
  nv: 'Natus Vincere',
  nip: 'Ninjas in Pyjamas',
  vp: 'Virtus.pro',
  c9: 'Cloud9',
  col: 'Complexity',
  eg: 'Evil Geniuses',
  ef: 'Eternal Fire',
  gl: 'GamerLegion',
  tl: 'Liquid',
  bb: 'BetBoom',
  mgz: 'The MongolZ',
  mongolz: 'The MongolZ',
  fly: 'FlyQuest',
  fq: 'FlyQuest',
  imp: 'Imperial',
  lvg: 'Lynn Vision',
  pv: 'PARIVISION',
  fal: 'Falcons',
  vit: 'Vitality',
  ast: 'Astralis',
  mibr: 'MIBR',
  '3dm': '3DMAX',
  fnc: 'fnatic',
  hero: 'HEROIC',
  lgc: 'Legacy',
  sprt: 'Spirit',
  ts: 'Spirit'
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

/** "100T" -> "100 Thieves". Si no es una sigla conocida devuelve el nombre tal cual. */
function canonicalTeamName(name, extra) {
  const raw = String(name || '').trim();
  const k = key(raw);
  if (!k) return raw;
  const all = { ...BUILT_IN, ...(extra || loadUserAliases()) };
  return all[k] || raw;
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
