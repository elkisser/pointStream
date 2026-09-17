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
    statusEl.innerHTML = cfg.enabled
      ? '✅ <strong>Conectado</strong><br>Recibirás las predicciones en tu chat de Telegram.'
      : '⏸️ <strong>Pausado</strong><br>Activá los avisos en la casilla para recibirlos.';
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
  statusEl.textContent = `Abrí Telegram (se abrió en tu navegador) y tocá Iniciar en el chat con @${res.botUsername}. Esperando…`;

  // Polling: revisar cada 2s si el usuario ya tocó Iniciar (hasta ~90s)
  if (telegramPollTimer) clearInterval(telegramPollTimer);
  let elapsed = 0;
  telegramPollTimer = setInterval(async () => {
    elapsed += 2;
    const poll = await window.telegramAPI.pollLink();
    if (poll.ok && poll.linked) {
      clearInterval(telegramPollTimer);
      telegramPollTimer = null;
      linkBtn.disabled = false;
      refreshTelegramStatus();
      return;
    }
    if (elapsed >= 90) {
      clearInterval(telegramPollTimer);
      telegramPollTimer = null;
      linkBtn.disabled = false;
      statusEl.className = 'telegram-status warn';
      statusEl.textContent = '⚠️ No detecté que iniciaras el chat. Probá de nuevo: tocá el botón y dale Iniciar en Telegram.';
    }
  }, 2000);
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
  if (telegramPollTimer) { clearInterval(telegramPollTimer); telegramPollTimer = null; }
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
    if (predictions && predictions.some(p => p.analysis && p.analysis.dataQuality && p.analysis.dataQuality !== 'none')) {
      hltvActive = true;
      updateHltvBtn(false);
    }

    if (!predictions || predictions.length === 0) {
      setResults(msgHTML('info', 'No hay predicciones activas', monitoring
        ? 'Te avisaré apenas se abra una nueva predicción en Forg1.'
        : 'En este momento no hay ninguna predicción abierta en Forg1. Activá "Monitorear" para recibir un aviso cuando se abra una nueva.'));
      return;
    }

    renderCards(predictions);
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

  try {
    const res = await window.predictionsAPI.analyzeMatch(t1, t2);
    if (res.success) {
      if (res.data && res.data.dataQuality && res.data.dataQuality !== 'none') {
        hltvActive = true;
        updateHltvBtn(false);
      }
      renderCards([{
        question: `${t1} vs ${t2}`,
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

function renderCards(predictions) {
  let html = `<div class="pred-scan-header">
    <span class="pred-scan-count">${predictions.length} predicción${predictions.length > 1 ? 'es' : ''}</span>
    <span class="pred-time">Actualizado ${new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span>
  </div>`;

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
        el.textContent = 'Cerrada';
        el.classList.add('closed');
      } else {
        el.textContent = `cierra en ${fmtClock(s)}`;
      }
    });
  };
  countdownInterval = setInterval(tick, 1000);
}

function renderOneCard(pred, i) {
  const a = pred.analysis;
  const predType = pred.predType || 'team-matchup';
  const options = pred.options || pred.teams || [];
  const t1Name = options[0]?.name || a?.team1?.name || 'Opción 1';
  const t2Name = options[1]?.name || a?.team2?.name || 'Opción 2';

  let html = `<div class="pred-card">`;

  const secs = parseClock(pred.closesAt);
  const timerHtml = secs != null
    ? `<span class="pred-card-timer" data-countdown="${secs}">cierra en ${fmtClock(secs)}</span>`
    : (pred.closesAt ? `<span class="pred-card-timer">cierra ${esc(pred.closesAt)}</span>` : '');

  const eventName = a?.sharedEvent || '';

  html += `<div class="pred-card-head">
    <span class="pred-card-q">${esc(pred.question || 'Predicción ' + (i + 1))}</span>
    ${timerHtml}
  </div>
  ${eventName ? `<div class="pred-card-event">🏆 ${esc(eventName)}</div>` : ''}`;

  const hasData = a && a.dataQuality && a.dataQuality !== 'none';
  const isTeamMatchup = predType === 'team-matchup' || predType === 'ot';

  // Recomendación / advertencia según el tipo
  if (pred.markets && pred.markets.length > 1) {
    html += `<div class="pred-verdict gray">
      <div class="pred-verdict-icon">📋</div>
      <div class="pred-verdict-body">
        <div class="pred-verdict-text">Predicción con ${pred.markets.length} mercados activos. Guiate por los porcentajes de la comunidad para cada uno.</div>
      </div>
    </div>`;
  } else if (isTeamMatchup && hasData && a.recommendation) {
    const lvl = a.verdictLevel || 'gray';
    const icon = lvl === 'green' ? '✅' : lvl === 'yellow' ? '⚠️' : lvl === 'red' ? '🛑' : 'ℹ️';
    const pick = lvl !== 'gray'
      ? `<div class="pred-pick">Apostar a <strong>${esc(a.recommendation)}</strong> · ${a.confidence}%</div>`
      : '';
    html += `<div class="pred-verdict ${lvl}">
      <div class="pred-verdict-icon">${icon}</div>
      <div class="pred-verdict-body">
        ${pick}
        <div class="pred-verdict-text">${esc(a.verdict || '')}</div>
      </div>
    </div>`;
  } else if (predType === 'kills-range') {
    html += `<div class="pred-verdict gray">
      <div class="pred-verdict-icon">🎯</div>
      <div class="pred-verdict-body">
        <div class="pred-verdict-text">Predicción de kills — no hay stats de HLTV para esto. Guiate por el % de la comunidad.</div>
      </div>
    </div>`;
  } else if (predType === 'yes-no') {
    html += `<div class="pred-verdict gray">
      <div class="pred-verdict-icon">🤔</div>
      <div class="pred-verdict-body">
        <div class="pred-verdict-text">Predicción de Sí/No — guiate por el % de la comunidad.</div>
      </div>
    </div>`;
  } else if (!isTeamMatchup || !hasData) {
    html += `<div class="pred-verdict gray">
      <div class="pred-verdict-icon">ℹ️</div>
      <div class="pred-verdict-body">
        <div class="pred-verdict-text">Sin estadísticas de HLTV. Tocá <strong>"Conectar HLTV"</strong> una vez, pasá la verificación y volvé a escanear.</div>
      </div>
    </div>`;
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
  } else if (predType === 'kills-range' || options.length > 2) {
    // Múltiples opciones: tabla simple
    html += `<div class="pred-options-list">`;
    for (const opt of options) {
      const pctNum = parseInt(opt.percentage) || 0;
      html += `<div class="pred-option-row">
        <span class="pred-option-name">${esc(opt.name)}</span>
        <div class="pred-option-bar-wrap">
          <div class="pred-option-bar" style="width:${pctNum}%"></div>
        </div>
        <span class="pred-option-pct crowd">${esc(opt.percentage || '—')}</span>
      </div>`;
    }
    html += `</div>`;
  } else {
    // Dos opciones: layout VS clásico
    const p1 = a?.team1?.probability ?? null;
    const p2 = a?.team2?.probability ?? null;
    const crowd1 = options[0]?.percentage || '—';
    const crowd2 = options[1]?.percentage || '—';

    html += `<div class="pred-versus">
      <div class="pred-vs-team">
        <div class="pred-vs-name">${esc(t1Name)}</div>
        <div class="pred-vs-bars">
          <div class="pred-vs-stat"><span class="lbl">Comunidad</span><span class="val crowd">${esc(crowd1)}</span></div>
          <div class="pred-vs-stat"><span class="lbl">Stats</span><span class="val hltv">${p1 != null ? p1 + '%' : '—'}</span></div>
        </div>
      </div>
      <div class="pred-vs-mid">VS</div>
      <div class="pred-vs-team right">
        <div class="pred-vs-name">${esc(t2Name)}</div>
        <div class="pred-vs-bars">
          <div class="pred-vs-stat"><span class="lbl">Comunidad</span><span class="val crowd">${esc(crowd2)}</span></div>
          <div class="pred-vs-stat"><span class="lbl">Stats</span><span class="val hltv">${p2 != null ? p2 + '%' : '—'}</span></div>
        </div>
      </div>
    </div>`;

    if (p1 != null && p2 != null) {
      html += `<div class="pred-prob-bar">
        <div class="pred-prob-fill" style="width:${p1}%"></div>
        <span class="pred-prob-left">${p1}%</span>
        <span class="pred-prob-right">${p2}%</span>
      </div>`;
    }
  }

  // Stats detalladas (solo para matchups con datos HLTV)
  if (isTeamMatchup && hasData) {
    const stats = buildStatsRows(a);
    if (stats) {
      html += `<div class="pred-section">
        <div class="pred-section-title">Estadísticas</div>
        <div class="pred-stats">${stats}</div>
      </div>`;
    }

    if (a.factors && a.factors.length) {
      html += `<div class="pred-section">
        <div class="pred-section-title">Por qué</div>
        <div class="pred-factors">${a.factors.map(f => `<div class="pred-factor">${esc(f)}</div>`).join('')}</div>
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
