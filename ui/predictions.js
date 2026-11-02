// ============================================================
// Predicciones CS2 — UI
// ============================================================

let predBusy = false;
let monitoring = false;
let forg1Active = false;
let hltvActive = false;

function updateForg1Btn(loading = false) {
  const btn = document.getElementById('loginForg1Btn');
  if (!btn) return;
  if (loading) {
    btn.classList.add('loading');
    btn.innerHTML = `<span class="btn-loader-spinner"></span> Conectando...`;
    return;
  }
  btn.classList.remove('loading');
  if (forg1Active) {
    btn.classList.add('active');
    btn.innerHTML = `<span class="btn-status-dot"></span> 🔑 Forg1 Activo`;
    btn.title = 'Sesión activa en Forg1';
  } else {
    btn.classList.remove('active');
    btn.innerHTML = `🔑 Login Forg1`;
    btn.title = 'Iniciar sesión en Forg1';
  }
}

function updateHltvBtn(loading = false) {
  const btn = document.getElementById('connectHltvBtn');
  if (!btn) return;
  if (loading) {
    btn.classList.add('loading');
    btn.innerHTML = `<span class="btn-loader-spinner"></span> Conectando HLTV...`;
    return;
  }
  btn.classList.remove('loading');
  if (hltvActive) {
    btn.classList.add('active');
    btn.innerHTML = `<span class="btn-status-dot"></span> 🛡️ HLTV Activo`;
    btn.title = 'HLTV verificado y conectado';
  } else {
    btn.classList.remove('active');
    btn.innerHTML = `🛡️ Conectar HLTV`;
    btn.title = 'Pasar verificación de Cloudflare en HLTV';
  }
}

function initPredictions() {
  document.getElementById('scanForg1Btn').addEventListener('click', doScan);
  document.getElementById('loginForg1Btn').addEventListener('click', doLogin);
  document.getElementById('connectHltvBtn').addEventListener('click', doConnectHLTV);
  document.getElementById('manualAnalyzeBtn').addEventListener('click', doManual);
  document.getElementById('monitorPredBtn').addEventListener('click', toggleMonitoring);

  document.getElementById('team1Input').addEventListener('keypress', e => {
    if (e.key === 'Enter') document.getElementById('team2Input').focus();
  });
  document.getElementById('team2Input').addEventListener('keypress', e => {
    if (e.key === 'Enter') doManual();
  });

  document.querySelectorAll('.quick-team').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.target).value = btn.dataset.team;
    });
  });

  // Escuchar avisos del monitor de predicciones
  window.predictionsAPI.onUpdate(handleMonitorUpdate);

  // Escuchar actualizaciones de estado de servicios (Forg1 y HLTV)
  if (window.predictionsAPI.onServicesStatus) {
    window.predictionsAPI.onServicesStatus((status) => {
      if (!status) return;
      if (status.forg1Active != null) {
        forg1Active = !!status.forg1Active;
        updateForg1Btn(false);
      }
      if (status.hltvActive != null) {
        hltvActive = !!status.hltvActive;
        updateHltvBtn(false);
      }
      // Cloudflare bloqueó HLTV: apagar el indicador y mostrar alerta.
      if (status.cf_blocked) {
        hltvActive = false;
        updateHltvBtn(false);
        // Solo mostrar una vez cada 5 minutos para no spamear.
        const now = Date.now();
        if (!window._cfAlertAt || now - window._cfAlertAt > 5 * 60 * 1000) {
          window._cfAlertAt = now;
          const msg = '⚠️ HLTV caído por Cloudflare. Tocá "Conectar HLTV" para pasar la verificación de nuevo.';
          setResults(msgHTML('warn', 'HLTV requiere verificación', msg));
          const btn = document.getElementById('connectHltvBtn');
          if (btn) btn.classList.add('needs-action');
        }
      }
    });
  }

  // Verificación inicial de estado de servicios
  if (window.predictionsAPI.checkServicesStatus) {
    window.predictionsAPI.checkServicesStatus().then((s) => {
      if (!s) return;
      forg1Active = !!s.forg1Active;
      hltvActive = !!s.hltvActive;
      updateForg1Btn(false);
      updateHltvBtn(false);
    }).catch(() => {});
  }

  // Configuración de Telegram
  initTelegram();
}

// ============================================================
// Telegram (bot compartido + vinculación por deep link)
// ============================================================

let telegramPollTimer = null;

async function initTelegram() {
  const linkBtn = document.getElementById('telegramLinkBtn');
  const testBtn = document.getElementById('telegramTestBtn');
  const unlinkBtn = document.getElementById('telegramUnlinkBtn');
  const enabledCheck = document.getElementById('telegramEnabled');
  if (!linkBtn) return;

  linkBtn.addEventListener('click', telegramStartLink);
  testBtn.addEventListener('click', telegramTest);
  unlinkBtn.addEventListener('click', telegramUnlink);
  enabledCheck.addEventListener('change', async (e) => {
    await window.telegramAPI.setEnabled(e.target.checked);
    refreshTelegramStatus();
  });

  refreshTelegramStatus();
}

async function refreshTelegramStatus() {
  const cfg = await window.telegramAPI.getConfig();
  const enabledRow = document.getElementById('telegramEnabledRow');
  const enabledCheck = document.getElementById('telegramEnabled');
  const linkBtn = document.getElementById('telegramLinkBtn');
  const statusEl = document.getElementById('telegramStatus');

  if (cfg.configured) {
    enabledRow.style.display = 'flex';
    enabledCheck.checked = !!cfg.enabled;
    linkBtn.style.display = 'none';
    statusEl.className = 'telegram-status ok';
    const err = cfg.lastError ? `<br><span class="telegram-error">Último error: ${esc(cfg.lastError)}</span>` : '';
    statusEl.innerHTML = cfg.enabled
      ? `✅ <strong>Conectado</strong><br>Recibirás las predicciones en tu chat de Telegram.${err}`
      : `⏸️ <strong>Pausado</strong><br>Activá los avisos en la casilla para recibirlos.${err}`;
  } else {
    enabledRow.style.display = 'none';
    linkBtn.style.display = '';
    statusEl.className = 'telegram-status warn';
    statusEl.innerHTML = '⚠️ <strong>Sin vincular</strong><br>Tocá el botón para conectar tu Telegram.';
  }
}

