# PointStream — Módulos

> Fase 0 — Auditoría 2026-09-17

## electron/main.js (28.8KB, 825 líneas)
**Responsabilidad:** Proceso principal Electron. Orquesta todo.
**Dependencias:** hltv.js, forg1-scraper.js, telegram.js, axios
**Expone:** Todos los IPC handlers (22 handlers + 4 window events)
**Estado global:**
- `mainWindow` — referencia a la ventana principal
- `monitorInterval` — setInterval del monitor de streams
- `isMonitoring` — flag de estado
- `currentStreamers` — Map(streamer → isLive)
- `openedStreamers` — Set de streamers ya abiertos en sesión
- `predMonitorInterval` — setInterval del monitor de predicciones
- `isPredMonitoring` — flag
- `knownPredictions` — Map(sig → pred) estado actual conocido
- `notifiedPredictions` — Set(sig) ya notificados en Telegram
- `recentlyClosed` — Map(sig → timestamp) cooldown 5min

**NO modificar sin justificación:**
- La lógica de deduplicación `predictionSignature()` (estable, bien probada)
- La lógica de cooldown recentlyClosed (evita spam de notificaciones)
- El User-Agent fallback (crítico para HLTV)

---

## electron/hltv.js (23.3KB, 625 líneas)
**Responsabilidad:** Scraping de HLTV con Cloudflare bypass.
**Dependencias:** electron BrowserWindow (persist:hltv)
**Expone:** `analyzeMatchup`, `searchTeam`, `normalizeTeamName`, `openHLTVConnect`

**Caches en memoria (se pierden al reiniciar):**
- `rankingCache` — ranking mundial, TTL 30min
- `searchCache` — búsquedas de equipo, TTL 1h
- `resultsCache` — resultados por team ID, TTL 15min

