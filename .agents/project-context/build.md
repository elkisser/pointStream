# PointStream — Build y Empaquetado

> Fase 0 — Auditoría 2026-09-17

## Scripts npm

```bash
npm start         # electron .                    ← modo producción
npm run dev       # electron . --dev              ← DevTools habilitadas
npm run icon      # electron build/prepare-icon.js
npm run icon:logo # node build/generate-icon.js   ← regenera icon.png + icon.ico desde cero
npm run art       # node build/generate-installer-art.js ← regenera BMPs
npm run dist      # npm run icon && npm run art && electron-builder  ← INSTALADOR
npm run pack      # npm run icon && electron-builder --dir ← sin instalador
```

## Flujo de build completo

```
1. npm run icon → regenerar icon.png (assets/) + icon.ico (build/)
2. npm run art  → regenerar installerHeader.bmp + installerSidebar.bmp (build/)
3. electron-builder → leer package.json build config
4. Output: dist/PointStream-1.3.0-Setup.exe
```

## Release Candidate 1.3.0 (Fase 8 — 2026-09-18)

- **Versión**: `1.3.0`
- **Comando canónico**: `pnpm run dist`
- **Artefacto**: `dist/PointStream-1.3.0-Setup.exe`
- **Tamaño**: 76,672,468 bytes (~73.1 MB)
- **Arquitectura**: Windows x64
- **SHA-256**: `ADAE20826F626268E8D00D10805DDBCCFA74AFDA9D579EA86DC5C30C91F6273B`
- **Authenticode**: `NotSigned` (Unsigned release documentado formalmente)
- **ASAR**: Filtrado estricto (`electron/**/*`, `ui/**/*`, `assets/**/*`, `package.json`, producción `node_modules`). Cero tests ni archivos `.agents/` o `.git/`.
- **Microsoft Defender Scan**: 0 amenazas detectadas (`MpCmdRun.exe -Scan -ScanType 3`).
- **Audit de Dependencias**: 0 vulnerabilidades en producción (`pnpm audit --prod`).
- **Smoke Test End-to-End**: PASS (Instalación silenciosa NSIS, accesos directos de Escritorio y Menú Inicio, persistencia atómica de config en `%APPDATA%\PointStream\config.json`, recuperación ante archivos corruptos, APIs seguras en preload, preservación de datos en desinstalación y reinstalación exitosa).


## Archivos de build (build/)

| Archivo | Tamaño | Propósito |
|---------|--------|-----------|
| icon.ico | 35.7KB | Icono app + acceso directo + instalador |
| icon.png | 35.7KB | Icono Linux/macOS |
| installerHeader.bmp | 25.8KB | Banner NSIS arriba |
| installerSidebar.bmp | 154.5KB | Panel lateral NSIS |
| generate-icon.js | 4.7KB | Generador de icono puro Node |
| generate-installer-art.js | 4.6KB | Generador de BMPs |
| prepare-icon.js | 2.4KB | Alternativa de preparación |
| capture-screenshots.js | 2.1KB | Screenshots automatizadas |
| setup-telegram-bot.js | 2.0KB | Setup inicial del bot |

## Configuración electron-builder (package.json — Fase 5)

```json
{
  "appId": "com.pointstream.app",
  "productName": "PointStream",
  "copyright": "Copyright © 2026",
  "directories": {
    "output": "dist",
    "buildResources": "build"
  },
  "asar": true,
  "files": [
    "electron/**/*",
    "ui/**/*",
    "assets/**/*",
    "!assets/icon_hd.png",
    "!assets/screenshots/**/*",
    "package.json"
  ],
  "win": {
    "target": [{ "target": "nsis", "arch": ["x64"] }],
    "icon": "build/icon.ico",
    "executableName": "PointStream",
    "artifactName": "PointStream-${version}-Setup.${ext}"
  },
  "nsis": {
    "oneClick": false,
    "perMachine": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "PointStream",
    "installerIcon": "build/icon.ico",
    "uninstallerIcon": "build/icon.ico",
    "installerHeaderIcon": "build/icon.ico",
    "installerHeader": "build/installerHeader.bmp",
    "installerSidebar": "build/installerSidebar.bmp",
    "uninstallerSidebar": "build/installerSidebar.bmp",
    "deleteAppDataOnUninstall": false,
    "runAfterFinish": true,
    "menuCategory": false
  }
}
```

## Problemas de identidad visual del instalador

- Los BMPs se generan programáticamente → pueden verse genéricos
- El header BMP (164×314 típico de NSIS classic) muestra el banner superior
- El sidebar BMP (164×314) muestra el panel lateral durante instalación
- El icono ICO se usa en: ventana del instalador, acceso directo, Task Manager
- Paleta de colores PointStream: verde #53FC18, fondo #0b0e0f, fuente Inter

## .gitignore

Actualmente excluye:
- node_modules/
- dist/, release/, out/
- Logs (npm-debug.log*, *.log)
- IDE (.vscode/, .idea/)
- OS (Thumbs.db, .DS_Store)

**NO excluye .agents/** → los archivos de contexto irán al repo (intencional).
Si se desea excluir, agregar `.agents/` al .gitignore.
