# PointStream — Dependencias

> Fase 0 — Auditoría 2026-09-17

## package.json

```json
{
  "version": "1.2.0",
  "main": "electron/main.js",
  "devDependencies": {
    "electron": "^28.0.0"          ← Chromium 120.x aprox
    "electron-builder": "^24.9.1"
  },
  "dependencies": {
    "axios": "^1.17.0"
  }
}
```

## Runtime del sistema

- **Node.js:** v24.19.0 (confirmado en el sistema)
- **pnpm:** v12.4.1 (gestor de paquetes primario y recomendado por el proyecto)
- **npm:** disponible como fallback en el launcher `start_electron.bat`

## Dependencias de producción

### axios ^1.17.0
**Usada en:**
- `main.js`: checkKickStatus(), checkTwitchStatus()
- `telegram.js`: apiUrl(), getUpdates(), sendMessage()

**Versión actual en package-lock.json:** ^1.17.0 (reciente)
**Riesgo:** BAJO — API estable

### electron ^28.0.0
**Versión Chromium incluida:** ~120.0.x
**Riesgo:** MEDIO — Cloudflare/HLTV pueden romper con actualizaciones de Chromium/UA

## Sin dependencias externas de scraping

Notable: NO se usa Puppeteer, Playwright ni ninguna librería de scraping.
Todo el scraping se hace con BrowserWindow nativo de Electron + executeJavaScript.
Esto reduce dependencias pero acopla el scraping al ciclo de vida de Electron.

## Dependencias de desarrollo (build scripts)

Los scripts en `build/` son 100% Node puro:
- `zlib` (nativo Node) — para generar PNG/ICO
- `fs`, `path`, `crypto` (nativos Node)
- Sin dependencias externas en scripts de build

## APIs externas

| API | Autenticación | Tipo |
|-----|--------------|------|
| kick.com/api/v2/channels/:id | Ninguna (pública) | REST/JSON |
| gql.twitch.tv/gql | Client-ID público | GraphQL |
| hltv.org | Cloudflare challenge | Scraping DOM |
| forg1.com | Sesión Kick OAuth | Scraping DOM |
| api.telegram.org | Bot token (ofuscado) | REST/JSON |

## Archivos incluidos en build de producción

Según package.json build.files:
```
electron/**/*   ← main.js, preload.js, hltv.js, forg1-scraper.js, telegram.js
ui/**/*         ← index.html, app.js, predictions.js, styles.css
assets/**/*     ← icon.png, icon_hd.png, screenshots/
package.json
```

**NO incluidos:**
- `build/` (solo para desarrollo)
- `node_modules/` (se empaquetan por electron-builder)
- `.git/`, `.agents/`, `dist/`

## Empaquetado NSIS

```
output: dist/
buildResources: build/   ← icon.ico, installerHeader.bmp, installerSidebar.bmp
target: nsis x64
artifact: pointStream-Setup-1.2.0.exe
oneClick: false
perMachine: false
allowToChangeInstallationDirectory: true
createDesktopShortcut: true
createStartMenuShortcut: true
shortcutName: pointStream
deleteAppDataOnUninstall: true
```
