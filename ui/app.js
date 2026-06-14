// Estado de la aplicación
const state = {
  streamers: ['baldu', 'forg1'], // Streamers por defecto
  streams: new Map(),
  isMonitoring: false,
  startTime: null,
  streamsDetected: 0,
  config: {
    interval: 60,
    autoOpen: true,
    notifications: true,
    minimize: false,
    platform: 'kick' // 'kick' | 'twitch'
  }
};

// Elementos del DOM
const elements = {
  streamerInput: document.getElementById('streamerInput'),
  addStreamerBtn: document.getElementById('addStreamerBtn'),
  streamersList: document.getElementById('streamersList'),
  intervalSlider: document.getElementById('intervalSlider'),
  intervalValue: document.getElementById('intervalValue'),
  autoOpenCheck: document.getElementById('autoOpenCheck'),
  notificationsCheck: document.getElementById('notificationsCheck'),
  minimizeCheck: document.getElementById('minimizeCheck'),
  toggleMonitorBtn: document.getElementById('toggleMonitorBtn'),
  globalStatus: document.getElementById('globalStatus'),
  emptyState: document.getElementById('emptyState'),
  streamsGrid: document.getElementById('streamsGrid'),
  logContent: document.getElementById('logContent'),
  clearLogBtn: document.getElementById('clearLogBtn'),
  statTime: document.getElementById('statTime'),
  statStreams: document.getElementById('statStreams'),
  statLive: document.getElementById('statLive'),
  liveCountBadge: document.getElementById('liveCountBadge'),
  platformSwitch: document.getElementById('platformSwitch')
};

// ============================================================
// Inicialización
// ============================================================

function init() {
  setupEventListeners();
  setupWindowControls();
  applyPlatformTheme();
  renderStreamersList();
  updateUI();
  logMessage('Aplicación iniciada', 'info');
  
  // Cargar streamers iniciales
  state.streamers.forEach(name => {
    state.streams.set(name, { isLive: false });
  });
  
  renderStreamsGrid();
}

function setupEventListeners() {
  // Agregar streamer
  elements.addStreamerBtn.addEventListener('click', addStreamer);
  elements.streamerInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addStreamer();
  });
  
  // Slider de intervalo
  elements.intervalSlider.addEventListener('input', (e) => {
    state.config.interval = parseInt(e.target.value);
    elements.intervalValue.textContent = `${e.target.value}s`;
  });
  
  // Checkboxes
  elements.autoOpenCheck.addEventListener('change', (e) => {
    state.config.autoOpen = e.target.checked;
  });
  
  elements.notificationsCheck.addEventListener('change', (e) => {
    state.config.notifications = e.target.checked;
  });
  
  elements.minimizeCheck.addEventListener('change', (e) => {
    state.config.minimize = e.target.checked;
  });
  
  // Toggle monitor
  elements.toggleMonitorBtn.addEventListener('click', toggleMonitoring);
  
  // Switch de plataforma (Kick / Twitch)
  if (elements.platformSwitch) {
    elements.platformSwitch.querySelectorAll('.platform-btn').forEach(btn => {
      btn.addEventListener('click', () => switchPlatform(btn.dataset.platform));
    });
  }
  
  // Clear log
  elements.clearLogBtn.addEventListener('click', clearLog);
  
  // Escuchar actualizaciones de streams
  window.kickAPI.onStreamUpdate((data) => {
    handleStreamUpdate(data);
  });
}

// ============================================================
// Controles de ventana (barra de título personalizada)
// ============================================================

function setupWindowControls() {
  if (!window.windowAPI) return;

  const titlebar = document.getElementById('titlebar');
  const minBtn = document.getElementById('winMin');
  const maxBtn = document.getElementById('winMax');
  const closeBtn = document.getElementById('winClose');

  if (minBtn) minBtn.addEventListener('click', () => window.windowAPI.minimize());
  if (closeBtn) closeBtn.addEventListener('click', () => window.windowAPI.close());
  if (maxBtn) maxBtn.addEventListener('click', () => window.windowAPI.maximize());

  // Doble click en la barra para maximizar/restaurar
  const dragZone = titlebar ? titlebar.querySelector('.titlebar-drag') : null;
  if (dragZone) {
    dragZone.addEventListener('dblclick', () => window.windowAPI.maximize());
  }

  // Reflejar el estado maximizado en el ícono del botón
  const reflectState = (maximized) => {
    if (!titlebar) return;
    titlebar.classList.toggle('maximized', !!maximized);
    if (maxBtn) maxBtn.title = maximized ? 'Restaurar' : 'Maximizar';
  };

  window.windowAPI.onStateChange((data) => reflectState(data.maximized));
  window.windowAPI.isMaximized().then(reflectState).catch(() => {});
}

