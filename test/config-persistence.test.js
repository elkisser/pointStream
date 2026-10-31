/**
 * test/config-persistence.test.js
 *
 * Suite de tests para el módulo de persistencia de configuración de PointStream (Fase 7 — ISSUE-005).
 * Cubre los 16 escenarios obligatorios de almacenamiento, recuperación, atomicidad y seguridad.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const configStore = require('../electron/config-store');

describe('Config Persistence & State Recovery (Fase 7 — ISSUE-005)', () => {
  let tempDir;
  let testConfigPath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-config-test-'));
    testConfigPath = path.join(tempDir, 'config.json');
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (_) {}
  });

  // Test 1: Defaults cuando no existe archivo
  test('Test 1 — Defaults cuando no existe archivo', () => {
    const cfg = configStore.loadConfig(testConfigPath);
    assert.strictEqual(cfg.version, 1);
    assert.deepStrictEqual(cfg.streamers, ['baldu', 'forg1']);
    assert.strictEqual(cfg.config.platform, 'kick');
    assert.strictEqual(cfg.config.interval, 60);
    assert.strictEqual(cfg.config.autoOpen, true);
    assert.strictEqual(cfg.config.notifications, true);
    assert.strictEqual(cfg.config.minimize, false);
  });

  // Test 2: Guardar configuración válida
  test('Test 2 — Guardar configuración válida', () => {
    const toSave = {
      version: 1,
      streamers: ['streamer1', 'streamer2'],
      config: {
        platform: 'twitch',
        interval: 120,
        autoOpen: false,
        notifications: true,
        minimize: true
      }
    };

    const res = configStore.saveConfig(toSave, testConfigPath);
    assert.strictEqual(res.success, true);
    assert.ok(fs.existsSync(testConfigPath), 'El archivo config.json debe existir');
  });

  // Test 3: Cargar configuración guardada
  test('Test 3 — Cargar configuración guardada', () => {
    const toSave = {
      version: 1,
      streamers: ['gaules', 'tarik'],
      config: {
        platform: 'twitch',
        interval: 90,
        autoOpen: true,
        notifications: false,
        minimize: false
      }
    };

    configStore.saveConfig(toSave, testConfigPath);
    const loaded = configStore.loadConfig(testConfigPath);

    assert.deepStrictEqual(loaded.streamers, ['gaules', 'tarik']);
    assert.strictEqual(loaded.config.platform, 'twitch');
    assert.strictEqual(loaded.config.interval, 90);
    assert.strictEqual(loaded.config.notifications, false);
  });

  // Test 4: Round-trip: save -> load -> deepEqual
  test('Test 4 — Round-trip: save -> load -> deepEqual', () => {
    const original = {
      version: 1,
      streamers: ['streamer_a', 'streamer_b', 'streamer_c'],
      config: {
        platform: 'kick',
        interval: 45,
        autoOpen: false,
        notifications: true,
        minimize: true
      }
    };

    configStore.saveConfig(original, testConfigPath);
    const loaded = configStore.loadConfig(testConfigPath);
    assert.deepStrictEqual(loaded, original);
  });

  // Test 5: Archivo JSON corrupto: backup .bak y carga de defaults
  test('Test 5 — Archivo JSON corrupto genera backup .bak y retorna defaults sin crashear', () => {
    fs.writeFileSync(testConfigPath, '{ "corruptedJson": true, INVALID_SYNTAX... ', 'utf8');

    const loaded = configStore.loadConfig(testConfigPath);
    assert.strictEqual(loaded.version, 1);
    assert.deepStrictEqual(loaded.streamers, ['baldu', 'forg1']);

    const bakPath = testConfigPath + '.bak';
    assert.ok(fs.existsSync(bakPath), 'Debe haberse creado config.json.bak');
    const bakContent = fs.readFileSync(bakPath, 'utf8');
    assert.ok(bakContent.includes('INVALID_SYNTAX'), 'El backup debe conservar el contenido corrupto original');
  });

  // Test 6: Schema version válida (v1)
  test('Test 6 — Schema version válida (v1)', () => {
    const valid = configStore.validateConfig({
      version: 1,
      streamers: ['baldu'],
      config: { platform: 'kick', interval: 60, autoOpen: true, notifications: true, minimize: false }
    });
    assert.strictEqual(valid.version, 1);
  });

  // Test 7: Schema version antigua o ausente: migra a versión actual
  test('Test 7 — Schema version antigua o ausente se normaliza a CONFIG_SCHEMA_VERSION', () => {
    const rawLegacy = {
      streamers: ['legacy_streamer'],
      config: { platform: 'kick' }
    };
    fs.writeFileSync(testConfigPath, JSON.stringify(rawLegacy), 'utf8');

    const loaded = configStore.loadConfig(testConfigPath);
    assert.strictEqual(loaded.version, 1);
    assert.deepStrictEqual(loaded.streamers, ['legacy_streamer']);
    assert.strictEqual(loaded.config.interval, 60, 'Debe rellenar defaults faltantes');
  });

  // Test 8: Schema version futura desconocida: preserva campos seguros
  test('Test 8 — Schema version futura desconocida conserva campos válidos', () => {
    const future = {
      version: 99,
      streamers: ['future_user'],
      config: { platform: 'twitch', interval: 90, autoOpen: true, notifications: false, minimize: false }
    };
    fs.writeFileSync(testConfigPath, JSON.stringify(future), 'utf8');

    const loaded = configStore.loadConfig(testConfigPath);
    assert.strictEqual(loaded.version, 99);
    assert.deepStrictEqual(loaded.streamers, ['future_user']);
    assert.strictEqual(loaded.config.platform, 'twitch');
  });

  // Test 9: Datos inválidos: types incorrectos y sanitización
  test('Test 9 — Datos inválidos: sanitiza nombres y acota valores numéricos', () => {
    const dirty = {
      version: 'invalid_version',
      streamers: ['   UPPER_CASE   ', 'bad name with spaces!', null, 123, 'valid-name.1'],
      config: {
        platform: 'INVALID_PLATFORM',
        interval: 9999, // Supera el max 300
        autoOpen: 'not_a_boolean',
        notifications: null
      }
    };

    const validated = configStore.validateConfig(dirty);
    assert.strictEqual(validated.version, 1);
    // Nombres válidos admitidos: upper_case y valid-name.1 (el que tiene espacios y los no-strings son descartados)
    assert.deepStrictEqual(validated.streamers, ['upper_case', 'valid-name.1']);
    assert.strictEqual(validated.config.platform, 'kick', 'Debe caer en default kick');
    assert.strictEqual(validated.config.interval, 300, 'Debe clampearse al máximo de 300');
    assert.strictEqual(validated.config.autoOpen, true, 'Debe caer en default booleano true');
  });

  // Test 10: No persiste secretos ni campos ajenos
  test('Test 10 — No persiste secretos, tokens, cookies ni campos desconocidos', () => {
    const payloadWithSecrets = {
      version: 1,
      streamers: ['clean_user'],
      config: { platform: 'kick', interval: 60, autoOpen: true, notifications: true, minimize: false },
      token: 'SECRET_BOT_TOKEN_12345',
      password: 'SUPER_SECRET_PASSWORD',
      cookie: 'cf_clearance=abcdef123456',
      sessionData: { sensitive: true }
    };

    const res = configStore.saveConfig(payloadWithSecrets, testConfigPath);
    assert.strictEqual(res.success, true);

    const savedRaw = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'));
    assert.strictEqual(savedRaw.token, undefined);
    assert.strictEqual(savedRaw.password, undefined);
    assert.strictEqual(savedRaw.cookie, undefined);
    assert.strictEqual(savedRaw.sessionData, undefined);
  });

  // Test 11: Agregar streamer y recuperar
  test('Test 11 — Agregar streamer y recuperar tras recarga', () => {
    let cfg = configStore.loadConfig(testConfigPath);
    cfg.streamers.push('nuevo_streamer');
    configStore.saveConfig(cfg, testConfigPath);

    const reloaded = configStore.loadConfig(testConfigPath);
    assert.ok(reloaded.streamers.includes('nuevo_streamer'));
  });

  // Test 12: Eliminar streamer y recuperar
  test('Test 12 — Eliminar streamer y recuperar tras recarga', () => {
    let cfg = configStore.loadConfig(testConfigPath);
    cfg.streamers = cfg.streamers.filter(s => s !== 'forg1');
    configStore.saveConfig(cfg, testConfigPath);

    const reloaded = configStore.loadConfig(testConfigPath);
    assert.ok(!reloaded.streamers.includes('forg1'));
    assert.ok(reloaded.streamers.includes('baldu'));
  });

  // Test 13: Múltiples streamers con límite y deduplicación
  test('Test 13 — Múltiples streamers deduplica y respeta límite de 100', () => {
    const list = [];
    for (let i = 0; i < 150; i++) {
      list.push(`streamer_${i}`);
      list.push(`STREAMER_${i}`); // Duplicado en mayúsculas
    }

    const validated = configStore.validateConfig({ streamers: list });
    assert.strictEqual(validated.streamers.length, 100);
    assert.strictEqual(validated.streamers[0], 'streamer_0');
    assert.strictEqual(validated.streamers[99], 'streamer_99');
  });

  // Test 14: Configuración vacía
  test('Test 14 — Configuración vacía: streamers vacíos permitidos', () => {
    const emptyConfig = {
      version: 1,
      streamers: [],
      config: { platform: 'kick', interval: 60, autoOpen: true, notifications: true, minimize: false }
    };

    configStore.saveConfig(emptyConfig, testConfigPath);
    const loaded = configStore.loadConfig(testConfigPath);
    assert.strictEqual(loaded.streamers.length, 0);
  });

  // Test 15: Atomicidad: crea archivo y no deja basura .tmp tras guardado exitoso
  test('Test 15 — Atomicidad: guarda limpiamente sin dejar residuos temporales', () => {
    configStore.saveConfig({ streamers: ['user1'] }, testConfigPath);
    const files = fs.readdirSync(tempDir);
    assert.strictEqual(files.filter(f => f.includes('.tmp')).length, 0);
    assert.ok(files.includes('config.json'));
  });

  // Test 16: Seguridad: protección contra prototype pollution y path traversal
  test('Test 16 — Seguridad: descarta __proto__ y constructor maliciosos', () => {
    const maliciousPayload = JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"prototype": {"isAdmin": true}}, "streamers": ["safe_user"]}');
    const validated = configStore.validateConfig(maliciousPayload);

    assert.strictEqual(Object.prototype.polluted, undefined);
    assert.strictEqual(Object.prototype.isAdmin, undefined);
    assert.deepStrictEqual(validated.streamers, ['safe_user']);
  });

  // Test adicional: Reset de configuración
  test('Test 17 — resetConfig restaura y persiste los valores por defecto', () => {
    configStore.saveConfig({ streamers: ['custom1', 'custom2'], config: { platform: 'twitch' } }, testConfigPath);
    const resetted = configStore.resetConfig(testConfigPath);

    assert.deepStrictEqual(resetted.streamers, ['baldu', 'forg1']);
    assert.strictEqual(resetted.config.platform, 'kick');

    const reloaded = configStore.loadConfig(testConfigPath);
    assert.deepStrictEqual(reloaded.streamers, ['baldu', 'forg1']);
  });

});
