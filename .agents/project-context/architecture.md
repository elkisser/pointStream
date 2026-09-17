# PointStream — Arquitectura

> Última actualización: 2026-09-17 | Fase 0

## Proceso Principal (Electron Main)

`electron/main.js` — punto de entrada. Orquesta todo.

### BrowserWindows activos

| Ventana        | partition     | show  | propósito                               |
|----------------|---------------|-------|-----------------------------------------|
| mainWindow     | (default)     | true  | UI principal 1200×800                   |
| Forg1 scraping | persist:forg1 | false | Scraping DOM de forg1.com (reutilizada) |
| Forg1 login    | persist:forg1 | true  | Login con Kick                          |
| HLTV fetch     | persist:hltv  | false | Scraping HLTV (destruida tras uso)      |
| HLTV connect   | persist:hltv  | true  | Pasar verificación Cloudflare           |

### IPC — Mapa completo

**Streams (Kick/Twitch)**
- `check-stream` → checkStreamStatus()
- `open-stream` → openInBrave()
- `start-monitoring` → setInterval sobre checkStreamStatus
- `stop-monitoring`
- `get-monitoring-status`

**Predicciones**
- `analyze-match` → hltv.analyzeMatchup()
- `scrape-forg1-predictions` → forg1-scraper.scrapeForg1Predictions()
- `forg1-login` → forg1-scraper.openForg1Login()
- `hltv-connect` → hltv.openHLTVConnect()
- `start-predictions-monitoring`
- `stop-predictions-monitoring`
- `get-predictions-monitoring-status`
- `auto-analyze-predictions` (forg1 + HLTV en paralelo)

**Telegram**
- `telegram-get-config`
- `telegram-begin-link`
- `telegram-poll-link`
- `telegram-set-enabled`
- `telegram-unlink`
- `telegram-test`

**Ventana**
- `window-minimize/maximize/close/is-maximized` (send, no handle)
- Event push: `window-state`, `stream-update`, `predictions-update`

## Flujo — Predicción completa

```
"Escanear Forg1" → predictionsAPI.autoAnalyze()
  → IPC: auto-analyze-predictions
  → scrapeForg1Predictions() [persist:forg1]
      polling DOM → parsePredictions()
  → para cada predicción con >=2 equipos:
      analyzeMatchup(t1, t2) [persist:hltv]
          → resolveTeam() → getRankingMap()
          → getTeamResults() × 2
          → getH2H()
          → scoring + verdict
  → renderCards() en UI
```

## Flujo — Monitoreo + Telegram

```
startMonitoring() → registra knownPredictions (sin notificar)
setInterval(60s) → runPredictionScan()
  → detectar nuevas/cerradas vs knownPredictions
  → nueva: showNotification() + notifyTelegramForPrediction()
      → analyzeMatchup() → buildPredictionMessage() → sendMessage()
  → cerrada: mensaje Telegram de resultado
  → push: predictions-update al renderer
```

## Seguridad

- `nodeIntegration: false` en todas las ventanas
- `contextIsolation: true` en todas las ventanas
- CSP en index.html: restricción de fuentes, scripts, conexiones
- Token Telegram: XOR+base64 (ofuscación, NO seguridad real)
- User-Agent: Chrome version real para evadir detección en HLTV