// ============================================================
// Plataforma (Kick / Twitch)
// ============================================================

const PLATFORM_LABELS = { kick: 'Kick', twitch: 'Twitch' };

function applyPlatformTheme() {
  document.body.setAttribute('data-platform', state.config.platform);

  // Marcar el botón activo
  if (elements.platformSwitch) {
    elements.platformSwitch.querySelectorAll('.platform-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.platform === state.config.platform);
    });
  }

  // Actualizar subtítulo del header con la plataforma activa
  const subtitle = document.querySelector('.header .subtitle');
  if (subtitle) {
    subtitle.textContent = `Streams en vivo · ${PLATFORM_LABELS[state.config.platform]}`;
  }
}

function switchPlatform(platform) {
  if (!platform || platform === state.config.platform) return;

  // No permitir cambiar mientras se monitorea (evita estados mezclados)
  if (state.isMonitoring) {
    logMessage('⚠️ Detené el monitor antes de cambiar de plataforma', 'warning');
    return;
  }

  state.config.platform = platform;
  applyPlatformTheme();

  // Resetear estado de los streams: los mismos nombres se revisarán
  // en la nueva plataforma desde cero.
  state.streams.forEach((_, name) => state.streams.set(name, { isLive: false }));
  renderStreamersList();
  renderStreamsGrid();
  updateStats();

  logMessage(`🎨 Plataforma cambiada a ${PLATFORM_LABELS[platform]}`, 'info');
}

// ============================================================
// Gestión de Streamers
// ============================================================

function addStreamer() {
  const name = elements.streamerInput.value.trim().toLowerCase();
  
  if (!name) {
    logMessage('Debes ingresar un nombre de streamer', 'warning');
    return;
  }
  
  if (state.streamers.includes(name)) {
    logMessage(`${name} ya está en la lista`, 'warning');
    return;
  }
  
  state.streamers.push(name);
  state.streams.set(name, { isLive: false });
  
  elements.streamerInput.value = '';
  renderStreamersList();
  renderStreamsGrid();
  updateUI();
  
  logMessage(`✅ ${name} agregado a la lista`, 'success');
}

function removeStreamer(name) {
  state.streamers = state.streamers.filter(s => s !== name);
  state.streams.delete(name);
  
  renderStreamersList();
  renderStreamsGrid();
  updateUI();
  
  logMessage(`❌ ${name} eliminado de la lista`, 'info');
}

function renderStreamersList() {
  elements.streamersList.innerHTML = '';

  if (state.streamers.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = 'No hay streamers agregados';
    elements.streamersList.appendChild(hint);
    return;
  }

  state.streamers.forEach(name => {
    const stream = state.streams.get(name) || { isLive: false };

    const tag = document.createElement('div');
    tag.className = 'streamer-tag';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'tag-name';

    const dot = document.createElement('span');
    dot.className = 'tag-dot' + (stream.isLive ? ' live' : '');

    nameSpan.appendChild(dot);
    nameSpan.appendChild(document.createTextNode(name));

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-streamer';
    removeBtn.title = 'Eliminar';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => removeStreamer(name));

    tag.appendChild(nameSpan);
    tag.appendChild(removeBtn);
    elements.streamersList.appendChild(tag);
  });
}

// ============================================================
// Monitoreo
// ============================================================

async function toggleMonitoring() {
  if (state.isMonitoring) {
    await stopMonitoring();
  } else {
    await startMonitoring();
  }
}

async function startMonitoring() {
  if (state.streamers.length === 0) {
    logMessage('⚠️  Agrega al menos un streamer para monitorear', 'warning');
    return;
  }
  
  state.isMonitoring = true;
  state.startTime = Date.now();
  
  elements.toggleMonitorBtn.innerHTML = `
    <svg width="20" height="20" fill="currentColor" viewBox="0 0 20 20">
      <path d="M5 4h3v12H5V4zm7 0h3v12h-3V4z"/>
    </svg>
    Detener Monitor
  `;
  elements.toggleMonitorBtn.classList.remove('btn-success');
  elements.toggleMonitorBtn.classList.add('btn-danger');
  
  elements.globalStatus.classList.remove('active');
  elements.globalStatus.classList.add('monitoring');
  elements.globalStatus.querySelector('.status-text').textContent = 'Monitoreando...';
  
  logMessage('🚀 Monitor iniciado', 'success');
  
  // Iniciar monitoreo en el backend
  const result = await window.kickAPI.startMonitoring({
    streamers: state.streamers,
    interval: state.config.interval,
    autoOpen: state.config.autoOpen,
    notifications: state.config.notifications,
    platform: state.config.platform
  });
  
  if (result.success) {
    logMessage(`✅ Monitoreando ${state.streamers.length} streamer(s)`, 'success');
    startStatsTimer();
  } else {
    logMessage('❌ Error al iniciar monitoreo', 'error');
    state.isMonitoring = false;
  }
}

