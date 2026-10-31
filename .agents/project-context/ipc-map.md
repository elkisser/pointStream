# PointStream — IPC Map Completo

> Fase 0 — Auditoría 2026-09-17

## Convenciones

- `ipcMain.handle` → bidireccional (renderer espera respuesta)
- `ipcMain.on` → unidireccional (renderer envía, main actúa)
- `webContents.send` → push del main al renderer (sin respuesta)
- `ipcRenderer.invoke` → llama a `handle`
- `ipcRenderer.send` → llama a `on`
- `ipcRenderer.on` → escucha pushes del main

---

## Namespace: kickAPI (streams)

| IPC Channel | Tipo | Dirección | Handler |
|-------------|------|-----------|---------|
| check-stream | handle | renderer→main→renderer | checkStreamStatus(name, platform) |
| open-stream | handle | renderer→main→renderer | openInBrave(name, platform) |
| start-monitoring | handle | renderer→main→renderer | setInterval + checkStreamStatus |
| stop-monitoring | handle | renderer→main→renderer | clearInterval |
| get-monitoring-status | handle | renderer→main→renderer | { isMonitoring } |
| stream-update | send | main→renderer | { streamer, isLive, title, viewers, thumbnail, profilePic, category } |

---

## Namespace: predictionsAPI

| IPC Channel | Tipo | Dirección | Handler |
|-------------|------|-----------|---------|
| analyze-match | handle | r→m→r | hltv.analyzeMatchup(t1, t2) |
| scrape-forg1-predictions | handle | r→m→r | forg1.scrapeForg1Predictions() |
| forg1-login | handle | r→m→r | forg1.openForg1Login() |
| hltv-connect | handle | r→m→r | hltv.openHLTVConnect() |
| auto-analyze-predictions | handle | r→m→r | forg1 + hltv combo |
| start-predictions-monitoring | handle | r→m→r | setInterval + runPredictionScan |
| stop-predictions-monitoring | handle | r→m→r | clearInterval |
| get-predictions-monitoring-status | handle | r→m→r | { isMonitoring } |
| predictions-update | send | main→renderer | { ok, loggedIn, predictions[], hasNew, newCount } |

---

## Namespace: telegramAPI

| IPC Channel | Tipo | Dirección | Handler |
|-------------|------|-----------|---------|
| telegram-get-config | handle | r→m→r | { chatId, enabled, configured, botUsername } |
| telegram-begin-link | handle | r→m→r | { ok, url, botUsername } |
| telegram-poll-link | handle | r→m→r | { ok, linked, chatId?, chatName? } |
| telegram-set-enabled | handle | r→m→r | { ok, enabled } |
| telegram-unlink | handle | r→m→r | { ok } |
| telegram-test | handle | r→m→r | { ok } |

---

## Namespace: configAPI (configuración persistente — Fase 7)

| IPC Channel | Tipo | Dirección | Handler |
|-------------|------|-----------|---------|
| config-get | handle | r→m→r | configStore.loadConfig() |
| config-save | handle | r→m→r | configStore.saveConfig(data) |
| config-reset | handle | r→m→r | configStore.resetConfig() |

---

## Namespace: windowAPI

| IPC Channel | Tipo | Dirección | Handler |
|-------------|------|-----------|---------|
| window-minimize | on | renderer→main | mainWindow.minimize() |
| window-maximize | on | renderer→main | mainWindow.maximize/unmaximize() |
| window-close | on | renderer→main | mainWindow.close() |
| window-is-maximized | handle | r→m→r | boolean |
| window-state | send | main→renderer | { maximized: bool } |

---

## Observaciones de seguridad IPC

- Todos los handlers usan `ipcMain.handle` (retornan Promise, más seguro)
- Los handlers de ventana usan `ipcMain.on` (fire-and-forget, OK para este caso)
- NO hay validación de origen del IPC (no hay `event.senderFrame` checks)
- El renderer tiene acceso completo a las funciones expuestas en el preload
- No hay rate limiting en los handlers de IPC

## Datos que fluyen main→renderer

### stream-update payload
```js
{
  streamer: string,
  isLive: boolean,
  title?: string,
  viewers?: number,
  thumbnail?: string,
  profilePic?: string,
  category?: string,
  error?: string
}
```

### predictions-update payload
```js
{
  ok: boolean,
  loggedIn?: boolean,
  predictions?: PredictionObject[],
  hasNew?: boolean,
  newCount?: number,
  error?: string
}
```

### PredictionObject
```js
{
  question: string,
  closesAt: string,        // "HH:MM" o ""
  teams: [{ name, percentage }],  // las 2 primeras opciones
  options: [{ name, percentage }], // todas las opciones
  predType: 'team-matchup'|'kills-range'|'ot'|'yes-no'|'map'|'other',
  pool: string,
  players: string,
  myBet: string,
  myWin: string,
  status: 'OPEN'|'WAITING_RESULT'|'RESOLVED'|'UNKNOWN',
  seriesId?: string|null,        // e.g. 'mouz_vs_vitality_2026-09-18' (Fase 9.1)
  mapNumber?: number|null,       // 1, 2, 3 (Fase 9.1)
  mapSignature?: string|null,    // e.g. 'mouz_vs_vitality_2026-09-18_map_2' (Fase 9.1)
  seriesScore?: { team1: number, team2: number }, // (Fase 9.1)
  format?: 'BO1'|'BO3'|'BO5'|'UNKNOWN', // (Fase 9.1)
  analysis?: AnalysisObject  // solo en auto-analyze
}
```

### AnalysisObject (de hltv.analyzeMatchup)
```js
{
  team1: { name, data, probability, found },
  team2: { name, data, probability, found },
  h2h: { total, team1Wins, team2Wins },
  sharedEvent: string|null,
  recommendation: string,
  confidence: number,
  verdict: string,
  verdictLevel: 'green'|'yellow'|'red'|'gray',
  factors: string[],
  dataQuality: 'none'|'partial'|'full'
}
```