async function telegramStartLink() {
  const statusEl = document.getElementById('telegramStatus');
  const linkBtn = document.getElementById('telegramLinkBtn');

  const res = await window.telegramAPI.beginLink();
  if (!res.ok) {
    statusEl.className = 'telegram-status warn';
    statusEl.textContent = '⚠️ No se pudo iniciar la vinculación.';
    return;
  }

  linkBtn.disabled = true;
  statusEl.className = 'telegram-status';
  statusEl.innerHTML = `Se abrió el chat con <strong>@${esc(res.botUsername)}</strong> en tu navegador. Abrilo en Telegram y tocá <strong>Iniciar</strong>.<br>
    Si no aparece el botón, mandale al bot este mensaje: <code class="telegram-code">/start ${esc(res.code || '')}</code><br>
    <span class="telegram-error">Esperando… (hasta 3 minutos)</span>`;

  if (telegramPollTimer) {
    clearTimeout(telegramPollTimer);
    telegramPollTimer = null;
  }
  // Mismo límite que el backend (3 min): antes la UI se rendía a los 90 s.
  const deadline = Date.now() + 3 * 60 * 1000;
  const tick = async () => {
    let poll;
    try {
      poll = await window.telegramAPI.pollLink();
    } catch (e) {
      poll = { ok: false, error: 'retry' };
    }
    if (poll.ok && poll.linked) {
      telegramPollTimer = null;
      linkBtn.disabled = false;
      refreshTelegramStatus();
      return;
    }
    if (poll.error === 'expired' || Date.now() >= deadline) {
      telegramPollTimer = null;
      linkBtn.disabled = false;
      statusEl.className = 'telegram-status warn';
      statusEl.textContent = '⚠️ No detecté que iniciaras el chat. Probá de nuevo: tocá el botón y dale Iniciar en Telegram.';
      return;
    }
    // Si falló la red, no martillar la API: esperar un poco más.
    telegramPollTimer = setTimeout(tick, poll.ok ? 400 : 2000);
  };
  tick();
}

async function telegramTest() {
  const statusEl = document.getElementById('telegramStatus');
  statusEl.className = 'telegram-status';
  statusEl.textContent = 'Enviando mensaje de prueba…';
  const res = await window.telegramAPI.test();
  if (res.ok) {
    statusEl.className = 'telegram-status ok';
    statusEl.textContent = '✅ Mensaje de prueba enviado. Revisá Telegram.';
  } else {
    statusEl.className = 'telegram-status warn';
    statusEl.textContent = '⚠️ ' + (res.error || 'No se pudo enviar.');
  }
}

async function telegramUnlink() {
  if (telegramPollTimer) { clearTimeout(telegramPollTimer); telegramPollTimer = null; }
  await window.telegramAPI.unlink();
  refreshTelegramStatus();
}

// --- Monitoreo de predicciones ---
async function toggleMonitoring() {
  const btn = document.getElementById('monitorPredBtn');
  if (monitoring) {
    if (btn) {
      btn.classList.add('loading');
      btn.innerHTML = `<span class="btn-loader-spinner"></span> <span class="pred-mon-label">Deteniendo...</span>`;
    }
    await window.predictionsAPI.stopMonitoring();
    setMonitoring(false);
    return;
  }

  if (btn) {
    btn.classList.add('loading');
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-loader-spinner"></span> <span class="pred-mon-label">Iniciando...</span>`;
  }
  const res = await window.predictionsAPI.startMonitoring({ interval: 60 });
  if (btn) btn.disabled = false;

  if (res.success) {
    setMonitoring(true);
    if (predBusy) return;
    // Mostrar lo que haya ahora mismo
    doScan();
  } else if (res.error === 'not-logged-in') {
    setMonitoring(false);
    forg1Active = false;
    updateForg1Btn(false);
    setResults(msgHTML('warning', 'No estás logueado en Forg1', 'Tocá "Login Forg1", iniciá sesión, cerrá esa ventana y volvé a activar el monitoreo.'));
  } else {
    setMonitoring(false);
    setResults(msgHTML('error', 'No se pudo iniciar el monitoreo', res.message || res.error || ''));
  }
}

function setMonitoring(on) {
  monitoring = on;
  const btn = document.getElementById('monitorPredBtn');
  if (!btn) return;
  btn.classList.remove('loading');
  btn.classList.toggle('active', on);
  if (on) {
    btn.innerHTML = `<span class="btn-status-dot"></span> <span class="pred-mon-label">Monitoreando</span>`;
  } else {
    btn.innerHTML = `<span class="pred-mon-dot"></span> <span class="pred-mon-label">Monitorear</span>`;
  }
}

// Llega cuando el monitor del backend detecta cambios
function handleMonitorUpdate(data) {
  if (!data) return;

  if (data.loggedIn === false) {
    setMonitoring(false);
    forg1Active = false;
    updateForg1Btn(false);
    setResults(`
      <div class="msg msg-warning">
        <div class="msg-icon">⚠️</div>
        <div class="msg-body">
          <strong>Sesión de Forg1 expirada</strong>
          <p>Tu sesión en Forg1 cerró. Hacé click en Login Forg1, iniciá sesión con Kick y cerrá la ventana.</p>
          <button class="btn-login" onclick="doLogin()" style="margin-top:0.7rem;">🔑 Ir a Login Forg1</button>
        </div>
      </div>`);
    return;
  }

  // Si apareció una predicción nueva, refrescar el análisis completo
  if (data.hasNew && !predBusy) {
    doScan();
  }
}