async function stopMonitoring() {
  state.isMonitoring = false;
  
  elements.toggleMonitorBtn.innerHTML = `
    <svg width="20" height="20" fill="currentColor" viewBox="0 0 20 20">
      <path d="M6 4l8 6-8 6V4z"/>
    </svg>
    Iniciar Monitor
  `;
  elements.toggleMonitorBtn.classList.remove('btn-danger');
  elements.toggleMonitorBtn.classList.add('btn-success');
  
  elements.globalStatus.classList.remove('monitoring', 'active');
  elements.globalStatus.querySelector('.status-text').textContent = 'Detenido';
  
  const result = await window.kickAPI.stopMonitoring();
  
  if (result.success) {
    logMessage('🛑 Monitor detenido', 'info');
  }
}

// ============================================================
// Actualización de Streams
// ============================================================

function handleStreamUpdate(data) {
  const { streamer, isLive, title, viewers, thumbnail, profilePic, category } = data;
  
  const previousState = state.streams.get(streamer);
  
  // Actualizar estado (conservar avatar previo si no llega uno nuevo)
  state.streams.set(streamer, {
    isLive,
    title,
    viewers,
    thumbnail,
    profilePic: profilePic || (previousState && previousState.profilePic) || '',
    category
  });
  
  // Detectar cambio de estado
  if (isLive && (!previousState || !previousState.isLive)) {
    // Stream acaba de empezar
    state.streamsDetected++;
    logMessage(`🔴 ${streamer} está EN VIVO! - "${title}"`, 'success');
    logMessage(`   👥 ${viewers} espectadores | ${category}`, 'info');
  } else if (!isLive && previousState && previousState.isLive) {
    // Stream terminó
    logMessage(`⭕ ${streamer} ya no está en vivo`, 'info');
  }
  
  renderStreamsGrid();
  renderStreamersList();
  updateStats();
}

// ============================================================
// UI Rendering
// ============================================================

function renderStreamsGrid() {
  if (state.streamers.length === 0) {
    elements.emptyState.style.display = 'flex';
    elements.streamsGrid.style.display = 'none';
    elements.streamsGrid.innerHTML = '';
    return;
  }

  elements.emptyState.style.display = 'none';
  elements.streamsGrid.style.display = 'grid';
  elements.streamsGrid.innerHTML = '';

  // Adaptar el layout según la cantidad de streamers
  const count = state.streamers.length;
  const layout = count === 1 ? 'count-1'
    : count === 2 ? 'count-2'
    : count === 3 ? 'count-3'
    : count === 4 ? 'count-4'
    : 'count-many';
  elements.streamsGrid.className = `streams-grid ${layout}`;

  const featured = count === 1;

  state.streamers.forEach(name => {
    const stream = state.streams.get(name) || { isLive: false };
    elements.streamsGrid.appendChild(createStreamCard(name, stream, featured));
  });
}

// Construye una imagen con fallback gestionado por JS (compatible con CSP)
function buildImage(src, className, fallbackEl) {
  const img = document.createElement('img');
  img.className = className;
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  fallbackEl.style.display = 'none';
  img.addEventListener('error', () => {
    img.remove();
    fallbackEl.style.display = 'flex';
  });
  img.src = src;
  return img;
}

