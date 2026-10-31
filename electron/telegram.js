/*
 * Integración con Telegram (bot compartido).
 *
 * El bot es único para todos los usuarios (@PointStreaming_bot). El token va
 * embebido pero OFUSCADO: no aparece en texto plano ni en búsquedas. Aclaración
 * honesta: en una app de escritorio el token siempre puede extraerse del paquete;
 * esto es ofuscación, no seguridad real. Si se filtra, regenerar en BotFather.
 *
 * Cada usuario se vincula con un deep link que incluye un código único. Al tocar
 * "Iniciar" se busca /start <código> para no agarrar el chat de otra persona.
 * Solo se guarda localmente el chat_id del usuario.
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');

console.log('[Telegram] Módulo cargado');

const BOT_USERNAME = 'PointStreaming_bot';
const TG_LIMIT = 3900;

// Token ofuscado (XOR + base64). Se reconstruye en memoria al usarlo.
const TK_ENC = 'SFdQX0ZkTENQU1dsIjZZfH5aAF5IOD0PGxYGMwgxCkA5F0JhU0kCD0UKEF4OEg==';
const TK_KEY = 'pointStream-cs2-2026';

function getToken() {
  const d = Buffer.from(TK_ENC, 'base64');
  const o = Buffer.alloc(d.length);
  for (let i = 0; i < d.length; i++) o[i] = d[i] ^ TK_KEY.charCodeAt(i % TK_KEY.length);
  return o.toString('utf8');
}

const CONFIG_FILE = 'telegram-config.json';
function configPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

function loadConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return { chatId: cfg.chatId ? String(cfg.chatId) : '', enabled: !!cfg.enabled };
  } catch (e) {
    return { chatId: '', enabled: false };
  }
}

function saveConfig(cfg) {
  const merged = { ...loadConfig(), ...cfg };
  try {
    fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2), 'utf8');
  } catch (e) {
    console.error('[Telegram] No se pudo guardar la config:', e.message);
  }
  return merged;
}

function isConfigured() {
  return !!loadConfig().chatId;
}

function apiUrl(method) {
  return `https://api.telegram.org/bot${getToken()}/${method}`;
}

let pendingCode = null;
let pendingSince = 0;
let webhookCleared = false;
let pollInFlight = false;
let linkOffset = 0;
let lastError = '';
let sendQueue = Promise.resolve();

function setLastError(msg) {
  lastError = String(msg || '');
  if (lastError) console.error('[Telegram] lastError:', lastError);
}

function getLastError() {
  return lastError;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function ensureGetUpdatesReady() {
  try {
    await axios.post(apiUrl('deleteWebhook'), { drop_pending_updates: false }, { timeout: 8000 });
    webhookCleared = true;
    console.log('[Telegram] Webhook limpiado (getUpdates listo)');
  } catch (e) {
    webhookCleared = false;
    console.warn('[Telegram] No se pudo limpiar webhook:', e.message);
  }
}

function beginLink() {
  pendingCode = crypto.randomBytes(8).toString('hex');
  pendingSince = Date.now();
  linkOffset = 0;
  webhookCleared = false;
  ensureGetUpdatesReady();
  return {
    ok: true,
    url: `https://t.me/${BOT_USERNAME}?start=${pendingCode}`,
    code: pendingCode,
    botUsername: BOT_USERNAME
  };
}

// Acepta "/start CODE", "/start@PointStreaming_bot CODE" o el código pegado a mano.
// Hace falta el código: el bot es compartido y un /start pelado puede ser de otra persona.
function messageHasCode(text, code) {
  if (!code) return false;
  const txt = String(text || '').trim();
  const m = txt.match(/^\/start(?:@\w+)?(?:\s+(\S+))?/i);
  if (m) return (m[1] || '') === code;
  return txt.split(/\s+/).includes(code);
}

async function pollLink() {
  if (!pendingCode) {
    return { ok: false, error: 'No hay vinculación en curso' };
  }
  if (Date.now() - pendingSince > 3 * 60 * 1000) {
    pendingCode = null;
    return { ok: false, error: 'expired' };
  }
  if (pollInFlight) {
    return { ok: true, linked: false };
  }

  pollInFlight = true;
  try {
    if (!webhookCleared) await ensureGetUpdatesReady();
    console.log('[Telegram] Polling para vinculación (esperando /start)...');

    const params = {
      timeout: 20,
      limit: 100,
      allowed_updates: JSON.stringify(['message'])
    };
    // Sin offset negativo: con -1 Telegram devuelve solo el último update y olvida
    // el resto, así que si otra persona le escribe al bot (es compartido) justo
    // después del /start del usuario, ese /start se perdía. Leemos toda la cola
    // en orden y avanzamos el offset a medida que la revisamos.
    if (linkOffset > 0) params.offset = linkOffset;

    let updates = [];
    try {
      const { data } = await axios.get(apiUrl('getUpdates'), {
        params,
        timeout: 25000
      });
      if (!data.ok) {
        const desc = data.description || 'Telegram rechazó la consulta';
        setLastError(desc);
        if (/webhook/i.test(desc)) webhookCleared = false;
        return { ok: false, error: desc };
      }
      updates = data.result || [];
      console.log('[Telegram] getUpdates retornó', updates.length, 'mensajes');
    } catch (e) {
      const status = e.response?.status;
      const desc = e.response?.data?.description || e.message;
      // 409: otra instancia de la app (el bot es compartido) está leyendo al mismo
      // tiempo. No es un error del usuario: esperamos un poco y seguimos.
      if (status === 409 || /conflict|terminated by other/i.test(desc)) {
        console.warn('[Telegram] getUpdates en conflicto con otra instancia, reintento');
        if (/webhook/i.test(desc)) {
          webhookCleared = false;
          await ensureGetUpdatesReady();
        }
        await sleep(1500);
        return { ok: true, linked: false };
      }
      setLastError(desc);
      console.error('[Telegram] Error en getUpdates:', desc);
      return { ok: false, error: 'retry' };
    }

    for (const u of updates) {
      if (u && typeof u.update_id === 'number') {
        linkOffset = Math.max(linkOffset, u.update_id + 1);
      }
    }

    for (let i = updates.length - 1; i >= 0; i--) {
      const m = updates[i].message;
      if (!m || !m.chat || m.chat.type !== 'private') continue;
      if (!messageHasCode(m.text, pendingCode)) continue;

      const chatId = String(m.chat.id);
      const chatName = m.chat.first_name || m.chat.username || m.chat.title || '';
      console.log('[Telegram] Vinculado chatId:', chatId, 'nombre:', chatName);
      pendingCode = null;
      saveConfig({ chatId, enabled: true });
      setLastError('');
      await sendMessage(
        `✅ <b>Listo, ${escapeName(chatName)}!</b>\nVas a recibir acá las predicciones de Forg1 con stats y recomendación. 🎯`,
        { chatId }
      );
      return { ok: true, linked: true, chatId, chatName };
    }

    return { ok: true, linked: false };
  } finally {
    pollInFlight = false;
  }
}

function escapeName(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function splitChunks(text, limit) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) chunks.push(rest);
  return chunks;
}

async function postMessage(chatId, text, parseMode) {
  const { data } = await axios.post(
    apiUrl('sendMessage'),
    {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...(parseMode ? { parse_mode: parseMode } : {})
    },
    { timeout: 15000 }
  );
  return data;
}

async function postMessageWithRetry(chatId, text, parseMode) {
  let lastDesc = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await postMessage(chatId, text, parseMode);
    } catch (e) {
      const status = e.response?.status;
      const desc = e.response?.data?.description || e.message;
      lastDesc = desc;
      if (status === 429) {
        const wait = Number(e.response?.data?.parameters?.retry_after) || 1;
        console.warn('[Telegram] 429, reintento en', wait, 's');
        await sleep(wait * 1000);
        continue;
      }
      if (/parse/i.test(desc) || /entities/i.test(desc)) {
        throw e;
      }
      if (attempt < 3 && (e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT' || e.code === 'ECONNABORTED' || status >= 500)) {
        await sleep(400 * attempt);
        continue;
      }
      throw e;
    }
  }
  throw new Error(lastDesc || 'Telegram no respondió');
}

function friendlySendError(e) {
  const status = e.response?.status;
  const desc = e.response?.data?.description || e.message || '';
  if (status === 403 || /blocked by the user|user is deactivated/i.test(desc)) {
    return 'El bot no te puede escribir (lo bloqueaste o cerraste el chat). Desvinculá y volvé a conectar.';
  }
  if (/chat not found/i.test(desc)) {
    return 'Telegram no encuentra tu chat. Desvinculá y volvé a conectar.';
  }
  if (status === 401 || /unauthorized/i.test(desc)) {
    return 'El token del bot es inválido. Hay que regenerarlo en BotFather.';
  }
  if (['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNABORTED', 'ECONNRESET'].includes(e.code)) {
    return 'Sin conexión con Telegram (' + e.code + ').';
  }
  return desc || 'Telegram no respondió';
}

async function sendMessage(text, opts = {}) {
  const run = async () => {
    const chatId = String(opts.chatId || loadConfig().chatId || '');
    if (!chatId) {
      setLastError('Telegram no está vinculado');
      console.error('[Telegram] No está vinculado - no hay chatId');
      return { ok: false, error: 'Telegram no está vinculado' };
    }

    const parts = splitChunks(String(text || ''), TG_LIMIT);
    try {
      for (const part of parts) {
        try {
          const data = await postMessageWithRetry(chatId, part, 'HTML');
          if (!data.ok) {
            setLastError(data.description || 'Telegram rechazó el mensaje');
            return { ok: false, error: data.description || 'Telegram rechazó el mensaje' };
          }
        } catch (e) {
          const desc = e.response?.data?.description || e.message;
          if (/parse/i.test(desc) || /entities/i.test(desc)) {
            console.warn('[Telegram] HTML inválido, reintento en texto plano:', desc);
            const data = await postMessageWithRetry(chatId, stripHtml(part), null);
            if (!data.ok) {
              setLastError(data.description || desc);
              return { ok: false, error: data.description || desc };
            }
          } else {
            throw e;
          }
        }
      }
      setLastError('');
      console.log('[Telegram] Mensaje enviado OK a', chatId, `(${parts.length} parte${parts.length > 1 ? 's' : ''})`);
      return { ok: true };
    } catch (e) {
      const desc = friendlySendError(e);
      setLastError(desc);
      console.error('[Telegram] Error enviando mensaje:', e.response?.data?.description || e.message);
      return { ok: false, error: desc };
    }
  };

  const queued = sendQueue.then(run, run);
  sendQueue = queued.then(() => {}, () => {});
  return queued;
}

function unlink() {
  pendingCode = null;
  lastError = '';
  saveConfig({ chatId: '', enabled: false });
  return { ok: true };
}

module.exports = {
  BOT_USERNAME,
  loadConfig,
  saveConfig,
  isConfigured,
  beginLink,
  pollLink,
  sendMessage,
  unlink,
  getLastError
};