**Estrategia de resolución de equipos:**
1. `TEAM_ALIASES` — alias hardcodeados (forg1 → HLTV name)
2. `getRankingMap()` — ranking top (rápido, da rank #)
3. `searchTeam()` — búsqueda en HLTV (lento, fallback)

**Scoring de matchup:**
- Ranking mundial → hasta ±25 puntos
- Winrate reciente → hasta ±14 puntos
- Forma en competencia → hasta ±18 puntos
- Head to head → 4 pts × victoria
- Blend: 78% datos / 22% base (50/50)
- Clampeo: 15% mín, 85% máx

**Riesgo alto:**
- Cloudflare puede cambiar el challenge y romper el bypass
- HLTV puede cambiar el DOM y romper los selectores CSS
- Los caches son in-memory: cada restart vacía el cache

---

## electron/forg1-scraper.js (~23KB, 634 líneas)
**Responsabilidad:** Scraping y parsing estructurado de predicciones en forg1.com.
**Dependencias:** electron BrowserWindow (persist:forg1)
**Expone:** `scrapeForg1Predictions`, `openForg1Login`, `parsePredictionFromState`, `parsePredictionsFromText`, `parsePredictions`, `classifyPrediction`

**Estrategia de scraping y parsing (Fase 3):**
- **Fuente Principal:** Consume el endpoint interno `/api/predictions/state` mediante `fetch` dentro de la ventana de sesión autenticada `persist:forg1`.
- **Estructura de Dominio:** Modela fielmente `Prediction -> markets[] -> selections[]` preservando IDs estables, puntos, apostadores y colores.
- **Parser de Fallback:** Parser de texto plano (`parsePredictionsFromText`) que detecta múltiples preguntas/mercados y agrupa sus selecciones sin aplanar.
- **Clasificador dinámico:** `classifyPrediction` identifica `team-matchup`, `kills-range`, `ot`, `yes-no`, `map`, `other`.
- **UI_WORDS:** set de 50+ palabras de navegación para filtrar ruido en fallback.
- **isLoggedIn():** detecta presencia de 'TU BALANCE', 'MI PERFIL', etc.
- **Timeout total:** 30 segundos; Polling cada: 2.5 segundos.

**Ventana persist:forg1 y Login Flow (Fase 2):**
- Se reutiliza entre scans (singleton `_win`) y se destruye al cerrar la ventana de login
- Cookies Kick/Forg1 persisten entre reinicios de la app (partition persist:forg1)
- User-Agent de Chrome limpio configurado explícitamente en `session.fromPartition('persist:forg1')`
- `setWindowOpenHandler` redirige popups/enlaces de kick y forg1 a la misma ventana manteniendo sesión
- `openForg1Login()` carga directamente `https://www.forg1.com/login` (evita 307 de raíz)
- Instrumentación no invasiva de eventos (`will-navigate`, `did-navigate`, etc.) con sanitización estricta de tokens
- Detección automática de login al navegar en `did-navigate` evaluando `isLoggedIn()`

**Limitaciones conocidas:**
- El parser de texto plano de fallback depende de la estructura textual visible si `/api/predictions/state` estuviera inaccesible.

---

## electron/telegram.js (5.7KB, 171 líneas)
**Responsabilidad:** Notificaciones push al chat personal del usuario.
**Dependencias:** axios, electron app (userData path), fs, crypto
**Expone:** `BOT_USERNAME`, `loadConfig`, `saveConfig`, `isConfigured`, `beginLink`, `pollLink`, `sendMessage`, `unlink`

**Bot:** @PointStreaming_bot (compartido, token ofuscado XOR+base64)
**Persistencia:** `{userData}/telegram-config.json` → `{ chatId, enabled }`
**Vinculación:** deep link → t.me/bot?start=link → polling getUpdates → primer /start recibido
**Bug conocido:** `unlink()` referencia `pendingCode` que no existe en este scope (línea 157)

---

## electron/preload.js (2.7KB, 63 líneas)
**Responsabilidad:** Bridge seguro Main ↔ Renderer.
**Dependencias:** contextBridge, ipcRenderer
**Expone 4 APIs:**
- `window.kickAPI` — streams, monitoring, stream updates
- `window.windowAPI` — controles de ventana
- `window.predictionsAPI` — forg1 + HLTV + monitoreo
- `window.telegramAPI` — configuración y notificaciones

---

## ui/app.js (20.2KB, 624 líneas)
**Responsabilidad:** UI del tab "Monitor" (streams Kick/Twitch).
**Dependencias:** window.kickAPI, window.windowAPI
**Estado:** `state` object (no persistente entre sesiones)
**Nota:** Los streamers por defecto son ['baldu', 'forg1'] (hardcoded línea 3)
**Sin persistencia:** la lista de streamers se pierde al cerrar la app

---

## ui/predictions.js (20.3KB, 531 líneas)
**Responsabilidad:** UI del tab "Predicciones CS2".
**Dependencias:** window.predictionsAPI, window.telegramAPI
**Funciones clave:**
- `doScan()` → auto-analyze completo
- `doManual()` → análisis manual por nombre de equipo
- `toggleMonitoring()` → inicia/detiene monitoreo automático
- `renderCards()` → renderiza tarjetas de predicción con countdown
- `initTelegram()` → setup UI de Telegram

---

## ui/index.html (16.7KB, 336 líneas)
**Responsabilidad:** Estructura HTML. Frame custom, 2 tabs.
**CSP:** `default-src 'self'` con excepciones para Google Fonts y conexiones HLTV/Forg1
**Tabs:** Monitor | Predicciones CS2

---

## ui/styles.css (42KB, ~1500 líneas estimadas)
**Responsabilidad:** Todo el diseño visual.
**No analizado en detalle en Fase 0.** Ver para temas de identidad visual.

---

## build/ (scripts de build)
- `generate-icon.js` — genera icon.png + icon.ico desde cero en puro Node (sin deps externas)
- `generate-installer-art.js` — genera BMP para NSIS (header + sidebar)
- `prepare-icon.js` — alternativa de preparación de icono
- `capture-screenshots.js` — capturas automatizadas
- `setup-telegram-bot.js` — setup inicial del bot
- `icon.ico`, `icon.png` — assets pre-generados
- `installerHeader.bmp` (25KB), `installerSidebar.bmp` (154KB)
