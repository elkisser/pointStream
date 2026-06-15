// ============================================================
// Predicciones CS2 — UI
// ============================================================

let predBusy = false;
let monitoring = false;

function initPredictions() {
  document.getElementById('scanForg1Btn').addEventListener('click', doScan);
  document.getElementById('loginForg1Btn').addEventListener('click', doLogin);
  document.getElementById('connectHltvBtn').addEventListener('click', () => window.predictionsAPI.connectHLTV());
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
}

// --- Monitoreo de predicciones ---
async function toggleMonitoring() {
  if (monitoring) {
    await window.predictionsAPI.stopMonitoring();
    setMonitoring(false);
    return;
  }

  const btn = document.getElementById('monitorPredBtn');
  btn.disabled = true;
  const res = await window.predictionsAPI.startMonitoring({ interval: 60 });
  btn.disabled = false;

  if (res.success) {
    setMonitoring(true);
    if (predBusy) return;
    // Mostrar lo que haya ahora mismo
    doScan();
  } else if (res.error === 'not-logged-in') {
    setMonitoring(false);
    setResults(msgHTML('warning', 'No estás logueado en Forg1', 'Tocá "Login Forg1", iniciá sesión, cerrá esa ventana y volvé a activar el monitoreo.'));
  } else {
    setMonitoring(false);
    setResults(msgHTML('error', 'No se pudo iniciar el monitoreo', res.message || res.error || ''));
  }
}

function setMonitoring(on) {
  monitoring = on;
  const btn = document.getElementById('monitorPredBtn');
  btn.classList.toggle('active', on);
  btn.querySelector('.pred-mon-label').textContent = on ? 'Monitoreando' : 'Monitorear';
}

// Llega cuando el monitor del backend detecta cambios
function handleMonitorUpdate(data) {
  if (!data) return;

  if (data.loggedIn === false) {
    setMonitoring(false);
    setResults(msgHTML('warning', 'Sesión de Forg1 cerrada', 'Volvé a loguearte para seguir monitoreando.'));
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
        setResults(msgHTML('warning', 'No estás logueado en Forg1', 'Tocá "Login Forg1", iniciá sesión, cerrá esa ventana y volvé a escanear.'));
      } else {
        setResults(msgHTML('error', 'Algo falló', res.error));
      }
      return;
    }

    const { predictions } = res.data;
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

async function doLogin() { await window.predictionsAPI.openForg1Login(); }

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
  const t1Name = pred.teams[0]?.name || a?.team1?.name || 'Equipo 1';
  const t2Name = pred.teams[1]?.name || a?.team2?.name || 'Equipo 2';

  let html = `<div class="pred-card">`;

  // Header: la pregunta (de qué es la predicción) + cuenta regresiva en vivo
  const secs = parseClock(pred.closesAt);
  const timerHtml = secs != null
    ? `<span class="pred-card-timer" data-countdown="${secs}">cierra en ${fmtClock(secs)}</span>`
    : (pred.closesAt ? `<span class="pred-card-timer">cierra ${esc(pred.closesAt)}</span>` : '');

  html += `<div class="pred-card-head">
    <span class="pred-card-q">${esc(pred.question || 'Predicción ' + (i + 1))}</span>
    ${timerHtml}
  </div>`;

  const hasData = a && a.dataQuality && a.dataQuality !== 'none';

  // RECOMENDACIÓN primero (lo más importante)
  if (hasData && a.recommendation) {
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
  } else {
    // Sin datos de HLTV: ser claro, no inventar
    html += `<div class="pred-verdict gray">
      <div class="pred-verdict-icon">ℹ️</div>
      <div class="pred-verdict-body">
        <div class="pred-verdict-text">No pude traer estadísticas de HLTV para estos equipos. Tocá <strong>"Conectar HLTV"</strong> una vez, pasá la verificación de Cloudflare, cerrá esa ventana y volvé a escanear. Mientras tanto, guiate por el porcentaje de la comunidad.</div>
      </div>
    </div>`;
  }

  // Probabilidad calculada con estadísticas
  const p1 = a?.team1?.probability ?? null;
  const p2 = a?.team2?.probability ?? null;
  const crowd1 = pred.teams[0]?.percentage || '—';
  const crowd2 = pred.teams[1]?.percentage || '—';

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

  // Barra de probabilidad (stats)
  if (p1 != null && p2 != null) {
    html += `<div class="pred-prob-bar">
      <div class="pred-prob-fill" style="width:${p1}%"></div>
      <span class="pred-prob-left">${p1}%</span>
      <span class="pred-prob-right">${p2}%</span>
    </div>`;
  }

  // Stats detalladas
  if (hasData) {
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
  btn.disabled = b;
  btn.classList.toggle('loading', b);
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function loadingHTML(title, sub) {
  return `<div class="pred-loading"><div class="pred-spinner"></div><div class="pred-loading-title">${title}</div><div class="pred-loading-sub">${sub}</div></div>`;
}

function msgHTML(type, title, body) {
  return `<div class="pred-msg pred-msg-${type}"><div class="pred-msg-title">${title}</div>${body ? `<div class="pred-msg-body">${body}</div>` : ''}</div>`;
}

document.addEventListener('DOMContentLoaded', initPredictions);