// --- Scan Forg1 ---
async function doScan() {
  if (predBusy) return;
  predBusy = true;
  setBusy(true);
  setResults(loadingHTML('Escaneando forg1.com', 'Detectando predicciones abiertas y analizando con HLTV…'));

  try {
    const res = await window.predictionsAPI.autoAnalyze();
    if (!res.success) {
      if (res.error === 'not-logged-in') {
        forg1Active = false;
        updateForg1Btn(false);
        setResults(`
          <div class="msg msg-warning">
            <div class="msg-icon">⚠️</div>
            <div class="msg-body">
              <strong>Sesión de Forg1 expirada</strong>
              <p>Tu sesión en Forg1 cerró. Hacé click en Login Forg1, iniciá sesión con Kick y cerrá la ventana.</p>
              <button class="btn-login" onclick="doLogin()" style="margin-top:0.7rem;">🔑 Ir a Login Forg1</button>
            </div>
          </div>`);
      } else {
        setResults(msgHTML('error', 'Algo falló', res.error));
      }
      return;
    }

    // Forg1 respondió correctamente
    forg1Active = true;
    updateForg1Btn(false);

    const { predictions } = res.data;
    const visible = (predictions || []).filter(isVisiblePrediction);
    if (visible.some(p => p.analysis && p.analysis.dataQuality && p.analysis.dataQuality !== 'none')) {
      hltvActive = true;
      updateHltvBtn(false);
    }

    if (!visible.length) {
      setResults(msgHTML('info', 'No hay predicciones activas', monitoring
        ? 'Te aviso apenas se abra una o más predicciones en Forg1. Si hay varias, podés apostar en todas.'
        : 'En este momento no hay predicciones en Forg1. Activá "Monitorear" para recibir aviso cuando se abran — pueden ser varias a la vez.'));
      return;
    }

    renderCards(visible);
  } catch (e) {
    setResults(msgHTML('error', 'Error de conexión', e.message));
  } finally {
    predBusy = false;
    setBusy(false);
  }
}

// --- Manual ---
async function doManual() {
  const t1 = document.getElementById('team1Input').value.trim();
  const t2 = document.getElementById('team2Input').value.trim();
  if (!t1 || !t2) return setResults(msgHTML('warning', 'Faltan equipos', 'Escribí los dos equipos para analizar.'));

  if (predBusy) return;
  predBusy = true;
  setBusy(true);
  setResults(loadingHTML(`Analizando ${t1} vs ${t2}`, 'Buscando en HLTV… puede tardar unos segundos.'));

  const mapVal = document.getElementById('manualMapSelect')?.value;
  const scoreVal = document.getElementById('manualSeriesScore')?.value;
  const pickVal = document.getElementById('manualPickSelect')?.value;

  const manualOpts = {};
  if (mapVal) manualOpts.mapNumber = parseInt(mapVal, 10);
  if (scoreVal) {
    const parts = scoreVal.split('-').map(Number);
    manualOpts.seriesScore = { team1: parts[0], team2: parts[1] };
  }
  if (pickVal === 'team1') manualOpts.mapPick = t1;
  else if (pickVal === 'team2') manualOpts.mapPick = t2;

  try {
    const res = await window.predictionsAPI.analyzeMatch(t1, t2, manualOpts);
    if (res.success) {
      if (res.data && res.data.dataQuality && res.data.dataQuality !== 'none') {
        hltvActive = true;
        updateHltvBtn(false);
      }
      renderCards([{
        question: `${t1} vs ${t2}${mapVal ? ` · Mapa ${mapVal}` : ''}`,
        mapNumber: mapVal ? parseInt(mapVal, 10) : null,
        seriesScore: manualOpts.seriesScore || null,
        teams: [{ name: res.data.team1.name, percentage: '—' }, { name: res.data.team2.name, percentage: '—' }],
        analysis: res.data
      }]);
    } else {
      setResults(msgHTML('error', 'Algo falló', res.error));
    }
  } catch (e) {
    setResults(msgHTML('error', 'Error', e.message));
  } finally {
    predBusy = false;
    setBusy(false);
  }
}

async function doLogin() {
  updateForg1Btn(true);
  try {
    await window.predictionsAPI.openForg1Login();
  } finally {
    setTimeout(async () => {
      if (window.predictionsAPI.checkServicesStatus) {
        const s = await window.predictionsAPI.checkServicesStatus();
        if (s) {
          forg1Active = !!s.forg1Active;
          updateForg1Btn(false);
        }
      } else {
        updateForg1Btn(false);
      }
    }, 1500);
  }
}

async function doConnectHLTV() {
  updateHltvBtn(true);
  try {
    await window.predictionsAPI.connectHLTV();
  } finally {
    setTimeout(async () => {
      if (window.predictionsAPI.checkServicesStatus) {
        const s = await window.predictionsAPI.checkServicesStatus();
        if (s) {
          hltvActive = !!s.hltvActive;
          updateHltvBtn(false);
        }
      } else {
        updateHltvBtn(false);
      }
    }, 1500);
  }
}

// --- Render ---
let countdownInterval = null;

function isVisiblePrediction(p) {
  if (!p) return false;
  const status = p.status || 'OPEN';
  if (status === 'RESOLVED' || status === 'WAITING_RESULT') return false;
  const secs = parseClock(p.closesAt);
  if (secs === 0) return false;
  return true;
}

