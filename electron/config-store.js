/**
 * electron/config-store.js
 *
 * Módulo centralizado y seguro de persistencia de configuración local de PointStream.
 * Almacena preferencias y lista de streamers en app.getPath('userData')/config.json.
 * 
 * Garantiza:
 * - Escritura atómica (evita corrupción ante cierres inesperados).
 * - Respaldo (.bak) y recuperación segura ante archivos JSON corruptos.
 * - Validación estricta y sanitización de tipos (Zero Prototype Pollution).
 * - Versionado de esquema (v1) con soporte para migraciones.
 * - Cero almacenamiento de credenciales, tokens, cookies o runtime state volátil.
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const CONFIG_SCHEMA_VERSION = 1;
const CONFIG_FILE = 'config.json';
const MAX_STREAMERS = 100;
const VALID_PLATFORMS = ['kick', 'twitch'];
const STREAMER_NAME_REGEX = /^[a-z0-9_\-.]{1,50}$/i;

/**
 * Retorna la ruta absoluta del archivo de configuración.
 * Permite inyectar un directorio o ruta personalizada para testing.
 */
function getConfigPath(customPath) {
  if (customPath) {
    return customPath.endsWith('.json') ? customPath : path.join(customPath, CONFIG_FILE);
  }
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

/**
 * Retorna la configuración por defecto canónica de PointStream.
 */
function getDefaultConfig() {
  return {
    version: CONFIG_SCHEMA_VERSION,
    streamers: ['baldu', 'forg1'],
    config: {
      platform: 'kick',
      interval: 60,
      autoOpen: true,
      notifications: true,
      minimize: false
    }
  };
}

/**
 * Valida y sanitiza una entrada de configuración proveniente del renderer o disco.
 * Descarta claves no autorizadas, prototype pollution y valores inválidos.
 */
function validateConfig(input) {
  const defaults = getDefaultConfig();
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return defaults;
  }

  // 1. Validar versión de esquema
  let version = CONFIG_SCHEMA_VERSION;
  if (typeof input.version === 'number' && Number.isInteger(input.version) && input.version > 0) {
    version = input.version;
  }

  // 2. Validar streamers
  const streamers = [];
  const seen = new Set();
  const rawStreamers = Array.isArray(input.streamers) ? input.streamers : defaults.streamers;

  for (const item of rawStreamers) {
    if (typeof item === 'string') {
      const sanitized = item.trim().toLowerCase();
      if (sanitized && STREAMER_NAME_REGEX.test(sanitized) && !seen.has(sanitized)) {
        seen.add(sanitized);
        streamers.push(sanitized);
        if (streamers.length >= MAX_STREAMERS) break;
      }
    }
  }

  // 3. Validar preferencias / monitor config
  const rawConfig = (input.config && typeof input.config === 'object' && !Array.isArray(input.config))
    ? input.config
    : defaults.config;

  const platform = (typeof rawConfig.platform === 'string' && VALID_PLATFORMS.includes(rawConfig.platform.toLowerCase()))
    ? rawConfig.platform.toLowerCase()
    : defaults.config.platform;

  let interval = defaults.config.interval;
  if (typeof rawConfig.interval === 'number' && !isNaN(rawConfig.interval)) {
    interval = Math.min(300, Math.max(30, Math.round(rawConfig.interval)));
  }

  const autoOpen = typeof rawConfig.autoOpen === 'boolean' ? rawConfig.autoOpen : defaults.config.autoOpen;
  const notifications = typeof rawConfig.notifications === 'boolean' ? rawConfig.notifications : defaults.config.notifications;
  const minimize = typeof rawConfig.minimize === 'boolean' ? rawConfig.minimize : defaults.config.minimize;

  return {
    version,
    streamers,
    config: {
      platform,
      interval,
      autoOpen,
      notifications,
      minimize
    }
  };
}

/**
 * Migra estructuras antiguas si version < CONFIG_SCHEMA_VERSION.
 */
function migrateConfig(raw) {
  if (!raw || typeof raw !== 'object') return getDefaultConfig();
  // Preparado para v1 -> futuras versiones. Actualmente v1 es la primera versión.
  return validateConfig(raw);
}

/**
 * Carga la configuración desde el disco.
 * Si no existe, retorna los valores por defecto.
 * Si el archivo está corrupto, realiza backup en .bak y carga defaults sin crashear.
 */
function loadConfig(customPath) {
  const filePath = getConfigPath(customPath);

  if (!fs.existsSync(filePath)) {
    return getDefaultConfig();
  }

  try {
    const rawText = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(rawText);
    const migrated = migrateConfig(parsed);
    return migrated;
  } catch (err) {
    console.error(`[CONFIG] Error al leer configuración en "${filePath}": ${err.message}`);
    // Archivo corrupto: realizar backup para permitir diagnóstico sin pérdida irreversible
    try {
      const bakPath = filePath + '.bak';
      fs.copyFileSync(filePath, bakPath);
      console.warn(`[CONFIG] Respaldo de archivo corrupto creado en "${bakPath}". Cargando valores por defecto.`);
    } catch (bakErr) {
      console.error(`[CONFIG] No se pudo crear respaldo .bak: ${bakErr.message}`);
    }
    return getDefaultConfig();
  }
}

/**
 * Guarda la configuración en disco de forma atómica.
 * Escribe primero en un archivo temporal (.tmp) y luego lo reemplaza.
 */
function saveConfig(data, customPath) {
  const filePath = getConfigPath(customPath);
  const dirPath = path.dirname(filePath);

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  const validated = validateConfig(data);
  const jsonString = JSON.stringify(validated, null, 2);

  const tmpPath = `${filePath}.tmp.${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    // 1. Escribir archivo temporal
    fs.writeFileSync(tmpPath, jsonString, 'utf8');

    // 2. Reemplazo atómico
    try {
      fs.renameSync(tmpPath, filePath);
    } catch (renameErr) {
      // Fallback para sistemas o cerraduras temporales en Windows
      fs.copyFileSync(tmpPath, filePath);
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }

    return { success: true, config: validated };
  } catch (err) {
    console.error(`[CONFIG] Error al guardar configuración: ${err.message}`);
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (_) {}
    return { success: false, error: err.message, config: validated };
  }
}

/**
 * Restaura la configuración por defecto y la persiste.
 */
function resetConfig(customPath) {
  const defaults = getDefaultConfig();
  saveConfig(defaults, customPath);
  return defaults;
}

module.exports = {
  CONFIG_SCHEMA_VERSION,
  CONFIG_FILE,
  getConfigPath,
  getDefaultConfig,
  validateConfig,
  migrateConfig,
  loadConfig,
  saveConfig,
  resetConfig
};
