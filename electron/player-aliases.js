// electron/player-aliases.js
// Sobrenombres que usan los streamers en las predicciones de kills ("HUEVO",
// "Biskela") -> nick real en HLTV + equipo (el equipo ayuda a elegir entre homónimos).
//
// Hay dos listas:
// 1. BUILT_IN: la que viene con la app.
// 2. %APPDATA%\pointstream\player-aliases.json: la editás vos, sin tocar código.
//    Se crea sola la primera vez con un ejemplo. Formato:
//      { "huevo": { "player": "buda", "team": "bestia" } }
//    Si un sobrenombre está en las dos, gana el archivo del usuario.

const fs = require('fs');
const path = require('path');

const BUILT_IN = {
  huevo: { player: 'buda', team: 'bestia' },
  biskela: { player: 'aleksib', team: 'natus vincere' }
};

const FILE_NAME = 'player-aliases.json';
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

function sanitize(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [nick, v] of Object.entries(raw)) {
    const k = key(nick);
    if (!k || k.length > 40 || k === '__proto__') continue;
    if (typeof v === 'string' && v.trim()) out[k] = { player: v.trim().slice(0, 40), team: null };
    else if (v && typeof v === 'object' && typeof v.player === 'string' && v.player.trim()) {
      out[k] = {
        player: v.player.trim().slice(0, 40),
        team: typeof v.team === 'string' && v.team.trim() ? v.team.trim().slice(0, 40) : null
      };
    }
  }
  return out;
}

function loadUserAliases() {
  const f = userFile();
  if (!f) return {};
  try {
    if (!fs.existsSync(f)) {
      const example = {
        _ayuda: 'Sobrenombre -> nick real en HLTV y equipo. Agregá los que quieras y guardá; no hace falta reiniciar.',
        huevo: { player: 'buda', team: 'bestia' }
      };
      fs.writeFileSync(f, JSON.stringify(example, null, 2), 'utf8');
    }
    const mtime = fs.statSync(f).mtimeMs;
    if (cache && mtime === cacheMtime) return cache;
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    delete data._ayuda;
    cache = sanitize(data);
    cacheMtime = mtime;
    return cache;
  } catch (e) {
    console.warn('[Alias] No pude leer ' + FILE_NAME + ':', e.message);
    return cache || {};
  }
}

/**
 * "HUEVO" -> { player: "buda", team: "bestia", alias: "HUEVO" }
 * Si no es un sobrenombre conocido devuelve null.
 */
function resolveAlias(name, extra) {
  const k = key(name);
  if (!k) return null;
  const all = { ...BUILT_IN, ...(extra || loadUserAliases()) };
  const hit = all[k];
  return hit ? { player: hit.player, team: hit.team || null, alias: String(name).trim() } : null;
}

module.exports = { resolveAlias, BUILT_IN, sanitize, key };