function createStreamCard(name, stream, featured = false) {
  const initial = name.charAt(0).toUpperCase();

  const card = document.createElement('div');
  card.className = 'stream-card' + (stream.isLive ? ' live' : '') + (featured ? ' featured' : '');
  card.dataset.streamer = name;
  card.title = `Abrir ${name} en Brave`;
  card.addEventListener('click', () => openStream(name));

  // ---- Miniatura ----
  const thumb = document.createElement('div');
  thumb.className = 'stream-thumbnail';

  const thumbPlaceholder = document.createElement('div');
  thumbPlaceholder.className = 'placeholder';
  const thumbIcon = document.createElement('div');
  thumbIcon.className = 'placeholder-icon';
  thumbIcon.textContent = stream.isLive ? '📺' : '😴';
  const thumbLabel = document.createElement('span');
  thumbLabel.textContent = stream.isLive ? 'Sin vista previa' : 'Offline';
  thumbPlaceholder.appendChild(thumbIcon);
  thumbPlaceholder.appendChild(thumbLabel);

  if (stream.isLive && stream.thumbnail) {
    thumb.appendChild(buildImage(stream.thumbnail, '', thumbPlaceholder));
  }
  thumb.appendChild(thumbPlaceholder);

  if (stream.isLive) {
    const badge = document.createElement('div');
    badge.className = 'stream-live-badge';
    badge.textContent = 'En Vivo';
    thumb.appendChild(badge);
  }
  if (stream.isLive && stream.viewers !== undefined) {
    const viewers = document.createElement('div');
    viewers.className = 'stream-viewers';
    viewers.textContent = `👥 ${formatNumber(stream.viewers)}`;
    thumb.appendChild(viewers);
  }

  // ---- Info ----
  const info = document.createElement('div');
  info.className = 'stream-info';

  const avatarFallback = document.createElement('div');
  avatarFallback.className = 'stream-avatar-fallback';
  avatarFallback.textContent = initial;

  if (stream.profilePic) {
    info.appendChild(buildImage(stream.profilePic, 'stream-avatar', avatarFallback));
  }
  info.appendChild(avatarFallback);

  const text = document.createElement('div');
  text.className = 'stream-text';

  const nameEl = document.createElement('div');
  nameEl.className = 'stream-name';
  nameEl.textContent = name;
  text.appendChild(nameEl);

  const titleEl = document.createElement('div');
  if (stream.isLive && stream.title) {
    titleEl.className = 'stream-title';
    titleEl.textContent = stream.title;
  } else {
    titleEl.className = 'stream-title offline';
    titleEl.textContent = 'Sin transmisión';
  }
  text.appendChild(titleEl);

  if (stream.isLive && stream.category) {
    const cat = document.createElement('div');
    cat.className = 'stream-category';
    cat.textContent = stream.category;
    text.appendChild(cat);
  }

  info.appendChild(text);

  card.appendChild(thumb);
  card.appendChild(info);
  return card;
}

async function openStream(streamerName) {
  const platformLabel = PLATFORM_LABELS[state.config.platform];
  logMessage(`🌐 Abriendo stream de ${streamerName} en ${platformLabel}...`, 'info');
  await window.kickAPI.openStream(streamerName, state.config.platform);
}

function updateUI() {
  // Actualizar estado del botón si no hay streamers
  if (state.streamers.length === 0) {
    elements.toggleMonitorBtn.disabled = true;
  } else {
    elements.toggleMonitorBtn.disabled = false;
  }
}

// ============================================================
// Estadísticas
// ============================================================

let statsTimer = null;

function startStatsTimer() {
  if (statsTimer) clearInterval(statsTimer);
  
  statsTimer = setInterval(() => {
    if (state.isMonitoring) {
      updateStats();
    }
  }, 1000);
}

function updateStats() {
  // Tiempo
  if (state.startTime) {
    const elapsed = Math.floor((Date.now() - state.startTime) / 1000 / 60);
    elements.statTime.textContent = `${elapsed}m`;
  }
  
  // Streams detectados
  elements.statStreams.textContent = state.streamsDetected;
  
  // En vivo ahora
  const liveCount = Array.from(state.streams.values()).filter(s => s.isLive).length;
  elements.statLive.textContent = liveCount;
  if (elements.liveCountBadge) {
    elements.liveCountBadge.textContent = `${liveCount} en vivo`;
  }
}

// ============================================================
// Log
// ============================================================

function logMessage(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString('es-ES', { hour12: false });
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `
    <span class="log-timestamp">[${timestamp}]</span>
    <span class="log-message">${message}</span>
  `;
  
  elements.logContent.appendChild(entry);
  elements.logContent.scrollTop = elements.logContent.scrollHeight;
  
  // Limitar a 100 entradas
  const entries = elements.logContent.querySelectorAll('.log-entry');
  if (entries.length > 100) {
    entries[0].remove();
  }
}

function clearLog() {
  elements.logContent.innerHTML = '';
  logMessage('Log limpiado', 'info');
}

// ============================================================
// Utilidades
// ============================================================

function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

// Iniciar aplicación
init();

// ============================================================
// Navegación por Tabs
// ============================================================

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    
    // Actualizar botones activos
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Mostrar/ocultar paneles
    const monitorElements = document.querySelectorAll('.sidebar, .streams-panel');
    const predictionsPanel = document.getElementById('predictionsPanel');
    
    if (tab === 'monitor') {
      monitorElements.forEach(el => el.style.display = '');
      predictionsPanel.style.display = 'none';
    } else if (tab === 'predictions') {
      monitorElements.forEach(el => el.style.display = 'none');
      predictionsPanel.style.display = 'flex';
    }
  });
});
