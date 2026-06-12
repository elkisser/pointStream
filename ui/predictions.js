// ============================================================
// Predicciones CS2 — UI
// ============================================================

let predBusy = false;

function initPredictions() {
  document.getElementById('scanForg1Btn').addEventListener('click', doScan);
  document.getElementById('loginForg1Btn').addEventListener('click', doLogin);
  document.getElementById('manualAnalyzeBtn').addEventListener('click', doManual);

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

    const { predictions, raw, message } = res.data;
    if (!predictions || predictions.length === 0) {
      let extra = '';
      if (raw) extra = `<details class="raw-details"><summary>Ver lo que leí de la página</summary><pre>${esc(raw.substring(0, 1500))}</pre></details>`;
      setResults(msgHTML('warning', 'No hay predicciones abiertas', message || 'Esperá a que abra una nueva y volvé a escanear.') + extra);
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
        analysis: res.data,
        crowdVsData: null
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
function renderCards(predictions) {
  let html = `<div class="pred-scan-header">
    <span class="pred-scan-count">${predictions.length} predicción${predictions.length > 1 ? 'es' : ''}</span>
    <span class="pred-time">Actualizado ${new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span>
  </div>`;

  predictions.forEach((pred, i) => {
    html += renderOneCard(pred, i);
  });

  setResults(html);
}

function renderOneCard(pred, i) {
  const a = pred.analysis;
  const c = pred.crowdVsData;
  const t1Name = pred.teams[0]?.name || a?.team1?.name || 'Equipo 1';
  const t2Name = pred.teams[1]?.name || a?.team2?.name || 'Equipo 2';

  let html = `<div class="pred-card">`;

  // Header
  html += `<div class="pred-card-head">
    <span class="pred-card-q">${esc(pred.question || 'Predicción ' + (i + 1))}</span>
    ${pred.closesAt ? `<span class="pred-card-timer">cierra ${pred.closesAt}</span>` : ''}
  </div>`;

  // VERDICT primero (lo más importante)
  if (a && a.verdict) {
    const lvl = a.verdictLevel || 'gray';
    const icon = lvl === 'green' ? '✅' : lvl === 'yellow' ? '⚠️' : lvl === 'red' ? '🛑' : 'ℹ️';
    const pick = a.recommendation && lvl !== 'gray' ? `<div class="pred-pick">Apostar a <strong>${esc(a.recommendation)}</strong></div>` : '';
    html += `<div class="pred-verdict ${lvl}">
      <div class="pred-verdict-icon">${icon}</div>
      <div class="pred-verdict-body">
        ${pick}
        <div class="pred-verdict-text">${esc(a.verdict)}</div>
      </div>
    </div>`;
  }

  // Comparador grande: Forg1 crowd vs HLTV
  const p1 = a?.team1?.probability ?? null;
  const p2 = a?.team2?.probability ?? null;
  const crowd1 = pred.teams[0]?.percentage || '—';
  const crowd2 = pred.teams[1]?.percentage || '—';

  html += `<div class="pred-versus">
    <div class="pred-vs-team">
      <div class="pred-vs-name">${esc(t1Name)}</div>
      <div class="pred-vs-bars">
        <div class="pred-vs-stat"><span class="lbl">Forg1</span><span class="val crowd">${crowd1}</span></div>
        <div class="pred-vs-stat"><span class="lbl">HLTV</span><span class="val hltv">${p1 != null ? p1 + '%' : '—'}</span></div>
      </div>
    </div>
    <div class="pred-vs-mid">VS</div>
    <div class="pred-vs-team right">
      <div class="pred-vs-name">${esc(t2Name)}</div>
      <div class="pred-vs-bars">
        <div class="pred-vs-stat"><span class="lbl">Forg1</span><span class="val crowd">${crowd2}</span></div>
        <div class="pred-vs-stat"><span class="lbl">HLTV</span><span class="val hltv">${p2 != null ? p2 + '%' : '—'}</span></div>
      </div>
    </div>
  </div>`;

  // Barra HLTV
  if (p1 != null && p2 != null) {
    html += `<div class="pred-prob-bar">
      <div class="pred-prob-fill" style="width:${p1}%"></div>
      <span class="pred-prob-left">${p1}%</span>
      <span class="pred-prob-right">${p2}%</span>
    </div>`;
  }

  // Stats detalladas
  if (a && a.dataQuality !== 'none') {
    const stats = buildStatsRows(a);
    if (stats) {
      html += `<div class="pred-section">
        <div class="pred-section-title">Estadísticas</div>
        <div class="pred-stats">${stats}</div>
      </div>`;
    }

    // Factores
    if (a.factors && a.factors.length) {
      html += `<div class="pred-section">
        <div class="pred-section-title">Por qué</div>
        <div class="pred-factors">${a.factors.map(f => `<div class="pred-factor">${esc(f)}</div>`).join('')}</div>
      </div>`;
    }

    // Map pool
    const mapRows = buildMapRows(a);
    if (mapRows) {
      html += `<div class="pred-section">
        <div class="pred-section-title">Mapas (winrate)</div>
        <div class="pred-stats">${mapRows}</div>
      </div>`;
    }
  }

  // Value (crowd vs datos)
  if (c && c.verdict) {
    html += `<div class="pred-value ${c.hasValue ? 'has-value' : ''}">
      <div class="pred-value-text">${esc(c.verdict)}</div>
    </div>`;
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
    rows += statRow('Winrate', w1 != null ? w1 + '%' : '—', w2 != null ? w2 + '%' : '—',
      (w1 != null && w2 != null) ? (w1 > w2 ? 'l' : 'r') : '');
  }

  if (d1 && d2 && (d1.wins + d1.losses > 0 || d2.wins + d2.losses > 0)) {
    rows += statRow('Forma', `${d1.wins}V-${d1.losses}D`, `${d2.wins}V-${d2.losses}D`,
      d1.wins > d2.wins ? 'l' : (d2.wins > d1.wins ? 'r' : ''));
  }

  if (d1?.streak || d2?.streak) {
    rows += statRow('Racha', fmtStreak(d1?.streak), fmtStreak(d2?.streak), '');
  }

  if (a.h2h && a.h2h.total > 0) {
    rows += statRow('Head to head', `${a.h2h.team1Wins}`, `${a.h2h.team2Wins}`,
      a.h2h.team1Wins > a.h2h.team2Wins ? 'l' : (a.h2h.team2Wins > a.h2h.team1Wins ? 'r' : ''));
  }

  return rows;
}

function buildMapRows(a) {
  const m1 = a.team1.maps || [], m2 = a.team2.maps || [];
  if (!m1.length && !m2.length) return '';
  const names = new Set([...m1.map(x => x.map), ...m2.map(x => x.map)]);
  let rows = '';
  names.forEach(name => {
    const a1 = m1.find(x => x.map === name);
    const a2 = m2.find(x => x.map === name);
    rows += statRow(name,
      a1 ? a1.winrate + '%' : '—',
      a2 ? a2.winrate + '%' : '—',
      (a1 && a2) ? (a1.winrate > a2.winrate ? 'l' : 'r') : '');
  });
  return rows;
}

function fmtStreak(s) {
  if (!s) return '—';
  const n = parseInt(s);
  const type = s.includes('W') ? '🟢' : '🔴';
  return `${n} ${type}`;
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
