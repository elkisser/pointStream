/*
 * Integración con Telegram (bot compartido).
 *
 * El bot es único para todos los usuarios (@PointStreaming_bot). El token va
 * embebido pero OFUSCADO: no aparece en texto plano ni en búsquedas. Aclaración
 * honesta: en una app de escritorio el token siempre puede extraerse del paquete;
 * esto es ofuscación, no seguridad real. Si se filtra, regenerar en BotFather.
 *
 * Cada usuario se vincula con un deep link de Telegram que incluye un código
 * único. Al tocar "Iniciar" en el chat del bot, se detecta su chat_id sin que
 * tenga que pegar ningún token. Solo se guarda localmente el chat_id del usuario.
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');

const BOT_USERNAME = 'PointStreaming_bot';

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

// ----- Persistencia (solo chat del usuario + preferencia) -----
function loadConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return { chatId: cfg.chatId || '', enabled: !!cfg.enabled };
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

// ----- Vinculación por deep link -----
let pendingCode = null;

// Genera un código único y devuelve el deep link para abrir el chat del bot.
function beginLink() {
  pendingCode = 'ps' + crypto.randomBytes(8).toString('hex');
  return {
    ok: true,
    code: pendingCode,
    url: `https://t.me/${BOT_USERNAME}?start=${pendingCode}`,
    botUsername: BOT_USERNAME
  };
}

// Busca en getUpdates un "/start <code>" que coincida con el código pendiente.
// IMPORTANTE: no se confirma el offset (no se consume la cola), así varios
// usuarios pueden vincularse con el mismo bot sin pisarse entre sí.
async function pollLink() {
  if (!pendingCode) return { ok: false, error: 'No hay vinculación en curso' };

  let updates = [];
  try {
    const { data } = await axios.get(apiUrl('getUpdates'), {
      params: { timeout: 0, allowed_updates: JSON.stringify(['message']) },
      timeout: 10000
    });
    if (!data.ok) return { ok: false, error: 'Telegram rechazó la consulta' };
    updates = data.result || [];
  } catch (e) {
    // 409: otra consulta getUpdates simultánea. Reintentar más tarde.
    return { ok: false, error: 'retry' };
  }

  for (let i = updates.length - 1; i >= 0; i--) {
    const m = updates[i].message;
    if (!m || !m.text || !m.chat) continue;
    const txt = m.text.trim();
    if (txt === `/start ${pendingCode}` || txt === pendingCode) {
      const chatId = String(m.chat.id);
      const chatName = m.chat.first_name || m.chat.username || m.chat.title || '';
      saveConfig({ chatId, enabled: true });
      pendingCode = null;
      await sendMessage(
        `✅ <b>Listo, ${escapeName(chatName)}!</b>\nVas a recibir acá las predicciones de Forg1 con su estadística y recomendación. 🎯`,
        { chatId }
      );
      return { ok: true, linked: true, chatId, chatName };
    }
  }

  return { ok: true, linked: false };
}

function escapeName(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ----- Envío de mensajes -----
async function sendMessage(text, opts = {}) {
  const chatId = opts.chatId || loadConfig().chatId;
  if (!chatId) return { ok: false, error: 'Telegram no está vinculado' };

  try {
    const { data } = await axios.post(
      apiUrl('sendMessage'),
      { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true },
      { timeout: 12000 }
    );
    return { ok: !!data.ok };
  } catch (e) {
    const desc = e.response?.data?.description || e.message;
    console.error('[Telegram] Error enviando mensaje:', desc);
    return { ok: false, error: desc };
  }
}

function unlink() {
  saveConfig({ chatId: '', enabled: false });
  pendingCode = null;
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
  unlink
};
