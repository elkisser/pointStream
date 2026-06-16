/*
 * Configura el perfil del bot de Telegram (una sola vez).
 * Define la descripción que ven los usuarios nuevos junto al botón "Iniciar",
 * la descripción corta y el comando /start.
 *
 * Uso: node build/setup-telegram-bot.js
 */
const axios = require('axios');

// Mismo token ofuscado que electron/telegram.js
const TK_ENC = 'SFdQX0ZkTENQU1dsIjZZfH5aAF5IOD0PGxYGMwgxCkA5F0JhU0kCD0UKEF4OEg==';
const TK_KEY = 'pointStream-cs2-2026';

function getToken() {
  const d = Buffer.from(TK_ENC, 'base64');
  const o = Buffer.alloc(d.length);
  for (let i = 0; i < d.length; i++) o[i] = d[i] ^ TK_KEY.charCodeAt(i % TK_KEY.length);
  return o.toString('utf8');
}

const API = (m) => `https://api.telegram.org/bot${getToken()}/${m}`;

const DESCRIPTION =
  '🎯 pointStream\n\n' +
  'Te aviso cuando se abre una predicción de CS2 en Forg1, con estadísticas reales ' +
  'de HLTV (ranking, forma reciente, head to head) y una recomendación de a quién ' +
  'conviene apostar.\n\n' +
  'Tocá INICIAR para vincular tu cuenta y empezar a recibir los avisos.';

const SHORT_DESCRIPTION =
  'Avisos de predicciones de CS2 (Forg1 + HLTV) con estadísticas y recomendación de a quién apostar.';

async function call(method, payload) {
  try {
    const { data } = await axios.post(API(method), payload, { timeout: 10000 });
    console.log(`  ${method}: ${data.ok ? 'OK' : 'FALLÓ'}${data.description ? ' - ' + data.description : ''}`);
  } catch (e) {
    console.log(`  ${method}: ERROR - ${e.response?.data?.description || e.message}`);
  }
}

(async () => {
  console.log('Configurando perfil del bot...');
  await call('setMyDescription', { description: DESCRIPTION });
  await call('setMyShortDescription', { short_description: SHORT_DESCRIPTION });
  await call('setMyCommands', {
    commands: [{ command: 'start', description: 'Vincular y recibir avisos de predicciones' }]
  });
  console.log('Listo.');
})();