function renderCards(predictions) {
  predictions = (predictions || []).filter(isVisiblePrediction);
  if (!predictions.length) {
    setResults(msgHTML('info', 'No hay predicciones activas', 'Las finalizadas no se muestran. Esperá a que Forg1 abra una nueva.'));
    return;
  }
  const openCount = predictions.filter(p => (p.status || 'OPEN') === 'OPEN').length;
  let html = `<div class="pred-scan-header">
    <span class="pred-scan-count">${predictions.length} predicción${predictions.length > 1 ? 'es' : ''}</span>
    <span class="pred-time">Actualizado ${new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span>
  </div>`;

  if (predictions.length > 1) {
    html += `<div class="pred-multi-hint">${openCount > 0
      ? `Hay ${predictions.length} predicciones. Apostá en las ${openCount} abierta${openCount === 1 ? '' : 's'}: cada una suma puntos por separado.`
      : `Hay ${predictions.length} predicciones esperando resultado. Cuando se abra otra, te aviso.`}</div>`;
  }

  predictions.forEach((pred, i) => {
    html += renderOneCard(pred, i);
  });

  setResults(html);
  startCountdowns();
}

// Cuenta regresiva en vivo (actualiza los segundos cada segundo)
function parseClock(str) {
  if (!str) return null;
  const parts = String(str).split(':').map(x => parseInt(x, 10));
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function fmtClock(total) {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function startCountdowns() {
  if (countdownInterval) clearInterval(countdownInterval);
  const tick = () => {
    const els = document.querySelectorAll('[data-countdown]');
    if (!els.length) { clearInterval(countdownInterval); countdownInterval = null; return; }
    els.forEach(el => {
      let s = parseInt(el.getAttribute('data-countdown'), 10);
      if (isNaN(s)) return;
      s = Math.max(0, s - 1);
      el.setAttribute('data-countdown', s);
      if (s <= 0) {
        const card = el.closest('.pred-card');
        if (card) card.remove();
      } else {
        el.textContent = `cierra en ${fmtClock(s)}`;
      }
    });
    const left = document.querySelectorAll('.pred-card');
    if (!left.length) {
      setResults(msgHTML('info', 'No hay predicciones activas', 'Las finalizadas no se muestran. Esperá a que Forg1 abra una nueva.'));
    }
  };
  countdownInterval = setInterval(tick, 1000);
}

function sameLabel(a, b) {
  return String(a || '').toLowerCase().replace(/\s+/g, '') === String(b || '').toLowerCase().replace(/\s+/g, '');
}

function teamInitials(name) {
  const raw = String(name || '').trim();
  if (!raw) return '?';
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function pickCopy(a, predType) {
  const lvl = a?.verdictLevel || 'gray';
  const rec = a?.recommendation || '';
  const p1 = a?.team1?.probability;
  const p2 = a?.team2?.probability;
  const other = a?.team1 && a?.team2
    ? (sameLabel(rec, a.team1.name) ? a.team2.name : a.team1.name)
    : '';
  const vsLine = (p1 != null && p2 != null) ? `${Math.max(p1, p2)}% vs ${Math.min(p1, p2)}%` : '';

  if (predType === 'kills-duel') {
    return {
      kicker: rec ? 'Más propenso' : 'Sin pick',
      title: rec || 'Sin datos',
      meta: a?.mapName ? `En ${a.mapName}` : 'Quién mata más',
      hint: 'Promedio de kills recientes, no es un lock'
    };
  }
  if (predType === 'ot-count') {
    return {
      kicker: rec ? 'Más probable' : 'Sin pick',
      title: rec ? (/^no$/i.test(rec) ? 'Sin OT' : rec + (/^\d$/.test(rec) ? ' OT' : '')) : 'Sin datos',
      meta: a?.mapsSampled ? `${a.mapsSampled} mapas recientes${a.mapName ? ' en ' + a.mapName : ''} de estos equipos` : '',
      hint: 'Según los marcadores reales de sus últimos mapas'
    };
  }
  if (predType === 'kills-range') {
    return {
      kicker: rec ? 'Rango más probable' : 'Sin pick',
      title: rec || 'Sin datos',
      meta: a?.hitRate != null ? `${a.hitRate}% de mapas recientes` : '',
      hint: 'Basado en el promedio del jugador'
    };
  }
  if (lvl === 'green') {
    return {
      kicker: 'Apostar a',
      title: rec,
      meta: other ? `contra ${other} · ventaja sólida` : 'Ventaja sólida',
      hint: 'Conviene si el multiplicador es mayor a 1.2x'
    };
  }
  if (lvl === 'yellow') {
    return {
      kicker: 'Favorito',
      title: rec,
      meta: other ? `contra ${other} · ventaja leve` : 'Ventaja leve',
      hint: 'Apuesta controlada, no all-in'
    };
  }
  if (lvl === 'red') {
    return {
      kicker: 'Skip o mínima',
      title: rec || 'Partido parejo',
      meta: vsLine ? `Solo ${vsLine}` : 'Muy parejo',
      hint: 'Mucho riesgo: skip o apuesta chica'
    };
  }
  return {
    kicker: 'Sin pick claro',
    title: rec && rec !== 'Sin datos' ? rec : 'Insuficientes stats',
    meta: '',
    hint: 'Guiate por el % de la comunidad'
  };
}

// "74%" -> 74. Devuelve null si no es un porcentaje usable.
function pctNumber(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// Forg1 reparte el pozo entre los que aciertan: el pago aproximado es 100 / % de la comunidad.
// Conviene cuando ese pago supera 100 / probabilidad según stats (punto de equilibrio).
function valueLine(statsPct, crowdPct) {
  const p = pctNumber(statsPct);
  const c = pctNumber(crowdPct);
  if (p == null || c == null || p <= 0 || c <= 0 || c >= 100) return null;
  const pays = 100 / c;
  const breakEven = 100 / p;
  const ok = pays >= breakEven;
  return {
    ok,
    html: ok
      ? `Paga <b>~x${pays.toFixed(2)}</b> · conviene desde x${breakEven.toFixed(2)}`
      : `Paga <b>~x${pays.toFixed(2)}</b> · haría falta x${breakEven.toFixed(2)} — no conviene`
  };
}

function renderPickTicket({ level = 'gray', kicker, title, meta, hint, conf, confSub = 'stats', value }) {
  const odds = conf != null ? `<div class="pick-ticket-odds">
      <div class="pick-ticket-odds-num">${conf}<span>%</span></div>
      <div class="pick-ticket-odds-lbl">${esc(confSub)}</div>
    </div>` : '';
  const valueHtml = value
    ? `<div class="pick-ticket-value ${value.ok ? 'ok' : 'bad'}">${value.ok ? '✓' : '✕'} ${value.html}</div>`
    : '';
  return `<div class="pick-ticket ${esc(level)}">
    <div class="pick-ticket-body">
      <div class="pick-ticket-copy">
        <div class="pick-ticket-kicker">${esc(kicker)}</div>
        <div class="pick-ticket-team">${esc(title)}</div>
        ${meta ? `<div class="pick-ticket-sub">${esc(meta)}</div>` : ''}
      </div>
      ${odds}
    </div>
    ${valueHtml}
    ${hint && !value ? `<div class="pick-ticket-hint">${esc(hint)}</div>` : ''}
  </div>`;
}

function renderPickHero(a, predType, options = []) {
  if (!a) return '';
  const copy = pickCopy(a, predType);
  const conf = a.confidence != null ? a.confidence : (a.hitRate != null ? a.hitRate : null);
  const confSub = predType === 'kills-range' && a.hitRate != null ? 'de mapas' : 'según stats';

  let value = null;
  const lvl = a.verdictLevel || 'gray';
  if ((predType === 'team-matchup' || predType === 'ot') && a.recommendation && (lvl === 'green' || lvl === 'yellow')) {
    const opt = options.find(o => sameLabel(o.name || o.label, a.recommendation));
    const side = a.team1 && sameLabel(a.recommendation, a.team1.name) ? a.team1
      : (a.team2 && sameLabel(a.recommendation, a.team2.name) ? a.team2 : null);
    value = valueLine(side?.probability ?? a.confidence, opt?.percentage);
  }
  if (predType === 'ot-count' && a.recommendation && (lvl === 'green' || lvl === 'yellow')) {
    const opt = options.find(o => sameLabel(o.name || o.label, a.recommendation));
    value = valueLine(a.confidence, opt?.percentage);
  }

  return renderPickTicket({
    level: lvl,
    kicker: copy.kicker,
    title: copy.title,
    meta: copy.meta,
    hint: copy.hint,
    conf,
    confSub,
    value
  });
}

// Comparación lado a lado: una fila por fuente (stats / comunidad) con barra dividida.
function renderCompare(t1Name, t2Name, rows, pickSide) {
  const usable = rows.filter(r => r.l != null && r.r != null && (r.l + r.r) > 0);
  const rowHtml = usable.map(r => {
    const total = r.l + r.r;
    const wl = Math.round((r.l / total) * 100);
    return `<div class="pick-compare-row">
      <span class="pick-compare-lbl">${esc(r.label)}</span>
      <span class="pick-compare-num l${pickSide === 'l' ? ' win' : ''}">${Math.round(r.l)}%</span>
      <div class="pick-compare-bar">
        <i class="l${pickSide === 'l' ? ' win' : ''}" style="width:${wl}%"></i>
        <i class="r${pickSide === 'r' ? ' win' : ''}" style="width:${100 - wl}%"></i>
      </div>
      <span class="pick-compare-num r${pickSide === 'r' ? ' win' : ''}">${Math.round(r.r)}%</span>
    </div>`;
  }).join('');

  return `<div class="pick-compare">
    <div class="pick-compare-teams">
      <span class="pick-compare-team${pickSide === 'l' ? ' win' : ''}">${esc(t1Name)}${pickSide === 'l' ? '<em>PICK</em>' : ''}</span>
      <span class="pick-compare-vs">vs</span>
      <span class="pick-compare-team r${pickSide === 'r' ? ' win' : ''}">${pickSide === 'r' ? '<em>PICK</em>' : ''}${esc(t2Name)}</span>
    </div>
    ${rowHtml || '<div class="pick-compare-empty">Sin porcentajes todavía</div>'}
  </div>`;
}

function renderOneCard(pred, i) {
  const a = pred.analysis;
  const predType = pred.predType || 'team-matchup';
  const options = pred.options || pred.teams || [];
  const t1Name = options[0]?.name || a?.team1?.name || 'Opción 1';
  const t2Name = options[1]?.name || a?.team2?.name || 'Opción 2';

  let html = `<div class="pred-card">`;

  const status = pred.status || 'OPEN';
  const secs = parseClock(pred.closesAt);
  let timerHtml = '';

  if (status === 'WAITING_RESULT') {
    timerHtml = `<span class="pred-card-timer closed">🔒 Esperando resultado</span>`;
  } else if (status === 'RESOLVED') {
    timerHtml = `<span class="pred-card-timer resolved">🏁 Finalizada</span>`;
  } else if (status === 'UNKNOWN') {
    timerHtml = `<span class="pred-card-timer unknown">ℹ️ No determinado</span>`;
  } else if (secs != null) {
    timerHtml = `<span class="pred-card-timer" data-countdown="${secs}">cierra en ${fmtClock(secs)}</span>`;
  } else if (pred.closesAt) {
    timerHtml = `<span class="pred-card-timer">cierra ${esc(pred.closesAt)}</span>`;
  }

  const eventName = a?.sharedEvent || '';
  const mapBadge = pred.mapNumber != null ? `<span class="badge" style="background:rgba(255,255,255,0.08);padding:2px 6px;border-radius:4px;font-size:11px;margin-right:6px;">Mapa ${pred.mapNumber}${pred.mapName ? ` · ${esc(pred.mapName)}` : ''}</span>` : '';
  const seriesBadge = (pred.seriesScore && (pred.seriesScore.team1 > 0 || pred.seriesScore.team2 > 0)) ? `<span class="badge" style="background:rgba(83,252,24,0.12);color:#53fc18;padding:2px 6px;border-radius:4px;font-size:11px;">Serie ${pred.seriesScore.team1}-${pred.seriesScore.team2}${pred.format && pred.format !== 'UNKNOWN' ? ` (${pred.format})` : ''}</span>` : '';

  html += `<div class="pred-card-head">
    <span class="pred-card-q">${esc(pred.question || 'Predicción ' + (i + 1))}</span>
    ${timerHtml}
  </div>
  ${(mapBadge || seriesBadge) ? `<div style="display:flex;gap:6px;margin:4px 0 8px 0;">${mapBadge}${seriesBadge}</div>` : ''}
  ${eventName ? `<div class="pred-card-event">🏆 ${esc(eventName)}</div>` : ''}`;

  const hasData = a && a.dataQuality && a.dataQuality !== 'none';
  const isTeamMatchup = predType === 'team-matchup' || predType === 'ot';

  // Recomendación / advertencia según el tipo y estado
  if (status === 'WAITING_RESULT') {
    html += renderPickTicket({
      level: 'gray', kicker: 'Cerrada', title: 'Esperando resultado',
      hint: 'Ya no se aceptan apuestas para este partido.', initials: '—'
    });
  } else if (pred.markets && pred.markets.length > 1) {
    html += renderPickTicket({
      level: 'gray', kicker: 'Varios mercados', title: `${pred.markets.length} mercados`,
      hint: 'Guiate por los porcentajes de la comunidad en cada uno.', initials: String(pred.markets.length)
    });
  } else if (isTeamMatchup && hasData && a.recommendation) {
    html += renderPickHero(a, predType, options);
  } else if (predType === 'kills-duel') {
    if (a && a.kind === 'kills-duel' && a.dataQuality && a.dataQuality !== 'none' && a.recommendation) {
      html += renderPickHero(a, predType);
    } else {
      html += renderPickTicket({
        level: 'gray', kicker: 'Quién mata más', title: 'Sin promedio aún',
        hint: 'Todavía no hay kills recientes de estos jugadores. Guiate por el % de la comunidad.', initials: 'KD'
      });
    }
  } else if (predType === 'kills-range') {
    if (a && a.kind === 'kills' && a.dataQuality && a.dataQuality !== 'none' && a.recommendation) {
      html += renderPickHero(a, predType);
    } else {
      html += renderPickTicket({
        level: 'gray', kicker: 'Kills', title: 'Sin promedio aún',
        hint: 'No hay promedio del jugador todavía. Guiate por el % de la comunidad.', initials: 'K'
      });
    }
  } else if (predType === 'ot-count') {
    if (a && a.kind === 'ot' && a.recommendation) {
      html += renderPickHero(a, predType, options);
    } else {
      html += renderPickTicket({
        level: 'gray', kicker: '¿Hay OT?', title: 'Sin marcadores',
        hint: (a && a.verdict) || 'Todavía no se buscaron stats. Tocá "Escanear Forg1" para analizarla.'
      });
    }
  } else if (predType === 'yes-no') {
    html += renderPickTicket({
      level: 'gray', kicker: 'Sí / No', title: 'Sin modelo de stats',
      hint: 'Guiate por el porcentaje de la comunidad.', initials: '?'
    });
  } else if (!isTeamMatchup || !hasData) {
    html += renderPickTicket({
      level: 'gray', kicker: 'Sin stats',
      title: a ? 'Equipos sin datos' : 'Sin analizar',
      hint: a
        ? 'No aparecen en HLTV, BO3.gg ni en el ranking de Valve. Guiate por el % de la comunidad.'
        : 'Todavía no se buscaron stats. Tocá "Escanear Forg1" para analizarla.'
    });
  }

  // Visualización de opciones / mercados
  if (pred.markets && pred.markets.length > 1) {
    html += `<div class="pred-multi-markets" style="display:flex;flex-direction:column;gap:12px;margin:12px 0;">`;
    for (let mi = 0; mi < pred.markets.length; mi++) {
      const m = pred.markets[mi];
      const mSelections = m.selections || [];
      html += `<div class="pred-market-group" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px;">`;
      html += `<div style="font-weight:600;font-size:13px;margin-bottom:8px;color:#e0e0e0;">📌 ${esc(m.question)}</div>`;
      html += `<div class="pred-options-list">`;
      for (const opt of mSelections) {
        const pctNum = parseInt(opt.percentage) || 0;
        html += `<div class="pred-option-row">
          <span class="pred-option-name">${esc(opt.name || opt.label)}</span>
          <div class="pred-option-bar-wrap">
            <div class="pred-option-bar" style="width:${pctNum}%"></div>
          </div>
          <span class="pred-option-pct crowd">${esc(opt.percentage || '—')}</span>
        </div>`;
      }
      html += `</div></div>`;
    }
    html += `</div>`;
  } else if (predType === 'kills-range' || predType === 'kills-duel' || predType === 'ot-count' || options.length > 2) {
    html += `<div class="pred-options-list">`;
    const duelPlayers = (a && a.kind === 'kills-duel' && a.players) ? a.players : [];
    const otProbs = (a && a.kind === 'ot' && a.optionProbs) ? a.optionProbs : [];
    for (const opt of options) {
      const pctNum = parseInt(opt.percentage) || 0;
      const rec = a && a.recommendation && a.recommendation === opt.name && (a.kind === 'kills' || a.kind === 'kills-duel' || a.kind === 'ot');
      const duel = duelPlayers.find(p => p.name === opt.name);
      const ot = otProbs.find(p => p.label === opt.name);
      const extra = duel && duel.avgKills != null ? ` · ${duel.avgKills} k/mapa`
        : (ot ? ` · stats ${ot.probability}%` : '');
      html += `<div class="pred-option-row${rec ? ' rec' : ''}">
        <span class="pred-option-name">${esc(opt.name)}${rec ? ' · pick' : ''}${extra}</span>
        <div class="pred-option-bar-wrap">
          <div class="pred-option-bar" style="width:${pctNum}%"></div>
        </div>
        <span class="pred-option-pct crowd">${esc(opt.percentage || '—')}</span>
      </div>`;
    }
    html += `</div>`;
  } else {
    // Dos opciones: comparación stats vs comunidad
    const rec = a && a.recommendation;
    const lvl = a?.verdictLevel;
    const hasPick = rec && (lvl === 'green' || lvl === 'yellow');
    const pickSide = hasPick ? (sameLabel(rec, t1Name) ? 'l' : (sameLabel(rec, t2Name) ? 'r' : '')) : '';
    // Las probabilidades de stats vienen por nombre de equipo, no por posición.
    const statFor = (name) => {
      if (a?.team1 && sameLabel(a.team1.name, name)) return a.team1.probability ?? null;
      if (a?.team2 && sameLabel(a.team2.name, name)) return a.team2.probability ?? null;
      return null;
    };
    let s1 = statFor(t1Name), s2 = statFor(t2Name);
    if (s1 == null && s2 == null) { s1 = a?.team1?.probability ?? null; s2 = a?.team2?.probability ?? null; }
    html += renderCompare(t1Name, t2Name, [
      { label: 'Stats', l: hasData ? s1 : null, r: hasData ? s2 : null },
      { label: 'Comunidad', l: pctNumber(options[0]?.percentage), r: pctNumber(options[1]?.percentage) }
    ], pickSide);
  }

  if (predType === 'ot-count' && a && a.kind === 'ot' && a.factors && a.factors.length) {
    html += `<div class="pred-section">
      <div class="pred-section-title">Overtimes recientes (HLTV)</div>
      <div class="pred-factors">${a.factors.map(f => `<div class="pred-factor">${esc(f)}</div>`).join('')}</div>
    </div>`;
  }

  if (predType === 'kills-duel' && a && a.kind === 'kills-duel' && a.dataQuality && a.dataQuality !== 'none') {
    html += `<div class="pred-section">
      <div class="pred-section-title">Kills por mapa${a.mapName ? ` · ${esc(a.mapName)}` : ''} (HLTV)</div>
      <div class="pred-factors">${(a.factors || []).map(f => `<div class="pred-factor">${esc(f)}</div>`).join('')}</div>
    </div>`;
  }

  if (predType === 'kills-range' && a && a.kind === 'kills' && a.dataQuality && a.dataQuality !== 'none') {
    html += `<div class="pred-section">
      <div class="pred-section-title">Kills de ${esc(a.playerName || pred.playerName || 'jugador')} (HLTV)</div>
      <div class="pred-factors">
        <div class="pred-factor">Promedio: <strong>${a.avgKills}</strong> kills/mapa · últimos ${a.mapsSampled}</div>
        ${a.typicalLow != null ? `<div class="pred-factor">Rango habitual: ${a.typicalLow}–${a.typicalHigh}</div>` : ''}
        ${(a.factors || []).map(f => `<div class="pred-factor">${esc(f)}</div>`).join('')}
      </div>
    </div>`;
  }

  // Stats detalladas (para matchups con datos)
  if (isTeamMatchup && hasData) {
    const srcBadge = a.source === 'bo3gg' ? 'BO3.gg' : (a.source === 'vrs' ? 'Ranking Valve' : 'HLTV');
    const stats = buildStatsRows(a);
    if (stats) {
      html += `<div class="pred-section">
        <div class="pred-section-title">Estadísticas (${srcBadge})</div>
        <div class="pred-stats">${stats}</div>
      </div>`;
    }

    if (a.factors && a.factors.length) {
      html += `<div class="pred-section">
        <div class="pred-section-title">Por qué</div>
        <div class="pred-factors">${a.factors.map(f => `<div class="pred-factor">${esc(f)}</div>`).join('')}</div>
      </div>`;
    }

    // Últimos 5 partidos por equipo
    const fmtForm = (matches, teamName) => {
      if (!Array.isArray(matches) || !matches.length) return '';
      const rows = matches.slice(0, 5).map(m => {
        const cls = m.won ? 'win' : 'loss';
        const icon = m.won ? '✅' : '❌';
        const score = m.score ? `<span class="form-score">${esc(m.score)}</span>` : '';
        const opp = m.opponent ? `<span class="form-opp">vs ${esc(m.opponent)}</span>`
          : (m.event ? `<span class="form-opp">${esc(m.event)}</span>` : '');
        return `<div class="form-row ${cls}">${icon}${score}${opp}</div>`;
      }).join('');
      return `<div class="form-team"><div class="form-team-name">${esc(teamName)}</div>${rows}</div>`;
    };
    const f1 = fmtForm(a.recentMatches1, a.team1?.name || options[0]?.name || '');
    const f2 = fmtForm(a.recentMatches2, a.team2?.name || options[1]?.name || '');
    if (f1 || f2) {
      html += `<div class="pred-section">
        <div class="pred-section-title">Últimos 5 partidos</div>
        <div class="pred-form">${f1}${f2}</div>
      </div>`;
    }

    // Roster & Jugadores clave
    const ros1 = a.roster1 || a.team1?.data?.roster;
    const ros2 = a.roster2 || a.team2?.data?.roster;
    if (ros1 || ros2) {
      const renderRosterCol = (teamName, ros) => {
        if (!ros) return `<div class="roster-col"><div class="form-team-name">${esc(teamName)}</div><div style="font-size:0.75rem;color:var(--text-tertiary);">Sin datos de roster</div></div>`;
        const avgBadge = ros.avgRating ? `<span class="badge-rating" title="Rating promedio activo">⭐ ${ros.avgRating} avg</span>` : '';
        const star = ros.starPlayer ? `<div class="roster-highlight">⭐ <strong>${esc(ros.starPlayer.nickname)}</strong> (${ros.starPlayer.rating} rating)</div>` : '';
        const newP = ros.newPlayer ? `<div class="roster-highlight new">🔥 <strong>${esc(ros.newPlayer.nickname)}</strong> ${ros.newPlayer.rating ? `(${ros.newPlayer.rating} rating)` : ''} · Refuerzo</div>` : '';
        const pList = (ros.players || []).map(p => `<span class="roster-tag">${esc(p.nickname)}${p.rating ? ` <em>${p.rating}</em>` : ''}</span>`).join('');
        return `<div class="roster-col">
          <div class="roster-header">
            <strong>${esc(teamName)}</strong>
            ${avgBadge}
          </div>
          ${newP || star}
          <div class="roster-tags">${pList}</div>
        </div>`;
      };
      html += `<div class="pred-section">
        <div class="pred-section-title">Roster & Nivel Individual (BO3.gg)</div>
        <div class="pred-roster-grid">${renderRosterCol(t1Name, ros1)}${renderRosterCol(t2Name, ros2)}</div>
      </div>`;
    }
  }

  html += `</div>`;
  return html;
}

function buildStatsRows(a) {
  const d1 = a.team1.data, d2 = a.team2.data;
  let rows = '';

  const r1 = d1?.ranking, r2 = d2?.ranking;
  if (r1 || r2) {
    rows += statRow('Ranking', r1 ? '#' + r1 : '—', r2 ? '#' + r2 : '—',
      (r1 && r2) ? (r1 < r2 ? 'l' : 'r') : '');
  }

  const w1 = d1?.winrate, w2 = d2?.winrate;
  if (w1 != null || w2 != null) {
    rows += statRow('Winrate reciente', w1 != null ? w1 + '%' : '—', w2 != null ? w2 + '%' : '—',
      (w1 != null && w2 != null) ? (w1 > w2 ? 'l' : 'r') : '');
  }

  if (a.roster1?.avgRating && a.roster2?.avgRating) {
    rows += statRow('Rating Roster', a.roster1.avgRating, a.roster2.avgRating,
      a.roster1.avgRating > a.roster2.avgRating ? 'l' : (a.roster2.avgRating > a.roster1.avgRating ? 'r' : ''));
  }

  if (d1 && d2 && (d1.wins + d1.losses > 0 || d2.wins + d2.losses > 0)) {
    rows += statRow('Últimos 10', `${d1.wins}V-${d1.losses}D`, `${d2.wins}V-${d2.losses}D`,
      d1.wins > d2.wins ? 'l' : (d2.wins > d1.wins ? 'r' : ''));
  }

  // Forma en la competencia
  const ev = (d1 && d1.event) || (d2 && d2.event) || '';
  if (ev && ((d1 && d1.eventTotal > 0) || (d2 && d2.eventTotal > 0))) {
    const v1 = (d1 && d1.eventTotal > 0) ? `${d1.eventWins}V-${d1.eventLosses}D` : '—';
    const v2 = (d2 && d2.eventTotal > 0) ? `${d2.eventWins}V-${d2.eventLosses}D` : '—';
    const label = ev.length > 22 ? ev.slice(0, 22) + '…' : ev;
    const better = (d1 && d2 && d1.eventTotal > 0 && d2.eventTotal > 0)
      ? ((d1.eventWins - d1.eventLosses) > (d2.eventWins - d2.eventLosses) ? 'l'
        : ((d2.eventWins - d2.eventLosses) > (d1.eventWins - d1.eventLosses) ? 'r' : ''))
      : '';
    rows += statRow(label, v1, v2, better);
  }

  if (a.h2h && a.h2h.total > 0) {
    rows += statRow('Head to head', `${a.h2h.team1Wins}`, `${a.h2h.team2Wins}`,
      a.h2h.team1Wins > a.h2h.team2Wins ? 'l' : (a.h2h.team2Wins > a.h2h.team1Wins ? 'r' : ''));
  }

  return rows;
}

function statRow(label, v1, v2, better) {
  return `<div class="pred-stat">
    <span class="pred-stat-v ${better === 'l' ? 'win' : ''}">${v1}</span>
    <span class="pred-stat-l">${label}</span>
    <span class="pred-stat-v ${better === 'r' ? 'win' : ''}">${v2}</span>
  </div>`;
}

// --- Helpers ---
function setResults(html) { document.getElementById('analysisResults').innerHTML = html; }
function setBusy(b) {
  const btn = document.getElementById('scanForg1Btn');
  if (!btn) return;
  btn.disabled = b;
  btn.classList.toggle('loading', b);
  if (b) {
    btn.innerHTML = `<span class="btn-loader-spinner"></span> Escaneando...`;
  } else {
    btn.innerHTML = `<svg width="18" height="18" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"/></svg> Escanear Forg1`;
  }
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function loadingHTML(title, sub) {
  return `<div class="pred-loading"><div class="pred-spinner"></div><div class="pred-loading-title">${title}</div><div class="pred-loading-sub">${sub}</div></div>`;
}

function msgHTML(type, title, body) {
  return `<div class="pred-msg pred-msg-${type}"><div class="pred-msg-title">${title}</div>${body ? `<div class="pred-msg-body">${body}</div>` : ''}</div>`;
}

document.addEventListener('DOMContentLoaded', initPredictions);
